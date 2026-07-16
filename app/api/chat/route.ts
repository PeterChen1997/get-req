import { openai } from "@ai-sdk/openai";
import {
  streamText,
  convertToModelMessages,
  type UIMessage,
  tool,
  zodSchema,
  isStepCount,
} from "ai";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import Exa from "exa-js";
import { db } from "@/lib/db";
import { createNotionPage } from "@/lib/notion";
import { SYSTEM_PROMPT } from "@/lib/prompts";
import {
  CHAT_MAX_MESSAGES,
  CHAT_MAX_MESSAGE_CHARS,
  CHAT_MAX_OUTPUT_TOKENS,
  SESSION_MAX_AGE_DAYS,
  DAILY_BUDGET_USD,
  SEARCH_MAX_PER_SESSION,
  SOFT_LIMIT_DIRECTIVE,
  HARD_LIMIT_DIRECTIVE,
  estimateCostUsd,
  evaluateSessionBudget,
  checkRateLimit,
  acquireStreamLock,
  releaseStreamLock,
} from "@/lib/budget";

// 所有防线拒绝统一返回纯文本，assistant-ui 的 AssistantChatTransport 会把非 2xx 响应体
// 原样抛为 Error message 显示在红色错误框里，纯文本即友好中文提示，前端零改动。
function textResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

// 统计最后一条用户消息的文本字符数（L1 单条消息长度限制用）
function lastUserMessageChars(messages: UIMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages.at(i);
    if (!m || m.role !== "user") continue;
    let chars = 0;
    for (const part of m.parts) {
      if (part.type === "text") chars += part.text.length;
    }
    return chars;
  }
  return 0;
}

// Exa 懒初始化（模块级单例；EXA_API_KEY 缺失时 webSearch 优雅返回不可用）
let _exa: Exa | null = null;
function getExa(): Exa {
  if (!_exa) _exa = new Exa(process.env.EXA_API_KEY);
  return _exa;
}

export async function POST(req: Request) {
  // 1. 解析 + 类型守卫
  let body: { messages?: UIMessage[]; sessionToken?: string };
  try {
    body = await req.json();
  } catch {
    return textResponse(400, "请求格式错误");
  }
  const messages = body.messages;
  const sessionToken = body.sessionToken;
  if (
    !Array.isArray(messages) ||
    typeof sessionToken !== "string" ||
    sessionToken.length === 0
  ) {
    return textResponse(400, "请求格式错误");
  }

  // 2. 会话校验 + 时效
  const submission = db.getSubmissionBySession(sessionToken);
  if (!submission) {
    return textResponse(401, "会话无效，请重新开始");
  }
  const createdAtMs = Date.parse(
    submission.created_at.replace(" ", "T") + "Z"
  );
  if (
    Number.isFinite(createdAtMs) &&
    Date.now() - createdAtMs > SESSION_MAX_AGE_DAYS * 86_400_000
  ) {
    return textResponse(401, "会话已过期，请联系运营者获取新邀请码");
  }

  // 3. L1 请求级护栏
  if (messages.length > CHAT_MAX_MESSAGES) {
    return textResponse(400, "对话太长了，请开启新的会话");
  }
  if (lastUserMessageChars(messages) > CHAT_MAX_MESSAGE_CHARS) {
    return textResponse(
      400,
      `单条消息太长了（上限 ${CHAT_MAX_MESSAGE_CHARS} 字），请分几次发送`
    );
  }

  // 4. L4 全局熔断（当日全站成本）
  const todayCost = estimateCostUsd(db.getTodayGlobalUsage());
  if (todayCost >= DAILY_BUDGET_USD) {
    return textResponse(503, "今日服务额度已用完，请明天再来，感谢理解~");
  }

  // 5. L4 限流 + 并发锁（单机内存态）
  const now = Date.now();
  if (!checkRateLimit(sessionToken, now)) {
    return textResponse(429, "发送太频繁了，请稍等一分钟再试");
  }
  if (!acquireStreamLock(sessionToken, now)) {
    return textResponse(429, "上一条回复还在生成中，请等它完成");
  }

  // 锁已持有：此后任何提前 return / throw 都必须释放锁
  try {
    // 6. L2 会话预算档位
    const usageBefore = db.getUsageBySubmission(submission.id);
    const requirement = db.getRequirementBySubmission(submission.id);
    const userTurns = messages.filter((m) => m.role === "user").length;
    const postDocTurns = requirement
      ? db.countUsageSince(submission.id, requirement.created_at)
      : 0;
    const verdict = evaluateSessionBudget({
      userTurns,
      usage: usageBefore,
      hasRequirement: Boolean(requirement),
      postDocTurns,
    });

    if (verdict.kind === "locked") {
      releaseStreamLock(sessionToken);
      return textResponse(403, verdict.reason);
    }

    // 7. 动态 system：软/硬阈值追加收敛/强制生成指令
    const system = [
      SYSTEM_PROMPT,
      verdict.kind === "soft" ? SOFT_LIMIT_DIRECTIVE : null,
      verdict.kind === "hard-final" ? HARD_LIMIT_DIRECTIVE : null,
    ]
      .filter((s): s is string => s !== null)
      .join("\n\n");
    const forceSubmit = verdict.kind === "hard-final";

    // 本次请求内的 Exa 搜索计数（与 DB 累计合并做会话额度判定，onEnd 落库）
    let searchCountThisRequest = 0;

    // 使用 chat completions 接口（.chat），兼容自建/中转的 OpenAI 兼容网关（仅支持
    // /v1/chat/completions，不支持默认 provider 走的 /v1/responses）。
    const model = openai.chat(process.env.OPENAI_MODEL || "gpt-4o");

    const tools = {
      // 联网搜索：查证行业现成方案/最新做法，供 AI 在需求梳理与生成文档时参考。
      // 每会话有次数上限；EXA_API_KEY 缺失或调用失败时返回结构化提示而非抛错，不打断对话。
      webSearch: tool({
        description:
          "搜索互联网获取最新信息，用于查证是否已有现成的成熟工具/产品能满足需求、了解别人怎么做类似的事。返回网页标题、链接和相关摘录。",
        inputSchema: zodSchema(
          z.object({
            query: z
              .string()
              .describe("搜索查询词，尽量具体明确，可用中文或英文"),
          })
        ),
        execute: async ({ query }) => {
          if (!process.env.EXA_API_KEY) {
            return {
              status: "unavailable" as const,
              message: "搜索功能未启用，请基于已经聊到的内容继续。",
            };
          }
          if (
            usageBefore.searchCount + searchCountThisRequest >=
            SEARCH_MAX_PER_SESSION
          ) {
            return {
              status: "quota_exhausted" as const,
              message: "本次聊天的搜索次数用完了，请基于已经聊到的内容继续。",
            };
          }
          searchCountThisRequest += 1;
          try {
            const res = await getExa().search(query, {
              numResults: 5,
              contents: { highlights: true },
            });
            return {
              status: "ok" as const,
              results: res.results.map((r) => ({
                title: r.title ?? "",
                url: r.url,
                highlights: (r.highlights ?? []).join(" … ").slice(0, 500),
              })),
            };
          } catch {
            return {
              status: "error" as const,
              message: "搜索暂时用不了，请基于已经聊到的内容继续。",
            };
          }
        },
      }),
      submitDocument: tool({
        description:
          "当需求信息已充分收敛后，调用此工具生成结构化需求文档。文档包含10个章节，前5章为预览版，后5章为完整版。每个章节内容应有实际决策价值，不堆砌字数。若结论是现有成熟工具/产品已能满足需求，文档应明确推荐该方案与上手路径，而不是虚构定制开发内容。",
        inputSchema: zodSchema(z.object({
          backgroundAndGoals: z
            .string()
            .describe("需求背景与目标：为什么要做、想达成什么"),
          targetUsersAndScenarios: z
            .string()
            .describe("目标用户与核心场景：用户画像与关键使用场景"),
          painAnalysis: z
            .string()
            .describe("痛点分析：现有方案的问题、为什么需要新方案"),
          requirementSummary: z
            .string()
            .describe("需求概要：主要功能模块的标题列表，每个标题占一行"),
          aiInsights: z
            .string()
            .describe(
              "AI关键洞察与盲点：AI主动指出用户未曾意识到的关键点、潜在风险或机会；如做过 webSearch，引用搜到的行业最新做法或现成产品情况佐证；若现成工具已能满足需求，在此明确给出推荐"
            ),
          detailedFeatures: z
            .string()
            .describe("详细功能拆解：每个功能模块的详细描述与子功能"),
          acceptanceCriteria: z
            .string()
            .describe(
              "可测试的验收标准：给每个核心功能写出具体、可判断的验收条件（形如「输入 XX，应当 YY」），落到可核对的程度，不要写「体验良好」「响应及时」这类空话。用户在聊天中亲口确认过的成功标准标注 [用户确认]，你自行推断补充的标注 [AI建议]。"
            ),
          technicalSuggestions: z
            .string()
            .describe(
              "技术方案建议：推荐的技术栈、架构方案与理由；优先参考 webSearch 搜到的最新做法并附来源链接；若采用现成方案，给出选型对比而非自研方案"
            ),
          risksAndCosts: z
            .string()
            .describe("风险/边界/成本预估：主要风险点、边界条件与粗略成本估算"),
          deliveryPlan: z
            .string()
            .describe("分期交付与报价建议：推荐的交付里程碑与对应的工作量估算"),
        })),
        execute: async (doc) => {
          const operatorWechat =
            process.env.OPERATOR_WECHAT || "请联系运营者获取联系方式";

          // 每次调用都重新查询最新快照，避免同一次流式请求内 AI 多次调用本工具
          // （stopWhen: isStepCount(3)）时仍看到请求入口处的旧快照而重复创建记录。
          const existingReq = db.getRequirementBySubmission(submission.id);

          if (existingReq?.notion_url && existingReq?.notion_full_url) {
            return {
              success: true,
              message: "需求文档已生成",
              notionUrl: existingReq.notion_url,
              requirementId: existingReq.id,
              operatorWechat,
            };
          }

          const previewSections = [
            { title: "需求背景与目标", content: doc.backgroundAndGoals },
            {
              title: "目标用户与核心场景",
              content: doc.targetUsersAndScenarios,
            },
            { title: "痛点分析", content: doc.painAnalysis },
            { title: "需求概要", content: doc.requirementSummary },
            { title: "AI关键洞察与盲点", content: doc.aiInsights },
          ];

          const fullSections = [
            ...previewSections,
            { title: "详细功能拆解", content: doc.detailedFeatures },
            { title: "可测试的验收标准", content: doc.acceptanceCriteria },
            { title: "技术方案建议", content: doc.technicalSuggestions },
            { title: "风险/边界/成本预估", content: doc.risksAndCosts },
            { title: "分期交付与报价建议", content: doc.deliveryPlan },
          ];

          const previewContent = previewSections
            .map((s) => `## ${s.title}\n\n${s.content}`)
            .join("\n\n");

          const fullContent = fullSections
            .map((s) => `## ${s.title}\n\n${s.content}`)
            .join("\n\n");

          const dateStr = new Date().toLocaleDateString("zh-CN");
          const pageTitle = `需求文档 - ${submission.name} - ${dateStr}`;

          // 完整版写入 NOTION_PRIVATE_PARENT_PAGE_ID 下的独立页面（运营者私有查阅，不随公开父页面继承分享），
          // 预览版写入 NOTION_PARENT_PAGE_ID 下的独立页面（供用户通过公开链接查看）。
          // 已成功创建的一侧不重复创建，仅重试此前失败（url 为空）的一侧。
          const [fullPageResult, previewPageResult] = await Promise.all([
            existingReq?.notion_full_url
              ? Promise.resolve({ url: existingReq.notion_full_url })
              : createNotionPage(`${pageTitle}（完整版-内部）`, fullSections, {
                  private: true,
                }),
            existingReq?.notion_url
              ? Promise.resolve({ url: existingReq.notion_url })
              : createNotionPage(`${pageTitle}（预览版）`, previewSections),
          ]);

          // existingReq 存在但此前 Notion 创建失败（notion_url 为空）时，此处重试创建并回填记录，
          // 而不是首次创建的场景才写 requirements 表，避免重复插入。
          const requirementId = existingReq?.id ?? uuidv4();
          if (existingReq) {
            db.updateRequirementNotionUrls(requirementId, {
              notionUrl: previewPageResult?.url,
              notionFullUrl: fullPageResult?.url,
            });
          } else {
            db.createRequirement({
              id: requirementId,
              submissionId: submission.id,
              previewContent,
              fullContent,
              notionUrl: previewPageResult?.url,
              notionFullUrl: fullPageResult?.url,
            });
          }

          if (previewPageResult) {
            return {
              success: true,
              message: "需求文档已生成并保存到 Notion",
              notionUrl: previewPageResult.url,
              requirementId,
              operatorWechat,
            };
          }

          return {
            success: true,
            message: `需求文档已生成，但 Notion 保存失败。请通过微信联系运营者获取文档：${operatorWechat}`,
            requirementId,
            fallbackContact: operatorWechat,
            operatorWechat,
          };
        },
      }),
    };

    // 8. 流式生成。hard-final 时双保险强制生成文档：activeTools 关闭搜索 +
    // prepareStep 仅 step 0 强制 toolChoice（后续 step 恢复 auto，让 AI 输出说明文字）。
    const result = streamText({
      model,
      system,
      messages: await convertToModelMessages(messages),
      stopWhen: isStepCount(3),
      maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
      tools,
      activeTools: forceSubmit ? ["submitDocument"] : undefined,
      prepareStep: forceSubmit
        ? ({ stepNumber }) =>
            stepNumber === 0
              ? { toolChoice: { type: "tool", toolName: "submitDocument" } }
              : {}
        : undefined,
      onEnd: ({ usage }) => {
        releaseStreamLock(sessionToken);
        db.recordChatUsage({
          submissionId: submission.id,
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          totalTokens: usage.totalTokens ?? 0,
          searchCount: searchCountThisRequest,
        });
      },
      onError: () => releaseStreamLock(sessionToken),
      onAbort: () => releaseStreamLock(sessionToken),
    });

    // 客户端断开时仍在服务端跑完流，保证 onEnd 触发（usage 落库 + 释放并发锁）。
    // onError 兜住流内错误，避免未处理的 promise rejection（锁仍由顶层 onError 释放）。
    result.consumeStream({ onError: () => {} });
    return result.toUIMessageStreamResponse();
  } catch (err) {
    releaseStreamLock(sessionToken);
    throw err;
  }
}

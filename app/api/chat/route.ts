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
import { db } from "@/lib/db";
import { createNotionPage } from "@/lib/notion";
import { SYSTEM_PROMPT } from "@/lib/prompts";

export async function POST(req: Request) {
  const {
    messages,
    sessionToken,
  }: {
    messages: UIMessage[];
    sessionToken?: string;
  } = await req.json();

  const submission = sessionToken
    ? db.getSubmissionBySession(sessionToken)
    : undefined;

  if (!submission) {
    return new Response(
      JSON.stringify({ error: "会话无效，请重新开始" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  // 使用 chat completions 接口（.chat），兼容自建/中转的 OpenAI 兼容网关（仅支持
  // /v1/chat/completions，不支持默认 provider 走的 /v1/responses）。
  const model = openai.chat(process.env.OPENAI_MODEL || "gpt-4o");

  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    stopWhen: isStepCount(3),
    tools: {
      submitDocument: tool({
        description:
          "当需求信息已充分收敛后，调用此工具生成结构化需求文档。文档包含10个章节，前5章为预览版，后5章为完整版。每个章节内容应有实际决策价值，不堆砌字数。",
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
              "AI关键洞察与盲点：AI主动指出用户未曾意识到的关键点、潜在风险或机会"
            ),
          detailedFeatures: z
            .string()
            .describe("详细功能拆解：每个功能模块的详细描述与子功能"),
          acceptanceCriteria: z
            .string()
            .describe("可测试的验收标准：每个核心功能的具体验收条件"),
          technicalSuggestions: z
            .string()
            .describe("技术方案建议：推荐的技术栈、架构方案与理由"),
          risksAndCosts: z
            .string()
            .describe("风险/边界/成本预估：主要风险点、边界条件与粗略成本估算"),
          deliveryPlan: z
            .string()
            .describe("分期交付与报价建议：推荐的交付里程碑与对应的工作量估算"),
        })),
        execute: async (doc) => {
          // 每次调用都重新查询最新快照，避免同一次流式请求内 AI 多次调用本工具
          // （stopWhen: isStepCount(3)）时仍看到请求入口处的旧快照而重复创建记录。
          const existingReq = db.getRequirementBySubmission(submission.id);

          if (existingReq?.notion_url && existingReq?.notion_full_url) {
            return {
              success: true,
              message: "需求文档已生成",
              notionUrl: existingReq.notion_url,
              requirementId: existingReq.id,
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
            };
          }

          const operatorWechat =
            process.env.OPERATOR_WECHAT || "请联系运营者获取联系方式";
          return {
            success: true,
            message: `需求文档已生成，但 Notion 保存失败。请通过微信联系运营者获取文档：${operatorWechat}`,
            requirementId,
            fallbackContact: operatorWechat,
          };
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}

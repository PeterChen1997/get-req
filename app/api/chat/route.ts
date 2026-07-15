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

  const existingReq = submission
    ? db.getRequirementBySubmission(submission.id)
    : undefined;

  const model = openai(process.env.OPENAI_MODEL || "gpt-4o");

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
          if (!submission) {
            return { success: false, message: "会话无效，请重新开始" };
          }

          if (existingReq) {
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

          const notionResult = await createNotionPage(
            pageTitle,
            previewSections
          );

          const requirementId = uuidv4();
          db.createRequirement({
            id: requirementId,
            submissionId: submission.id,
            previewContent,
            fullContent,
            notionUrl: notionResult?.url,
          });

          if (notionResult) {
            return {
              success: true,
              message: "需求文档已生成并保存到 Notion",
              notionUrl: notionResult.url,
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

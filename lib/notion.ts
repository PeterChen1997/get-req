import { Client } from "@notionhq/client";

function getClient(): Client | null {
  const token = process.env.NOTION_TOKEN;
  if (!token) return null;
  return new Client({ auth: token });
}

type BlockObjectRequest = Parameters<Client["blocks"]["children"]["append"]>[0]["children"][number];
type RichText = {
  type: "text";
  text: { content: string };
  annotations?: { bold: boolean };
};

// Notion 单个 rich_text 片段上限 2000 字，超长按字符切分。
function chunkText(text: string, maxLen = 2000): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    chunks.push(remaining.slice(0, maxLen));
    remaining = remaining.slice(maxLen);
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

// 将一行文本切成 rich_text 片段，解析行内 **加粗**，并保证每片不超过 2000 字。
function toRichText(line: string): RichText[] {
  const segments: RichText[] = [];
  for (const part of line.split(/(\*\*[^*]+\*\*)/g)) {
    if (part.length === 0) continue;
    const isBold =
      part.length > 4 && part.startsWith("**") && part.endsWith("**");
    const raw = isBold ? part.slice(2, -2) : part;
    for (const chunk of chunkText(raw)) {
      segments.push(
        isBold
          ? { type: "text", text: { content: chunk }, annotations: { bold: true } }
          : { type: "text", text: { content: chunk } }
      );
    }
  }
  return segments.length > 0 ? segments : [{ type: "text", text: { content: "" } }];
}

// 把一段 Markdown 文本解析成 Notion block 列表：识别标题（#）、无序列表（- / *）、
// 有序列表（1.）与普通段落；空行仅作分隔不产出块。这样标题就是标题、列表就是列表，
// 而不是把整段连同 Markdown 符号塞进单个段落块。
function markdownToBlocks(content: string): BlockObjectRequest[] {
  const blocks: BlockObjectRequest[] = [];

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.trim().length === 0) continue;

    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        object: "block" as const,
        // 章节标题已是 heading_2，正文内标题统一降一级到 heading_3。
        type: "heading_3" as const,
        heading_3: { rich_text: toRichText(heading.at(1) ?? "") },
      });
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      blocks.push({
        object: "block" as const,
        type: "bulleted_list_item" as const,
        bulleted_list_item: { rich_text: toRichText(bullet.at(1) ?? "") },
      });
      continue;
    }

    const numbered = /^\d+\.\s+(.*)$/.exec(line);
    if (numbered) {
      blocks.push({
        object: "block" as const,
        type: "numbered_list_item" as const,
        numbered_list_item: { rich_text: toRichText(numbered.at(1) ?? "") },
      });
      continue;
    }

    blocks.push({
      object: "block" as const,
      type: "paragraph" as const,
      paragraph: { rich_text: toRichText(line) },
    });
  }

  return blocks;
}

function sectionToBlocks(
  title: string,
  content: string
): BlockObjectRequest[] {
  return [
    {
      object: "block" as const,
      type: "heading_2" as const,
      heading_2: {
        rich_text: [{ type: "text" as const, text: { content: title } }],
      },
    },
    ...markdownToBlocks(content),
  ];
}

export async function createNotionPage(
  title: string,
  sections: { title: string; content: string }[],
  options?: { private?: boolean }
): Promise<{ url: string } | null> {
  const client = getClient();
  const parentPageId = options?.private
    ? process.env.NOTION_PRIVATE_PARENT_PAGE_ID
    : process.env.NOTION_PARENT_PAGE_ID;

  if (!client || !parentPageId) return null;

  try {
    const allBlocks = sections.flatMap((s) =>
      sectionToBlocks(s.title, s.content)
    );

    const firstBatch = allBlocks.slice(0, 100);

    const page = await client.pages.create({
      parent: { page_id: parentPageId },
      properties: {
        title: {
          type: "title" as const,
          title: [{ type: "text" as const, text: { content: title } }],
        },
      },
      children: firstBatch as Parameters<typeof client.pages.create>[0]["children"],
    });

    for (let i = 100; i < allBlocks.length; i += 100) {
      const batch = allBlocks.slice(i, i + 100);
      await client.blocks.children.append({
        block_id: page.id,
        children: batch,
      });
    }

    // Notion API 不支持通过代码开启「Share to web」，public_url 仅在父页面
    // 已被手动设为 Public 分享时才会被继承并返回；否则需要 Notion 账号登录才能访问 url。
    // 完整版页面创建在私有父页面下，即使意外继承了公开分享也坚持返回内部 url，避免泄露。
    const { url, public_url } = page as { url: string; public_url: string | null };
    return { url: options?.private ? url : public_url || url };
  } catch (err) {
    console.error("Notion page creation failed:", err);
    return null;
  }
}

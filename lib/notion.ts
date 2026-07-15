import { Client } from "@notionhq/client";

function getClient(): Client | null {
  const token = process.env.NOTION_TOKEN;
  if (!token) return null;
  return new Client({ auth: token });
}

function splitText(text: string, maxLen = 2000): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt <= 0) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

type BlockObjectRequest = Parameters<Client["blocks"]["children"]["append"]>[0]["children"][number];

function sectionToBlocks(
  title: string,
  content: string
): BlockObjectRequest[] {
  const blocks: BlockObjectRequest[] = [
    {
      object: "block" as const,
      type: "heading_2" as const,
      heading_2: {
        rich_text: [{ type: "text" as const, text: { content: title } }],
      },
    },
  ];

  for (const chunk of splitText(content)) {
    blocks.push({
      object: "block" as const,
      type: "paragraph" as const,
      paragraph: {
        rich_text: [{ type: "text" as const, text: { content: chunk } }],
      },
    });
  }

  return blocks;
}

export async function createNotionPage(
  title: string,
  sections: { title: string; content: string }[]
): Promise<{ url: string } | null> {
  const client = getClient();
  const parentPageId = process.env.NOTION_PARENT_PAGE_ID;

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
    const { url, public_url } = page as { url: string; public_url: string | null };
    return { url: public_url || url };
  } catch (err) {
    console.error("Notion page creation failed:", err);
    return null;
  }
}

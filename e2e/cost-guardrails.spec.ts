import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";

// 成本管理五层防线的接口级验证：直接建库造出各种会话状态，命中 streamText 之前的拒绝逻辑，
// 因此这些用例不消耗 LLM 额度，且完全确定性。
// WHY：这些断言编码「什么情况必须拦、拦了给什么友好提示」，任何一层被误改都会在此暴露。

const ADMIN_SECRET = process.env.ADMIN_SECRET || "test-admin-secret";
const DB_PATH = path.join(process.cwd(), "data", "get-req.db");

// 每个用例用独立 token，避免相互污染内存限流/并发锁状态
function freshIds(tag: string) {
  const rnd = Math.random().toString(36).slice(2, 8);
  return { sid: `e2e-${tag}-${rnd}`, stok: `e2etok-${tag}-${rnd}` };
}

function withDb<T>(fn: (db: Database.Database) => T): T {
  const db = new Database(DB_PATH);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function createSubmission(sid: string, stok: string, agedDays = 0) {
  withDb((db) => {
    // 确保有可引用的邀请码（外键）
    db.prepare(
      "INSERT OR IGNORE INTO invite_codes (code, max_uses) VALUES ('E2ETEST', 999)"
    ).run();
    const createdAt = agedDays
      ? `datetime('now','-${agedDays} days')`
      : "datetime('now')";
    db.prepare(
      `INSERT INTO submissions (id, invite_code, name, contact_info, contact_type, session_token, created_at)
       VALUES (?, 'E2ETEST', '守卫测试', 'guard@test.com', 'email', ?, ${createdAt})`
    ).run(sid, stok);
  });
}

function cleanup(sid: string) {
  withDb((db) => {
    db.prepare("DELETE FROM chat_usage WHERE submission_id = ?").run(sid);
    db.prepare("DELETE FROM requirements WHERE submission_id = ?").run(sid);
    db.prepare("DELETE FROM submissions WHERE id = ?").run(sid);
  });
}

function userMessage(text: string) {
  return {
    id: Math.random().toString(36).slice(2),
    role: "user",
    parts: [{ type: "text", text }],
  };
}

test.describe("成本管理五层防线（接口级）", () => {
  test("L1：messages 非数组 → 400", async ({ request }) => {
    const { sid, stok } = freshIds("badbody");
    createSubmission(sid, stok);
    try {
      const res = await request.post("/api/chat", {
        data: { messages: "notarray", sessionToken: stok },
      });
      expect(res.status()).toBe(400);
    } finally {
      cleanup(sid);
    }
  });

  test("L1：缺少 sessionToken → 400", async ({ request }) => {
    const res = await request.post("/api/chat", {
      data: { messages: [userMessage("hi")] },
    });
    expect(res.status()).toBe(400);
  });

  test("会话无效 → 401", async ({ request }) => {
    const res = await request.post("/api/chat", {
      data: { messages: [userMessage("hi")], sessionToken: "does-not-exist" },
    });
    expect(res.status()).toBe(401);
  });

  test("L1：单条消息超长 → 400，且返回友好中文纯文本", async ({ request }) => {
    const { sid, stok } = freshIds("toolong");
    createSubmission(sid, stok);
    try {
      const res = await request.post("/api/chat", {
        data: {
          messages: [userMessage("啊".repeat(4001))],
          sessionToken: stok,
        },
      });
      expect(res.status()).toBe(400);
      expect(res.headers()["content-type"]).toContain("text/plain");
      expect(await res.text()).toContain("单条消息太长");
    } finally {
      cleanup(sid);
    }
  });

  test("L1：消息条数超限 → 400", async ({ request }) => {
    const { sid, stok } = freshIds("toomany");
    createSubmission(sid, stok);
    try {
      const many = Array.from({ length: 121 }, (_, i) => userMessage("m" + i));
      const res = await request.post("/api/chat", {
        data: { messages: many, sessionToken: stok },
      });
      expect(res.status()).toBe(400);
    } finally {
      cleanup(sid);
    }
  });

  test("会话超过时效（8 天）→ 401 过期提示", async ({ request }) => {
    const { sid, stok } = freshIds("expired");
    createSubmission(sid, stok, 8);
    try {
      const res = await request.post("/api/chat", {
        data: { messages: [userMessage("hi")], sessionToken: stok },
      });
      expect(res.status()).toBe(401);
      expect(await res.text()).toContain("过期");
    } finally {
      cleanup(sid);
    }
  });

  test("硬阈值宽限用尽 → 403 锁定，且客户端堆历史（大 userTurns）撑不大宽限窗口", async ({
    request,
  }) => {
    // 回归 Finding 1：宽限锚定服务端 requestCount（DB 已完成轮数），不受客户端上报的 userTurns 影响。
    const { sid, stok } = freshIds("hardlock");
    createSubmission(sid, stok);
    try {
      withDb((db) => {
        // 47 = CHAT_HARD_TURNS(45) + CHAT_HARD_GRACE(2)，无 requirement → 宽限已用尽
        const stmt = db.prepare(
          `INSERT INTO chat_usage (submission_id, input_tokens, output_tokens, total_tokens, search_count)
           VALUES (?, 1000, 100, 1100, 0)`
        );
        for (let i = 0; i < 47; i++) stmt.run(sid);
      });
      // 客户端堆 100 条历史消息（userTurns=100），旧实现会让宽限窗口膨胀而永不锁定
      const messages = Array.from({ length: 100 }, (_, i) => userMessage("m" + i));
      const res = await request.post("/api/chat", {
        data: { sessionToken: stok, messages },
      });
      expect(res.status()).toBe(403);
      expect(await res.text()).toContain("额度用完");
    } finally {
      cleanup(sid);
    }
  });

  test("文档生成后追问超限 → 403 锁定", async ({ request }) => {
    const { sid, stok } = freshIds("locked");
    createSubmission(sid, stok);
    try {
      withDb((db) => {
        const rid = `req-${sid}`;
        db.prepare(
          `INSERT INTO requirements (id, submission_id, preview_content, full_content, created_at)
           VALUES (?, ?, 'p', 'f', datetime('now','-1 hours'))`
        ).run(rid, sid);
        // 5 次文档之后的追问用量，达到 CHAT_POST_DOC_TURNS 上限
        const stmt = db.prepare(
          `INSERT INTO chat_usage (submission_id, input_tokens, output_tokens, total_tokens, search_count, created_at)
           VALUES (?, 100, 20, 120, 0, datetime('now','-30 minutes'))`
        );
        for (let i = 0; i < 5; i++) stmt.run(sid);
      });
      const res = await request.post("/api/chat", {
        data: { messages: [userMessage("我还想改改")], sessionToken: stok },
      });
      expect(res.status()).toBe(403);
      expect(await res.text()).toContain("额度用完");
    } finally {
      cleanup(sid);
    }
  });
});

test.describe("admin 用量端点", () => {
  test("无密钥 → 401（proxy 中间件拦截）", async ({ request }) => {
    const res = await request.get("/api/admin/usage");
    expect(res.status()).toBe(401);
  });

  test("带密钥 → 200，返回今日/累计/top 结构且含成本折算", async ({ request }) => {
    const res = await request.get("/api/admin/usage", {
      headers: { "x-admin-secret": ADMIN_SECRET },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.dailyBudgetUsd).toBe("number");
    expect(typeof body.today.costUsd).toBe("number");
    expect(typeof body.total.costUsd).toBe("number");
    expect(Array.isArray(body.topSubmissions)).toBe(true);
  });
});

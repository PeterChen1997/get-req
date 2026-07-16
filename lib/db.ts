import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "get-req.db");

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;

  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  _db.exec(`
    CREATE TABLE IF NOT EXISTS invite_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      used_count INTEGER DEFAULT 0,
      max_uses INTEGER DEFAULT 3,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      invite_code TEXT NOT NULL,
      name TEXT NOT NULL,
      contact_info TEXT NOT NULL,
      contact_type TEXT NOT NULL,
      session_token TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS requirements (
      id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL,
      preview_content TEXT,
      full_content TEXT,
      status TEXT DEFAULT 'pending_review',
      notion_url TEXT,
      notion_full_url TEXT,
      accepted_at TEXT,
      commitment_terms TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (submission_id) REFERENCES submissions(id)
    );

    -- 每次对话请求记录一行用量（一行=一轮），SUM 即累计，支撑成本预算与观测。
    CREATE TABLE IF NOT EXISTS chat_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      search_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (submission_id) REFERENCES submissions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_usage_submission ON chat_usage(submission_id);
    CREATE INDEX IF NOT EXISTS idx_chat_usage_created ON chat_usage(created_at);
  `);

  return _db;
}

export const db = {
  verifyInviteCode(code: string): {
    valid: boolean;
    message?: string;
  } {
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM invite_codes WHERE code = ?")
      .get(code) as {
      code: string;
      used_count: number;
      max_uses: number;
      active: number;
    } | undefined;

    if (!row) return { valid: false, message: "邀请码无效，请联系我获取新邀请码" };
    if (!row.active) return { valid: false, message: "邀请码已失效，请联系我获取新邀请码" };
    if (row.used_count >= row.max_uses)
      return { valid: false, message: "邀请码已使用满3次，请联系我获取新邀请码" };
    return { valid: true };
  },

  createSubmission(data: {
    id: string;
    inviteCode: string;
    name: string;
    contactInfo: string;
    contactType: string;
    sessionToken: string;
  }): { success: true } | { success: false; message: string } {
    const db = getDb();
    const insertSubmissionAndBumpCode = db.transaction(() => {
      // 校验与 used_count+1 放在同一个 BEGIN IMMEDIATE 事务内（见下方 .immediate() 调用），
      // 避免并发请求都读到旧的 used_count 而双双通过校验，超过 max_uses 限制。
      const row = db
        .prepare("SELECT used_count, max_uses, active FROM invite_codes WHERE code = ?")
        .get(data.inviteCode) as
        | { used_count: number; max_uses: number; active: number }
        | undefined;

      if (!row || !row.active || row.used_count >= row.max_uses) {
        return {
          success: false as const,
          message: !row
            ? "邀请码无效，请联系我获取新邀请码"
            : !row.active
              ? "邀请码已失效，请联系我获取新邀请码"
              : "邀请码已使用满3次，请联系我获取新邀请码",
        };
      }

      db.prepare(
        "INSERT INTO submissions (id, invite_code, name, contact_info, contact_type, session_token) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(
        data.id,
        data.inviteCode,
        data.name,
        data.contactInfo,
        data.contactType,
        data.sessionToken
      );
      db.prepare(
        "UPDATE invite_codes SET used_count = used_count + 1 WHERE code = ?"
      ).run(data.inviteCode);

      return { success: true as const };
    });
    // 用 BEGIN IMMEDIATE 立即获取写锁，避免多进程/多连接下并发请求同时读到同一 used_count 而双双通过校验。
    return insertSubmissionAndBumpCode.immediate();
  },

  getSubmissionBySession(sessionToken: string) {
    const db = getDb();
    return db
      .prepare("SELECT * FROM submissions WHERE session_token = ?")
      .get(sessionToken) as {
      id: string;
      invite_code: string;
      name: string;
      contact_info: string;
      contact_type: string;
      session_token: string;
      created_at: string;
    } | undefined;
  },

  createRequirement(data: {
    id: string;
    submissionId: string;
    previewContent: string;
    fullContent: string;
    notionUrl?: string;
    notionFullUrl?: string;
  }) {
    const db = getDb();
    db.prepare(
      "INSERT INTO requirements (id, submission_id, preview_content, full_content, notion_url, notion_full_url) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      data.id,
      data.submissionId,
      data.previewContent,
      data.fullContent,
      data.notionUrl ?? null,
      data.notionFullUrl ?? null
    );
  },

  updateRequirementNotionUrls(
    id: string,
    data: { notionUrl?: string; notionFullUrl?: string }
  ) {
    const db = getDb();
    db.prepare(
      "UPDATE requirements SET notion_url = ?, notion_full_url = ? WHERE id = ?"
    ).run(data.notionUrl ?? null, data.notionFullUrl ?? null, id);
  },

  getRequirement(id: string) {
    const db = getDb();
    return db.prepare("SELECT * FROM requirements WHERE id = ?").get(id) as {
      id: string;
      submission_id: string;
      preview_content: string;
      full_content: string;
      status: string;
      notion_url: string | null;
      notion_full_url: string | null;
      accepted_at: string | null;
      commitment_terms: string | null;
      created_at: string;
    } | undefined;
  },

  getRequirementBySubmission(submissionId: string) {
    const db = getDb();
    return db
      .prepare("SELECT * FROM requirements WHERE submission_id = ?")
      .get(submissionId) as {
      id: string;
      submission_id: string;
      preview_content: string;
      full_content: string;
      status: string;
      notion_url: string | null;
      notion_full_url: string | null;
      accepted_at: string | null;
      commitment_terms: string | null;
      created_at: string;
    } | undefined;
  },

  listRequirements() {
    const db = getDb();
    return db
      .prepare(
        `SELECT r.*, s.name, s.contact_info, s.contact_type, s.invite_code
         FROM requirements r
         JOIN submissions s ON r.submission_id = s.id
         ORDER BY r.created_at DESC`
      )
      .all() as Array<{
      id: string;
      submission_id: string;
      preview_content: string;
      full_content: string;
      status: string;
      notion_url: string | null;
      notion_full_url: string | null;
      accepted_at: string | null;
      commitment_terms: string | null;
      created_at: string;
      name: string;
      contact_info: string;
      contact_type: string;
      invite_code: string;
    }>;
  },

  updateRequirementStatus(
    id: string,
    status: "accepted" | "rejected"
  ) {
    const db = getDb();
    if (status === "accepted") {
      const now = new Date().toISOString();
      const terms = "7天沟通支持 + 1个月内≤100美元大模型调用费支持";
      db.prepare(
        "UPDATE requirements SET status = ?, accepted_at = ?, commitment_terms = ? WHERE id = ?"
      ).run(status, now, terms, id);
    } else {
      db.prepare("UPDATE requirements SET status = ? WHERE id = ?").run(
        status,
        id
      );
    }
  },

  // 记录一次对话请求的用量（在 streamText 的 onEnd 回调中调用）
  recordChatUsage(data: {
    submissionId: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    searchCount: number;
  }) {
    const db = getDb();
    db.prepare(
      "INSERT INTO chat_usage (submission_id, input_tokens, output_tokens, total_tokens, search_count) VALUES (?, ?, ?, ?, ?)"
    ).run(
      data.submissionId,
      data.inputTokens,
      data.outputTokens,
      data.totalTokens,
      data.searchCount
    );
  },

  // 某 submission 的累计用量（会话预算档位判定用）
  getUsageBySubmission(submissionId: string): {
    requestCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    searchCount: number;
  } {
    const db = getDb();
    const row = db
      .prepare<
        [string],
        {
          requestCount: number;
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
          searchCount: number;
        }
      >(
        `SELECT
           COUNT(*) AS requestCount,
           COALESCE(SUM(input_tokens), 0) AS inputTokens,
           COALESCE(SUM(output_tokens), 0) AS outputTokens,
           COALESCE(SUM(total_tokens), 0) AS totalTokens,
           COALESCE(SUM(search_count), 0) AS searchCount
         FROM chat_usage WHERE submission_id = ?`
      )
      .get(submissionId);
    return (
      row ?? {
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        searchCount: 0,
      }
    );
  },

  // 某 submission 在指定时间点之后的请求次数（文档生成后追问轮数判定）。
  // requirements.created_at 与 chat_usage.created_at 同为 datetime('now') UTC 字符串，可直接比较。
  countUsageSince(submissionId: string, sinceIso: string): number {
    const db = getDb();
    const row = db
      .prepare<[string, string], { count: number }>(
        "SELECT COUNT(*) AS count FROM chat_usage WHERE submission_id = ? AND created_at > ?"
      )
      .get(submissionId, sinceIso);
    return row?.count ?? 0;
  },

  // 当日（UTC）全站用量聚合（每日成本熔断用）。日界为 UTC，与 datetime('now') 一致。
  getTodayGlobalUsage(): {
    inputTokens: number;
    outputTokens: number;
    searchCount: number;
  } {
    const db = getDb();
    const row = db
      .prepare<
        [],
        { inputTokens: number; outputTokens: number; searchCount: number }
      >(
        `SELECT
           COALESCE(SUM(input_tokens), 0) AS inputTokens,
           COALESCE(SUM(output_tokens), 0) AS outputTokens,
           COALESCE(SUM(search_count), 0) AS searchCount
         FROM chat_usage WHERE date(created_at) = date('now')`
      )
      .get();
    return row ?? { inputTokens: 0, outputTokens: 0, searchCount: 0 };
  },

  // admin 用量统计：今日 + 累计 + 按消耗排序的 top 会话
  getUsageStats(): {
    today: {
      inputTokens: number;
      outputTokens: number;
      searchCount: number;
      requestCount: number;
    };
    total: {
      inputTokens: number;
      outputTokens: number;
      searchCount: number;
      requestCount: number;
    };
    topSubmissions: Array<{
      submissionId: string;
      name: string;
      contactInfo: string;
      inputTokens: number;
      outputTokens: number;
      searchCount: number;
      requestCount: number;
      lastActiveAt: string;
    }>;
  } {
    const db = getDb();
    const aggFields = `
      COUNT(*) AS requestCount,
      COALESCE(SUM(input_tokens), 0) AS inputTokens,
      COALESCE(SUM(output_tokens), 0) AS outputTokens,
      COALESCE(SUM(search_count), 0) AS searchCount`;
    const emptyAgg = {
      requestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      searchCount: 0,
    };
    const today =
      db
        .prepare<
          [],
          {
            requestCount: number;
            inputTokens: number;
            outputTokens: number;
            searchCount: number;
          }
        >(
          `SELECT ${aggFields} FROM chat_usage WHERE date(created_at) = date('now')`
        )
        .get() ?? emptyAgg;
    const total =
      db
        .prepare<
          [],
          {
            requestCount: number;
            inputTokens: number;
            outputTokens: number;
            searchCount: number;
          }
        >(`SELECT ${aggFields} FROM chat_usage`)
        .get() ?? emptyAgg;
    const topSubmissions = db
      .prepare<
        [],
        {
          submissionId: string;
          name: string;
          contactInfo: string;
          inputTokens: number;
          outputTokens: number;
          searchCount: number;
          requestCount: number;
          lastActiveAt: string;
        }
      >(
        `SELECT
           u.submission_id AS submissionId,
           s.name AS name,
           s.contact_info AS contactInfo,
           COALESCE(SUM(u.input_tokens), 0) AS inputTokens,
           COALESCE(SUM(u.output_tokens), 0) AS outputTokens,
           COALESCE(SUM(u.search_count), 0) AS searchCount,
           COUNT(*) AS requestCount,
           MAX(u.created_at) AS lastActiveAt
         FROM chat_usage u
         JOIN submissions s ON u.submission_id = s.id
         GROUP BY u.submission_id
         ORDER BY SUM(u.total_tokens) DESC
         LIMIT 20`
      )
      .all();
    return { today, total, topSubmissions };
  },

  createInviteCode(code: string) {
    const db = getDb();
    db.prepare("INSERT INTO invite_codes (code) VALUES (?)").run(code);
  },

  revokeInviteCode(code: string) {
    const db = getDb();
    db.prepare("UPDATE invite_codes SET active = 0 WHERE code = ?").run(code);
  },

  listInviteCodes() {
    const db = getDb();
    return db.prepare("SELECT * FROM invite_codes ORDER BY created_at DESC").all() as Array<{
      id: number;
      code: string;
      used_count: number;
      max_uses: number;
      active: number;
      created_at: string;
    }>;
  },
};

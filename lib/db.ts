import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "get-req.db");

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;

  const fs = require("fs");
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

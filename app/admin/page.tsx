"use client";

import { useState, useEffect, useCallback, useSyncExternalStore } from "react";

type Requirement = {
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
};

type InviteCode = {
  id: number;
  code: string;
  used_count: number;
  max_uses: number;
  active: number;
  created_at: string;
};

type UsageAgg = {
  inputTokens: number;
  outputTokens: number;
  searchCount: number;
  requestCount: number;
  costUsd: number;
};

type TopSubmission = {
  submissionId: string;
  name: string;
  contactInfo: string;
  inputTokens: number;
  outputTokens: number;
  searchCount: number;
  requestCount: number;
  lastActiveAt: string;
  costUsd: number;
};

type UsageStats = {
  dailyBudgetUsd: number;
  today: UsageAgg;
  total: UsageAgg;
  topSubmissions: TopSubmission[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isUsageAgg(v: unknown): v is UsageAgg {
  return (
    isRecord(v) &&
    typeof v.inputTokens === "number" &&
    typeof v.outputTokens === "number" &&
    typeof v.searchCount === "number" &&
    typeof v.requestCount === "number" &&
    typeof v.costUsd === "number"
  );
}

function isTopSubmission(v: unknown): v is TopSubmission {
  return (
    isRecord(v) &&
    typeof v.submissionId === "string" &&
    typeof v.name === "string" &&
    typeof v.contactInfo === "string" &&
    typeof v.lastActiveAt === "string" &&
    typeof v.inputTokens === "number" &&
    typeof v.outputTokens === "number" &&
    typeof v.searchCount === "number" &&
    typeof v.requestCount === "number" &&
    typeof v.costUsd === "number"
  );
}

function isUsageStats(v: unknown): v is UsageStats {
  return (
    isRecord(v) &&
    typeof v.dailyBudgetUsd === "number" &&
    isUsageAgg(v.today) &&
    isUsageAgg(v.total) &&
    Array.isArray(v.topSubmissions) &&
    v.topSubmissions.every(isTopSubmission)
  );
}

const ADMIN_SECRET_STORAGE_KEY = "admin_secret";

// sessionStorage 只读一次、无变更通知，订阅为空实现
const noopSubscribe = () => () => {};

export default function AdminPage() {
  const [tab, setTab] = useState<"requirements" | "invites" | "usage">(
    "requirements"
  );
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFull, setShowFull] = useState<string | null>(null);
  // 初始密钥来自 sessionStorage（服务端渲染时为 null）；登录/失效后以 override 为准
  const storedSecret = useSyncExternalStore(
    noopSubscribe,
    () => sessionStorage.getItem(ADMIN_SECRET_STORAGE_KEY),
    () => null
  );
  const [secretOverride, setSecretOverride] = useState<{ value: string | null } | null>(null);
  const adminSecret = secretOverride ? secretOverride.value : storedSecret;
  const [secretInput, setSecretInput] = useState("");
  const [authError, setAuthError] = useState("");

  const authedFetch = useCallback(
    async (input: string, init?: RequestInit) => {
      const res = await fetch(input, {
        ...init,
        headers: { ...init?.headers, "x-admin-secret": adminSecret || "" },
      });
      if (res.status === 401) {
        sessionStorage.removeItem(ADMIN_SECRET_STORAGE_KEY);
        setSecretOverride({ value: null });
        setAuthError("密钥无效或已过期，请重新输入");
      }
      return res;
    },
    [adminSecret]
  );

  const loadRequirements = useCallback(async () => {
    const res = await authedFetch("/api/requirements");
    if (res.ok) setRequirements(await res.json());
  }, [authedFetch]);

  const loadInviteCodes = useCallback(async () => {
    const res = await authedFetch("/api/invite/manage");
    if (res.ok) setInviteCodes(await res.json());
  }, [authedFetch]);

  const loadUsage = useCallback(async () => {
    const res = await authedFetch("/api/admin/usage");
    if (!res.ok) return;
    const data: unknown = await res.json();
    if (isUsageStats(data)) setUsage(data);
  }, [authedFetch]);

  useEffect(() => {
    if (!adminSecret) return;
    void (async () => {
      await Promise.all([loadRequirements(), loadInviteCodes(), loadUsage()]);
    })();
  }, [adminSecret, loadRequirements, loadInviteCodes, loadUsage]);

  function handleSecretSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!secretInput.trim()) return;
    sessionStorage.setItem(ADMIN_SECRET_STORAGE_KEY, secretInput.trim());
    setSecretOverride({ value: secretInput.trim() });
    setAuthError("");
    setSecretInput("");
  }

  async function createInviteCode() {
    await authedFetch("/api/invite/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    loadInviteCodes();
  }

  async function revokeCode(code: string) {
    await authedFetch("/api/invite/manage", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    loadInviteCodes();
  }

  async function updateStatus(id: string, status: "accepted" | "rejected") {
    await authedFetch(`/api/requirements/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    loadRequirements();
  }

  const statusLabels: Record<string, string> = {
    pending_review: "待评审",
    accepted: "已接受",
    rejected: "已拒绝",
  };

  const statusColors: Record<string, string> = {
    pending_review: "bg-yellow-100 text-yellow-800",
    accepted: "bg-green-100 text-green-800",
    rejected: "bg-red-100 text-red-800",
  };

  if (!adminSecret) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16">
        <h1 className="text-xl font-semibold mb-4">运营管理后台登录</h1>
        <form onSubmit={handleSecretSubmit} className="flex flex-col gap-3">
          <input
            type="password"
            value={secretInput}
            onChange={(e) => setSecretInput(e.target.value)}
            placeholder="请输入管理密钥"
            autoFocus
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
          {authError && <p className="text-sm text-destructive">{authError}</p>}
          <button
            type="submit"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            进入
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold mb-6">运营管理后台</h1>

      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab("requirements")}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "requirements" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
        >
          需求列表 ({requirements.length})
        </button>
        <button
          onClick={() => setTab("invites")}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "invites" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
        >
          邀请码管理 ({inviteCodes.length})
        </button>
        <button
          onClick={() => setTab("usage")}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "usage" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
        >
          用量统计
        </button>
      </div>

      {tab === "requirements" && (
        <div className="flex flex-col gap-4">
          {requirements.length === 0 && (
            <p className="text-muted-foreground text-sm">暂无需求</p>
          )}
          {requirements.map((req) => (
            <div key={req.id} className="border border-border rounded-lg p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium">{req.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[req.status] || ""}`}>
                      {statusLabels[req.status] || req.status}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {req.contact_type}: {req.contact_info} | 邀请码: {req.invite_code} | {new Date(req.created_at).toLocaleString("zh-CN")}
                  </p>
                  {req.accepted_at && (
                    <p className="text-xs text-muted-foreground mt-1">
                      接受时间: {new Date(req.accepted_at).toLocaleString("zh-CN")} | {req.commitment_terms}
                    </p>
                  )}
                  {req.notion_url && (
                    <a href={req.notion_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline mt-1 mr-3 inline-block">
                      Notion 预览版
                    </a>
                  )}
                  {req.notion_full_url && (
                    <a href={req.notion_full_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline mt-1 inline-block">
                      Notion 完整版（内部）
                    </a>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  {req.status === "pending_review" && (
                    <>
                      <button onClick={() => updateStatus(req.id, "accepted")} className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700">
                        接受
                      </button>
                      <button onClick={() => updateStatus(req.id, "rejected")} className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700">
                        拒绝
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setExpandedId(expandedId === req.id ? null : req.id)}
                  className="text-xs text-primary hover:underline"
                >
                  {expandedId === req.id ? "收起预览版" : "查看预览版"}
                </button>
                <button
                  onClick={() => setShowFull(showFull === req.id ? null : req.id)}
                  className="text-xs text-primary hover:underline"
                >
                  {showFull === req.id ? "收起完整版" : "查看完整版"}
                </button>
              </div>

              {expandedId === req.id && (
                <div className="mt-3 p-3 bg-muted/50 rounded-lg text-sm whitespace-pre-wrap">
                  {req.preview_content}
                </div>
              )}

              {showFull === req.id && (
                <div className="mt-3 p-3 bg-muted/50 rounded-lg text-sm whitespace-pre-wrap">
                  {req.full_content}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "invites" && (
        <div>
          <button
            onClick={createInviteCode}
            className="mb-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            生成新邀请码
          </button>

          <div className="flex flex-col gap-2">
            {inviteCodes.map((ic) => (
              <div key={ic.id} data-testid={`invite-row-${ic.code}`} className="flex items-center justify-between border border-border rounded-lg px-4 py-3">
                <div className="flex items-center gap-4">
                  <code className="font-mono text-sm font-semibold">{ic.code}</code>
                  <span className="text-sm text-muted-foreground">
                    已使用 {ic.used_count}/{ic.max_uses} 次
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${ic.active ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                    {ic.active ? "有效" : "已作废"}
                  </span>
                </div>
                {ic.active ? (
                  <button
                    onClick={() => revokeCode(ic.code)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700"
                  >
                    作废
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "usage" && (
        <div className="flex flex-col gap-6">
          {!usage && (
            <p className="text-muted-foreground text-sm">暂无用量数据</p>
          )}
          {usage && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <UsageCard
                  title="今日"
                  agg={usage.today}
                  budgetUsd={usage.dailyBudgetUsd}
                />
                <UsageCard title="累计" agg={usage.total} />
              </div>

              <div>
                <h2 className="text-sm font-medium mb-2">消耗最多的会话（Top 20）</h2>
                {usage.topSubmissions.length === 0 ? (
                  <p className="text-muted-foreground text-sm">暂无数据</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th className="py-2 pr-4 font-medium">用户</th>
                          <th className="py-2 pr-4 font-medium">轮数</th>
                          <th className="py-2 pr-4 font-medium">输入tokens</th>
                          <th className="py-2 pr-4 font-medium">输出tokens</th>
                          <th className="py-2 pr-4 font-medium">搜索</th>
                          <th className="py-2 pr-4 font-medium">成本(USD)</th>
                          <th className="py-2 font-medium">最后活跃</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usage.topSubmissions.map((s) => (
                          <tr
                            key={s.submissionId}
                            className="border-b border-border/50"
                          >
                            <td className="py-2 pr-4">
                              {s.name}
                              <span className="text-muted-foreground ml-1">
                                ({s.contactInfo})
                              </span>
                            </td>
                            <td className="py-2 pr-4">{s.requestCount}</td>
                            <td className="py-2 pr-4">
                              {s.inputTokens.toLocaleString()}
                            </td>
                            <td className="py-2 pr-4">
                              {s.outputTokens.toLocaleString()}
                            </td>
                            <td className="py-2 pr-4">{s.searchCount}</td>
                            <td className="py-2 pr-4">${s.costUsd.toFixed(4)}</td>
                            <td className="py-2 text-muted-foreground">
                              {new Date(
                                s.lastActiveAt.replace(" ", "T") + "Z"
                              ).toLocaleString("zh-CN")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function UsageCard({
  title,
  agg,
  budgetUsd,
}: {
  title: string;
  agg: UsageAgg;
  budgetUsd?: number;
}) {
  return (
    <div className="border border-border rounded-lg p-4">
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-sm text-muted-foreground">{title}</span>
        <span className="text-2xl font-semibold">
          ${agg.costUsd.toFixed(2)}
          {budgetUsd !== undefined && (
            <span className="text-sm text-muted-foreground font-normal">
              {" "}
              / ${budgetUsd}
            </span>
          )}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>对话轮数</span>
        <span className="text-right text-foreground">{agg.requestCount}</span>
        <span>输入 tokens</span>
        <span className="text-right text-foreground">
          {agg.inputTokens.toLocaleString()}
        </span>
        <span>输出 tokens</span>
        <span className="text-right text-foreground">
          {agg.outputTokens.toLocaleString()}
        </span>
        <span>搜索次数</span>
        <span className="text-right text-foreground">{agg.searchCount}</span>
      </div>
    </div>
  );
}

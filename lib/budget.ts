// 成本管理「预算域」集中地：阈值常量、成本折算、会话预算档位判定、内存限流与并发锁。
// 所有阈值均可通过 env 覆盖，未配置时用代码内默认值。

// —— 数值 env 解析：非法值回退默认，避免 NaN 污染判定 ——
function numEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

// —— L1 请求级 ——
export const CHAT_MAX_MESSAGE_CHARS = numEnv("CHAT_MAX_MESSAGE_CHARS", 4000);
export const CHAT_MAX_MESSAGES = numEnv("CHAT_MAX_MESSAGES", 120);
export const CHAT_MAX_OUTPUT_TOKENS = numEnv("CHAT_MAX_OUTPUT_TOKENS", 2048);

// —— L2 会话预算 ——
export const CHAT_SOFT_TURNS = numEnv("CHAT_SOFT_TURNS", 30);
export const CHAT_SOFT_INPUT_TOKENS = numEnv("CHAT_SOFT_INPUT_TOKENS", 200000);
export const CHAT_HARD_TURNS = numEnv("CHAT_HARD_TURNS", 45);
export const CHAT_HARD_INPUT_TOKENS = numEnv("CHAT_HARD_INPUT_TOKENS", 350000);
export const CHAT_HARD_GRACE = numEnv("CHAT_HARD_GRACE", 2);
export const CHAT_POST_DOC_TURNS = numEnv("CHAT_POST_DOC_TURNS", 5);
export const SESSION_MAX_AGE_DAYS = numEnv("SESSION_MAX_AGE_DAYS", 7);

// —— L4 全局熔断与限流 ——
export const DAILY_BUDGET_USD = numEnv("DAILY_BUDGET_USD", 10);
export const RATE_LIMIT_PER_MINUTE = numEnv("RATE_LIMIT_PER_MINUTE", 6);

// —— Exa 搜索 ——
export const SEARCH_MAX_PER_SESSION = numEnv("SEARCH_MAX_PER_SESSION", 15);

// —— 单价（折算成本用，调价不影响已落库的 token 数）——
export const PRICE_INPUT_USD_PER_1M = numEnv("PRICE_INPUT_USD_PER_1M", 2.5); // gpt-4o input
export const PRICE_OUTPUT_USD_PER_1M = numEnv("PRICE_OUTPUT_USD_PER_1M", 10); // gpt-4o output
export const PRICE_EXA_PER_SEARCH_USD = numEnv("PRICE_EXA_PER_SEARCH_USD", 0.005); // Exa 约 $5/1k 次

// 由 token 数与搜索次数折算美元成本
export function estimateCostUsd(u: {
  inputTokens: number;
  outputTokens: number;
  searchCount: number;
}): number {
  return (
    (u.inputTokens / 1_000_000) * PRICE_INPUT_USD_PER_1M +
    (u.outputTokens / 1_000_000) * PRICE_OUTPUT_USD_PER_1M +
    u.searchCount * PRICE_EXA_PER_SEARCH_USD
  );
}

// —— 会话预算档位判定（纯函数，便于单测）——
export type BudgetVerdict =
  | { kind: "normal" }
  | { kind: "soft" }
  | { kind: "hard-final" }
  | { kind: "locked"; reason: string };

const LOCKED_POST_DOC =
  "需求清单已经整理好了，这次聊天的额度用完了。想再补充或修改，直接联系运营者就好~";
const LOCKED_EXHAUSTED = "这次聊天的额度用完了，麻烦联系运营者继续，感谢理解~";

export function evaluateSessionBudget(input: {
  userTurns: number; // 本请求体中 role==="user" 的消息条数
  usage: { requestCount: number; inputTokens: number };
  hasRequirement: boolean; // 是否已生成过需求文档
  postDocTurns: number; // 文档生成后已发生的请求次数
}): BudgetVerdict {
  const { userTurns, usage, hasRequirement, postDocTurns } = input;

  // a) 文档已生成：只允许有限次追问
  if (hasRequirement) {
    if (postDocTurns >= CHAT_POST_DOC_TURNS) {
      return { kind: "locked", reason: LOCKED_POST_DOC };
    }
    return { kind: "normal" };
  }

  const overHard =
    userTurns >= CHAT_HARD_TURNS || usage.inputTokens >= CHAT_HARD_INPUT_TOKENS;
  if (overHard) {
    // 硬阈值后放行有限次以强制生成文档；宽限用尽仍无文档则锁定，
    // 防止 Notion 反复失败导致每轮都强制生成、无限烧钱。
    // 宽限锚定服务端 requestCount（DB 已完成轮数）——绝不能用客户端可控的 userTurns，
    // 否则正常流里 userTurns≈requestCount+1，宽限窗口随历史一起膨胀、locked 永不触发。
    if (usage.requestCount < CHAT_HARD_TURNS + CHAT_HARD_GRACE) {
      return { kind: "hard-final" };
    }
    return { kind: "locked", reason: LOCKED_EXHAUSTED };
  }

  const overSoft =
    userTurns >= CHAT_SOFT_TURNS || usage.inputTokens >= CHAT_SOFT_INPUT_TOKENS;
  if (overSoft) return { kind: "soft" };

  return { kind: "normal" };
}

// 软阈值：追加到 system，引导 AI 主动收敛并自然告知用户
export const SOFT_LIMIT_DIRECTIVE =
  "【系统提示】这次聊天的轮数已经不多了。请开始收敛：用一两句话总结目前理解到的内容请用户确认，只再问最关键的缺失点，并在接下来几轮内准备调用 submitDocument 整理成清单。请自然地告诉用户「我们聊得差不多了，再确认几个点就可以帮你整理好了」。";

// 硬阈值：本轮必须强制生成文档
export const HARD_LIMIT_DIRECTIVE =
  "【系统提示】这次聊天的额度已经到上限，本轮必须调用 submitDocument，基于目前聊到的全部内容整理成清单；信息不够的部分由你自己专业判断补全，不要再向用户提问。";

// —— 内存限流 + 并发锁 ——
// 单机 PM2 fork 单实例部署，模块级状态跨请求持久，方案安全；
// 多实例部署需迁移到 Redis。dev 模式 HMR 会重置状态（可接受）。
const rateWindows = new Map<string, number[]>(); // token -> 60s 窗口内的请求时间戳
const activeStreams = new Map<string, number>(); // token -> 流开始时间戳（用于泄漏兜底）

const STREAM_LOCK_TTL_MS = 10 * 60 * 1000; // 超 10 分钟视为泄漏锁，允许抢占

// 每分钟请求数限流；未超限则记录本次时间戳并返回 true
export function checkRateLimit(token: string, now: number): boolean {
  const stamps = (rateWindows.get(token) ?? []).filter((t) => now - t < 60_000);
  if (stamps.length >= RATE_LIMIT_PER_MINUTE) {
    rateWindows.set(token, stamps);
    return false;
  }
  stamps.push(now);
  rateWindows.set(token, stamps);
  if (rateWindows.size > 1000) sweepRateWindows(now); // 惰性清理，防 Map 无界增长
  return true;
}

function sweepRateWindows(now: number): void {
  for (const [token, stamps] of rateWindows) {
    const fresh = stamps.filter((t) => now - t < 60_000);
    if (fresh.length === 0) rateWindows.delete(token);
    else rateWindows.set(token, fresh);
  }
}

// 获取并发流锁；已有进行中的流（且未超 TTL）则失败
export function acquireStreamLock(token: string, now: number): boolean {
  const startedAt = activeStreams.get(token);
  if (startedAt !== undefined && now - startedAt < STREAM_LOCK_TTL_MS) {
    return false;
  }
  activeStreams.set(token, now);
  return true;
}

export function releaseStreamLock(token: string): void {
  activeStreams.delete(token);
}

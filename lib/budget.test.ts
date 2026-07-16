import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateCostUsd,
  evaluateSessionBudget,
  checkRateLimit,
  acquireStreamLock,
  releaseStreamLock,
  CHAT_SOFT_TURNS,
  CHAT_HARD_TURNS,
  CHAT_SOFT_INPUT_TOKENS,
  CHAT_HARD_INPUT_TOKENS,
  CHAT_POST_DOC_TURNS,
  CHAT_HARD_GRACE,
  RATE_LIMIT_PER_MINUTE,
} from "./budget";

// —— estimateCostUsd：纯数学，验证单价与三项叠加 ——
test("estimateCostUsd 分项与叠加", () => {
  assert.equal(
    estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 0, searchCount: 0 }),
    2.5
  );
  assert.equal(
    estimateCostUsd({ inputTokens: 0, outputTokens: 1_000_000, searchCount: 0 }),
    10
  );
  assert.equal(
    estimateCostUsd({ inputTokens: 0, outputTokens: 0, searchCount: 100 }),
    0.5
  );
  // 叠加：0.5M 输入 + 0.1M 输出 + 2 次搜索 = 1.25 + 1 + 0.01
  assert.equal(
    estimateCostUsd({ inputTokens: 500_000, outputTokens: 100_000, searchCount: 2 }),
    1.25 + 1 + 0.01
  );
});

// —— evaluateSessionBudget：五层防线的会话档位判定 ——
// WHY：预算档位错误会导致要么过早锁死用户（体验差），要么永不收敛（烧钱），
// 每个边界都编码了「成本与产品收敛的平衡点」，业务阈值变动时这些断言必须一起改。

test("normal：轮数与 token 都远未到阈值", () => {
  const v = evaluateSessionBudget({
    userTurns: 5,
    usage: { requestCount: 5, inputTokens: 1000 },
    hasRequirement: false,
    postDocTurns: 0,
  });
  assert.equal(v.kind, "normal");
});

test("soft：轮数达到软阈值即触发收敛引导", () => {
  const v = evaluateSessionBudget({
    userTurns: CHAT_SOFT_TURNS,
    usage: { requestCount: CHAT_SOFT_TURNS, inputTokens: 1000 },
    hasRequirement: false,
    postDocTurns: 0,
  });
  assert.equal(v.kind, "soft");
});

test("soft：累计输入 token 达到软阈值也触发（与轮数任一即可）", () => {
  const v = evaluateSessionBudget({
    userTurns: 3,
    usage: { requestCount: 3, inputTokens: CHAT_SOFT_INPUT_TOKENS },
    hasRequirement: false,
    postDocTurns: 0,
  });
  assert.equal(v.kind, "soft");
});

test("hard-final：达到硬阈值且宽限未用尽 → 放行强制生成文档", () => {
  const v = evaluateSessionBudget({
    userTurns: CHAT_HARD_TURNS,
    usage: { requestCount: CHAT_HARD_TURNS, inputTokens: 1000 },
    hasRequirement: false,
    postDocTurns: 0,
  });
  assert.equal(v.kind, "hard-final");
});

test("hard-final：token 触发硬阈值同样强制生成", () => {
  const v = evaluateSessionBudget({
    userTurns: 10,
    usage: { requestCount: 10, inputTokens: CHAT_HARD_INPUT_TOKENS },
    hasRequirement: false,
    postDocTurns: 0,
  });
  assert.equal(v.kind, "hard-final");
});

test("locked：硬阈值后强制生成宽限用尽仍无文档 → 锁定（防 Notion 反复失败无限烧钱）", () => {
  // 真实序列：requestCount=DB 已完成轮数，userTurns≈requestCount+1（客户端每轮回传完整历史）
  const v = evaluateSessionBudget({
    userTurns: CHAT_HARD_TURNS + CHAT_HARD_GRACE + 1,
    usage: {
      requestCount: CHAT_HARD_TURNS + CHAT_HARD_GRACE,
      inputTokens: 1000,
    },
    hasRequirement: false,
    postDocTurns: 0,
  });
  assert.equal(v.kind, "locked");
});

test("hard-final：宽限边界内（requestCount = 硬阈值+grace-1）仍放行", () => {
  const v = evaluateSessionBudget({
    userTurns: CHAT_HARD_TURNS + CHAT_HARD_GRACE,
    usage: {
      requestCount: CHAT_HARD_TURNS + CHAT_HARD_GRACE - 1,
      inputTokens: 1000,
    },
    hasRequirement: false,
    postDocTurns: 0,
  });
  assert.equal(v.kind, "hard-final");
});

test("locked 锚定服务端 requestCount：客户端上报的巨大 userTurns 不能撑大宽限窗口", () => {
  // 回归 Finding 1：宽限一旦用 max(HARD_TURNS, userTurns) 做锚点，
  // 客户端把历史堆到 userTurns=500 就能让 requestCount<userTurns+grace 恒真、永不锁定。
  // 正确行为：只看服务端 requestCount，达到 HARD_TURNS+GRACE 即锁定，无视 userTurns。
  const v = evaluateSessionBudget({
    userTurns: 500,
    usage: {
      requestCount: CHAT_HARD_TURNS + CHAT_HARD_GRACE,
      inputTokens: 1000,
    },
    hasRequirement: false,
    postDocTurns: 0,
  });
  assert.equal(v.kind, "locked");
});

test("文档已生成：追问未达上限 → normal（可继续小幅追问）", () => {
  const v = evaluateSessionBudget({
    userTurns: 100, // 即便历史轮数很多，有文档后只看 postDocTurns
    usage: { requestCount: 100, inputTokens: 999_999 },
    hasRequirement: true,
    postDocTurns: CHAT_POST_DOC_TURNS - 1,
  });
  assert.equal(v.kind, "normal");
});

test("文档已生成：追问达到上限 → locked", () => {
  const v = evaluateSessionBudget({
    userTurns: 100,
    usage: { requestCount: 100, inputTokens: 1000 },
    hasRequirement: true,
    postDocTurns: CHAT_POST_DOC_TURNS,
  });
  assert.equal(v.kind, "locked");
  if (v.kind === "locked") assert.match(v.reason, /整理好/);
});

// —— checkRateLimit：每分钟窗口限流 ——
test("checkRateLimit：窗口内放行至上限，超出拒绝，跨窗口恢复", () => {
  const token = "rl-" + Math.random().toString(36).slice(2);
  const t0 = 1_000_000;
  for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) {
    assert.equal(checkRateLimit(token, t0 + i), true, `第 ${i + 1} 次应放行`);
  }
  assert.equal(checkRateLimit(token, t0 + RATE_LIMIT_PER_MINUTE), false, "超限应拒绝");
  // 61 秒后旧时间戳滑出窗口，恢复放行
  assert.equal(checkRateLimit(token, t0 + 61_000), true, "跨窗口后应恢复");
});

test("checkRateLimit：不同 token 相互独立", () => {
  const a = "rl-a-" + Math.random().toString(36).slice(2);
  const b = "rl-b-" + Math.random().toString(36).slice(2);
  const now = 2_000_000;
  for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) checkRateLimit(a, now + i);
  assert.equal(checkRateLimit(a, now + RATE_LIMIT_PER_MINUTE), false);
  assert.equal(checkRateLimit(b, now + RATE_LIMIT_PER_MINUTE), true, "b 不受 a 影响");
});

// —— 并发流锁 ——
test("stream lock：同 token 二次获取失败，释放后可再获取", () => {
  const token = "lk-" + Math.random().toString(36).slice(2);
  const now = 3_000_000;
  assert.equal(acquireStreamLock(token, now), true);
  assert.equal(acquireStreamLock(token, now + 1), false, "持锁期间二次获取应失败");
  releaseStreamLock(token);
  assert.equal(acquireStreamLock(token, now + 2), true, "释放后应可再获取");
  releaseStreamLock(token);
});

test("stream lock：超过 TTL 的泄漏锁允许抢占", () => {
  const token = "lk-ttl-" + Math.random().toString(36).slice(2);
  const now = 4_000_000;
  assert.equal(acquireStreamLock(token, now), true);
  // 未释放，但 11 分钟后视为泄漏，允许抢占
  assert.equal(acquireStreamLock(token, now + 11 * 60_000), true, "超 TTL 应可抢占");
  releaseStreamLock(token);
});

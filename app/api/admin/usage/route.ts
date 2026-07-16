import { db } from "@/lib/db";
import { estimateCostUsd, DAILY_BUDGET_USD } from "@/lib/budget";
import { NextResponse } from "next/server";

// 用量统计（认证由 proxy.ts 的 matcher "/api/admin/:path*" 覆盖）。
// token 数落库、成本查询时折算，调价不影响历史数据。
export async function GET() {
  const stats = db.getUsageStats();
  return NextResponse.json({
    dailyBudgetUsd: DAILY_BUDGET_USD,
    today: { ...stats.today, costUsd: estimateCostUsd(stats.today) },
    total: { ...stats.total, costUsd: estimateCostUsd(stats.total) },
    topSubmissions: stats.topSubmissions.map((s) => ({
      ...s,
      costUsd: estimateCostUsd(s),
    })),
  });
}

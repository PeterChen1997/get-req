import { NextRequest, NextResponse } from "next/server";

export function proxy(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return NextResponse.json(
      { error: "ADMIN_SECRET 未配置，管理接口已禁用" },
      { status: 500 }
    );
  }

  const provided =
    req.headers.get("x-admin-secret") ||
    req.cookies.get("admin_secret")?.value;

  if (provided !== adminSecret) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/requirements/:path*", "/api/invite/manage"],
};

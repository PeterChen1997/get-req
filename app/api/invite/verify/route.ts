import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { code } = await req.json();

  if (!code || typeof code !== "string") {
    return NextResponse.json(
      { valid: false, message: "请输入邀请码" },
      { status: 400 }
    );
  }

  const result = db.verifyInviteCode(code.trim());
  return NextResponse.json(result);
}

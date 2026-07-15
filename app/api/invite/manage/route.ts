import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

export async function GET() {
  const codes = db.listInviteCodes();
  return NextResponse.json(codes);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const code = (body.code as string) || uuidv4().slice(0, 8).toUpperCase();

  try {
    db.createInviteCode(code);
    return NextResponse.json({ code });
  } catch {
    return NextResponse.json({ error: "邀请码已存在" }, { status: 409 });
  }
}

export async function DELETE(req: Request) {
  const { code } = await req.json();
  if (!code) {
    return NextResponse.json({ error: "缺少邀请码" }, { status: 400 });
  }
  db.revokeInviteCode(code);
  return NextResponse.json({ ok: true });
}

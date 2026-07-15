import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

export async function POST(req: Request) {
  const { inviteCode, name, contactInfo, contactType } = await req.json();

  if (!inviteCode || !name || !contactInfo || !contactType) {
    return NextResponse.json({ error: "请填写完整信息" }, { status: 400 });
  }

  const validTypes = ["email", "phone", "wechat"];
  if (!validTypes.includes(contactType)) {
    return NextResponse.json({ error: "无效的联系方式类型" }, { status: 400 });
  }

  const verification = db.verifyInviteCode(inviteCode);
  if (!verification.valid) {
    return NextResponse.json(
      { error: verification.message },
      { status: 403 }
    );
  }

  const submissionId = uuidv4();
  const sessionToken = uuidv4();

  db.createSubmission({
    id: submissionId,
    inviteCode,
    name: name.trim(),
    contactInfo: contactInfo.trim(),
    contactType,
    sessionToken,
  });

  return NextResponse.json({ sessionToken });
}

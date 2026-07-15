import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { status } = await req.json();

  if (!["accepted", "rejected"].includes(status)) {
    return NextResponse.json({ error: "无效状态" }, { status: 400 });
  }

  const requirement = db.getRequirement(id);
  if (!requirement) {
    return NextResponse.json({ error: "需求不存在" }, { status: 404 });
  }

  db.updateRequirementStatus(id, status);
  return NextResponse.json({ ok: true });
}

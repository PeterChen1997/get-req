import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  const requirements = db.listRequirements();
  return NextResponse.json(requirements);
}

import { NextResponse } from "next/server";
import { runChecks } from "@/lib/check-engine";

export async function POST() {
  const count = await runChecks();
  return NextResponse.json({ checked: count });
}

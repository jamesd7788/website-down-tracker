import { NextResponse } from "next/server";
import { z } from "zod";
import { changePassword, createSessionCookie } from "@/lib/auth";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "current password and new password required" },
      { status: 400 }
    );
  }

  const { currentPassword, newPassword } = parsed.data;

  const success = await changePassword(currentPassword, newPassword);
  if (!success) {
    return NextResponse.json(
      { error: "current password is incorrect" },
      { status: 401 }
    );
  }

  // re-issue session cookie since password (signing secret) may have changed
  const { name, value, options } = createSessionCookie();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(name, value, options);
  return response;
}

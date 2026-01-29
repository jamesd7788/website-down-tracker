import { NextResponse } from "next/server";
import { checkPassword, createSessionCookie } from "@/lib/auth";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("password" in body) ||
    typeof (body as Record<string, unknown>).password !== "string"
  ) {
    return NextResponse.json({ error: "password required" }, { status: 400 });
  }

  const { password } = body as { password: string };

  if (!checkPassword(password)) {
    return NextResponse.json({ error: "invalid password" }, { status: 401 });
  }

  const { name, value, options } = createSessionCookie();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(name, value, options);
  return response;
}

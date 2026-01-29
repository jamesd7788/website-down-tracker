import crypto from "node:crypto";

const COOKIE_NAME = "session";
const SESSION_VALUE = "authenticated";

function getPassword(): string {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) throw new Error("DASHBOARD_PASSWORD env variable is not set");
  return pw;
}

function sign(value: string): string {
  const secret = getPassword();
  const hmac = crypto.createHmac("sha256", secret).update(value).digest("hex");
  return `${value}.${hmac}`;
}

export function checkPassword(password: string): boolean {
  return password === getPassword();
}

export function createSessionCookie(): {
  name: string;
  value: string;
  options: Record<string, unknown>;
} {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    name: COOKIE_NAME,
    value: sign(SESSION_VALUE),
    options: {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax" as const,
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    },
  };
}

export function deleteSessionCookie(): {
  name: string;
  value: string;
  options: Record<string, unknown>;
} {
  return {
    name: COOKIE_NAME,
    value: "",
    options: {
      httpOnly: true,
      path: "/",
      maxAge: 0,
    },
  };
}

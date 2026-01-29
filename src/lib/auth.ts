import crypto from "node:crypto";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";

const COOKIE_NAME = "session";
const SESSION_VALUE = "authenticated";
const PASSWORD_SETTINGS_KEY = "dashboard_password_hash";

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function getEnvPassword(): string {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) throw new Error("DASHBOARD_PASSWORD env variable is not set");
  return pw;
}

async function getStoredPasswordHash(): Promise<string | null> {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, PASSWORD_SETTINGS_KEY))
    .limit(1);
  return row?.value ?? null;
}

export async function checkPassword(password: string): Promise<boolean> {
  const storedHash = await getStoredPasswordHash();
  if (storedHash) {
    return crypto.timingSafeEqual(
      Buffer.from(hashPassword(password)),
      Buffer.from(storedHash)
    );
  }
  return password === getEnvPassword();
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<boolean> {
  const valid = await checkPassword(currentPassword);
  if (!valid) return false;

  const newHash = hashPassword(newPassword);
  await db
    .insert(settings)
    .values({ key: PASSWORD_SETTINGS_KEY, value: newHash })
    .onConflictDoUpdate({ target: settings.key, set: { value: newHash } });

  return true;
}

function sign(value: string): string {
  const secret = getEnvPassword();
  const hmac = crypto.createHmac("sha256", secret).update(value).digest("hex");
  return `${value}.${hmac}`;
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

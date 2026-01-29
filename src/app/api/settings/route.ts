import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";

const ALLOWED_KEYS = [
  "slack_webhook_url",
  "global_notify_downtime",
  "global_notify_slow_response",
  "global_notify_status_code",
  "global_notify_content_change",
  "global_notify_ssl_issue",
  "global_notify_header_anomaly",
] as const;

const updateSettingsSchema = z.object({
  slack_webhook_url: z.union([z.url(), z.literal("")]).optional(),
  global_notify_downtime: z.enum(["true", "false"]).optional(),
  global_notify_slow_response: z.enum(["true", "false"]).optional(),
  global_notify_status_code: z.enum(["true", "false"]).optional(),
  global_notify_content_change: z.enum(["true", "false"]).optional(),
  global_notify_ssl_issue: z.enum(["true", "false"]).optional(),
  global_notify_header_anomaly: z.enum(["true", "false"]).optional(),
});

export async function GET() {
  const rows = await db.select().from(settings);
  const result: Record<string, string> = {};
  for (const row of rows) {
    if ((ALLOWED_KEYS as readonly string[]).includes(row.key)) {
      result[row.key] = row.value;
    }
  }
  return NextResponse.json(result);
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const updates = parsed.data;

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    if (value === "") {
      await db.delete(settings).where(eq(settings.key, key));
    } else {
      await db
        .insert(settings)
        .values({ key, value })
        .onConflictDoUpdate({ target: settings.key, set: { value } });
    }
  }

  // return current state
  const rows = await db.select().from(settings);
  const result: Record<string, string> = {};
  for (const row of rows) {
    if ((ALLOWED_KEYS as readonly string[]).includes(row.key)) {
      result[row.key] = row.value;
    }
  }
  return NextResponse.json(result);
}

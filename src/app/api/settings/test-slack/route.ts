import { NextResponse } from "next/server";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST() {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "slack_webhook_url"))
    .limit(1);

  const webhookUrl = row?.value;
  if (!webhookUrl) {
    return NextResponse.json(
      { error: "no slack webhook url configured" },
      { status: 400 }
    );
  }

  const payload = {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: ":white_check_mark: *Test Notification*\nThis is a test message from Site Monitor. Your Slack webhook is configured correctly.",
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Sent at ${new Date().toISOString()}`,
          },
        ],
      },
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `webhook returned ${res.status}` },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "webhook request failed" },
      { status: 502 }
    );
  }
}

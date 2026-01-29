import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";

const RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes

// key: "siteId:anomalyType" -> last notification timestamp
const rateLimitMap = new Map<string, number>();

interface AnomalyNotification {
  siteName: string;
  siteUrl: string;
  anomalyType: string;
  description: string;
  severity: string;
  timestamp: Date;
  siteId: number;
}

function isRateLimited(siteId: number, anomalyType: string): boolean {
  const key = `${siteId}:${anomalyType}`;
  const last = rateLimitMap.get(key);
  if (last && Date.now() - last < RATE_LIMIT_MS) {
    return true;
  }
  rateLimitMap.set(key, Date.now());
  return false;
}

async function getWebhookUrl(): Promise<string | null> {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "slack_webhook_url"))
    .limit(1);
  return row?.value ?? null;
}

function severityEmoji(severity: string): string {
  switch (severity) {
    case "critical":
      return "\u{1f534}";
    case "high":
      return "\u{1f7e0}";
    case "medium":
      return "\u{1f7e1}";
    default:
      return "\u{1f535}";
  }
}

export async function notifyAnomaly(
  notification: AnomalyNotification
): Promise<void> {
  const webhookUrl = await getWebhookUrl();
  if (!webhookUrl) return;

  if (isRateLimited(notification.siteId, notification.anomalyType)) {
    return;
  }

  const emoji = severityEmoji(notification.severity);
  const payload = {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${emoji} *Anomaly Detected: ${notification.anomalyType}*`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Site:*\n${notification.siteName}` },
          { type: "mrkdwn", text: `*URL:*\n${notification.siteUrl}` },
          { type: "mrkdwn", text: `*Type:*\n${notification.anomalyType}` },
          { type: "mrkdwn", text: `*Severity:*\n${notification.severity}` },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Description:*\n${notification.description}`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Detected at ${notification.timestamp.toISOString()}`,
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
      console.error(
        `[slack-notifier] webhook delivery failed: ${res.status} ${res.statusText}`
      );
    }
  } catch (err) {
    console.error(
      "[slack-notifier] webhook delivery error:",
      err instanceof Error ? err.message : err
    );
  }
}

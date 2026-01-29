import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";

const RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes

// key: "siteId:anomalyType" -> last notification timestamp
const rateLimitMap = new Map<string, number>();

// key: siteId -> timestamp when continuous downtime started
const downtimeStartMap = new Map<number, number>();

const DEFAULT_ESCALATION_THRESHOLD_MINUTES = 5;

export function recordDowntimeStart(siteId: number): void {
  if (!downtimeStartMap.has(siteId)) {
    downtimeStartMap.set(siteId, Date.now());
  }
}

export function clearDowntime(siteId: number): void {
  downtimeStartMap.delete(siteId);
}

export function isEscalated(
  siteId: number,
  thresholdMinutes: number | null
): boolean {
  const start = downtimeStartMap.get(siteId);
  if (start == null) return false;
  const threshold =
    (thresholdMinutes ?? DEFAULT_ESCALATION_THRESHOLD_MINUTES) * 60 * 1000;
  return Date.now() - start >= threshold;
}

interface AnomalyNotification {
  siteName: string;
  siteUrl: string;
  anomalyType: string;
  description: string;
  severity: string;
  timestamp: Date;
  siteId: number;
  escalated?: boolean;
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
  const prefix = notification.escalated ? "ESCALATED: " : "";
  const channelMention = notification.escalated ? "<!channel> " : "";
  const payload = {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${channelMention}${emoji} *${prefix}Anomaly Detected: ${notification.anomalyType}*`,
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

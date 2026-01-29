import { db } from "@/db";
import { sites, checks, anomalies, siteSettings } from "@/db/schema";
import { eq, desc, type InferSelectModel } from "drizzle-orm";
import { notifyAnomaly } from "@/lib/slack-notifier";

type SiteSettingsRow = InferSelectModel<typeof siteSettings>;

type AnomalyType =
  | "downtime"
  | "slow_response"
  | "status_code"
  | "content_change"
  | "ssl_issue"
  | "header_anomaly";

type Severity = "low" | "medium" | "high" | "critical";

interface AnomalyRecord {
  checkId: number;
  siteId: number;
  type: AnomalyType;
  description: string;
  severity: Severity;
}

const ROLLING_AVERAGE_WINDOW = 10;
const DEFAULT_SLOW_RESPONSE_MULTIPLIER = 2;
const DEFAULT_SSL_EXPIRY_WARNING_DAYS = 7;

const SEVERITY_LEVELS: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const NOTIFY_TYPE_FIELDS: Record<AnomalyType, string> = {
  downtime: "notifyDowntime",
  slow_response: "notifySlowResponse",
  status_code: "notifyStatusCode",
  content_change: "notifyContentChange",
  ssl_issue: "notifySslIssue",
  header_anomaly: "notifyHeaderAnomaly",
};

function shouldNotify(
  overrides: SiteSettingsRow | undefined,
  anomalyType: AnomalyType,
  severity: Severity
): boolean {
  if (!overrides) return true; // no prefs = notify everything

  // check type toggle (null = default = enabled)
  const field = NOTIFY_TYPE_FIELDS[anomalyType] as keyof SiteSettingsRow;
  const typeEnabled = overrides[field];
  if (typeEnabled === false) return false;

  // check severity floor (null = default = "low" = notify everything)
  const threshold = (overrides.severityThreshold as Severity | null) ?? "low";
  return SEVERITY_LEVELS[severity] >= SEVERITY_LEVELS[threshold];
}

const SECURITY_HEADERS = [
  "strict-transport-security",
  "content-security-policy",
  "x-content-type-options",
  "x-frame-options",
  "x-xss-protection",
  "referrer-policy",
  "permissions-policy",
];

export async function detectAnomalies(
  checkId: number,
  siteId: number
): Promise<void> {
  // fetch the current check
  const [current] = await db
    .select()
    .from(checks)
    .where(eq(checks.id, checkId))
    .limit(1);

  if (!current) return;

  // fetch recent previous checks for this site (excluding current)
  const previousChecks = await db
    .select()
    .from(checks)
    .where(eq(checks.siteId, siteId))
    .orderBy(desc(checks.checkedAt))
    .limit(ROLLING_AVERAGE_WINDOW + 1);

  // filter out the current check from previous
  const history = previousChecks.filter((c) => c.id !== checkId);

  // fetch site info (needed for ssl checks and notifications)
  const [site] = await db
    .select()
    .from(sites)
    .where(eq(sites.id, siteId))
    .limit(1);

  if (!site) return;

  // fetch per-site threshold overrides
  const [overrides] = await db
    .select()
    .from(siteSettings)
    .where(eq(siteSettings.siteId, siteId))
    .limit(1);

  const sslExpiryWarningDays =
    overrides?.sslExpiryWarningDays ?? DEFAULT_SSL_EXPIRY_WARNING_DAYS;

  const detected: AnomalyRecord[] = [];

  // 1. downtime: site unreachable or 5xx
  if (!current.isUp) {
    if (current.statusCode !== null && current.statusCode >= 500) {
      detected.push({
        checkId,
        siteId,
        type: "downtime",
        description: `server error: HTTP ${current.statusCode}`,
        severity: "critical",
      });
    } else if (current.statusCode === null) {
      detected.push({
        checkId,
        siteId,
        type: "downtime",
        description: current.errorMessage
          ? `site unreachable: ${current.errorMessage}`
          : "site unreachable",
        severity: "critical",
      });
    }
  }

  // 2. slow response: per-site absolute threshold or 2x rolling average
  if (current.responseTimeMs !== null) {
    if (overrides?.responseTimeThreshold != null) {
      // absolute threshold override
      if (current.responseTimeMs > overrides.responseTimeThreshold) {
        detected.push({
          checkId,
          siteId,
          type: "slow_response",
          description: `response time ${current.responseTimeMs}ms exceeds threshold (${overrides.responseTimeThreshold}ms)`,
          severity:
            current.responseTimeMs > overrides.responseTimeThreshold * 2
              ? "high"
              : "medium",
        });
      }
    } else if (history.length > 0) {
      // default: 2x rolling average
      const historicalTimes = history
        .map((c) => c.responseTimeMs)
        .filter((t): t is number => t !== null);

      if (historicalTimes.length > 0) {
        const avg =
          historicalTimes.reduce((sum, t) => sum + t, 0) /
          historicalTimes.length;
        const threshold = avg * DEFAULT_SLOW_RESPONSE_MULTIPLIER;

        if (current.responseTimeMs > threshold) {
          detected.push({
            checkId,
            siteId,
            type: "slow_response",
            description: `response time ${current.responseTimeMs}ms exceeds 2x rolling average (${Math.round(avg)}ms)`,
            severity: current.responseTimeMs > avg * 4 ? "high" : "medium",
          });
        }
      }
    }
  }

  // 3. unexpected status codes: 3xx or 4xx
  if (current.statusCode !== null) {
    if (current.statusCode >= 400 && current.statusCode < 500) {
      detected.push({
        checkId,
        siteId,
        type: "status_code",
        description: `client error: HTTP ${current.statusCode}`,
        severity: current.statusCode === 401 || current.statusCode === 403
          ? "high"
          : "medium",
      });
    } else if (current.statusCode >= 300 && current.statusCode < 400) {
      detected.push({
        checkId,
        siteId,
        type: "status_code",
        description: `redirect: HTTP ${current.statusCode}`,
        severity: "low",
      });
    }
  }

  // 4. content change: body hash differs from previous check
  if (current.bodyHash !== null && history.length > 0) {
    const lastWithHash = history.find((c) => c.bodyHash !== null);
    if (lastWithHash && lastWithHash.bodyHash !== current.bodyHash) {
      detected.push({
        checkId,
        siteId,
        type: "content_change",
        description: "response body content changed since last check",
        severity: "low",
      });
    }
  }

  // 5. ssl issues: invalid, expiring within 7 days, or missing on https site
  if (site.url.startsWith("https://")) {
    if (current.sslValid === false) {
      detected.push({
        checkId,
        siteId,
        type: "ssl_issue",
        description: "ssl certificate is invalid",
        severity: "critical",
      });
    }

    if (current.sslExpiry !== null) {
      const daysUntilExpiry = Math.floor(
        (current.sslExpiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );
      if (daysUntilExpiry <= 0) {
        detected.push({
          checkId,
          siteId,
          type: "ssl_issue",
          description: `ssl certificate expired ${Math.abs(daysUntilExpiry)} days ago`,
          severity: "critical",
        });
      } else if (daysUntilExpiry <= sslExpiryWarningDays) {
        detected.push({
          checkId,
          siteId,
          type: "ssl_issue",
          description: `ssl certificate expires in ${daysUntilExpiry} days`,
          severity: "high",
        });
      }
    }
  }

  // 6. header anomalies: security headers removed or changed
  if (current.headersSnapshot !== null && history.length > 0) {
    const lastWithHeaders = history.find((c) => c.headersSnapshot !== null);
    if (lastWithHeaders) {
      const currentHeaders = parseHeaders(current.headersSnapshot);
      const previousHeaders = parseHeaders(lastWithHeaders.headersSnapshot!);

      const removedHeaders: string[] = [];
      const changedHeaders: string[] = [];

      for (const header of SECURITY_HEADERS) {
        const prev = previousHeaders[header];
        const curr = currentHeaders[header];

        if (prev !== undefined && curr === undefined) {
          removedHeaders.push(header);
        } else if (
          prev !== undefined &&
          curr !== undefined &&
          prev !== curr
        ) {
          changedHeaders.push(header);
        }
      }

      if (removedHeaders.length > 0) {
        detected.push({
          checkId,
          siteId,
          type: "header_anomaly",
          description: `security headers removed: ${removedHeaders.join(", ")}`,
          severity: "high",
        });
      }

      if (changedHeaders.length > 0) {
        detected.push({
          checkId,
          siteId,
          type: "header_anomaly",
          description: `security headers changed: ${changedHeaders.join(", ")}`,
          severity: "medium",
        });
      }
    }
  }

  // insert all detected anomalies
  if (detected.length > 0) {
    await db.insert(anomalies).values(detected);

    // fire slack notifications (best-effort, never throws)
    // respects per-site notification preferences: type toggle + severity floor
    for (const anomaly of detected) {
      if (!shouldNotify(overrides, anomaly.type, anomaly.severity)) {
        continue;
      }
      notifyAnomaly({
        siteName: site.name,
        siteUrl: site.url,
        anomalyType: anomaly.type,
        description: anomaly.description,
        severity: anomaly.severity,
        timestamp: new Date(),
        siteId: anomaly.siteId,
      }).catch((err) => {
        console.error("[slack-notifier] unexpected error:", err);
      });
    }
  }
}

function parseHeaders(
  snapshot: string
): Record<string, string | undefined> {
  try {
    const parsed = JSON.parse(snapshot);
    const flat: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(parsed)) {
      flat[key.toLowerCase()] = Array.isArray(value)
        ? value.join(", ")
        : (value as string | undefined);
    }
    return flat;
  } catch {
    return {};
  }
}

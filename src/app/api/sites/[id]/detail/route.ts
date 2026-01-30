import { NextResponse } from "next/server";
import { db } from "@/db";
import { sites, checks, anomalies } from "@/db/schema";
import { eq, desc, and, gte } from "drizzle-orm";

type RouteParams = { params: Promise<{ id: string }> };

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const [site] = await db.select().from(sites).where(eq(sites.id, id));
  if (!site) {
    return NextResponse.json({ error: "site not found" }, { status: 404 });
  }

  const [latestCheck] = await db
    .select()
    .from(checks)
    .where(eq(checks.siteId, id))
    .orderBy(desc(checks.checkedAt))
    .limit(1);

  const now = Date.now();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

  // all checks in last 30 days for percentiles, uptime, and time-series
  const recentChecks = await db
    .select({
      responseTimeMs: checks.responseTimeMs,
      isUp: checks.isUp,
      checkedAt: checks.checkedAt,
    })
    .from(checks)
    .where(and(eq(checks.siteId, id), gte(checks.checkedAt, thirtyDaysAgo)))
    .orderBy(checks.checkedAt);

  // response time percentiles
  const responseTimes = recentChecks
    .map((c) => c.responseTimeMs)
    .filter((t): t is number => t != null)
    .sort((a, b) => a - b);

  const avg =
    responseTimes.length > 0
      ? Math.round(
          responseTimes.reduce((s, t) => s + t, 0) / responseTimes.length
        )
      : null;
  const p50 = responseTimes.length > 0 ? percentile(responseTimes, 50) : null;
  const p95 = responseTimes.length > 0 ? percentile(responseTimes, 95) : null;
  const p99 = responseTimes.length > 0 ? percentile(responseTimes, 99) : null;

  // uptime calculations
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

  function uptimePercent(since: Date): number | null {
    const relevant = recentChecks.filter(
      (c) => c.checkedAt >= since && c.isUp != null
    );
    if (relevant.length === 0) return null;
    const upCount = relevant.filter((c) => c.isUp === true).length;
    return Math.round((upCount / relevant.length) * 10000) / 100;
  }

  const uptime24h = uptimePercent(oneDayAgo);
  const uptime7d = uptimePercent(sevenDaysAgo);
  const uptime30d = uptimePercent(thirtyDaysAgo);

  // time-series data
  const timeSeries = recentChecks.map((c) => ({
    time: c.checkedAt,
    responseTimeMs: c.responseTimeMs,
    isUp: c.isUp,
  }));

  // recent anomalies (last 30 days, newest first, limit 50) — includes checkId for detail drill-down
  // join checks to surface responseTimeMs and statusCode for inline diagnostics
  const recentAnomalies = await db
    .select({
      id: anomalies.id,
      checkId: anomalies.checkId,
      type: anomalies.type,
      description: anomalies.description,
      severity: anomalies.severity,
      createdAt: anomalies.createdAt,
      responseTimeMs: checks.responseTimeMs,
      statusCode: checks.statusCode,
    })
    .from(anomalies)
    .innerJoin(checks, eq(anomalies.checkId, checks.id))
    .where(
      and(eq(anomalies.siteId, id), gte(anomalies.createdAt, thirtyDaysAgo))
    )
    .orderBy(desc(anomalies.createdAt))
    .limit(50);

  return NextResponse.json({
    site,
    latestCheck: latestCheck ?? null,
    responseTime: { avg, p50, p95, p99 },
    uptime: { "24h": uptime24h, "7d": uptime7d, "30d": uptime30d },
    timeSeries,
    anomalies: recentAnomalies,
  });
}

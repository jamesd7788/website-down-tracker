import { NextResponse } from "next/server";
import { db } from "@/db";
import { sites, checks, anomalies } from "@/db/schema";
import { eq, desc, sql, and, gte } from "drizzle-orm";

export async function GET() {
  const allSites = await db.select().from(sites);

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const enriched = await Promise.all(
    allSites.map(async (site) => {
      const [latestCheck] = await db
        .select()
        .from(checks)
        .where(eq(checks.siteId, site.id))
        .orderBy(desc(checks.checkedAt))
        .limit(1);

      const [anomalyCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(anomalies)
        .where(
          and(
            eq(anomalies.siteId, site.id),
            gte(anomalies.createdAt, oneDayAgo)
          )
        );

      return {
        ...site,
        latestCheck: latestCheck ?? null,
        activeAnomalyCount: anomalyCount?.count ?? 0,
      };
    })
  );

  return NextResponse.json(enriched);
}

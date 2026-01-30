import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb } from "./test-db";
import { sites, checks, anomalies } from "@/db/schema";

const testDb = createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { GET } = await import("@/app/api/sites/[id]/detail/route");

async function insertSite(name: string, url: string) {
  const now = new Date();
  const [row] = await testDb
    .insert(sites)
    .values({ name, url, isActive: true, createdAt: now, updatedAt: now })
    .returning();
  return row;
}

async function insertCheck(
  siteId: number,
  overrides: Record<string, unknown> = {}
) {
  const [row] = await testDb
    .insert(checks)
    .values({
      siteId,
      statusCode: 200,
      responseTimeMs: 100,
      isUp: true,
      errorMessage: null,
      headersSnapshot: null,
      bodyHash: null,
      sslValid: null,
      sslExpiry: null,
      sslCertificate: null,
      errorCode: null,
      redirectChain: null,
      checkedAt: new Date(),
      ...overrides,
    })
    .returning();
  return row;
}

async function insertAnomaly(
  checkId: number,
  siteId: number,
  type: "downtime" | "slow_response" | "status_code" | "content_change" | "ssl_issue" | "header_anomaly",
  severity: "low" | "medium" | "high" | "critical"
) {
  const [row] = await testDb
    .insert(anomalies)
    .values({
      checkId,
      siteId,
      type,
      severity,
      description: `test ${type}`,
      createdAt: new Date(),
    })
    .returning();
  return row;
}

async function clearAllTables() {
  await testDb.delete(anomalies);
  await testDb.delete(checks);
  await testDb.delete(sites);
}

function makeRequest(id: string) {
  const req = new Request(`http://localhost/api/sites/${id}/detail`);
  const params = Promise.resolve({ id });
  return GET(req, {
    params,
  } as unknown as { params: Promise<{ id: string }> });
}

describe("GET /api/sites/[id]/detail", () => {
  beforeEach(async () => {
    await clearAllTables();
  });

  it("returns 400 for invalid id", async () => {
    const res = await makeRequest("abc");
    expect(res.status).toBe(400);
  });

  it("returns 404 for nonexistent site", async () => {
    const res = await makeRequest("9999");
    expect(res.status).toBe(404);
  });

  it("returns site detail with anomalies including checkId", async () => {
    const site = await insertSite("test", "https://test.com");
    const check = await insertCheck(site.id);
    await insertAnomaly(check.id, site.id, "downtime", "critical");

    const res = await makeRequest(String(site.id));
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.site.id).toBe(site.id);
    expect(data.anomalies).toHaveLength(1);
    expect(data.anomalies[0].checkId).toBe(check.id);
    expect(data.anomalies[0].type).toBe("downtime");
    expect(data.anomalies[0].severity).toBe("critical");
  });

  it("does NOT return recentChecks (removed)", async () => {
    const site = await insertSite("test", "https://test.com");
    await insertCheck(site.id);

    const res = await makeRequest(String(site.id));
    const data = await res.json();
    expect(data.recentChecks).toBeUndefined();
  });

  it("returns uptime and response time stats", async () => {
    const site = await insertSite("test", "https://test.com");
    for (let i = 0; i < 5; i++) {
      await insertCheck(site.id, {
        responseTimeMs: 100 + i * 10,
        checkedAt: new Date(Date.now() - i * 60_000),
      });
    }

    const res = await makeRequest(String(site.id));
    const data = await res.json();

    expect(data.responseTime.avg).toBeGreaterThan(0);
    expect(data.uptime["24h"]).toBe(100);
    expect(data.timeSeries.length).toBe(5);
  });
});

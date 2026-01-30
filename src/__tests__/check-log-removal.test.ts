import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
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
  type: "downtime" | "slow_response" | "status_code",
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

describe("check log removal regression", () => {
  beforeEach(async () => {
    await clearAllTables();
  });

  describe("API response shape", () => {
    it("does not contain recentChecks field", async () => {
      const site = await insertSite("test", "https://test.com");
      await insertCheck(site.id);

      const res = await makeRequest(String(site.id));
      const data = await res.json();

      expect(data).not.toHaveProperty("recentChecks");
    });

    it("does not contain recentChecks even with many checks", async () => {
      const site = await insertSite("test", "https://test.com");
      for (let i = 0; i < 10; i++) {
        await insertCheck(site.id, {
          checkedAt: new Date(Date.now() - i * 60_000),
        });
      }

      const res = await makeRequest(String(site.id));
      const data = await res.json();

      expect(data).not.toHaveProperty("recentChecks");
      expect(data).not.toHaveProperty("checkLogs");
      expect(data).not.toHaveProperty("recentCheckLogs");
    });

    it("only contains expected top-level keys", async () => {
      const site = await insertSite("test", "https://test.com");
      const check = await insertCheck(site.id);
      await insertAnomaly(check.id, site.id, "downtime", "critical");

      const res = await makeRequest(String(site.id));
      const data = await res.json();

      const keys = Object.keys(data).sort();
      expect(keys).toEqual(
        ["anomalies", "latestCheck", "responseTime", "site", "timeSeries", "uptime"].sort()
      );
    });
  });

  describe("site detail page module", () => {
    const pageSource = readFileSync(
      resolve(__dirname, "../app/site/[id]/page.tsx"),
      "utf-8"
    );

    it("has no CheckLogEntry interface", () => {
      expect(pageSource).not.toMatch(/interface\s+CheckLogEntry/);
    });

    it("has no recentChecks references", () => {
      expect(pageSource).not.toMatch(/recentChecks/);
    });

    it("has no check log section heading", () => {
      expect(pageSource).not.toMatch(/check\s*logs?/i);
    });

    it("has no checkLogs or checkLog variable references", () => {
      expect(pageSource).not.toMatch(/\bcheckLog(s)?\b/);
    });
  });
});

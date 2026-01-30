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
  type:
    | "downtime"
    | "slow_response"
    | "status_code"
    | "content_change"
    | "ssl_issue"
    | "header_anomaly",
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

describe("clickable anomaly rows", () => {
  beforeEach(async () => {
    await clearAllTables();
  });

  describe("API returns checkId on anomaly objects", () => {
    it("each anomaly object has a numeric checkId", async () => {
      const site = await insertSite("test", "https://test.com");
      const check = await insertCheck(site.id);
      await insertAnomaly(check.id, site.id, "downtime", "critical");

      const res = await makeRequest(String(site.id));
      const data = await res.json();

      expect(data.anomalies).toHaveLength(1);
      expect(data.anomalies[0]).toHaveProperty("checkId");
      expect(typeof data.anomalies[0].checkId).toBe("number");
    });

    it("checkId matches the originating check", async () => {
      const site = await insertSite("test", "https://test.com");
      const check1 = await insertCheck(site.id, { statusCode: 500 });
      const check2 = await insertCheck(site.id, { statusCode: 503 });
      await insertAnomaly(check1.id, site.id, "status_code", "high");
      await insertAnomaly(check2.id, site.id, "downtime", "critical");

      const res = await makeRequest(String(site.id));
      const data = await res.json();

      expect(data.anomalies).toHaveLength(2);
      const checkIds = data.anomalies.map(
        (a: { checkId: number }) => a.checkId
      );
      expect(checkIds).toContain(check1.id);
      expect(checkIds).toContain(check2.id);
    });

    it("anomaly includes inline diagnostic fields from joined check", async () => {
      const site = await insertSite("test", "https://test.com");
      const check = await insertCheck(site.id, {
        statusCode: 503,
        responseTimeMs: 4500,
      });
      await insertAnomaly(check.id, site.id, "slow_response", "medium");

      const res = await makeRequest(String(site.id));
      const data = await res.json();

      expect(data.anomalies[0].responseTimeMs).toBe(4500);
      expect(data.anomalies[0].statusCode).toBe(503);
    });
  });

  describe("anomaly row click handler sets selected check ID", () => {
    const pageSource = readFileSync(
      resolve(__dirname, "../app/site/[id]/page.tsx"),
      "utf-8"
    );

    it("Anomaly interface declares checkId field", () => {
      expect(pageSource).toMatch(
        /interface\s+Anomaly\s*\{[^}]*checkId:\s*number/s
      );
    });

    it("anomaly row onClick calls setSelectedCheckId with a.checkId", () => {
      expect(pageSource).toMatch(/onClick=\{?\(\)\s*=>\s*setSelectedCheckId\(a\.checkId\)/);
    });

    it("selectedCheckId state controls CheckDetailModal rendering", () => {
      expect(pageSource).toMatch(/selectedCheckId\s*!=\s*null\s*&&/);
      expect(pageSource).toMatch(/<CheckDetailModal/);
      expect(pageSource).toMatch(/checkId=\{selectedCheckId\}/);
    });
  });

  describe("suppress button click does not propagate to row click handler", () => {
    const pageSource = readFileSync(
      resolve(__dirname, "../app/site/[id]/page.tsx"),
      "utf-8"
    );

    it("suppress button calls e.stopPropagation()", () => {
      expect(pageSource).toMatch(
        /onClick=\{\(e\)\s*=>\s*\{\s*e\.stopPropagation\(\)/
      );
    });

    it("suppress button has type='button' to prevent form submission", () => {
      // the suppress button must be type="button" inside the clickable row
      expect(pageSource).toMatch(/type="button"\s*\n?\s*onClick=\{\(e\)\s*=>\s*\{\s*e\.stopPropagation/);
    });

    it("suppress dropdown options also stop propagation", () => {
      // both "for this site only" and "for all sites" buttons also stopPropagation
      const matches = pageSource.match(/e\.stopPropagation\(\)/g);
      expect(matches).not.toBeNull();
      // at least 3: suppress toggle + 2 dropdown options
      expect(matches!.length).toBeGreaterThanOrEqual(3);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb } from "./test-db";
import { sites, checks, anomalies, siteSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

const testDb = createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

// mock slack notifier — we don't want to send slack messages in tests
vi.mock("@/lib/slack-notifier", () => ({
  notifyAnomaly: vi.fn().mockResolvedValue(undefined),
  recordDowntimeStart: vi.fn(),
  clearDowntime: vi.fn(),
  isEscalated: vi.fn().mockReturnValue(false),
}));

const { detectAnomalies } = await import("@/lib/anomaly-detector");

async function insertSite(name: string, url: string) {
  const now = new Date();
  const [row] = await testDb
    .insert(sites)
    .values({
      name,
      url,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row;
}

async function insertCheck(
  siteId: number,
  overrides: Partial<{
    statusCode: number | null;
    responseTimeMs: number | null;
    isUp: boolean;
    errorMessage: string | null;
    errorCode: string | null;
    headersSnapshot: string | null;
    bodyHash: string | null;
    sslValid: boolean | null;
    sslExpiry: Date | null;
    sslCertificate: string | null;
    redirectChain: string | null;
    checkedAt: Date;
  }> = {}
) {
  const [row] = await testDb
    .insert(checks)
    .values({
      siteId,
      statusCode: "statusCode" in overrides ? overrides.statusCode : 200,
      responseTimeMs: "responseTimeMs" in overrides ? overrides.responseTimeMs : 100,
      isUp: "isUp" in overrides ? overrides.isUp : true,
      errorMessage: overrides.errorMessage ?? null,
      errorCode: overrides.errorCode ?? null,
      headersSnapshot: overrides.headersSnapshot ?? null,
      bodyHash: overrides.bodyHash ?? null,
      sslValid: "sslValid" in overrides ? overrides.sslValid : null,
      sslExpiry: "sslExpiry" in overrides ? overrides.sslExpiry : null,
      sslCertificate: overrides.sslCertificate ?? null,
      redirectChain: overrides.redirectChain ?? null,
      checkedAt: overrides.checkedAt ?? new Date(),
    })
    .returning();
  return row;
}

async function getAnomaliesForCheck(checkId: number) {
  return testDb
    .select()
    .from(anomalies)
    .where(eq(anomalies.checkId, checkId));
}

async function clearAllTables() {
  await testDb.delete(anomalies);
  await testDb.delete(siteSettings);
  await testDb.delete(checks);
  await testDb.delete(sites);
}

describe("anomaly-detector: detectAnomalies", () => {
  beforeEach(async () => {
    await clearAllTables();
  });

  describe("downtime detection", () => {
    it("detects 5xx as critical downtime", async () => {
      const site = await insertSite("test", "https://test.com");
      const check = await insertCheck(site.id, {
        statusCode: 503,
        isUp: false,
      });

      await detectAnomalies(check.id, site.id);
      const found = await getAnomaliesForCheck(check.id);

      expect(found).toHaveLength(1);
      expect(found[0].type).toBe("downtime");
      expect(found[0].severity).toBe("critical");
      expect(found[0].description).toContain("503");
    });

    it("detects unreachable site (null statusCode) as critical downtime", async () => {
      const site = await insertSite("test", "https://test.com");
      const check = await insertCheck(site.id, {
        statusCode: null,
        isUp: false,
        errorMessage: "ECONNREFUSED",
      });

      await detectAnomalies(check.id, site.id);
      const found = await getAnomaliesForCheck(check.id);

      expect(found.some((a) => a.type === "downtime")).toBe(true);
      const downtime = found.find((a) => a.type === "downtime")!;
      expect(downtime.severity).toBe("critical");
      expect(downtime.description).toContain("ECONNREFUSED");
    });

    it("does not flag downtime when site is up", async () => {
      const site = await insertSite("test", "https://test.com");
      const check = await insertCheck(site.id, {
        statusCode: 200,
        isUp: true,
      });

      await detectAnomalies(check.id, site.id);
      const found = await getAnomaliesForCheck(check.id);
      expect(found.filter((a) => a.type === "downtime")).toHaveLength(0);
    });
  });

  describe("slow response detection", () => {
    it("detects slow response via rolling average (2x)", async () => {
      const site = await insertSite("test", "https://test.com");
      // insert history with avg ~100ms
      for (let i = 0; i < 5; i++) {
        await insertCheck(site.id, {
          responseTimeMs: 100,
          checkedAt: new Date(Date.now() - (i + 1) * 60_000),
        });
      }
      // current check at 250ms (> 2x of 100)
      const check = await insertCheck(site.id, { responseTimeMs: 250 });

      await detectAnomalies(check.id, site.id);
      const found = await getAnomaliesForCheck(check.id);

      expect(found.some((a) => a.type === "slow_response")).toBe(true);
    });

    it("does not flag normal response times", async () => {
      const site = await insertSite("test", "https://test.com");
      for (let i = 0; i < 5; i++) {
        await insertCheck(site.id, {
          responseTimeMs: 100,
          checkedAt: new Date(Date.now() - (i + 1) * 60_000),
        });
      }
      // current check at 150ms (< 2x of 100)
      const check = await insertCheck(site.id, { responseTimeMs: 150 });

      await detectAnomalies(check.id, site.id);
      const found = await getAnomaliesForCheck(check.id);
      expect(found.filter((a) => a.type === "slow_response")).toHaveLength(0);
    });

    it("uses per-site absolute threshold when configured", async () => {
      const site = await insertSite("test", "https://test.com");
      await testDb.insert(siteSettings).values({
        siteId: site.id,
        responseTimeThreshold: 200,
        updatedAt: new Date(),
      });

      const check = await insertCheck(site.id, { responseTimeMs: 250 });

      await detectAnomalies(check.id, site.id);
      const found = await getAnomaliesForCheck(check.id);
      expect(found.some((a) => a.type === "slow_response")).toBe(true);
    });
  });

  describe("status code detection", () => {
    it("detects 4xx status codes", async () => {
      const site = await insertSite("test", "https://test.com");
      const check = await insertCheck(site.id, {
        statusCode: 404,
        isUp: true,
      });

      await detectAnomalies(check.id, site.id);
      const found = await getAnomaliesForCheck(check.id);
      expect(found.some((a) => a.type === "status_code")).toBe(true);
    });

    it("flags 401/403 as high severity", async () => {
      const site = await insertSite("test", "https://test.com");
      const check = await insertCheck(site.id, { statusCode: 403, isUp: true });

      await detectAnomalies(check.id, site.id);
      const found = await getAnomaliesForCheck(check.id);
      const sc = found.find((a) => a.type === "status_code")!;
      expect(sc.severity).toBe("high");
    });

    it("does not flag 200-299 status codes", async () => {
      const site = await insertSite("test", "https://test.com");
      const check = await insertCheck(site.id, { statusCode: 200, isUp: true });

      await detectAnomalies(check.id, site.id);
      const found = await getAnomaliesForCheck(check.id);
      expect(found.filter((a) => a.type === "status_code")).toHaveLength(0);
    });
  });

  describe("content change detection", () => {
    it("detects body hash changes", async () => {
      const site = await insertSite("test", "https://test.com");
      await insertCheck(site.id, {
        bodyHash: "abc123",
        checkedAt: new Date(Date.now() - 60_000),
      });
      const check = await insertCheck(site.id, { bodyHash: "def456" });

      await detectAnomalies(check.id, site.id);
      const found = await getAnomaliesForCheck(check.id);
      expect(found.some((a) => a.type === "content_change")).toBe(true);
    });

    it("does not flag when body hash is the same", async () => {
      const site = await insertSite("test", "https://test.com");
      await insertCheck(site.id, {
        bodyHash: "abc123",
        checkedAt: new Date(Date.now() - 60_000),
      });
      const check = await insertCheck(site.id, { bodyHash: "abc123" });

      await detectAnomalies(check.id, site.id);
      const found = await getAnomaliesForCheck(check.id);
      expect(found.filter((a) => a.type === "content_change")).toHaveLength(0);
    });
  });

  describe("ssl issue detection", () => {
    it("detects invalid ssl certificate", async () => {
      const site = await insertSite("test", "https://test.com");
      const check = await insertCheck(site.id, { sslValid: false });

      await detectAnomalies(check.id, site.id);
      const found = await getAnomaliesForCheck(check.id);
      expect(found.some((a) => a.type === "ssl_issue")).toBe(true);
      const ssl = found.find((a) => a.type === "ssl_issue")!;
      expect(ssl.severity).toBe("critical");
    });

    it("detects ssl cert expiring within 7 days", async () => {
      const site = await insertSite("test", "https://test.com");
      const expiresIn3Days = new Date(
        Date.now() + 3 * 24 * 60 * 60 * 1000
      );
      const check = await insertCheck(site.id, {
        sslValid: true,
        sslExpiry: expiresIn3Days,
      });

      await detectAnomalies(check.id, site.id);
      const found = await getAnomaliesForCheck(check.id);
      expect(found.some((a) => a.type === "ssl_issue")).toBe(true);
      const ssl = found.find((a) => a.type === "ssl_issue")!;
      expect(ssl.severity).toBe("high");
      expect(ssl.description).toContain("expires in");
    });

    it("detects already-expired ssl cert", async () => {
      const site = await insertSite("test", "https://test.com");
      const expired = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const check = await insertCheck(site.id, {
        sslValid: true,
        sslExpiry: expired,
      });

      await detectAnomalies(check.id, site.id);
      const found = await getAnomaliesForCheck(check.id);
      const ssl = found.find(
        (a) => a.type === "ssl_issue" && a.description?.includes("expired")
      );
      expect(ssl).toBeDefined();
      expect(ssl!.severity).toBe("critical");
    });

    it("does not flag ssl for http sites", async () => {
      const site = await insertSite("test", "http://test.com");
      const check = await insertCheck(site.id, { sslValid: null });

      await detectAnomalies(check.id, site.id);
      const found = await getAnomaliesForCheck(check.id);
      expect(found.filter((a) => a.type === "ssl_issue")).toHaveLength(0);
    });
  });

  describe("header anomaly detection", () => {
    it("detects removed security headers", async () => {
      const site = await insertSite("test", "https://test.com");
      const prevHeaders = JSON.stringify({
        "strict-transport-security": "max-age=31536000",
        "x-content-type-options": "nosniff",
      });
      const currHeaders = JSON.stringify({
        "x-content-type-options": "nosniff",
      });

      await insertCheck(site.id, {
        headersSnapshot: prevHeaders,
        checkedAt: new Date(Date.now() - 60_000),
      });
      const check = await insertCheck(site.id, {
        headersSnapshot: currHeaders,
      });

      await detectAnomalies(check.id, site.id);
      const found = await getAnomaliesForCheck(check.id);
      const ha = found.find((a) => a.type === "header_anomaly");
      expect(ha).toBeDefined();
      expect(ha!.description).toContain("strict-transport-security");
      expect(ha!.severity).toBe("high");
    });

    it("detects changed security headers", async () => {
      const site = await insertSite("test", "https://test.com");
      await insertCheck(site.id, {
        headersSnapshot: JSON.stringify({
          "content-security-policy": "default-src 'self'",
        }),
        checkedAt: new Date(Date.now() - 60_000),
      });
      const check = await insertCheck(site.id, {
        headersSnapshot: JSON.stringify({
          "content-security-policy": "default-src *",
        }),
      });

      await detectAnomalies(check.id, site.id);
      const found = await getAnomaliesForCheck(check.id);
      const ha = found.find(
        (a) =>
          a.type === "header_anomaly" &&
          a.description?.includes("changed")
      );
      expect(ha).toBeDefined();
      expect(ha!.severity).toBe("medium");
    });
  });
});

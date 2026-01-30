import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb } from "./test-db";
import { sites, checks, siteSettings } from "@/db/schema";

// mock the db module so check-engine uses our in-memory db
const testDb = createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

// mock anomaly detector — we test that separately
vi.mock("@/lib/anomaly-detector", () => ({
  detectAnomalies: vi.fn().mockResolvedValue(undefined),
}));

// mock the http layer: override performCheck via the module internals
// since performCheck is not exported, we mock the node:https/node:http modules
// to return controlled responses
vi.mock("node:https", () => ({
  request: vi.fn((_url: string, _opts: unknown, cb: (res: unknown) => void) => {
    const res = {
      statusCode: 200,
      headers: { "content-type": "text/html" },
      socket: null,
      on: (event: string, handler: (data?: Buffer) => void) => {
        if (event === "data") handler(Buffer.from("ok"));
        if (event === "end") handler();
      },
    };
    // call callback async to match real behavior
    setTimeout(() => cb(res), 1);
    return {
      on: vi.fn(),
      end: vi.fn(),
      destroy: vi.fn(),
    };
  }),
}));

vi.mock("node:http", () => ({
  request: vi.fn((_url: string, _opts: unknown, cb: (res: unknown) => void) => {
    const res = {
      statusCode: 200,
      headers: { "content-type": "text/html" },
      socket: null,
      on: (event: string, handler: (data?: Buffer) => void) => {
        if (event === "data") handler(Buffer.from("ok"));
        if (event === "end") handler();
      },
    };
    setTimeout(() => cb(res), 1);
    return {
      on: vi.fn(),
      end: vi.fn(),
      destroy: vi.fn(),
    };
  }),
}));

// import AFTER mocks are set up
const { runChecks } = await import("@/lib/check-engine");

async function insertSite(name: string, url: string, isActive = true) {
  const now = new Date();
  const [row] = await testDb
    .insert(sites)
    .values({ name, url, isActive, createdAt: now, updatedAt: now })
    .returning();
  return row;
}

async function insertCheck(siteId: number, checkedAt: Date) {
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
      checkedAt,
    })
    .returning();
  return row;
}

async function insertSiteSettings(siteId: number, checkInterval: number) {
  await testDb.insert(siteSettings).values({
    siteId,
    checkInterval,
    updatedAt: new Date(),
  });
}

async function clearAllTables() {
  await testDb.delete(siteSettings);
  await testDb.delete(checks);
  await testDb.delete(sites);
}

describe("check-engine: runChecks", () => {
  beforeEach(async () => {
    await clearAllTables();
  });

  it("returns 0 when no active sites exist", async () => {
    const count = await runChecks();
    expect(count).toBe(0);
  });

  it("checks a site that has never been checked", async () => {
    await insertSite("example", "https://example.com");
    const count = await runChecks();
    expect(count).toBe(1);
  });

  it("skips a site checked recently (within default 60s interval)", async () => {
    const site = await insertSite("example", "https://example.com");
    // checked 10 seconds ago
    await insertCheck(site.id, new Date(Date.now() - 10_000));

    const count = await runChecks();
    expect(count).toBe(0);
  });

  it("checks a site whose default interval has elapsed", async () => {
    const site = await insertSite("example", "https://example.com");
    // checked 90 seconds ago (> 60s default)
    await insertCheck(site.id, new Date(Date.now() - 90_000));

    const count = await runChecks();
    expect(count).toBe(1);
  });

  it("respects per-site check interval (longer)", async () => {
    const site = await insertSite("example", "https://example.com");
    await insertSiteSettings(site.id, 300); // 5 minutes
    // checked 90 seconds ago — within the 5min interval
    await insertCheck(site.id, new Date(Date.now() - 90_000));

    const count = await runChecks();
    expect(count).toBe(0);
  });

  it("respects per-site check interval (shorter)", async () => {
    const site = await insertSite("example", "https://example.com");
    await insertSiteSettings(site.id, 30); // 30 seconds
    // checked 45 seconds ago — past the 30s interval
    await insertCheck(site.id, new Date(Date.now() - 45_000));

    const count = await runChecks();
    expect(count).toBe(1);
  });

  it("handles multiple sites with different intervals", async () => {
    const siteA = await insertSite("fast", "https://fast.com");
    const siteB = await insertSite("slow", "https://slow.com");
    await insertSiteSettings(siteA.id, 30); // 30s
    await insertSiteSettings(siteB.id, 300); // 5min

    // both checked 45s ago
    await insertCheck(siteA.id, new Date(Date.now() - 45_000));
    await insertCheck(siteB.id, new Date(Date.now() - 45_000));

    const count = await runChecks();
    // siteA should be checked (45s > 30s), siteB should be skipped (45s < 300s)
    expect(count).toBe(1);
  });

  it("does not check inactive sites", async () => {
    await insertSite("inactive", "https://inactive.com", false);
    const count = await runChecks();
    expect(count).toBe(0);
  });
});

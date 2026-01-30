import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb } from "./test-db";
import { sites, checks, siteSettings } from "@/db/schema";

// mock the db module so check-engine uses our in-memory db
const testDb = createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

// mock anomaly detector — tested separately
vi.mock("@/lib/anomaly-detector", () => ({
  detectAnomalies: vi.fn().mockResolvedValue(undefined),
}));

// mock http layer to return controlled responses
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
    setTimeout(() => cb(res), 1);
    return { on: vi.fn(), end: vi.fn(), destroy: vi.fn() };
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
    return { on: vi.fn(), end: vi.fn(), destroy: vi.fn() };
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

describe("check-interval: per-site check intervals", () => {
  beforeEach(async () => {
    await clearAllTables();
  });

  it("skips a site with 120s interval when only 60s have elapsed", async () => {
    const site = await insertSite("slow-check", "https://slow-check.com");
    await insertSiteSettings(site.id, 120);
    // checked 60s ago — within the 120s interval
    await insertCheck(site.id, new Date(Date.now() - 60_000));

    const count = await runChecks();
    expect(count).toBe(0);
  });

  it("checks a site with 30s interval when 30s have elapsed", async () => {
    const site = await insertSite("fast-check", "https://fast-check.com");
    await insertSiteSettings(site.id, 30);
    // checked 31s ago — past the 30s interval
    await insertCheck(site.id, new Date(Date.now() - 31_000));

    const count = await runChecks();
    expect(count).toBe(1);
  });

  it("defaults to 60s interval when site has no interval setting", async () => {
    const site = await insertSite("default-interval", "https://default.com");
    // no siteSettings row — should use 60s default

    // checked 30s ago — within default 60s
    await insertCheck(site.id, new Date(Date.now() - 30_000));
    const skipCount = await runChecks();
    expect(skipCount).toBe(0);

    // clear checks and insert one from 61s ago — past default 60s
    await testDb.delete(checks);
    await insertCheck(site.id, new Date(Date.now() - 61_000));
    const checkCount = await runChecks();
    expect(checkCount).toBe(1);
  });

  it("checks multiple sites at their own cadence", async () => {
    const siteA = await insertSite("site-a", "https://site-a.com");
    const siteB = await insertSite("site-b", "https://site-b.com");
    const siteC = await insertSite("site-c", "https://site-c.com");

    await insertSiteSettings(siteA.id, 30);  // 30s interval
    await insertSiteSettings(siteB.id, 120); // 120s interval
    // siteC has no settings — defaults to 60s

    // all checked 45s ago
    const checkedAt = new Date(Date.now() - 45_000);
    await insertCheck(siteA.id, checkedAt);
    await insertCheck(siteB.id, checkedAt);
    await insertCheck(siteC.id, checkedAt);

    const count = await runChecks();
    // siteA: 45s > 30s → checked
    // siteB: 45s < 120s → skipped
    // siteC: 45s < 60s → skipped
    expect(count).toBe(1);
  });
});

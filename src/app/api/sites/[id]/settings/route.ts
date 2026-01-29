import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sites, siteSettings } from "@/db/schema";

const DEFAULTS = {
  responseTimeThreshold: null,
  sslExpiryWarningDays: 7,
  checkInterval: 60,
  customName: null,
  notifyDowntime: true,
  notifySlowResponse: true,
  notifyStatusCode: true,
  notifyContentChange: true,
  notifySslIssue: true,
  notifyHeaderAnomaly: true,
  severityThreshold: "low" as const,
  escalationThreshold: 5,
};

const updateSettingsSchema = z.object({
  responseTimeThreshold: z.number().int().positive().nullable().optional(),
  sslExpiryWarningDays: z.number().int().min(1).max(365).optional(),
  checkInterval: z.number().int().min(10).max(86400).optional(),
  customName: z.string().max(255).nullable().optional(),
  notifyDowntime: z.boolean().optional(),
  notifySlowResponse: z.boolean().optional(),
  notifyStatusCode: z.boolean().optional(),
  notifyContentChange: z.boolean().optional(),
  notifySslIssue: z.boolean().optional(),
  notifyHeaderAnomaly: z.boolean().optional(),
  severityThreshold: z.enum(["low", "medium", "high", "critical"]).optional(),
  escalationThreshold: z.number().int().min(1).max(1440).nullable().optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

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

  const [existing] = await db
    .select()
    .from(siteSettings)
    .where(eq(siteSettings.siteId, id));

  return NextResponse.json({
    siteId: id,
    responseTimeThreshold: existing?.responseTimeThreshold ?? DEFAULTS.responseTimeThreshold,
    sslExpiryWarningDays: existing?.sslExpiryWarningDays ?? DEFAULTS.sslExpiryWarningDays,
    checkInterval: existing?.checkInterval ?? DEFAULTS.checkInterval,
    customName: existing?.customName ?? DEFAULTS.customName,
    notifyDowntime: existing?.notifyDowntime ?? DEFAULTS.notifyDowntime,
    notifySlowResponse: existing?.notifySlowResponse ?? DEFAULTS.notifySlowResponse,
    notifyStatusCode: existing?.notifyStatusCode ?? DEFAULTS.notifyStatusCode,
    notifyContentChange: existing?.notifyContentChange ?? DEFAULTS.notifyContentChange,
    notifySslIssue: existing?.notifySslIssue ?? DEFAULTS.notifySslIssue,
    notifyHeaderAnomaly: existing?.notifyHeaderAnomaly ?? DEFAULTS.notifyHeaderAnomaly,
    severityThreshold: existing?.severityThreshold ?? DEFAULTS.severityThreshold,
    escalationThreshold: existing?.escalationThreshold ?? DEFAULTS.escalationThreshold,
  });
}

export async function PUT(request: Request, { params }: RouteParams) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const [site] = await db.select().from(sites).where(eq(sites.id, id));
  if (!site) {
    return NextResponse.json({ error: "site not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json(
      { error: "no fields to update" },
      { status: 400 }
    );
  }

  const [existing] = await db
    .select()
    .from(siteSettings)
    .where(eq(siteSettings.siteId, id));

  let result;
  if (existing) {
    [result] = await db
      .update(siteSettings)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(siteSettings.siteId, id))
      .returning();
  } else {
    [result] = await db
      .insert(siteSettings)
      .values({ siteId: id, ...parsed.data })
      .returning();
  }

  return NextResponse.json({
    siteId: id,
    responseTimeThreshold: result.responseTimeThreshold ?? DEFAULTS.responseTimeThreshold,
    sslExpiryWarningDays: result.sslExpiryWarningDays ?? DEFAULTS.sslExpiryWarningDays,
    checkInterval: result.checkInterval ?? DEFAULTS.checkInterval,
    customName: result.customName ?? DEFAULTS.customName,
    notifyDowntime: result.notifyDowntime ?? DEFAULTS.notifyDowntime,
    notifySlowResponse: result.notifySlowResponse ?? DEFAULTS.notifySlowResponse,
    notifyStatusCode: result.notifyStatusCode ?? DEFAULTS.notifyStatusCode,
    notifyContentChange: result.notifyContentChange ?? DEFAULTS.notifyContentChange,
    notifySslIssue: result.notifySslIssue ?? DEFAULTS.notifySslIssue,
    notifyHeaderAnomaly: result.notifyHeaderAnomaly ?? DEFAULTS.notifyHeaderAnomaly,
    severityThreshold: result.severityThreshold ?? DEFAULTS.severityThreshold,
    escalationThreshold: result.escalationThreshold ?? DEFAULTS.escalationThreshold,
  });
}

import { NextResponse } from "next/server";
import { db } from "@/db";
import { checks } from "@/db/schema";
import { eq, and } from "drizzle-orm";

type RouteParams = { params: Promise<{ id: string; checkId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { id: rawSiteId, checkId: rawCheckId } = await params;
  const siteId = Number(rawSiteId);
  const checkId = Number(rawCheckId);

  if (!Number.isInteger(siteId) || siteId <= 0) {
    return NextResponse.json({ error: "invalid site id" }, { status: 400 });
  }
  if (!Number.isInteger(checkId) || checkId <= 0) {
    return NextResponse.json({ error: "invalid check id" }, { status: 400 });
  }

  const [check] = await db
    .select()
    .from(checks)
    .where(and(eq(checks.id, checkId), eq(checks.siteId, siteId)));

  if (!check) {
    return NextResponse.json({ error: "check not found" }, { status: 404 });
  }

  // parse json fields for the response
  let headers: Record<string, string | string[] | undefined> | null = null;
  if (check.headersSnapshot) {
    try {
      headers = JSON.parse(check.headersSnapshot);
    } catch {
      headers = null;
    }
  }

  let sslCertificate: Record<string, unknown> | null = null;
  if (check.sslCertificate) {
    try {
      sslCertificate = JSON.parse(check.sslCertificate);
    } catch {
      sslCertificate = null;
    }
  }

  return NextResponse.json({
    id: check.id,
    siteId: check.siteId,
    statusCode: check.statusCode,
    responseTimeMs: check.responseTimeMs,
    isUp: check.isUp,
    errorMessage: check.errorMessage,
    errorCode: check.errorCode,
    headers,
    sslValid: check.sslValid,
    sslExpiry: check.sslExpiry,
    sslCertificate,
    bodyHash: check.bodyHash,
    checkedAt: check.checkedAt,
  });
}

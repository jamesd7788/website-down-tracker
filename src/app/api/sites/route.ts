import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { sites } from "@/db/schema";

const createSiteSchema = z.object({
  url: z.url(),
  name: z.string().min(1).max(255),
});

export async function GET() {
  const allSites = await db.select().from(sites);
  return NextResponse.json(allSites);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = createSiteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { url, name } = parsed.data;
  const [created] = await db.insert(sites).values({ url, name }).returning();
  return NextResponse.json(created, { status: 201 });
}

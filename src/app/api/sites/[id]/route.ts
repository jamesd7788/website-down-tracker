import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sites } from "@/db/schema";

const updateSiteSchema = z.object({
  url: z.url().optional(),
  name: z.string().min(1).max(255).optional(),
  isActive: z.boolean().optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: RouteParams) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = updateSiteSchema.safeParse(body);
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

  const [updated] = await db
    .update(sites)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(sites.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "site not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const [deleted] = await db
    .delete(sites)
    .where(eq(sites.id, id))
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "site not found" }, { status: 404 });
  }

  return NextResponse.json({ message: "site deleted", id });
}

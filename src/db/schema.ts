import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const sites = sqliteTable("sites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  url: text("url").notNull(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const checks = sqliteTable("checks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  siteId: integer("site_id")
    .notNull()
    .references(() => sites.id),
  status: integer("status"),
  responseTimeMs: integer("response_time_ms"),
  checkedAt: integer("checked_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  error: text("error"),
});

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const sites = sqliteTable("sites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  url: text("url").notNull(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

export const checks = sqliteTable(
  "checks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    siteId: integer("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    statusCode: integer("status_code"),
    responseTimeMs: integer("response_time_ms"),
    isUp: integer("is_up", { mode: "boolean" }),
    errorMessage: text("error_message"),
    headersSnapshot: text("headers_snapshot"),
    bodyHash: text("body_hash"),
    sslValid: integer("ssl_valid", { mode: "boolean" }),
    sslExpiry: integer("ssl_expiry", { mode: "timestamp" }),
    checkedAt: integer("checked_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("checks_site_id_idx").on(table.siteId),
    index("checks_checked_at_idx").on(table.checkedAt),
    index("checks_site_checked_idx").on(table.siteId, table.checkedAt),
  ]
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const siteSettings = sqliteTable("site_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  siteId: integer("site_id")
    .notNull()
    .unique()
    .references(() => sites.id, { onDelete: "cascade" }),
  responseTimeThreshold: integer("response_time_threshold"),
  sslExpiryWarningDays: integer("ssl_expiry_warning_days"),
  checkInterval: integer("check_interval"),
  customName: text("custom_name"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const anomalies = sqliteTable(
  "anomalies",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    checkId: integer("check_id")
      .notNull()
      .references(() => checks.id, { onDelete: "cascade" }),
    siteId: integer("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: [
        "downtime",
        "slow_response",
        "status_code",
        "content_change",
        "ssl_issue",
        "header_anomaly",
      ],
    }).notNull(),
    description: text("description"),
    severity: text("severity", {
      enum: ["low", "medium", "high", "critical"],
    }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("anomalies_check_id_idx").on(table.checkId),
    index("anomalies_site_id_idx").on(table.siteId),
    index("anomalies_type_idx").on(table.type),
    index("anomalies_site_type_idx").on(table.siteId, table.type),
  ]
);

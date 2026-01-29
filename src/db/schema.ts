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
    sslCertificate: text("ssl_certificate"), // json: full cert object (issuer, subject, valid_from, valid_to, serialNumber, fingerprint)
    errorCode: text("error_code"), // e.g. ECONNREFUSED, CERT_HAS_EXPIRED, ETIMEDOUT
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
  // notification preferences: per-type toggles (1=enabled, 0=disabled, null=default/enabled)
  notifyDowntime: integer("notify_downtime", { mode: "boolean" }),
  notifySlowResponse: integer("notify_slow_response", { mode: "boolean" }),
  notifyStatusCode: integer("notify_status_code", { mode: "boolean" }),
  notifyContentChange: integer("notify_content_change", { mode: "boolean" }),
  notifySslIssue: integer("notify_ssl_issue", { mode: "boolean" }),
  notifyHeaderAnomaly: integer("notify_header_anomaly", { mode: "boolean" }),
  // severity floor: only notify if severity >= this level
  severityThreshold: text("severity_threshold", {
    enum: ["low", "medium", "high", "critical"],
  }),
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

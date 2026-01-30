import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";

const MIGRATIONS = [
  // 0000 - base tables
  `CREATE TABLE IF NOT EXISTS \`sites\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    \`url\` text NOT NULL,
    \`name\` text NOT NULL,
    \`created_at\` integer NOT NULL,
    \`updated_at\` integer NOT NULL,
    \`is_active\` integer DEFAULT 1 NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS \`checks\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    \`site_id\` integer NOT NULL,
    \`status_code\` integer,
    \`response_time_ms\` integer,
    \`is_up\` integer,
    \`error_message\` text,
    \`headers_snapshot\` text,
    \`body_hash\` text,
    \`ssl_valid\` integer,
    \`ssl_expiry\` integer,
    \`checked_at\` integer NOT NULL,
    FOREIGN KEY (\`site_id\`) REFERENCES \`sites\`(\`id\`) ON DELETE cascade
  )`,
  `CREATE TABLE IF NOT EXISTS \`anomalies\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    \`check_id\` integer NOT NULL,
    \`site_id\` integer NOT NULL,
    \`type\` text NOT NULL,
    \`description\` text,
    \`severity\` text NOT NULL,
    \`created_at\` integer NOT NULL,
    FOREIGN KEY (\`check_id\`) REFERENCES \`checks\`(\`id\`) ON DELETE cascade,
    FOREIGN KEY (\`site_id\`) REFERENCES \`sites\`(\`id\`) ON DELETE cascade
  )`,
  // indexes
  `CREATE INDEX IF NOT EXISTS \`checks_site_id_idx\` ON \`checks\` (\`site_id\`)`,
  `CREATE INDEX IF NOT EXISTS \`checks_checked_at_idx\` ON \`checks\` (\`checked_at\`)`,
  `CREATE INDEX IF NOT EXISTS \`checks_site_checked_idx\` ON \`checks\` (\`site_id\`, \`checked_at\`)`,
  `CREATE INDEX IF NOT EXISTS \`anomalies_check_id_idx\` ON \`anomalies\` (\`check_id\`)`,
  `CREATE INDEX IF NOT EXISTS \`anomalies_site_id_idx\` ON \`anomalies\` (\`site_id\`)`,
  `CREATE INDEX IF NOT EXISTS \`anomalies_type_idx\` ON \`anomalies\` (\`type\`)`,
  `CREATE INDEX IF NOT EXISTS \`anomalies_site_type_idx\` ON \`anomalies\` (\`site_id\`, \`type\`)`,
  // 0001 - settings
  `CREATE TABLE IF NOT EXISTS \`settings\` (
    \`key\` text PRIMARY KEY NOT NULL,
    \`value\` text NOT NULL
  )`,
  // 0002 - site_settings
  `CREATE TABLE IF NOT EXISTS \`site_settings\` (
    \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    \`site_id\` integer NOT NULL,
    \`response_time_threshold\` integer,
    \`ssl_expiry_warning_days\` integer,
    \`check_interval\` integer,
    \`custom_name\` text,
    \`notify_downtime\` integer,
    \`notify_slow_response\` integer,
    \`notify_status_code\` integer,
    \`notify_content_change\` integer,
    \`notify_ssl_issue\` integer,
    \`notify_header_anomaly\` integer,
    \`severity_threshold\` text,
    \`escalation_threshold\` integer,
    \`updated_at\` integer NOT NULL,
    FOREIGN KEY (\`site_id\`) REFERENCES \`sites\`(\`id\`) ON DELETE cascade
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`site_settings_site_id_unique\` ON \`site_settings\` (\`site_id\`)`,
  // 0004 - extra check columns
  `ALTER TABLE \`checks\` ADD \`ssl_certificate\` text`,
  `ALTER TABLE \`checks\` ADD \`error_code\` text`,
  // 0006 - redirect chain
  `ALTER TABLE \`checks\` ADD \`redirect_chain\` text`,
];

export function createTestDb() {
  const sqlite = new Database(":memory:");
  for (const sql of MIGRATIONS) {
    sqlite.exec(sql);
  }
  return drizzle(sqlite, { schema });
}

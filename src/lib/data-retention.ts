import { db } from "@/db";
import { checks, anomalies } from "@/db/schema";
import { lt } from "drizzle-orm";

const RETENTION_DAYS = 30;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

let intervalId: ReturnType<typeof setInterval> | null = null;

function cutoffDate(): Date {
  const d = new Date();
  d.setDate(d.getDate() - RETENTION_DAYS);
  return d;
}

export async function runCleanup(): Promise<{ deletedChecks: number; deletedAnomalies: number }> {
  const cutoff = cutoffDate();
  console.log(`[data-retention] running cleanup, removing data older than ${cutoff.toISOString()}`);

  // delete anomalies older than 30 days first
  const anomalyResult = db.delete(anomalies).where(lt(anomalies.createdAt, cutoff)).run();
  const deletedAnomalies = anomalyResult.changes;

  // delete checks older than 30 days (also cascades remaining anomalies)
  const checkResult = db.delete(checks).where(lt(checks.checkedAt, cutoff)).run();
  const deletedChecks = checkResult.changes;

  console.log(
    `[data-retention] cleanup complete: ${deletedChecks} checks, ${deletedAnomalies} anomalies removed`
  );

  return { deletedChecks, deletedAnomalies };
}

export function startCleanupJob(): void {
  if (intervalId !== null) return;

  console.log("[data-retention] starting daily cleanup job");

  // run once on startup
  runCleanup().catch((err) =>
    console.error("[data-retention] initial cleanup failed:", err)
  );

  // then every 24 hours
  intervalId = setInterval(() => {
    runCleanup().catch((err) =>
      console.error("[data-retention] cleanup failed:", err)
    );
  }, CLEANUP_INTERVAL_MS);
}

export function stopCleanupJob(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[data-retention] cleanup job stopped");
  }
}

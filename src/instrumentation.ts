export async function onRequestError() {
  // required export — no-op
}

export async function register() {
  // only run on the server, not edge
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startCheckEngine } = await import("@/lib/check-engine");
    const { startCleanupJob } = await import("@/lib/data-retention");
    startCheckEngine();
    startCleanupJob();
  }
}

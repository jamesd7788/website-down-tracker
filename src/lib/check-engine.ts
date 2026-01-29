import * as https from "node:https";
import * as http from "node:http";
import * as crypto from "node:crypto";
import { db } from "@/db";
import { sites, checks } from "@/db/schema";
import { eq } from "drizzle-orm";
import { detectAnomalies } from "@/lib/anomaly-detector";

const CHECK_TIMEOUT_MS = 10_000;

interface CheckResult {
  siteId: number;
  statusCode: number | null;
  responseTimeMs: number | null;
  isUp: boolean;
  errorMessage: string | null;
  errorCode: string | null;
  headersSnapshot: string | null;
  bodyHash: string | null;
  sslValid: boolean | null;
  sslExpiry: Date | null;
  sslCertificate: string | null;
}

function performCheck(url: string): Promise<Omit<CheckResult, "siteId">> {
  return new Promise((resolve) => {
    const start = Date.now();
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const transport = isHttps ? https : http;

    const req = transport.request(
      url,
      { timeout: CHECK_TIMEOUT_MS, method: "GET" },
      (res) => {
        const responseTimeMs = Date.now() - start;
        const chunks: Buffer[] = [];

        // grab ssl info if available
        let sslValid: boolean | null = null;
        let sslExpiry: Date | null = null;
        let sslCertificate: string | null = null;
        if (isHttps && "socket" in res && res.socket) {
          try {
            const sock = res.socket as import("tls").TLSSocket;
            if (sock.getPeerCertificate) {
              const cert = sock.getPeerCertificate();
              if (cert && cert.valid_to) {
                sslExpiry = new Date(cert.valid_to);
                // sock.authorized can be undefined even on valid tls connections;
                // if we completed the handshake and got a response, treat as valid
                sslValid = sock.authorized !== false;
                sslCertificate = JSON.stringify({
                  issuer: cert.issuer,
                  subject: cert.subject,
                  valid_from: cert.valid_from,
                  valid_to: cert.valid_to,
                  serialNumber: cert.serialNumber,
                  fingerprint: cert.fingerprint,
                });
              }
            }
          } catch {
            // ssl info is best-effort
          }
        }

        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          const bodyHash = crypto
            .createHash("sha256")
            .update(body)
            .digest("hex");

          const statusCode = res.statusCode ?? null;
          const isUp = statusCode !== null && statusCode < 500;

          const headers: Record<string, string | string[] | undefined> = {};
          if (res.headers) {
            for (const [key, value] of Object.entries(res.headers)) {
              headers[key] = value;
            }
          }

          resolve({
            statusCode,
            responseTimeMs,
            isUp,
            errorMessage: null,
            errorCode: null,
            headersSnapshot: JSON.stringify(headers),
            bodyHash,
            sslValid,
            sslExpiry,
            sslCertificate,
          });
        });

        res.on("error", (err) => {
          resolve({
            statusCode: res.statusCode ?? null,
            responseTimeMs: Date.now() - start,
            isUp: false,
            errorMessage: err.message,
            errorCode: (err as NodeJS.ErrnoException).code ?? null,
            headersSnapshot: null,
            bodyHash: null,
            sslValid: null,
            sslExpiry: null,
            sslCertificate: null,
          });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      resolve({
        statusCode: null,
        responseTimeMs: Date.now() - start,
        isUp: false,
        errorMessage: `timeout after ${CHECK_TIMEOUT_MS}ms`,
        errorCode: "ETIMEDOUT",
        headersSnapshot: null,
        bodyHash: null,
        sslValid: null,
        sslExpiry: null,
        sslCertificate: null,
      });
    });

    req.on("error", (err) => {
      resolve({
        statusCode: null,
        responseTimeMs: Date.now() - start,
        isUp: false,
        errorMessage: err.message,
        errorCode: (err as NodeJS.ErrnoException).code ?? null,
        headersSnapshot: null,
        bodyHash: null,
        sslValid: null,
        sslExpiry: null,
        sslCertificate: null,
      });
    });

    req.end();
  });
}

export async function runChecks(): Promise<number> {
  const activeSites = await db
    .select()
    .from(sites)
    .where(eq(sites.isActive, true));

  if (activeSites.length === 0) return 0;

  const results = await Promise.allSettled(
    activeSites.map(async (site) => {
      const result = await performCheck(site.url);
      const [inserted] = await db
        .insert(checks)
        .values({
          siteId: site.id,
          ...result,
        })
        .returning({ id: checks.id });

      await detectAnomalies(inserted.id, site.id);

      return result;
    })
  );

  return results.length;
}

const CHECK_INTERVAL_MS = 60_000;
let intervalId: ReturnType<typeof setInterval> | null = null;

export function startCheckEngine(): void {
  if (intervalId !== null) return; // already running

  console.log("[check-engine] starting, interval=60s");

  // run immediately on start, then every 60s
  runChecks().catch((err) =>
    console.error("[check-engine] initial run failed:", err)
  );

  intervalId = setInterval(() => {
    runChecks().catch((err) =>
      console.error("[check-engine] check run failed:", err)
    );
  }, CHECK_INTERVAL_MS);
}

export function stopCheckEngine(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[check-engine] stopped");
  }
}

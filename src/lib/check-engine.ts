import * as https from "node:https";
import * as http from "node:http";
import * as crypto from "node:crypto";
import { db } from "@/db";
import { sites, checks } from "@/db/schema";
import { eq } from "drizzle-orm";
import { detectAnomalies } from "@/lib/anomaly-detector";

const CHECK_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

interface RedirectHop {
  url: string;
  statusCode: number;
}

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
  redirectChain: string | null;
}

function singleRequest(
  url: string,
  timeoutMs: number
): Promise<{
  statusCode: number | null;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  socket: import("net").Socket | null;
  error?: { message: string; code: string | null };
}> {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const transport = isHttps ? https : http;

    const req = transport.request(
      url,
      { timeout: timeoutMs, method: "GET" },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? null,
            headers: res.headers,
            body: Buffer.concat(chunks),
            socket: res.socket,
          });
        });
        res.on("error", (err) => {
          resolve({
            statusCode: res.statusCode ?? null,
            headers: res.headers,
            body: Buffer.alloc(0),
            socket: res.socket,
            error: {
              message: err.message,
              code: (err as NodeJS.ErrnoException).code ?? null,
            },
          });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      resolve({
        statusCode: null,
        headers: {},
        body: Buffer.alloc(0),
        socket: null,
        error: { message: `timeout after ${timeoutMs}ms`, code: "ETIMEDOUT" },
      });
    });

    req.on("error", (err) => {
      resolve({
        statusCode: null,
        headers: {},
        body: Buffer.alloc(0),
        socket: null,
        error: {
          message: err.message,
          code: (err as NodeJS.ErrnoException).code ?? null,
        },
      });
    });

    req.end();
  });
}

async function performCheck(
  url: string
): Promise<Omit<CheckResult, "siteId">> {
  const start = Date.now();
  const redirectChain: RedirectHop[] = [];
  const visitedUrls = new Set<string>();
  let currentUrl = url;

  // follow redirects up to MAX_REDIRECTS hops
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // loop detection
    if (visitedUrls.has(currentUrl)) {
      return {
        statusCode: null,
        responseTimeMs: Date.now() - start,
        isUp: false,
        errorMessage: `redirect loop detected: ${currentUrl} already visited`,
        errorCode: "REDIRECT_LOOP",
        headersSnapshot: null,
        bodyHash: null,
        sslValid: null,
        sslExpiry: null,
        sslCertificate: null,
        redirectChain:
          redirectChain.length > 0 ? JSON.stringify(redirectChain) : null,
      };
    }
    visitedUrls.add(currentUrl);

    const remainingMs = CHECK_TIMEOUT_MS - (Date.now() - start);
    if (remainingMs <= 0) {
      return {
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
        redirectChain:
          redirectChain.length > 0 ? JSON.stringify(redirectChain) : null,
      };
    }

    const result = await singleRequest(currentUrl, remainingMs);

    if (result.error) {
      return {
        statusCode: result.statusCode,
        responseTimeMs: Date.now() - start,
        isUp: false,
        errorMessage: result.error.message,
        errorCode: result.error.code,
        headersSnapshot: null,
        bodyHash: null,
        sslValid: null,
        sslExpiry: null,
        sslCertificate: null,
        redirectChain:
          redirectChain.length > 0 ? JSON.stringify(redirectChain) : null,
      };
    }

    const statusCode = result.statusCode;

    // is this a redirect?
    if (
      statusCode !== null &&
      statusCode >= 300 &&
      statusCode < 400 &&
      result.headers.location
    ) {
      redirectChain.push({ url: currentUrl, statusCode });

      // too many redirects?
      if (hop === MAX_REDIRECTS) {
        return {
          statusCode,
          responseTimeMs: Date.now() - start,
          isUp: false,
          errorMessage: `too many redirects (>${MAX_REDIRECTS})`,
          errorCode: "TOO_MANY_REDIRECTS",
          headersSnapshot: null,
          bodyHash: null,
          sslValid: null,
          sslExpiry: null,
          sslCertificate: null,
          redirectChain: JSON.stringify(redirectChain),
        };
      }

      // resolve relative location
      currentUrl = new URL(result.headers.location, currentUrl).href;
      continue;
    }

    // final response — extract all the data
    const responseTimeMs = Date.now() - start;
    const bodyHash = crypto
      .createHash("sha256")
      .update(result.body)
      .digest("hex");
    const isUp = statusCode !== null && statusCode < 500;

    const headers: Record<string, string | string[] | undefined> = {};
    for (const [key, value] of Object.entries(result.headers)) {
      headers[key] = value;
    }

    // grab ssl info from final response
    let sslValid: boolean | null = null;
    let sslExpiry: Date | null = null;
    let sslCertificate: string | null = null;
    const finalParsed = new URL(currentUrl);
    if (finalParsed.protocol === "https:" && result.socket) {
      try {
        const sock = result.socket as import("tls").TLSSocket;
        if (sock.getPeerCertificate) {
          const cert = sock.getPeerCertificate();
          if (cert && cert.valid_to) {
            sslExpiry = new Date(cert.valid_to);
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

    return {
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
      redirectChain:
        redirectChain.length > 0 ? JSON.stringify(redirectChain) : null,
    };
  }

  // should never reach here, but just in case
  return {
    statusCode: null,
    responseTimeMs: Date.now() - start,
    isUp: false,
    errorMessage: `too many redirects (>${MAX_REDIRECTS})`,
    errorCode: "TOO_MANY_REDIRECTS",
    headersSnapshot: null,
    bodyHash: null,
    sslValid: null,
    sslExpiry: null,
    sslCertificate: null,
    redirectChain:
      redirectChain.length > 0 ? JSON.stringify(redirectChain) : null,
  };
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

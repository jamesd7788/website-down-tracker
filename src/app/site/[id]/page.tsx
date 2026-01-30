"use client";

import { useState, useEffect, useCallback, useMemo, useRef, use, type FormEvent } from "react";
import Link from "next/link";

interface Check {
  id: number;
  siteId: number;
  statusCode: number | null;
  responseTimeMs: number | null;
  isUp: boolean | null;
  errorMessage: string | null;
  checkedAt: string;
}

interface CheckDetailData {
  id: number;
  siteId: number;
  statusCode: number | null;
  responseTimeMs: number | null;
  isUp: boolean | null;
  errorMessage: string | null;
  errorCode: string | null;
  headers: Record<string, string | string[] | undefined> | null;
  sslValid: boolean | null;
  sslExpiry: string | null;
  sslCertificate: {
    issuer?: Record<string, string>;
    subject?: Record<string, string>;
    valid_from?: string;
    valid_to?: string;
    serialNumber?: string;
    fingerprint?: string;
  } | null;
  bodyHash: string | null;
  redirectChain: Array<{ url: string; statusCode: number }> | null;
  checkedAt: string;
}

interface Anomaly {
  id: number;
  checkId: number;
  type: string;
  description: string | null;
  severity: string;
  createdAt: string;
}

interface TimePoint {
  time: string;
  responseTimeMs: number | null;
}

interface SiteDetail {
  site: {
    id: number;
    url: string;
    name: string;
    isActive: boolean;
    createdAt: string;
  };
  latestCheck: Check | null;
  responseTime: {
    avg: number | null;
    p50: number | null;
    p95: number | null;
    p99: number | null;
  };
  uptime: {
    "24h": number | null;
    "7d": number | null;
    "30d": number | null;
  };
  timeSeries: TimePoint[];
  anomalies: Anomaly[];
}

interface SiteSettings {
  siteId: number;
  responseTimeThreshold: number | null;
  sslExpiryWarningDays: number;
  checkInterval: number;
  customName: string | null;
  notifyDowntime: boolean;
  notifySlowResponse: boolean;
  notifyStatusCode: boolean;
  notifyContentChange: boolean;
  notifySslIssue: boolean;
  notifyHeaderAnomaly: boolean;
  severityThreshold: "low" | "medium" | "high" | "critical";
  escalationThreshold: number;
}

type Period = "24h" | "7d" | "30d";
type Tab = "overview" | "settings";

function ResponseChart({
  data,
  period,
  now,
}: {
  data: TimePoint[];
  period: Period;
  now: number;
}) {
  const [hover, setHover] = useState<{ x: number; y: number; val: number; time: string } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const chartData = useMemo(() => {
    const cutoffs: Record<Period, number> = {
      "24h": now - 24 * 60 * 60 * 1000,
      "7d": now - 7 * 24 * 60 * 60 * 1000,
      "30d": now - 30 * 24 * 60 * 60 * 1000,
    };

    const allInPeriod = data.filter(
      (d) => new Date(d.time).getTime() >= cutoffs[period]
    );
    const filtered = allInPeriod.filter((d) => d.responseTimeMs != null);

    if (filtered.length < 2) return null;

    let maxVal = -Infinity;
    for (const d of filtered) {
      const v = d.responseTimeMs!;
      if (v > maxVal) maxVal = v;
    }
    const yMin = 0;
    const yMax = maxVal;
    const range = yMax - yMin || 1;

    const w = 800;
    const h = 192;
    const padX = 0;
    const padTop = 12;
    const padBot = 24;
    const chartH = h - padTop - padBot;
    const chartW = w - padX * 2;

    const tMin = new Date(filtered[0].time).getTime();
    const tMax = new Date(filtered[filtered.length - 1].time).getTime();
    const tRange = tMax - tMin || 1;

    const points = filtered.map((d) => {
      const t = new Date(d.time).getTime();
      const x = padX + ((t - tMin) / tRange) * chartW;
      const y = padTop + chartH - ((d.responseTimeMs! - yMin) / range) * chartH;
      return { x, y, val: d.responseTimeMs!, time: d.time };
    });

    // downtime regions: spans where responseTimeMs is null
    const downtimeRegions: { x1: number; x2: number }[] = [];
    for (let i = 0; i < allInPeriod.length; i++) {
      if (allInPeriod[i].responseTimeMs == null) {
        const startT = new Date(allInPeriod[i].time).getTime();
        let endT = startT;
        while (i + 1 < allInPeriod.length && allInPeriod[i + 1].responseTimeMs == null) {
          i++;
          endT = new Date(allInPeriod[i].time).getTime();
        }
        if (endT >= tMin && startT <= tMax) {
          const x1 = padX + (Math.max(startT, tMin) - tMin) / tRange * chartW;
          const x2 = padX + (Math.min(endT, tMax) - tMin) / tRange * chartW;
          downtimeRegions.push({ x1, x2: Math.max(x2, x1 + 2) });
        }
      }
    }

    // split points into segments at downtime gaps
    const segments: typeof points[] = [];
    let currentSeg: typeof points = [];
    for (let i = 0; i < points.length; i++) {
      if (currentSeg.length === 0) {
        currentSeg.push(points[i]);
      } else {
        const hasGap = downtimeRegions.some((r) => {
          const rMid = (r.x1 + r.x2) / 2;
          return rMid > currentSeg[currentSeg.length - 1].x && rMid < points[i].x;
        });
        if (hasGap) {
          if (currentSeg.length >= 1) segments.push(currentSeg);
          currentSeg = [points[i]];
        } else {
          currentSeg.push(points[i]);
        }
      }
    }
    if (currentSeg.length >= 1) segments.push(currentSeg);

    const linePaths = segments
      .filter((seg) => seg.length >= 2)
      .map((seg) => seg.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" "));

    const areaPaths = segments
      .filter((seg) => seg.length >= 2)
      .map((seg) => {
        const line = seg.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
        return `${line} L${seg[seg.length - 1].x},${h - padBot} L${seg[0].x},${h - padBot} Z`;
      });

    const yLabels = [yMin, yMin + range / 2, yMax].map((val) => ({
      val: Math.round(val),
      y: padTop + chartH - ((val - yMin) / range) * chartH,
    }));

    const xLabelCount = 5;
    const xLabels = Array.from({ length: xLabelCount }, (_, i) => {
      const t = tMin + (i / (xLabelCount - 1)) * tRange;
      const x = padX + ((t - tMin) / tRange) * chartW;
      const d = new Date(t);
      const label =
        period === "24h"
          ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : d.toLocaleDateString([], { month: "short", day: "numeric" });
      return { x, label };
    });

    return { w, h, padX, padTop, padBot, chartH, points, downtimeRegions, linePaths, areaPaths, yLabels, xLabels };
  }, [data, period, now]);

  if (!chartData) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-zinc-400">
        not enough data for selected period
      </div>
    );
  }

  const { w, h, padX, padTop, padBot, chartH, points, downtimeRegions, linePaths, areaPaths, yLabels, xLabels } = chartData;

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg || points.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * w;
    // find nearest point
    let closest = points[0];
    let closestDist = Math.abs(mouseX - points[0].x);
    for (let i = 1; i < points.length; i++) {
      const dist = Math.abs(mouseX - points[i].x);
      if (dist < closestDist) {
        closestDist = dist;
        closest = points[i];
      }
    }
    setHover(closest);
  }

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h}`}
        className="w-full"
        preserveAspectRatio="xMidYMid meet"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* grid lines */}
        {yLabels.map((yl, i) => (
          <line
            key={i}
            x1={padX}
            x2={w - padX}
            y1={yl.y}
            y2={yl.y}
            className="stroke-zinc-200 dark:stroke-zinc-800"
            strokeWidth={0.5}
          />
        ))}

        {/* downtime regions */}
        {downtimeRegions.map((r, i) => (
          <rect
            key={`dt-${i}`}
            x={r.x1}
            y={padTop}
            width={r.x2 - r.x1}
            height={chartH}
            className="fill-red-500/10 dark:fill-red-400/10"
          />
        ))}

        {/* area fills (per segment) */}
        {areaPaths.map((d, i) => (
          <path key={`area-${i}`} d={d} className="fill-emerald-500/10 dark:fill-emerald-400/10" />
        ))}

        {/* lines (per segment) */}
        {linePaths.map((d, i) => (
          <path
            key={`line-${i}`}
            d={d}
            fill="none"
            className="stroke-emerald-500 dark:stroke-emerald-400"
            strokeWidth={1.5}

          />
        ))}

        {/* hover crosshair + dot */}
        {hover && (
          <>
            <line
              x1={hover.x}
              x2={hover.x}
              y1={padTop}
              y2={h - padBot}
              className="stroke-zinc-400 dark:stroke-zinc-500"
              strokeWidth={0.5}
              strokeDasharray="4 2"
  
            />
            <circle
              cx={hover.x}
              cy={hover.y}
              r={3}
              className="fill-emerald-500 dark:fill-emerald-400"
  
            />
          </>
        )}

        {/* y labels */}
        {yLabels.map((yl, i) => (
          <text
            key={i}
            x={padX + 4}
            y={yl.y - 4}
            className="fill-zinc-400 dark:fill-zinc-500"
            fontSize={10}
          >
            {yl.val}ms
          </text>
        ))}

        {/* x labels */}
        {xLabels.map((xl, i) => (
          <text
            key={i}
            x={xl.x}
            y={h - 4}
            textAnchor="middle"
            className="fill-zinc-400 dark:fill-zinc-500"
            fontSize={10}
          >
            {xl.label}
          </text>
        ))}
      </svg>

      {/* tooltip */}
      {hover && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded border border-zinc-200 bg-white px-2 py-1 text-xs shadow dark:border-zinc-700 dark:bg-zinc-800"
          style={{
            left: `${(hover.x / w) * 100}%`,
            transform: hover.x > w / 2 ? "translateX(-110%)" : "translateX(10%)",
          }}
        >
          <p className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
            {hover.val}ms
          </p>
          <p className="text-zinc-500 dark:text-zinc-400">
            {new Date(hover.time).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400 dark:focus:ring-zinc-400";

const btnPrimary =
  "rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";

const NOTIFICATION_TYPES = [
  { key: "notifyDowntime" as const, label: "downtime" },
  { key: "notifySlowResponse" as const, label: "slow response" },
  { key: "notifyStatusCode" as const, label: "status code changes" },
  { key: "notifyContentChange" as const, label: "content changes" },
  { key: "notifySslIssue" as const, label: "SSL issues" },
  { key: "notifyHeaderAnomaly" as const, label: "header anomalies" },
];

const SEVERITY_OPTIONS: SiteSettings["severityThreshold"][] = [
  "low",
  "medium",
  "high",
  "critical",
];

// maps anomaly type → per-site settings toggle key
const ANOMALY_TYPE_TO_NOTIFY_KEY: Record<string, keyof SiteSettings> = {
  downtime: "notifyDowntime",
  slow_response: "notifySlowResponse",
  status_code: "notifyStatusCode",
  content_change: "notifyContentChange",
  ssl_issue: "notifySslIssue",
  header_anomaly: "notifyHeaderAnomaly",
};

// maps anomaly type → global settings key
const ANOMALY_TYPE_TO_GLOBAL_KEY: Record<string, string> = {
  downtime: "global_notify_downtime",
  slow_response: "global_notify_slow_response",
  status_code: "global_notify_status_code",
  content_change: "global_notify_content_change",
  ssl_issue: "global_notify_ssl_issue",
  header_anomaly: "global_notify_header_anomaly",
};

interface UndoToast {
  message: string;
  undoAction: () => Promise<void>;
  timerId: ReturnType<typeof setTimeout>;
}

function SettingsPanel({ siteId }: { siteId: number }) {
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null
  );

  // form state
  const [responseTimeThreshold, setResponseTimeThreshold] = useState("");
  const [sslExpiryWarningDays, setSslExpiryWarningDays] = useState("");
  const [checkInterval, setCheckInterval] = useState("");
  const [escalationThreshold, setEscalationThreshold] = useState("");
  const [notifyToggles, setNotifyToggles] = useState<
    Record<string, boolean>
  >({});
  const [severityThreshold, setSeverityThreshold] =
    useState<SiteSettings["severityThreshold"]>("low");
  const [globalSuppressions, setGlobalSuppressions] = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([
      fetch(`/api/sites/${siteId}/settings`).then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()),
    ])
      .then(([siteData, globalData]: [SiteSettings, Record<string, string>]) => {
        setSettings(siteData);
        setResponseTimeThreshold(
          siteData.responseTimeThreshold != null
            ? String(siteData.responseTimeThreshold)
            : ""
        );
        setSslExpiryWarningDays(String(siteData.sslExpiryWarningDays));
        setCheckInterval(String(siteData.checkInterval));
        setEscalationThreshold(String(siteData.escalationThreshold));
        setNotifyToggles({
          notifyDowntime: siteData.notifyDowntime,
          notifySlowResponse: siteData.notifySlowResponse,
          notifyStatusCode: siteData.notifyStatusCode,
          notifyContentChange: siteData.notifyContentChange,
          notifySslIssue: siteData.notifySslIssue,
          notifyHeaderAnomaly: siteData.notifyHeaderAnomaly,
        });
        setSeverityThreshold(siteData.severityThreshold);
        setGlobalSuppressions(globalData);
      })
      .catch(() => setMsg({ type: "err", text: "failed to load settings" }))
      .finally(() => setLoading(false));
  }, [siteId]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setSaving(true);

    const payload: Record<string, unknown> = {
      ...notifyToggles,
      severityThreshold,
      sslExpiryWarningDays: Number(sslExpiryWarningDays),
      checkInterval: Number(checkInterval),
      responseTimeThreshold:
        responseTimeThreshold.trim() === ""
          ? null
          : Number(responseTimeThreshold),
      escalationThreshold:
        escalationThreshold.trim() === ""
          ? null
          : Number(escalationThreshold),
    };

    try {
      const res = await fetch(`/api/sites/${siteId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        setMsg({
          type: "err",
          text: data.error || "failed to save",
        });
        return;
      }
      const updated: SiteSettings = await res.json();
      setSettings(updated);
      setMsg({ type: "ok", text: "settings saved — changes take effect on next check cycle" });
    } catch {
      setMsg({ type: "err", text: "network error" });
    } finally {
      setSaving(false);
    }
  }

  function toggleNotify(key: string) {
    setNotifyToggles((prev) => ({ ...prev, [key]: !prev[key] }));
    setMsg(null);
  }

  if (loading) {
    return (
      <div className="py-12 text-center text-sm text-zinc-400">
        loading settings...
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="py-12 text-center text-sm text-red-500">
        {msg?.text || "failed to load settings"}
      </div>
    );
  }

  // find suppressed notification types (explicitly disabled)
  const suppressed = NOTIFICATION_TYPES.filter(
    (nt) => notifyToggles[nt.key] === false
  );

  // find globally suppressed types
  const globallySuppressed = NOTIFICATION_TYPES.filter((nt) => {
    const anomalyType = nt.key.replace("notify", "").replace(/([A-Z])/g, "_$1").toLowerCase().slice(1);
    const globalKey = ANOMALY_TYPE_TO_GLOBAL_KEY[anomalyType];
    return globalKey && globalSuppressions[globalKey] === "false";
  });

  async function reEnableGlobal(anomalyType: string) {
    const globalKey = ANOMALY_TYPE_TO_GLOBAL_KEY[anomalyType];
    if (!globalKey) return;
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [globalKey]: "true" }),
    });
    if (res.ok) {
      setGlobalSuppressions((prev) => {
        const next = { ...prev };
        delete next[globalKey];
        return next;
      });
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {/* thresholds */}
      <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            thresholds
          </h2>
        </div>
        <div className="space-y-4 p-4">
          <div>
            <label
              htmlFor="response-time-threshold"
              className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              response time threshold (ms)
            </label>
            <input
              id="response-time-threshold"
              type="number"
              min={1}
              value={responseTimeThreshold}
              onChange={(e) => {
                setResponseTimeThreshold(e.target.value);
                setMsg(null);
              }}
              placeholder="auto (2x rolling avg)"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
              leave empty to use automatic detection (2x rolling average)
            </p>
          </div>
          <div>
            <label
              htmlFor="ssl-expiry-days"
              className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              SSL expiry warning (days)
            </label>
            <input
              id="ssl-expiry-days"
              type="number"
              min={1}
              max={365}
              value={sslExpiryWarningDays}
              onChange={(e) => {
                setSslExpiryWarningDays(e.target.value);
                setMsg(null);
              }}
              className={inputClass}
            />
          </div>
          <div>
            <label
              htmlFor="check-interval"
              className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              check interval (seconds)
            </label>
            <input
              id="check-interval"
              type="number"
              min={10}
              max={86400}
              value={checkInterval}
              onChange={(e) => {
                setCheckInterval(e.target.value);
                setMsg(null);
              }}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
              10–86400 seconds
            </p>
          </div>
          <div>
            <label
              htmlFor="escalation-threshold"
              className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              escalation threshold (minutes)
            </label>
            <input
              id="escalation-threshold"
              type="number"
              min={1}
              max={1440}
              value={escalationThreshold}
              onChange={(e) => {
                setEscalationThreshold(e.target.value);
                setMsg(null);
              }}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
              minutes of continuous downtime before slack messages escalate with @channel
            </p>
          </div>
        </div>
      </section>

      {/* notification toggles */}
      <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            notification preferences
          </h2>
        </div>
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
          {NOTIFICATION_TYPES.map((nt) => (
            <div
              key={nt.key}
              className="flex items-center justify-between px-4 py-3"
            >
              <span className="text-sm text-zinc-700 dark:text-zinc-300">
                {nt.label}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={notifyToggles[nt.key] !== false}
                onClick={() => toggleNotify(nt.key)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  notifyToggles[nt.key] !== false
                    ? "bg-emerald-500 dark:bg-emerald-600"
                    : "bg-zinc-300 dark:bg-zinc-700"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                    notifyToggles[nt.key] !== false
                      ? "translate-x-4"
                      : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* severity threshold */}
      <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            severity threshold
          </h2>
        </div>
        <div className="p-4">
          <p className="mb-3 text-xs text-zinc-400 dark:text-zinc-500">
            only notify for anomalies at or above this severity level
          </p>
          <div className="flex gap-2">
            {SEVERITY_OPTIONS.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => {
                  setSeverityThreshold(level);
                  setMsg(null);
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  severityThreshold === level
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "border border-zinc-300 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                {level}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* suppressed types */}
      {suppressed.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30">
          <div className="px-4 py-3">
            <h2 className="text-sm font-medium text-amber-800 dark:text-amber-400">
              suppressed notifications
            </h2>
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
              these notification types are currently disabled. toggle them above
              to re-enable.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {suppressed.map((nt) => (
                <button
                  key={nt.key}
                  type="button"
                  onClick={() => toggleNotify(nt.key)}
                  className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-400 dark:hover:bg-amber-900/60"
                >
                  {nt.label}
                  <span className="text-amber-500">+</span>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* globally suppressed types */}
      {globallySuppressed.length > 0 && (
        <section className="rounded-lg border border-orange-200 bg-orange-50 dark:border-orange-900/50 dark:bg-orange-950/30">
          <div className="px-4 py-3">
            <h2 className="text-sm font-medium text-orange-800 dark:text-orange-400">
              globally suppressed notifications
            </h2>
            <p className="mt-1 text-xs text-orange-600 dark:text-orange-500">
              these types are suppressed across all sites. click to re-enable.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {globallySuppressed.map((nt) => {
                const anomalyType = nt.key.replace("notify", "").replace(/([A-Z])/g, "_$1").toLowerCase().slice(1);
                return (
                  <button
                    key={nt.key}
                    type="button"
                    onClick={() => reEnableGlobal(anomalyType)}
                    className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-800 transition-colors hover:bg-orange-200 dark:bg-orange-900/40 dark:text-orange-400 dark:hover:bg-orange-900/60"
                  >
                    {nt.label}
                    <span className="text-orange-500">+</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* save */}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className={btnPrimary}>
          {saving ? "saving..." : "save settings"}
        </button>
        {msg && (
          <p
            className={`text-sm ${
              msg.type === "ok"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {msg.text}
          </p>
        )}
      </div>
    </form>
  );
}

function CheckDetailModal({
  siteId,
  checkId,
  onClose,
}: {
  siteId: number;
  checkId: number;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<CheckDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/sites/${siteId}/checks/${checkId}`)
      .then((r) => {
        if (!r.ok) throw new Error("failed to fetch");
        return r.json();
      })
      .then((d: CheckDetailData) => setDetail(d))
      .catch(() => setError("failed to load check details"))
      .finally(() => setLoading(false));
  }, [siteId, checkId]);

  // close on escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const statusColor = detail
    ? detail.isUp
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-red-600 dark:text-red-400"
    : "text-zinc-500";

  const sectionClass =
    "rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50";
  const labelClass =
    "text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400";
  const valueClass = "text-sm text-zinc-900 dark:text-zinc-100";

  function formatHeaderValue(val: string | string[] | undefined): string {
    if (val === undefined) return "";
    return Array.isArray(val) ? val.join(", ") : val;
  }

  function formatCertField(obj: Record<string, string> | undefined): string {
    if (!obj) return "—";
    return Object.entries(obj)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-[10vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
        {/* header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            check details
          </h2>
          <button
            onClick={onClose}
            className="text-zinc-400 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M15 5L5 15M5 5l10 10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
          {loading && (
            <div className="py-12 text-center text-sm text-zinc-400">
              loading...
            </div>
          )}
          {error && (
            <div className="py-12 text-center text-sm text-red-500">
              {error}
            </div>
          )}
          {detail && (
            <div className="space-y-4">
              {/* status overview */}
              <div className={sectionClass}>
                <div className="grid grid-cols-3 gap-4 p-4">
                  <div>
                    <p className={labelClass}>status</p>
                    <p className={`text-lg font-semibold tabular-nums ${statusColor}`}>
                      {detail.statusCode ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className={labelClass}>response time</p>
                    <p className={`text-lg font-semibold tabular-nums ${valueClass}`}>
                      {detail.responseTimeMs != null
                        ? `${detail.responseTimeMs}ms`
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className={labelClass}>result</p>
                    <p className={`text-lg font-semibold ${statusColor}`}>
                      {detail.isUp === true
                        ? "up"
                        : detail.isUp === false
                          ? "down"
                          : "unknown"}
                    </p>
                  </div>
                </div>
                <div className="border-t border-zinc-200 px-4 py-2 dark:border-zinc-800">
                  <p className="text-xs text-zinc-400">
                    {new Date(detail.checkedAt).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* error info */}
              {(detail.errorMessage || detail.errorCode) && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/30">
                  <p className="text-xs font-medium uppercase tracking-wider text-red-800 dark:text-red-400">
                    error
                  </p>
                  {detail.errorCode && (
                    <p className="mt-1 font-mono text-sm text-red-700 dark:text-red-300">
                      {detail.errorCode}
                    </p>
                  )}
                  {detail.errorMessage && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                      {detail.errorMessage}
                    </p>
                  )}
                </div>
              )}

              {/* redirect chain */}
              {detail.redirectChain && detail.redirectChain.length > 0 && (
                <div className={sectionClass}>
                  <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                    <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      redirect chain ({detail.redirectChain.length} hop{detail.redirectChain.length !== 1 ? "s" : ""})
                    </p>
                  </div>
                  <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                    {detail.redirectChain.map((hop, i) => (
                      <div key={i} className="flex items-center gap-3 px-4 py-2">
                        <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                          {hop.statusCode}
                        </span>
                        <span className="min-w-0 truncate font-mono text-xs text-zinc-600 dark:text-zinc-400">
                          {hop.url}
                        </span>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-zinc-300 dark:text-zinc-600">
                          <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ssl certificate */}
              <div className={sectionClass}>
                <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                  <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    SSL certificate
                  </p>
                </div>
                {detail.sslCertificate ? (
                  <div className="space-y-2 p-4">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          detail.sslValid
                            ? "bg-emerald-500"
                            : "bg-red-500"
                        }`}
                      />
                      <span className={`text-sm font-medium ${
                        detail.sslValid
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                      }`}>
                        {detail.sslValid ? "valid" : "invalid"}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className={labelClass}>issuer</p>
                        <p className={`${valueClass} break-all`}>
                          {formatCertField(detail.sslCertificate.issuer)}
                        </p>
                      </div>
                      <div>
                        <p className={labelClass}>subject</p>
                        <p className={`${valueClass} break-all`}>
                          {formatCertField(detail.sslCertificate.subject)}
                        </p>
                      </div>
                      <div>
                        <p className={labelClass}>valid from</p>
                        <p className={valueClass}>
                          {detail.sslCertificate.valid_from ?? "—"}
                        </p>
                      </div>
                      <div>
                        <p className={labelClass}>valid to</p>
                        <p className={valueClass}>
                          {detail.sslCertificate.valid_to ?? "—"}
                        </p>
                      </div>
                      <div>
                        <p className={labelClass}>fingerprint</p>
                        <p className={`${valueClass} break-all font-mono text-xs`}>
                          {detail.sslCertificate.fingerprint ?? "—"}
                        </p>
                      </div>
                      <div>
                        <p className={labelClass}>serial number</p>
                        <p className={`${valueClass} break-all font-mono text-xs`}>
                          {detail.sslCertificate.serialNumber ?? "—"}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="px-4 py-4 text-sm text-zinc-400">
                    SSL certificate data not available
                  </div>
                )}
              </div>

              {/* response headers */}
              <div className={sectionClass}>
                <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                  <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    response headers
                  </p>
                </div>
                {detail.headers &&
                Object.keys(detail.headers).length > 0 ? (
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                        {Object.entries(detail.headers).map(([key, val]) => (
                          <tr key={key}>
                            <td className="whitespace-nowrap px-4 py-1.5 font-mono text-xs font-medium text-zinc-600 dark:text-zinc-300">
                              {key}
                            </td>
                            <td className="break-all px-4 py-1.5 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                              {formatHeaderValue(val)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="px-4 py-4 text-sm text-zinc-400">
                    header data not available
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const severityColors: Record<string, string> = {
  critical:
    "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  medium:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  low: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
};

export default function SiteDetailPage({
  params: paramsPromise,
}: {
  params: Promise<{ id: string }>;
}) {
  const params = use(paramsPromise);
  const [data, setData] = useState<SiteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<Period>("24h");
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedCheckId, setSelectedCheckId] = useState<number | null>(null);
  const [suppressingAnomalyId, setSuppressingAnomalyId] = useState<number | null>(null);
  const [undoToast, setUndoToast] = useState<UndoToast | null>(null);
  const undoToastRef = useRef<UndoToast | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute timestamp when data refreshes
  const now = useMemo(() => Date.now(), [data]);

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/sites/${params.id}/detail`);
      if (!res.ok) throw new Error("failed to fetch");
      const json = await res.json();
      setData(json);
      setError("");
    } catch {
      setError("failed to load site details");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    fetchDetail();
    const interval = setInterval(fetchDetail, 30_000);
    return () => clearInterval(interval);
  }, [fetchDetail]);

  // cleanup undo timer on unmount
  useEffect(() => {
    return () => {
      if (undoToastRef.current?.timerId) {
        clearTimeout(undoToastRef.current.timerId);
      }
    };
  }, []);

  async function handleSuppress(anomalyType: string, scope: "site" | "global") {
    setSuppressingAnomalyId(null);

    if (scope === "site") {
      // update per-site settings to disable this notification type
      const notifyKey = ANOMALY_TYPE_TO_NOTIFY_KEY[anomalyType];
      if (!notifyKey) return;

      const res = await fetch(`/api/sites/${params.id}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [notifyKey]: false }),
      });
      if (!res.ok) return;

      showUndoToast(
        `${anomalyType.replace(/_/g, " ")} notifications suppressed for this site`,
        async () => {
          await fetch(`/api/sites/${params.id}/settings`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ [notifyKey]: true }),
          });
        }
      );
    } else {
      // update global settings
      const globalKey = ANOMALY_TYPE_TO_GLOBAL_KEY[anomalyType];
      if (!globalKey) return;

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [globalKey]: "false" }),
      });
      if (!res.ok) return;

      showUndoToast(
        `${anomalyType.replace(/_/g, " ")} notifications suppressed globally`,
        async () => {
          await fetch("/api/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ [globalKey]: "true" }),
          });
        }
      );
    }
  }

  function showUndoToast(message: string, undoAction: () => Promise<void>) {
    // clear any existing toast timer
    if (undoToastRef.current?.timerId) {
      clearTimeout(undoToastRef.current.timerId);
    }

    const timerId = setTimeout(() => {
      setUndoToast(null);
      undoToastRef.current = null;
    }, 30_000);

    const toast: UndoToast = { message, undoAction, timerId };
    undoToastRef.current = toast;
    setUndoToast(toast);
  }

  async function handleUndo() {
    if (!undoToast) return;
    clearTimeout(undoToast.timerId);
    await undoToast.undoAction();
    setUndoToast(null);
    undoToastRef.current = null;
  }

  // compute response time stats scoped to the selected period
  // must be above early returns to satisfy rules of hooks
  const periodStats = useMemo(() => {
    const ts = data?.timeSeries;
    if (!ts || ts.length === 0) return { avg: null, p50: null, p95: null, p99: null };
    const cutoff = now - (
      period === "24h" ? 24 * 60 * 60 * 1000 :
      period === "7d" ? 7 * 24 * 60 * 60 * 1000 :
      30 * 24 * 60 * 60 * 1000
    );
    const vals = ts
      .filter((d) => new Date(d.time).getTime() >= cutoff && d.responseTimeMs != null)
      .map((d) => d.responseTimeMs!)
      .sort((a, b) => a - b);
    if (vals.length === 0) return { avg: null, p50: null, p95: null, p99: null };
    const avg = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
    const pct = (p: number) => {
      const idx = (p / 100) * (vals.length - 1);
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      if (lo === hi) return vals[lo];
      return vals[lo] + (vals[hi] - vals[lo]) * (idx - lo);
    };
    return { avg, p50: pct(50), p95: pct(95), p99: pct(99) };
  }, [data, period, now]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <p className="text-sm text-zinc-500">loading...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="text-center">
          <p className="mb-4 text-sm text-red-600 dark:text-red-400">
            {error || "site not found"}
          </p>
          <Link
            href="/"
            className="text-sm text-zinc-500 underline hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const { site, latestCheck, uptime, timeSeries, anomalies } =
    data;
  const isUp = latestCheck?.isUp;

  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              &larr; Sites
            </Link>
            <span className="text-zinc-300 dark:text-zinc-700">/</span>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {site.name}
            </h1>
          </div>
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
              isUp === true
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                : isUp === false
                  ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                  : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
            }`}
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                isUp === true
                  ? "bg-emerald-500"
                  : isUp === false
                    ? "bg-red-500"
                    : "bg-zinc-400"
              }`}
            />
            {isUp === true ? "up" : isUp === false ? "down" : "unknown"}
          </span>
        </div>
        <div className="mx-auto flex max-w-5xl gap-4 px-6">
          {(["overview", "settings"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`border-b-2 pb-2 text-sm font-medium transition-colors ${
                tab === t
                  ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                  : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {tab === "settings" ? (
          <SettingsPanel siteId={site.id} />
        ) : (
        <>
        {/* site info */}
        <div className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          <span className="font-mono">{site.url}</span>
          {!site.isActive && (
            <span className="ml-3 rounded bg-zinc-200 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              paused
            </span>
          )}
          {latestCheck && (
            <span className="ml-3">
              last checked {new Date(latestCheck.checkedAt).toLocaleString()}
            </span>
          )}
        </div>

        {/* uptime cards */}
        <div className="mb-6 grid grid-cols-3 gap-4">
          {(["24h", "7d", "30d"] as const).map((window) => (
            <div
              key={window}
              className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                uptime {window}
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                {uptime[window] != null ? `${uptime[window]}%` : "—"}
              </p>
            </div>
          ))}
        </div>

        {/* response time stats (scoped to selected period) */}
        <div className="mb-6 grid grid-cols-4 gap-4">
          {[
            { label: "avg", value: periodStats.avg },
            { label: "p50", value: periodStats.p50 },
            { label: "p95", value: periodStats.p95 },
            { label: "p99", value: periodStats.p99 },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                {label}
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                {value != null ? `${Math.round(value)}ms` : "—"}
              </p>
            </div>
          ))}
        </div>

        {/* response time chart */}
        <div className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              response time
            </h2>
            <div className="flex gap-1">
              {(["24h", "7d", "30d"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                    period === p
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <ResponseChart data={timeSeries} period={period} now={now} />
        </div>

        {/* anomalies — the event log */}
        <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              event log
            </h2>
          </div>
          {anomalies.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-zinc-400">
              no anomalies in the last 30 days
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
              {anomalies.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setSelectedCheckId(a.checkId)}
                  className="flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                >
                  <span
                    className={`mt-0.5 inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      severityColors[a.severity] ?? severityColors.low
                    }`}
                  >
                    {a.severity}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {a.type.replace(/_/g, " ")}
                    </p>
                    {a.description && (
                      <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                        {a.description}
                      </p>
                    )}
                  </div>
                  <div className="relative shrink-0 flex items-center gap-2">
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">
                      {new Date(a.createdAt).toLocaleString()}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSuppressingAnomalyId(
                          suppressingAnomalyId === a.id ? null : a.id
                        );
                      }}
                      className="rounded px-1.5 py-0.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                      title="Don't notify this type"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                        <path d="M13.5 4.5L12 3l-4 4-4-4L2.5 4.5l4 4-4 4L4 14l4-4 4 4 1.5-1.5-4-4 4-4z" fill="currentColor"/>
                      </svg>
                    </button>
                    {suppressingAnomalyId === a.id && (
                      <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                        <p className="px-3 py-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                          suppress {a.type.replace(/_/g, " ")}
                        </p>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSuppress(a.type, "site");
                          }}
                          className="w-full px-3 py-1.5 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
                        >
                          for this site only
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSuppress(a.type, "global");
                          }}
                          className="w-full px-3 py-1.5 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
                        >
                          for all sites
                        </button>
                      </div>
                    )}
                  </div>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    className="mt-0.5 shrink-0 text-zinc-300 dark:text-zinc-600"
                  >
                    <path
                      d="M6 4l4 4-4 4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              ))}
            </div>
          )}
        </div>
        </>
        )}
      </main>

      {selectedCheckId != null && (
        <CheckDetailModal
          siteId={site.id}
          checkId={selectedCheckId}
          onClose={() => setSelectedCheckId(null)}
        />
      )}

      {/* undo toast */}
      {undoToast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              {undoToast.message}
            </p>
            <button
              type="button"
              onClick={handleUndo}
              className="rounded px-2 py-1 text-sm font-medium text-emerald-600 transition-colors hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
            >
              undo
            </button>
            <button
              type="button"
              onClick={() => {
                clearTimeout(undoToast.timerId);
                setUndoToast(null);
                undoToastRef.current = null;
              }}
              className="text-zinc-400 transition-colors hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                <path d="M15 5L5 15M5 5l10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

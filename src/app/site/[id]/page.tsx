"use client";

import { useState, useEffect, useCallback, useMemo, use, type FormEvent } from "react";
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

interface CheckLogEntry {
  id: number;
  statusCode: number | null;
  responseTimeMs: number | null;
  isUp: boolean | null;
  errorMessage: string | null;
  errorCode: string | null;
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
  checkedAt: string;
}

interface Anomaly {
  id: number;
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
  recentChecks: CheckLogEntry[];
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
  const cutoffs: Record<Period, number> = {
    "24h": now - 24 * 60 * 60 * 1000,
    "7d": now - 7 * 24 * 60 * 60 * 1000,
    "30d": now - 30 * 24 * 60 * 60 * 1000,
  };

  const filtered = data.filter(
    (d) => new Date(d.time).getTime() >= cutoffs[period] && d.responseTimeMs != null
  );

  if (filtered.length < 2) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-zinc-400">
        not enough data for selected period
      </div>
    );
  }

  const times = filtered.map((d) => d.responseTimeMs!);
  const maxVal = Math.max(...times);
  const minVal = Math.min(...times);
  const range = maxVal - minVal || 1;

  const w = 800;
  const h = 192;
  const padX = 0;
  const padTop = 12;
  const padBot = 24;
  const chartH = h - padTop - padBot;
  const chartW = w - padX * 2;

  const points = filtered.map((d, i) => {
    const x = padX + (i / (filtered.length - 1)) * chartW;
    const y = padTop + chartH - ((d.responseTimeMs! - minVal) / range) * chartH;
    return { x, y, val: d.responseTimeMs!, time: d.time };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x},${h - padBot} L${points[0].x},${h - padBot} Z`;

  // y-axis labels
  const yLabels = [minVal, minVal + range / 2, maxVal].map((val) => ({
    val: Math.round(val),
    y: padTop + chartH - ((val - minVal) / range) * chartH,
  }));

  // x-axis labels
  const xLabelCount = 5;
  const xLabels = Array.from({ length: xLabelCount }, (_, i) => {
    const idx = Math.round((i / (xLabelCount - 1)) * (filtered.length - 1));
    const d = new Date(filtered[idx].time);
    const label =
      period === "24h"
        ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : d.toLocaleDateString([], { month: "short", day: "numeric" });
    return { x: points[idx].x, label };
  });

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none">
      {/* grid lines */}
      {yLabels.map((yl) => (
        <line
          key={yl.val}
          x1={padX}
          x2={w - padX}
          y1={yl.y}
          y2={yl.y}
          className="stroke-zinc-200 dark:stroke-zinc-800"
          strokeWidth={0.5}
        />
      ))}

      {/* area fill */}
      <path d={areaPath} className="fill-emerald-500/10 dark:fill-emerald-400/10" />

      {/* line */}
      <path
        d={linePath}
        fill="none"
        className="stroke-emerald-500 dark:stroke-emerald-400"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />

      {/* y labels */}
      {yLabels.map((yl) => (
        <text
          key={yl.val}
          x={padX + 4}
          y={yl.y - 4}
          className="fill-zinc-400 dark:fill-zinc-500"
          fontSize={10}
        >
          {yl.val}ms
        </text>
      ))}

      {/* x labels */}
      {xLabels.map((xl) => (
        <text
          key={xl.x}
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
  const [notifyToggles, setNotifyToggles] = useState<
    Record<string, boolean>
  >({});
  const [severityThreshold, setSeverityThreshold] =
    useState<SiteSettings["severityThreshold"]>("low");

  useEffect(() => {
    fetch(`/api/sites/${siteId}/settings`)
      .then((r) => r.json())
      .then((data: SiteSettings) => {
        setSettings(data);
        setResponseTimeThreshold(
          data.responseTimeThreshold != null
            ? String(data.responseTimeThreshold)
            : ""
        );
        setSslExpiryWarningDays(String(data.sslExpiryWarningDays));
        setCheckInterval(String(data.checkInterval));
        setNotifyToggles({
          notifyDowntime: data.notifyDowntime,
          notifySlowResponse: data.notifySlowResponse,
          notifyStatusCode: data.notifyStatusCode,
          notifyContentChange: data.notifyContentChange,
          notifySslIssue: data.notifySslIssue,
          notifyHeaderAnomaly: data.notifyHeaderAnomaly,
        });
        setSeverityThreshold(data.severityThreshold);
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

  const { site, latestCheck, responseTime, uptime, timeSeries, anomalies, recentChecks } =
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

        {/* response time stats */}
        <div className="mb-6 grid grid-cols-4 gap-4">
          {[
            { label: "avg", value: responseTime.avg },
            { label: "p50", value: responseTime.p50 },
            { label: "p95", value: responseTime.p95 },
            { label: "p99", value: responseTime.p99 },
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

        {/* check log */}
        <div className="mb-6 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              check log
            </h2>
          </div>
          {recentChecks.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-zinc-400">
              no checks recorded yet
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
              {recentChecks.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCheckId(c.id)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                >
                  <span
                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                      c.isUp === true
                        ? "bg-emerald-500"
                        : c.isUp === false
                          ? "bg-red-500"
                          : "bg-zinc-400"
                    }`}
                  />
                  <span className="w-12 shrink-0 font-mono text-xs tabular-nums text-zinc-900 dark:text-zinc-100">
                    {c.statusCode ?? "—"}
                  </span>
                  <span className="w-16 shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                    {c.responseTimeMs != null ? `${c.responseTimeMs}ms` : "—"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-zinc-400 dark:text-zinc-500">
                    {c.errorMessage || c.errorCode || ""}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
                    {new Date(c.checkedAt).toLocaleString()}
                  </span>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    className="shrink-0 text-zinc-300 dark:text-zinc-600"
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

        {/* anomalies */}
        <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              recent anomalies
            </h2>
          </div>
          {anomalies.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-zinc-400">
              no anomalies in the last 30 days
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
              {anomalies.map((a) => (
                <div
                  key={a.id}
                  className="flex items-start gap-3 px-4 py-3"
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
                  <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
                    {new Date(a.createdAt).toLocaleString()}
                  </span>
                </div>
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
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback, useMemo, use } from "react";
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
}

type Period = "24h" | "7d" | "30d";

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

  const { site, latestCheck, responseTime, uptime, timeSeries, anomalies } =
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
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
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
      </main>
    </div>
  );
}

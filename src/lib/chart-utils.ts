/**
 * pure computation logic for ResponseChart — extracted for testability
 */

export interface TimePoint {
  time: string;
  responseTimeMs: number | null;
  isUp?: boolean | null;
}

export type Period = "24h" | "7d" | "30d";

export interface ChartPoint {
  x: number;
  y: number;
  val: number;
  time: string;
}

export interface DowntimeRegion {
  x1: number;
  x2: number;
}

export interface ChartLayout {
  w: number;
  h: number;
  padX: number;
  padTop: number;
  padBot: number;
  chartH: number;
  chartW: number;
}

const DEFAULT_LAYOUT: ChartLayout = {
  w: 800,
  h: 192,
  padX: 0,
  padTop: 12,
  padBot: 24,
  chartH: 192 - 12 - 24,
  chartW: 800,
};

export function getCutoff(period: Period, now: number): number {
  const ms: Record<Period, number> = {
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
  };
  return now - ms[period];
}

export function minMax(values: number[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v > max) max = v;
    if (v < min) min = v;
  }
  return { min, max };
}

export function computePoints(
  filtered: TimePoint[],
  layout: ChartLayout = DEFAULT_LAYOUT
): ChartPoint[] {
  if (filtered.length < 2) return [];

  const { max: maxVal } = minMax(
    filtered.map((d) => d.responseTimeMs!)
  );
  // anchor y-axis to 0 so small variations don't look dramatic
  const yMin = 0;
  const range = maxVal - yMin || 1;

  const tMin = new Date(filtered[0].time).getTime();
  const tMax = new Date(filtered[filtered.length - 1].time).getTime();
  const tRange = tMax - tMin || 1;

  return filtered.map((d) => {
    const t = new Date(d.time).getTime();
    const x =
      layout.padX + ((t - tMin) / tRange) * layout.chartW;
    const y =
      layout.padTop +
      layout.chartH -
      ((d.responseTimeMs! - yMin) / range) * layout.chartH;
    return { x, y, val: d.responseTimeMs!, time: d.time };
  });
}

export function computeDowntimeRegions(
  allInPeriod: TimePoint[],
  tMin: number,
  tMax: number,
  layout: ChartLayout = DEFAULT_LAYOUT
): DowntimeRegion[] {
  const tRange = tMax - tMin || 1;
  const regions: DowntimeRegion[] = [];

  for (let i = 0; i < allInPeriod.length; i++) {
    if (allInPeriod[i].responseTimeMs == null) {
      const startT = new Date(allInPeriod[i].time).getTime();
      let endT = startT;
      while (
        i + 1 < allInPeriod.length &&
        allInPeriod[i + 1].responseTimeMs == null
      ) {
        i++;
        endT = new Date(allInPeriod[i].time).getTime();
      }
      if (endT >= tMin && startT <= tMax) {
        const x1 =
          layout.padX +
          ((Math.max(startT, tMin) - tMin) / tRange) * layout.chartW;
        const x2 =
          layout.padX +
          ((Math.min(endT, tMax) - tMin) / tRange) * layout.chartW;
        regions.push({ x1, x2: Math.max(x2, x1 + 2) });
      }
    }
  }

  return regions;
}

export function splitSegments(
  points: ChartPoint[],
  downtimeRegions: DowntimeRegion[]
): ChartPoint[][] {
  if (points.length === 0) return [];

  const segments: ChartPoint[][] = [];
  let currentSeg: ChartPoint[] = [];

  for (let i = 0; i < points.length; i++) {
    if (currentSeg.length === 0) {
      currentSeg.push(points[i]);
    } else {
      const hasGap = downtimeRegions.some((r) => {
        const rMid = (r.x1 + r.x2) / 2;
        return (
          rMid > currentSeg[currentSeg.length - 1].x && rMid < points[i].x
        );
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

  return segments;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function computePeriodStats(
  timeSeries: TimePoint[],
  period: Period,
  now: number
): { avg: number | null; p50: number | null; p95: number | null; p99: number | null } {
  const cutoff = getCutoff(period, now);
  const vals = timeSeries
    .filter((d) => new Date(d.time).getTime() >= cutoff && d.responseTimeMs != null)
    .map((d) => d.responseTimeMs!)
    .sort((a, b) => a - b);
  if (vals.length === 0) return { avg: null, p50: null, p95: null, p99: null };
  const avg = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
  return {
    avg,
    p50: percentile(vals, 50),
    p95: percentile(vals, 95),
    p99: percentile(vals, 99),
  };
}

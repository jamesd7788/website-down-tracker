import { describe, it, expect } from "vitest";
import {
  minMax,
  getCutoff,
  computePoints,
  computeDowntimeRegions,
  splitSegments,
  percentile,
  computePeriodStats,
  type TimePoint,
  type ChartLayout,
} from "@/lib/chart-utils";

const layout: ChartLayout = {
  w: 800,
  h: 192,
  padX: 0,
  padTop: 12,
  padBot: 24,
  chartH: 156,
  chartW: 800,
};

// helpers
function tp(time: string, ms: number | null): TimePoint {
  return { time, responseTimeMs: ms };
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function isoAt(base: number, offsetMs: number): string {
  return new Date(base + offsetMs).toISOString();
}

describe("minMax (issue #2 — stack-safe min/max)", () => {
  it("works for small arrays", () => {
    expect(minMax([5, 3, 8, 1, 9])).toEqual({ min: 1, max: 9 });
  });

  it("works for single element", () => {
    expect(minMax([42])).toEqual({ min: 42, max: 42 });
  });

  it("handles large arrays without stack overflow", () => {
    // 50k elements — Math.max(...arr) would blow up here
    const big = Array.from({ length: 50_000 }, (_, i) => i);
    const result = minMax(big);
    expect(result.min).toBe(0);
    expect(result.max).toBe(49_999);
  });

  it("handles all identical values", () => {
    expect(minMax([100, 100, 100])).toEqual({ min: 100, max: 100 });
  });
});

describe("getCutoff", () => {
  const now = Date.now();

  it("24h cutoff is 24 hours ago", () => {
    expect(getCutoff("24h", now)).toBe(now - DAY);
  });

  it("7d cutoff is 7 days ago", () => {
    expect(getCutoff("7d", now)).toBe(now - 7 * DAY);
  });

  it("30d cutoff is 30 days ago", () => {
    expect(getCutoff("30d", now)).toBe(now - 30 * DAY);
  });
});

describe("computePoints (issue #1 — time-based x-axis)", () => {
  const base = Date.parse("2026-01-01T00:00:00Z");

  it("returns empty for < 2 points", () => {
    expect(computePoints([tp(isoAt(base, 0), 100)], layout)).toEqual([]);
    expect(computePoints([], layout)).toEqual([]);
  });

  it("spaces points proportional to time, not index", () => {
    // 3 points: t=0, t=1h, t=3h
    // index-based would put them at x=0, 400, 800
    // time-based should put them at x=0, 266.67, 800
    const data = [
      tp(isoAt(base, 0), 100),
      tp(isoAt(base, 1 * HOUR), 100),
      tp(isoAt(base, 3 * HOUR), 100),
    ];
    const pts = computePoints(data, layout);
    expect(pts).toHaveLength(3);

    // first and last at edges
    expect(pts[0].x).toBeCloseTo(0, 1);
    expect(pts[2].x).toBeCloseTo(800, 1);

    // middle at 1/3 (time-based), NOT 1/2 (index-based)
    expect(pts[1].x).toBeCloseTo(800 / 3, 1);
  });

  it("clusters points that are close in time", () => {
    // 10 points in first 5 min, then 1 point at 24h
    const data = [
      ...Array.from({ length: 10 }, (_, i) =>
        tp(isoAt(base, i * 30_000), 100) // every 30s
      ),
      tp(isoAt(base, 24 * HOUR), 100),
    ];
    const pts = computePoints(data, layout);

    // the first 10 points should all be clustered near x=0
    // bc 5 min / 24h ≈ 0.35% of the chart width
    const maxXofCluster = pts[9].x;
    expect(maxXofCluster).toBeLessThan(layout.chartW * 0.01);
    // last point at the right edge
    expect(pts[10].x).toBeCloseTo(800, 1);
  });

  it("maps y based on value range with zero baseline", () => {
    const data = [
      tp(isoAt(base, 0), 100),
      tp(isoAt(base, HOUR), 200),
    ];
    const pts = computePoints(data, layout);
    // with zero baseline: range is 0-200
    // max=200 → y at top (padTop)
    expect(pts[1].y).toBeCloseTo(layout.padTop, 1);
    // 100ms = half of 200 → y at midpoint
    const midY = layout.padTop + layout.chartH * 0.5;
    expect(pts[0].y).toBeCloseTo(midY, 1);
  });
});

describe("computeDowntimeRegions (issue #4 — downtime indication)", () => {
  const base = Date.parse("2026-01-01T00:00:00Z");

  it("returns empty when no nulls", () => {
    const data = [
      tp(isoAt(base, 0), 100),
      tp(isoAt(base, HOUR), 200),
    ];
    const regions = computeDowntimeRegions(data, base, base + HOUR, layout);
    expect(regions).toEqual([]);
  });

  it("detects a single downtime point", () => {
    const data = [
      tp(isoAt(base, 0), 100),
      tp(isoAt(base, HOUR), null),
      tp(isoAt(base, 2 * HOUR), 100),
    ];
    const regions = computeDowntimeRegions(
      data,
      base,
      base + 2 * HOUR,
      layout
    );
    expect(regions).toHaveLength(1);
    expect(regions[0].x1).toBeCloseTo(400, 0); // halfway
  });

  it("merges consecutive null points into one region", () => {
    const data = [
      tp(isoAt(base, 0), 100),
      tp(isoAt(base, HOUR), null),
      tp(isoAt(base, 2 * HOUR), null),
      tp(isoAt(base, 3 * HOUR), null),
      tp(isoAt(base, 4 * HOUR), 100),
    ];
    const regions = computeDowntimeRegions(
      data,
      base,
      base + 4 * HOUR,
      layout
    );
    expect(regions).toHaveLength(1);
    // region spans from 1h to 3h in a 4h range
    expect(regions[0].x1).toBeCloseTo(200, 0);
    expect(regions[0].x2).toBeCloseTo(600, 0);
  });

  it("handles downtime at start of period", () => {
    const data = [
      tp(isoAt(base, 0), null),
      tp(isoAt(base, HOUR), null),
      tp(isoAt(base, 2 * HOUR), 100),
    ];
    const regions = computeDowntimeRegions(
      data,
      base,
      base + 2 * HOUR,
      layout
    );
    expect(regions).toHaveLength(1);
    expect(regions[0].x1).toBeCloseTo(0, 0);
  });

  it("handles downtime at end of period", () => {
    const data = [
      tp(isoAt(base, 0), 100),
      tp(isoAt(base, HOUR), null),
      tp(isoAt(base, 2 * HOUR), null),
    ];
    const regions = computeDowntimeRegions(
      data,
      base,
      base + 2 * HOUR,
      layout
    );
    expect(regions).toHaveLength(1);
    expect(regions[0].x2).toBeCloseTo(800, 0);
  });

  it("ensures minimum 2px width for single-point downtime", () => {
    const data = [
      tp(isoAt(base, 0), 100),
      tp(isoAt(base, HOUR), null), // single point
      tp(isoAt(base, 2 * HOUR), 100),
    ];
    const regions = computeDowntimeRegions(
      data,
      base,
      base + 2 * HOUR,
      layout
    );
    // x1 and x2 would be the same for a single point, but we enforce min 2px
    expect(regions[0].x2 - regions[0].x1).toBeGreaterThanOrEqual(2);
  });

  it("detects multiple separate downtime regions", () => {
    const data = [
      tp(isoAt(base, 0), 100),
      tp(isoAt(base, HOUR), null),
      tp(isoAt(base, 2 * HOUR), 100),
      tp(isoAt(base, 3 * HOUR), null),
      tp(isoAt(base, 4 * HOUR), 100),
    ];
    const regions = computeDowntimeRegions(
      data,
      base,
      base + 4 * HOUR,
      layout
    );
    expect(regions).toHaveLength(2);
  });
});

describe("splitSegments (issue #4 — line gaps at downtime)", () => {
  it("returns single segment when no downtime", () => {
    const points = [
      { x: 0, y: 50, val: 100, time: "a" },
      { x: 400, y: 60, val: 90, time: "b" },
      { x: 800, y: 50, val: 100, time: "c" },
    ];
    const segs = splitSegments(points, []);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toHaveLength(3);
  });

  it("splits at downtime region", () => {
    const points = [
      { x: 0, y: 50, val: 100, time: "a" },
      { x: 200, y: 60, val: 90, time: "b" },
      // downtime gap between x=300 and x=500
      { x: 600, y: 50, val: 100, time: "c" },
      { x: 800, y: 55, val: 95, time: "d" },
    ];
    const segs = splitSegments(points, [{ x1: 300, x2: 500 }]);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toHaveLength(2); // points at x=0, x=200
    expect(segs[1]).toHaveLength(2); // points at x=600, x=800
  });

  it("handles multiple gaps", () => {
    const points = [
      { x: 0, y: 50, val: 100, time: "a" },
      { x: 300, y: 50, val: 100, time: "b" },
      { x: 600, y: 50, val: 100, time: "c" },
      { x: 800, y: 50, val: 100, time: "d" },
    ];
    const segs = splitSegments(points, [
      { x1: 100, x2: 200 },
      { x1: 400, x2: 500 },
    ]);
    expect(segs).toHaveLength(3);
  });

  it("returns empty for empty points", () => {
    expect(splitSegments([], [])).toEqual([]);
  });
});

describe("computePoints y-axis (issue #5 — zero baseline)", () => {
  const base = Date.parse("2026-01-01T00:00:00Z");

  it("anchors y-axis to 0, not minVal", () => {
    // values 95-105 — old code would fill full chart height
    // with zero baseline, these should cluster near the top
    const data = [
      tp(isoAt(base, 0), 95),
      tp(isoAt(base, HOUR), 100),
      tp(isoAt(base, 2 * HOUR), 105),
    ];
    const pts = computePoints(data, layout);

    // max (105) should be at padTop (y=12)
    expect(pts[2].y).toBeCloseTo(layout.padTop, 1);

    // 0ms would be at the bottom (padTop + chartH = 168)
    // 95ms should be near the top, not at the bottom
    // with range = 105 (0 to 105), 95/105 ≈ 0.905 up from bottom
    const expectedY = layout.padTop + layout.chartH - (95 / 105) * layout.chartH;
    expect(pts[0].y).toBeCloseTo(expectedY, 1);

    // critically: the y-spread should be SMALL (values are close together)
    const ySpread = Math.abs(pts[2].y - pts[0].y);
    expect(ySpread).toBeLessThan(layout.chartH * 0.15);
  });

  it("still works when values include 0", () => {
    const data = [
      tp(isoAt(base, 0), 0),
      tp(isoAt(base, HOUR), 100),
    ];
    const pts = computePoints(data, layout);
    // 0 should be at bottom
    expect(pts[0].y).toBeCloseTo(layout.padTop + layout.chartH, 1);
    // 100 should be at top
    expect(pts[1].y).toBeCloseTo(layout.padTop, 1);
  });
});

describe("computePeriodStats (issue #6 — period-scoped stats)", () => {
  const base = Date.parse("2026-01-15T00:00:00Z");

  it("returns null stats for empty data", () => {
    const result = computePeriodStats([], "24h", base);
    expect(result).toEqual({ avg: null, p50: null, p95: null, p99: null });
  });

  it("filters data by period", () => {
    const now = base;
    // 10 points at 200ms from 2 days ago, 10 points at 100ms from today
    const data: TimePoint[] = [
      ...Array.from({ length: 10 }, (_, i) =>
        tp(isoAt(base, -2 * DAY + i * HOUR), 200)
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        tp(isoAt(base, -12 * HOUR + i * HOUR), 100)
      ),
    ];

    // 30d should include all 20 points → avg = 150
    const stats30d = computePeriodStats(data, "30d", now);
    expect(stats30d.avg).toBe(150);

    // 24h should only include the 10 recent points → avg = 100
    const stats24h = computePeriodStats(data, "24h", now);
    expect(stats24h.avg).toBe(100);
  });

  it("computes correct percentiles", () => {
    const now = base;
    // 100 evenly spaced values: 1, 2, 3, ..., 100
    const data = Array.from({ length: 100 }, (_, i) =>
      tp(isoAt(base, -HOUR * (100 - i)), i + 1)
    );
    const stats = computePeriodStats(data, "30d", now);
    expect(stats.avg).toBe(51); // Math.round(50.5)
    expect(stats.p50).toBeCloseTo(50.5, 1);
    expect(stats.p95).toBeCloseTo(95.05, 1);
    expect(stats.p99).toBeCloseTo(99.01, 1);
  });

  it("ignores null response times", () => {
    const now = base;
    const data: TimePoint[] = [
      tp(isoAt(base, -HOUR), 100),
      tp(isoAt(base, -2 * HOUR), null), // downtime
      tp(isoAt(base, -3 * HOUR), 200),
    ];
    const stats = computePeriodStats(data, "24h", now);
    expect(stats.avg).toBe(150); // (100 + 200) / 2
  });
});

describe("percentile", () => {
  it("returns single element for single-element array", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });

  it("interpolates correctly", () => {
    // [10, 20] → p50 = 15
    expect(percentile([10, 20], 50)).toBe(15);
  });

  it("returns 0 for empty array", () => {
    expect(percentile([], 50)).toBe(0);
  });
});

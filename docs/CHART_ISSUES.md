# ResponseChart issues

source: `src/app/site/[id]/page.tsx:97-219`

## critical

### 1. x-axis is index-based, not time-based
points are spaced evenly by array index (`x = i / (filtered.length - 1)`) regardless of actual timestamps. 10 checks in hour 1 and 1 check in hour 23 render as evenly distributed. fundamentally misleading for time-series data.

### 2. `Math.max(...times)` will stack overflow
30 days at 60s intervals = ~43k points. spreading that many args blows the call stack. needs a reduce or iterative approach.

## significant

### 3. no hover/tooltip
no way to inspect the actual value or timestamp of any point. for a monitoring dashboard this is table stakes.

### 4. no downtime indication
checks where `responseTimeMs` is null (site unreachable) are silently filtered out. the chart skips those periods with no visual gap or marker.

### 5. y-axis auto-scaling hides context
chart always fills the full y range from min to max. response times of 95ms-105ms render as dramatic swings. no zero baseline or absolute reference beyond 3 y-labels.

### 6. period selector doesn't affect stat cards
p50/p95/p99/avg cards above the chart always show 30d stats regardless of the selected period. misleading when viewing a 24h chart.

## minor

### 7. `preserveAspectRatio="none"` distorts labels
non-uniform svg stretching makes text labels render at inconsistent visual sizes depending on container width. conflicts with `vectorEffect="non-scaling-stroke"` on the line path.

### 8. react key collisions
- y-labels use `key={yl.val}` — collides when min === max (the `range || 1` fallback maps all 3 labels to the same value)
- x-labels use `key={xl.x}` — collides if two labels share the same x position

### 9. no memoization
entire chart recalculates every render. parent polls every 30s and chart does filtering + path generation. should be wrapped in `useMemo`.

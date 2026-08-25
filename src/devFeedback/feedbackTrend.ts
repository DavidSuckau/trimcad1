import type { FeedbackIssueWithMeta } from './feedbackIssueFilter'

export type TrendPoint = {
  /** YYYY-MM-DD (UTC) */
  date: string
  open: number
  closed: number
}

function startOfUtcDay(isoOrMs: string | number): number {
  const d = new Date(isoOrMs)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

function toDateKey(ms: number): string {
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Täglicher Verlauf: offene vs. kumuliert abgeschlossene TrimTex-Issues. */
export function buildFeedbackTrend(
  issues: FeedbackIssueWithMeta[],
  nowMs = Date.now(),
): TrendPoint[] {
  if (issues.length === 0) return []

  const created = issues.map((i) => new Date(i.createdAt).getTime()).filter(Number.isFinite)
  const start = startOfUtcDay(Math.min(...created))
  const end = startOfUtcDay(nowMs)
  const dayMs = 86400000

  const raw: TrendPoint[] = []
  for (let t = start; t <= end; t += dayMs) {
    const endOfDay = t + dayMs - 1
    let open = 0
    let closed = 0
    for (const i of issues) {
      const c = new Date(i.createdAt).getTime()
      if (!Number.isFinite(c) || c > endOfDay) continue
      const cl = i.closedAt ? new Date(i.closedAt).getTime() : null
      if (cl != null && Number.isFinite(cl) && cl <= endOfDay) closed++
      else open++
    }
    raw.push({ date: toDateKey(t), open, closed })
  }

  return downsampleTrend(raw, 90)
}

/** Wöchentliche Stützstellen bei langen Zeiträumen. */
export function downsampleTrend(points: TrendPoint[], maxPoints: number): TrendPoint[] {
  if (points.length <= maxPoints) return points
  const step = Math.ceil(points.length / maxPoints)
  const out: TrendPoint[] = []
  for (let i = 0; i < points.length; i += step) out.push(points[i]!)
  const last = points[points.length - 1]!
  if (out[out.length - 1]?.date !== last.date) out.push(last)
  return out
}

export type TrendChartGeometry = {
  points: TrendPoint[]
  width: number
  height: number
  padding: { top: number; right: number; bottom: number; left: number }
  maxY: number
  openPath: string
  closedPath: string
  openDots: { x: number; y: number }[]
  closedDots: { x: number; y: number }[]
}

export function buildTrendChartGeometry(
  trend: TrendPoint[],
  width = 520,
  height = 160,
): TrendChartGeometry | null {
  if (trend.length === 0) return null
  const padding = { top: 12, right: 12, bottom: 28, left: 36 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom
  const maxY = Math.max(1, ...trend.flatMap((p) => [p.open, p.closed]))

  const xAt = (i: number) =>
    padding.left + (trend.length <= 1 ? innerW / 2 : (i / (trend.length - 1)) * innerW)
  const yAt = (v: number) => padding.top + innerH - (v / maxY) * innerH

  const openDots = trend.map((p, i) => ({ x: xAt(i), y: yAt(p.open) }))
  const closedDots = trend.map((p, i) => ({ x: xAt(i), y: yAt(p.closed) }))

  const toPath = (dots: { x: number; y: number }[]) =>
    dots.map((d, i) => `${i === 0 ? 'M' : 'L'} ${d.x.toFixed(1)} ${d.y.toFixed(1)}`).join(' ')

  return {
    points: trend,
    width,
    height,
    padding,
    maxY,
    openPath: toPath(openDots),
    closedPath: toPath(closedDots),
    openDots,
    closedDots,
  }
}

export function formatTrendDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-')
  return `${d}.${m}.${y?.slice(2) ?? ''}`
}

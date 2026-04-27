import type { LineSegment, Point } from '../types/model'

/** Kantenlänge eines Liniensegments in mm. */
export function lineSegmentLengthMm(seg: LineSegment): number {
  const dx = seg.end.x - seg.start.x
  const dy = seg.end.y - seg.start.y
  return Math.hypot(dx, dy)
}

/** Punkt auf Liniensegment; t in [0,1] von start nach end. */
export function pointAtLineSegmentT(
  seg: LineSegment,
  t: number,
  options?: { strict?: boolean },
): Point {
  if (options?.strict && (t < 0 || t > 1)) {
    throw new Error('t must be between 0 and 1')
  }
  const u = Math.min(1, Math.max(0, t))
  const dx = seg.end.x - seg.start.x
  const dy = seg.end.y - seg.start.y
  return {
    x: seg.start.x + u * dx,
    y: seg.start.y + u * dy,
  }
}

/**
 * Gleichmäßige Parameter entlang einer Kante (n innere Teilungen: t = 1/(n+1) … n/(n+1)).
 * n = 1 → nur Mitte (t = 0.5).
 */
export function evenlySpacedTsOnLineSegment(n: number): number[] {
  if (!Number.isFinite(n)) throw new Error('n must be finite')
  if (!Number.isInteger(n)) throw new Error('n must be an integer')
  if (n < 0) throw new Error('n must be >= 0')
  if (n < 1) return []
  if (n === 1) return [0.5]
  return Array.from({ length: n }, (_, i) => (i + 1) / (n + 1))
}

/** Mittelpunkt eines geraden Kontursegments (Parameter t = 0.5). */
export function midpointOnLineSegment(curve: LineSegment): { point: Point; t: number } {
  return { point: pointAtLineSegmentT(curve, 0.5), t: 0.5 }
}

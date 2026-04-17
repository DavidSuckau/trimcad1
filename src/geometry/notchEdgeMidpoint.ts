import type { LineSegment, Point } from '../types/model'

/** Kantenlänge eines Liniensegments in mm. */
export function lineSegmentLengthMm(seg: LineSegment): number {
  return Math.hypot(seg.end.x - seg.start.x, seg.end.y - seg.start.y)
}

/** Punkt auf Liniensegment; t in [0,1] von start nach end. */
export function pointAtLineSegmentT(seg: LineSegment, t: number): Point {
  const u = Math.min(1, Math.max(0, t))
  return {
    x: seg.start.x + u * (seg.end.x - seg.start.x),
    y: seg.start.y + u * (seg.end.y - seg.start.y),
  }
}

/**
 * Gleichmäßige Parameter entlang einer Kante (n innere Teilungen: t = 1/(n+1) … n/(n+1)).
 * n = 1 → nur Mitte (t = 0.5).
 */
export function evenlySpacedTsOnLineSegment(n: number): number[] {
  if (n < 1) return []
  if (n === 1) return [0.5]
  return Array.from({ length: n }, (_, i) => (i + 1) / (n + 1))
}

/** Mittelpunkt eines geraden Kontursegments (Parameter t = 0.5). */
export function midpointOnLineSegment(curve: LineSegment): { point: Point; t: number } {
  return { point: pointAtLineSegmentT(curve, 0.5), t: 0.5 }
}

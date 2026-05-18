import type { Curve, Notch, Point } from '../types/model'
import {
  bezierAt,
  pathLengthAt,
  totalPathLength,
  pointAtPathLength,
  outwardNormalAngleAt,
} from './curveToPath'
import { nearestCurveIndexAndPoint } from './nearestOnCurve'

export function isNotchOnInternalLine(notch: Notch): boolean {
  const idx = notch.internalLineIndex
  return idx != null && Number.isFinite(idx) && idx >= 0
}

function pointOnCurveAt(curves: Curve[], curveIndex: number, t: number): Point | null {
  if (curveIndex < 0 || curveIndex >= curves.length) return null
  const c = curves[curveIndex]
  const tt = Math.max(0, Math.min(1, t))
  if (c.type === 'line') {
    return {
      x: c.start.x + tt * (c.end.x - c.start.x),
      y: c.start.y + tt * (c.end.y - c.start.y),
    }
  }
  return bezierAt(c, tt)
}

/** Innen-Normale (Kerbe zeigt ins „Innere“ der Linie) an offener interner Polylinie. */
function inwardNormalOnInternalLine(curves: Curve[], curveIndex: number, t: number): number {
  return outwardNormalAngleAt(curves, curveIndex, t) + 180
}

export function resolveNotchInternalLineAnchor(
  notch: Notch,
  internalLines: Curve[]
): { curveIndex: number; t: number } | null {
  if (!isNotchOnInternalLine(notch) || internalLines.length === 0) return null

  const total = totalPathLength(internalLines)
  if (total <= 0) return null

  const sn = notch.internalSNormalized
  if (sn != null && Number.isFinite(sn)) {
    const L = Math.max(0, Math.min(1, sn)) * total
    const pt = pointAtPathLength(internalLines, L)
    if (!pt) return null
    return { curveIndex: pt.curveIndex, t: pt.t }
  }

  const al = notch.internalArcLengthMm
  if (al != null && Number.isFinite(al)) {
    const L = Math.max(0, Math.min(total, al))
    const pt = pointAtPathLength(internalLines, L)
    if (!pt) return null
    return { curveIndex: pt.curveIndex, t: pt.t }
  }

  const idx = notch.internalLineIndex!
  if (idx >= 0 && idx < internalLines.length) {
    const r = nearestCurveIndexAndPoint(notch.position, [internalLines[idx]])
    if (r) return { curveIndex: idx, t: r.t ?? 0 }
  }

  const r = nearestCurveIndexAndPoint(notch.position, internalLines)
  return r ? { curveIndex: r.curveIndex, t: r.t ?? 0 } : null
}

export function getNotchPositionAndAngleOnInternalLine(
  notch: Notch,
  internalLines: Curve[]
): { position: Point; angle: number } | null {
  if (!isNotchOnInternalLine(notch) || internalLines.length === 0) return null
  const fallbackPos =
    Number.isFinite(notch.position.x) && Number.isFinite(notch.position.y)
      ? notch.position
      : { x: 0, y: 0 }
  const fallbackAngle = Number.isFinite(notch.angle) ? notch.angle : 0
  const anchor = resolveNotchInternalLineAnchor(notch, internalLines)
  if (!anchor) return { position: fallbackPos, angle: fallbackAngle }
  const position = pointOnCurveAt(internalLines, anchor.curveIndex, anchor.t)
  if (!position) return { position: fallbackPos, angle: fallbackAngle }
  const angle = inwardNormalOnInternalLine(internalLines, anchor.curveIndex, anchor.t)
  return { position, angle: Number.isFinite(angle) ? angle : fallbackAngle }
}

export function materializeNotchAnchorsOnInternalLine(
  notch: Notch,
  internalLines: Curve[]
): Notch | null {
  if (!isNotchOnInternalLine(notch) || internalLines.length === 0) return null
  const total = totalPathLength(internalLines)
  if (total <= 0) return null

  const anchor = resolveNotchInternalLineAnchor(notch, internalLines)
  if (!anchor) return null
  const L = pathLengthAt(internalLines, anchor.curveIndex, anchor.t)
  const position = pointOnCurveAt(internalLines, anchor.curveIndex, anchor.t)
  if (!position) return null
  const angle = inwardNormalOnInternalLine(internalLines, anchor.curveIndex, anchor.t)
  return {
    ...notch,
    sNormalized: undefined,
    arcLengthMm: undefined,
    vertexIndex: undefined,
    internalLineIndex: anchor.curveIndex,
    internalSNormalized: L / total,
    internalArcLengthMm: L,
    position,
    angle,
  }
}

export function remapNotchesAfterInternalLineRemove(
  notches: Notch[],
  removedIndex: number
): Notch[] {
  return notches
    .filter((n) => !isNotchOnInternalLine(n) || n.internalLineIndex !== removedIndex)
    .map((n) => {
      if (!isNotchOnInternalLine(n) || n.internalLineIndex == null) return n
      if (n.internalLineIndex > removedIndex) {
        return { ...n, internalLineIndex: n.internalLineIndex - 1 }
      }
      return n
    })
}

export function remapNotchesAfterInternalLineSplit(
  notches: Notch[],
  splitIndex: number,
  internalLines: Curve[]
): Notch[] {
  return notches.map((n) => {
    if (!isNotchOnInternalLine(n)) return n
    let next = n
    if (n.internalLineIndex != null && n.internalLineIndex > splitIndex) {
      next = { ...next, internalLineIndex: n.internalLineIndex + 1 }
    }
    return materializeNotchAnchorsOnInternalLine(next, internalLines) ?? next
  })
}

import type { Curve, PatternPiece, Point } from '../types/model'
import { bezierAt, curveSegmentArcLength, splitBezierAt } from './curveToPath'
import { getEffectiveSoftVerticesCut } from './seamUtils'
import { getAllowanceForCurveIndex } from './edgeEnumeration'
import { interiorAngleAtVertexDegrees } from './softVertexPromotion'

const MIN_CHAMFER_MM = 0.5
const EDGE_FRAC = 0.45
/**
 * Nur echte Knicke chamfern. Tessellationspunkte entlang einer Kurve (Clipper-Offset)
 * sind nahezu kollinear (~180°) und würden sonst die gesamte Nahtzugabe „auffressen“.
 */
const MAX_INTERIOR_DEG_FOR_CHAMFER = 165

function cloneCurve(c: Curve): Curve {
  if (c.type === 'line') {
    return { type: 'line', start: { ...c.start }, end: { ...c.end } }
  }
  return {
    type: 'bezier',
    start: { ...c.start },
    end: { ...c.end },
    cp1: { ...c.cp1 },
    cp2: { ...c.cp2 },
  }
}

function curveLen(c: Curve): number {
  return curveSegmentArcLength(c, 0, 1)
}

/** Parameter t ∈ [0,1] für Bogenlänge vom Segmentstart. */
function tAtArcFromStart(c: Curve, arcMm: number): number {
  const total = curveLen(c)
  if (total <= 1e-12) return 0
  const target = Math.max(0, Math.min(total, arcMm))
  if (c.type === 'line') return target / total
  let lo = 0
  let hi = 1
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2
    if (curveSegmentArcLength(c, 0, mid) < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

function pointAtT(c: Curve, t: number): Point {
  const tt = Math.max(0, Math.min(1, t))
  if (c.type === 'line') {
    return {
      x: c.start.x + tt * (c.end.x - c.start.x),
      y: c.start.y + tt * (c.end.y - c.start.y),
    }
  }
  return bezierAt(c, tt)
}

function trimFromStart(c: Curve, distMm: number): Curve | null {
  const total = curveLen(c)
  if (distMm >= total - MIN_CHAMFER_MM) return null
  if (distMm <= 1e-9) return cloneCurve(c)
  const t = tAtArcFromStart(c, distMm)
  if (c.type === 'line') {
    return { type: 'line', start: pointAtT(c, t), end: { ...c.end } }
  }
  const [, right] = splitBezierAt(c, t)
  return right
}

function trimFromEnd(c: Curve, distMm: number): Curve | null {
  const total = curveLen(c)
  if (distMm >= total - MIN_CHAMFER_MM) return null
  if (distMm <= 1e-9) return cloneCurve(c)
  const t = tAtArcFromStart(c, total - distMm)
  if (c.type === 'line') {
    return { type: 'line', start: { ...c.start }, end: pointAtT(c, t) }
  }
  const [left] = splitBezierAt(c, t)
  return left
}

function endPoint(c: Curve): Point {
  return { ...c.end }
}

function startPoint(c: Curve): Point {
  return { ...c.start }
}

function allowanceForCutEdge(piece: PatternPiece, cutCurveIndex: number): number {
  const saDefault = piece.seamAllowanceMm ?? 0
  const masterLen = piece.seamLine.length >= 3 ? piece.seamLine.length : piece.cutLine.length
  if (piece.cutLine.length === masterLen) {
    return getAllowanceForCurveIndex(piece, cutCurveIndex)
  }
  return saDefault
}

/**
 * Schneidet scharfe Ecken der **Schnittkontur** in der Nahtzugabe ab (~45° bei rechten Winkeln).
 * Die Nahtlinie bleibt unverändert. Weiche Vertices und Stellen ohne NZ werden übersprungen.
 */
export function chamferCutLineCornersInSeamAllowance(piece: PatternPiece): Curve[] {
  const cut = piece.cutLine
  const n = cut.length
  if (n < 3) return cut.map(cloneCurve)

  const soft = new Set(getEffectiveSoftVerticesCut(piece))
  const saDefault = piece.seamAllowanceMm ?? 0
  if (saDefault <= 0 && !(piece.edgeSeamAllowances && piece.edgeSeamAllowances.length > 0)) {
    return cut.map(cloneCurve)
  }

  type ChamferSpec = { dIn: number; dOut: number }
  const specs: (ChamferSpec | null)[] = new Array(n).fill(null)

  for (let i = 0; i < n; i++) {
    if (soft.has(i)) continue
    const interiorDeg = interiorAngleAtVertexDegrees(cut, i)
    // Nahezu gestreckt (Tessellation auf Kurven) → kein Chamfer
    if (interiorDeg == null || interiorDeg > MAX_INTERIOR_DEG_FOR_CHAMFER) continue
    const inCi = (i - 1 + n) % n
    const outCi = i
    const incoming = cut[inCi]
    const outgoing = cut[outCi]
    const lenIn = curveLen(incoming)
    const lenOut = curveLen(outgoing)
    const saIn = allowanceForCutEdge(piece, inCi)
    const saOut = allowanceForCutEdge(piece, outCi)
    const dIn = Math.min(Math.max(saIn, 0), EDGE_FRAC * lenIn)
    const dOut = Math.min(Math.max(saOut, 0), EDGE_FRAC * lenOut)
    if (dIn < MIN_CHAMFER_MM || dOut < MIN_CHAMFER_MM) continue
    specs[i] = { dIn, dOut }
  }

  if (specs.every((s) => s == null)) return cut.map(cloneCurve)

  const out: Curve[] = []
  for (let i = 0; i < n; i++) {
    const startSpec = specs[i]
    const endSpec = specs[(i + 1) % n]
    let seg: Curve | null = cloneCurve(cut[i])
    if (startSpec) {
      seg = trimFromStart(seg, startSpec.dOut)
      if (!seg) continue
    }
    if (endSpec) {
      seg = trimFromEnd(seg, endSpec.dIn)
      if (!seg) continue
    }
    if (curveLen(seg) < MIN_CHAMFER_MM * 0.5) continue
    out.push(seg)

    if (endSpec) {
      const a = endPoint(seg)
      const nextOrig = cut[(i + 1) % n]
      const b = pointAtT(nextOrig, tAtArcFromStart(nextOrig, endSpec.dOut))
      if (Math.hypot(b.x - a.x, b.y - a.y) >= MIN_CHAMFER_MM * 0.25) {
        out.push({ type: 'line', start: a, end: b })
      }
    }
  }

  if (out.length >= 3) {
    const first = startPoint(out[0])
    const last = endPoint(out[out.length - 1])
    if (Math.hypot(first.x - last.x, first.y - last.y) > 1e-6) {
      const lastC = out[out.length - 1]
      out[out.length - 1] =
        lastC.type === 'line'
          ? { type: 'line', start: { ...lastC.start }, end: { ...first } }
          : { ...lastC, end: { ...first } }
    }
  }

  return out.length >= 3 ? out : cut.map(cloneCurve)
}

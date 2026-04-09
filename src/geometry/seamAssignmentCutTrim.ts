/**
 * Optionale Nahtzuordnungs-Korrektur: nur die Schnittkontur (cutLine). seamLine unverändert.
 *
 * 1) Partner-Trim (Teil B = zweites Teil bei der Zuordnung): An der Naht-Ecke, die der
 *    oberen linken BBox-Ecke von B am nächsten liegt, wird die Miter-Spitze von B auf die
 *    analytische Miter-Länge von Teil A gekürzt (Nähen entgegengesetzt: B_start↔A_end, B_end↔A_start).
 *    Entspricht dem Übereinanderlegen: längere Spitze am Partner-Bündel angleichen.
 *
 * 2) Zusätzlich: Kappung an beiden Kantenenden nach MITER_CAP_FACTOR (wie zuvor).
 *
 * Deaktivieren: `SEAM_ASSIGNMENT_CUT_TRIM_ENABLED = false` oder Aufruf in `useStore.ts` entfernen.
 */

import type { Curve, PatternPiece, Point } from '../types/model'
import { bezierDerivativeAt, curvesBounds, signedAreaCurves } from './curveToPath'
import { resyncNotchesAfterCutLineRebuilt } from './notchResyncCutLine'
import { applySharpCornerPromotion } from './softVertexPromotion'
import { getCurvesForSeamEdge } from './seamUtils'
import { pieceLocalToWorld } from './pieceTransform'
import { samePoint as samePointDefault, vertexPosition as vertexAt } from './geometryConstants'

export const SEAM_ASSIGNMENT_CUT_TRIM_ENABLED = true

/** Max. Abstand Naht-Ecke → Miter-Spitze in Vielfachen der Nahtzugabe (harte Kappung). */
const MITER_CAP_FACTOR = 2.4

/** cutLine-Eckpunkt muss nahe der analytischen Miter-Spitze liegen (mm). */
const CUT_VERTEX_MATCH_MM = 22

const EPS = 1e-9

function samePoint(a: Point, b: Point, eps = 1e-4): boolean {
  return samePointDefault(a, b, eps)
}

function allLineSegments(curves: Curve[]): boolean {
  return curves.every((c) => c.type === 'line')
}

function replaceVertexInClosedLineCurves(curves: Curve[], vi: number, p: Point): Curve[] {
  const n = curves.length
  if (n < 3) return curves
  const i = ((vi % n) + n) % n
  const prev = (i - 1 + n) % n
  const out = curves.map((c) =>
    c.type === 'line'
      ? { type: 'line' as const, start: { ...c.start }, end: { ...c.end } }
      : { ...c, start: { ...c.start }, end: { ...c.end } }
  )
  if (out[i].type !== 'line' || out[prev].type !== 'line') return curves
  out[i] = { type: 'line', start: { ...p }, end: { ...out[i].end } }
  out[prev] = { type: 'line', start: { ...out[prev].start }, end: { ...p } }
  return out
}

function seamEdgeEndpointsOnMaster(master: Curve[], curveIndices: number[]): [Point, Point] | null {
  if (curveIndices.length === 0) return null
  const firstCi = curveIndices[0]
  const lastCi = curveIndices[curveIndices.length - 1]
  const start = master[firstCi]?.start
  const end = master[lastCi]?.end
  if (!start || !end) return null
  return [{ ...start }, { ...end }]
}

/**
 * Einheits-Tangente in Laufrichtung der Kontur auf Segment curveIndex bei t in [0,1].
 */
function unitTangentForward(curves: Curve[], curveIndex: number, t: number): Point | null {
  const c = curves[curveIndex]
  let tx: number
  let ty: number
  if (c.type === 'line') {
    tx = c.end.x - c.start.x
    ty = c.end.y - c.start.y
  } else {
    const d = bezierDerivativeAt(c, t)
    tx = d.x
    ty = d.y
  }
  const len = Math.hypot(tx, ty)
  if (len < 1e-12) return null
  return { x: tx / len, y: ty / len }
}

/**
 * Einheits-Außen-Normale (wie outwardNormalAngleAt / curveToPath).
 */
function outwardUnitNormal(curves: Curve[], curveIndex: number, t: number): Point | null {
  const c = curves[curveIndex]
  let tx: number
  let ty: number
  if (c.type === 'line') {
    tx = c.end.x - c.start.x
    ty = c.end.y - c.start.y
  } else {
    const d = bezierDerivativeAt(c, t)
    tx = d.x
    ty = d.y
  }
  const len = Math.hypot(tx, ty)
  if (len < 1e-12) return null
  const nx = -ty / len
  const ny = tx / len
  const area = signedAreaCurves(curves)
  const ox = area >= 0 ? -nx : nx
  const oy = area >= 0 ? -ny : ny
  return { x: ox, y: oy }
}

function cross2(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x
}

function intersectLines(p1: Point, d1: Point, p2: Point, d2: Point): Point | null {
  const cr = cross2(d1, d2)
  if (Math.abs(cr) < EPS) return null
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const s = cross2({ x: dx, y: dy }, d2) / cr
  return { x: p1.x + s * d1.x, y: p1.y + s * d1.y }
}

function masterVertexIndexForPoint(master: Curve[], p: Point, epsMm = 0.08): number | null {
  const n = master.length
  for (let vi = 0; vi < n; vi++) {
    const v = vertexAt(master, vi)
    if (Math.hypot(v.x - p.x, v.y - p.y) <= epsMm) return vi
  }
  return null
}

/**
 * Miter-Spitze = Schnitt der um d verschobenen Geraden zu den beiden Kanten am Vertex vi.
 * Nur für konvexe Ecken (innen) sinnvoll; Reflex-Ecken überspringen.
 */
function analyticMiterPointAtSeamVertex(
  seamLine: Curve[],
  vi: number,
  dMm: number
): { corner: Point; miter: Point } | null {
  const n = seamLine.length
  if (n < 3) return null
  const prevCi = (vi - 1 + n) % n
  const nextCi = vi
  const corner = vertexAt(seamLine, vi)

  const T_in = unitTangentForward(seamLine, prevCi, 1)
  const T_out = unitTangentForward(seamLine, nextCi, 0)
  const N_in = outwardUnitNormal(seamLine, prevCi, 1)
  const N_out = outwardUnitNormal(seamLine, nextCi, 0)
  if (!T_in || !T_out || !N_in || !N_out) return null

  const area = signedAreaCurves(seamLine)
  if (cross2(T_in, T_out) * area <= EPS) return null

  const p1 = { x: corner.x + N_in.x * dMm, y: corner.y + N_in.y * dMm }
  const p2 = { x: corner.x + N_out.x * dMm, y: corner.y + N_out.y * dMm }
  const M = intersectLines(p1, T_in, p2, T_out)
  if (!M) return null
  const dist = Math.hypot(M.x - corner.x, M.y - corner.y)
  if (dist < dMm * 0.45) return null

  return { corner, miter: M }
}

function nearestVertexIndexToPoint(curves: Curve[], target: Point, maxDist: number): number | null {
  const n = curves.length
  let best: number | null = null
  let bestD = maxDist
  for (let vi = 0; vi < n; vi++) {
    const p = vertexAt(curves, vi)
    const dd = Math.hypot(p.x - target.x, p.y - target.y)
    if (dd < bestD) {
      bestD = dd
      best = vi
    }
  }
  return best
}

function capMiterTowardCorner(corner: Point, miter: Point, capDistMm: number): Point {
  const dx = miter.x - corner.x
  const dy = miter.y - corner.y
  const dist = Math.hypot(dx, dy)
  if (dist <= capDistMm + 1e-9) return { ...miter }
  const t = capDistMm / dist
  return { x: corner.x + dx * t, y: corner.y + dy * t }
}

/**
 * Welcher Naht-Endpunkt auf B liegt der „oberen linken“ Bounding-Box-Ecke des Teils
 * in der Arbeitsfläche am nächsten? (y nach unten → minY = oben)
 */
function chooseBSeamEndpointNearTopLeftWorld(
  pieceB: PatternPiece,
  resolvedCurveIndicesB: number[]
): 'start' | 'end' | null {
  const master = getCurvesForSeamEdge(pieceB)
  if (resolvedCurveIndicesB.length === 0) return null
  const firstCi = resolvedCurveIndicesB[0]
  const lastCi = resolvedCurveIndicesB[resolvedCurveIndicesB.length - 1]
  const wbStart = pieceLocalToWorld(master[firstCi].start, pieceB.transform)
  const wbEnd = pieceLocalToWorld(master[lastCi].end, pieceB.transform)
  const b = curvesBounds(pieceB.cutLine)
  if (!b) return null
  const tlWorld = pieceLocalToWorld({ x: b.minX, y: b.minY }, pieceB.transform)
  const dStart = Math.hypot(wbStart.x - tlWorld.x, wbStart.y - tlWorld.y)
  const dEnd = Math.hypot(wbEnd.x - tlWorld.x, wbEnd.y - tlWorld.y)
  return dStart <= dEnd ? 'start' : 'end'
}

/**
 * Nahtzuordnung: B_start ↔ A_end, B_end ↔ A_start (entgegengesetzt nähen).
 */
function partnerVertexIndicesAtSeamEnds(
  nA: number,
  nB: number,
  firstCiA: number,
  lastCiA: number,
  firstCiB: number,
  lastCiB: number,
  which: 'start' | 'end'
): { viB: number; viA: number } {
  if (which === 'start') {
    return { viB: firstCiB, viA: (lastCiA + 1) % nA }
  }
  return { viB: (lastCiB + 1) % nB, viA: firstCiA }
}

/**
 * Rechtes Teil (B): an der Naht-Ecke, die der oberen linken BBox-Ecke am nächsten liegt,
 * die Schnitt-Spitze auf die Miter-Länge des linken Teils (A) kürzen — wie beim Übereinanderlegen.
 * Nur cutLine; seamLine unverändert.
 */
function partnerTrimPieceBToMatchPieceA(
  pieceA: PatternPiece,
  pieceB: PatternPiece,
  resolvedIndicesA: number[],
  resolvedIndicesB: number[]
): PatternPiece | null {
  const dB = pieceB.seamAllowanceMm
  const dA = pieceA.seamAllowanceMm
  if (
    dB == null ||
    dB <= 0 ||
    dA == null ||
    dA <= 0 ||
    pieceB.seamLine.length < 3 ||
    pieceA.seamLine.length < 3 ||
    !allLineSegments(pieceB.cutLine)
  ) {
    return null
  }

  const which = chooseBSeamEndpointNearTopLeftWorld(pieceB, resolvedIndicesB)
  if (!which) return null

  const masterA = getCurvesForSeamEdge(pieceA)
  const masterB = getCurvesForSeamEdge(pieceB)
  const nA = masterA.length
  const nB = masterB.length
  const firstCiA = resolvedIndicesA[0]
  const lastCiA = resolvedIndicesA[resolvedIndicesA.length - 1]
  const firstCiB = resolvedIndicesB[0]
  const lastCiB = resolvedIndicesB[resolvedIndicesB.length - 1]

  const { viB, viA } = partnerVertexIndicesAtSeamEnds(
    nA,
    nB,
    firstCiA,
    lastCiA,
    firstCiB,
    lastCiB,
    which
  )

  const analyticA = analyticMiterPointAtSeamVertex(pieceA.seamLine, viA, dA)
  const analyticB = analyticMiterPointAtSeamVertex(pieceB.seamLine, viB, dB)
  if (!analyticA || !analyticB) return null

  const La = Math.hypot(analyticA.miter.x - analyticA.corner.x, analyticA.miter.y - analyticA.corner.y)
  const Lb = Math.hypot(analyticB.miter.x - analyticB.corner.x, analyticB.miter.y - analyticB.corner.y)
  if (Lb <= La + 0.08) return null

  const cornerB = analyticB.corner
  const Mb = analyticB.miter
  const inv = 1 / Lb
  const newTip: Point = {
    x: cornerB.x + (Mb.x - cornerB.x) * inv * La,
    y: cornerB.y + (Mb.y - cornerB.y) * inv * La,
  }

  const viCut = nearestVertexIndexToPoint(pieceB.cutLine, Mb, CUT_VERTEX_MATCH_MM)
  if (viCut == null) return null

  const newCut = replaceVertexInClosedLineCurves(pieceB.cutLine, viCut, newTip)
  const a0 = signedAreaCurves(pieceB.cutLine)
  const a1 = signedAreaCurves(newCut)
  if (Math.abs(a1) < 1e-6 || a0 * a1 <= 0) return null

  const notches = resyncNotchesAfterCutLineRebuilt(pieceB.notches, pieceB.cutLine, newCut)
  return applySharpCornerPromotion({ ...pieceB, cutLine: newCut, notches })
}

function trimPieceCutLineAtSeamEndpoints(
  piece: PatternPiece,
  resolvedCurveIndices: number[]
): { cutLine: Curve[]; changed: boolean } {
  const d = piece.seamAllowanceMm
  if (d == null || d <= 0 || piece.seamLine.length < 3 || piece.cutLine.length < 3) {
    return { cutLine: piece.cutLine, changed: false }
  }
  if (!allLineSegments(piece.cutLine)) {
    return { cutLine: piece.cutLine, changed: false }
  }

  const master = getCurvesForSeamEdge(piece)
  const seamLine = piece.seamLine
  const ends = seamEdgeEndpointsOnMaster(master, resolvedCurveIndices)
  if (!ends) return { cutLine: piece.cutLine, changed: false }

  const capDist = d * MITER_CAP_FACTOR
  let corners: Point[] = [ends[0], ends[1]]
  if (samePoint(ends[0], ends[1])) {
    corners = [ends[0]]
  }

  let cut = piece.cutLine
  let changed = false

  for (const cornerPt of corners) {
    const viM = masterVertexIndexForPoint(master, cornerPt)
    if (viM == null) continue

    const analytic = analyticMiterPointAtSeamVertex(seamLine, viM, d)
    if (!analytic) continue

    const { corner, miter: M } = analytic
    const capped = capMiterTowardCorner(corner, M, capDist)
    if (Math.hypot(capped.x - M.x, capped.y - M.y) < 0.02) continue

    const viCut = nearestVertexIndexToPoint(cut, M, CUT_VERTEX_MATCH_MM)
    if (viCut == null) continue

    const next = replaceVertexInClosedLineCurves(cut, viCut, capped)
    const a0 = signedAreaCurves(cut)
    const a1 = signedAreaCurves(next)
    if (Math.abs(a1) < 1e-6 || a0 * a1 <= 0) continue

    cut = next
    changed = true
  }

  return { cutLine: cut, changed }
}

export function applySeamAssignmentCutTrim(
  pieceA: PatternPiece,
  pieceB: PatternPiece,
  resolvedIndicesA: number[],
  resolvedIndicesB: number[]
): { pieceA: PatternPiece; pieceB: PatternPiece } | null {
  if (!SEAM_ASSIGNMENT_CUT_TRIM_ENABLED) return null

  let nextA = pieceA
  let nextB = partnerTrimPieceBToMatchPieceA(pieceA, pieceB, resolvedIndicesA, resolvedIndicesB) ?? pieceB

  const rA = trimPieceCutLineAtSeamEndpoints(nextA, resolvedIndicesA)
  const rB = trimPieceCutLineAtSeamEndpoints(nextB, resolvedIndicesB)
  if (nextB === pieceB && !rA.changed && !rB.changed) return null

  if (rA.changed) {
    const notches = resyncNotchesAfterCutLineRebuilt(nextA.notches, nextA.cutLine, rA.cutLine)
    nextA = applySharpCornerPromotion({ ...nextA, cutLine: rA.cutLine, notches })
  }
  if (rB.changed) {
    const notches = resyncNotchesAfterCutLineRebuilt(nextB.notches, nextB.cutLine, rB.cutLine)
    nextB = applySharpCornerPromotion({ ...nextB, cutLine: rB.cutLine, notches })
  }

  return { pieceA: nextA, pieceB: nextB }
}

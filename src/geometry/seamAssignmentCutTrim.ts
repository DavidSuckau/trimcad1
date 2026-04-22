/**
 * Optionale Nahtzuordnungs-Korrektur: nur die Schnittkontur (cutLine). seamLine unverändert.
 *
 * 1) Partner-Trim: An **beiden** Enden der zugeordneten Naht-Kante: die **längere** Miter-Spitze
 *    (relativ zum Partner) wird entlang derselben Miter-Bahn auf die kürzere Länge gekürzt. Die
 *    **Nahtlinie** (seamLine) und der **exakte** Nahtzugabe-Offset entlang **gerader** Nahtkanten
 *    bleiben unverändert; es geht ausschließlich um Spitzen (Zöpfe an Außenkanten in der
 *    Schnittkontur) — **keine** zwingende Miter-„Kappung“ entlang des ganzen Kantenverlaufs mehr.
 *
 * Bei tangential gefilleter CutLine (viele kurze Segmente): kein Vertex liegt exakt auf der
 * theoretischen Miter-Spitze → Kandidat über maximalen Abstand entlang corner→Miter.
 *
 * Deaktivieren: `SEAM_ASSIGNMENT_CUT_TRIM_ENABLED = false` oder Aufruf in `useStore.ts` entfernen.
 */

import type { Curve, PatternPiece, Point, SeamAssignment } from '../types/model'
import { bezierDerivativeAt, signedAreaCurves } from './curveToPath'
import { resyncNotchesAfterCutLineRebuilt } from './notchResyncCutLine'
import { applySharpCornerPromotion } from './softVertexPromotion'
import { getCurvesForSeamEdge, resolvedSeamAssignmentCurveIndices } from './seamUtils'
import { vertexPosition as vertexAt } from './geometryConstants'

export const SEAM_ASSIGNMENT_CUT_TRIM_ENABLED = true

/** cutLine-Eckpunkt muss nahe der analytischen Miter-Spitze liegen (mm). */
const CUT_VERTEX_MATCH_MM = 22

const EPS = 1e-9

/** Nur echte Längendifferenz: früher 0,08 mm — dadurch blieb der längere Zopf oft unangetastet. */
const PARTNER_TRIM_LENGTH_EPS_MM = 0.002

function allLineSegments(curves: Curve[]): boolean {
  return curves.every((c) => c.type === 'line')
}

/**
 * Nicht-kollineare Ecken: verhindert, dass (diskretisierte) Hilfspunkte mitten auf einer parallelen
 * CutLine-Kante als Miter missbraucht werden und „ganze Kanten“ statt nur Zöpfe verziehen.
 */
function cutLineVertexIsSignificantCorner(
  cutLine: Curve[],
  vi: number,
  minTurnSin: number = 0.0028
): boolean {
  if (!allLineSegments(cutLine)) return true
  const n = cutLine.length
  const a = vertexAt(cutLine, (vi - 1 + n) % n)
  const b = vertexAt(cutLine, vi)
  const c = vertexAt(cutLine, (vi + 1) % n)
  const e1x = a.x - b.x
  const e1y = a.y - b.y
  const e2x = c.x - b.x
  const e2y = c.y - b.y
  const l1 = Math.hypot(e1x, e1y)
  const l2 = Math.hypot(e2x, e2y)
  if (l1 < 1e-7 || l2 < 1e-7) return true
  const s = Math.abs(cross2({ x: e1x, y: e1y }, { x: e2x, y: e2y })) / (l1 * l2)
  return s > minTurnSin
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

/**
 * Vertex auf der CutLine, der die Außen-Spitze (Miter oder Fillet-Bogen) am ehesten trägt:
 * maximaler Abstand entlang (M − corner), mit lateraler Toleranz (viele kurze Segmente).
 */
function cutVertexIndexForAnalyticMiterCap(
  cutLine: Curve[],
  corner: Point,
  M: Point,
  dMm: number
): number | null {
  const n = cutLine.length
  if (n < 3) return null
  const dirx = M.x - corner.x
  const diry = M.y - corner.y
  const dirLen = Math.hypot(dirx, diry)
  if (dirLen < 1e-6) return null
  const ux = dirx / dirLen
  const uy = diry / dirLen
  const lateralMax = Math.max(dMm * 3, 18)
  const forwardMax = dirLen + dMm * 2.5
  let bestVi: number | null = null
  let bestProj = -Infinity
  for (let vi = 0; vi < n; vi++) {
    if (!cutLineVertexIsSignificantCorner(cutLine, vi)) continue
    const p = vertexAt(cutLine, vi)
    const dx = p.x - corner.x
    const dy = p.y - corner.y
    const proj = dx * ux + dy * uy
    const lateral = Math.abs(dx * uy - dy * ux)
    if (proj > dMm * 0.15 && proj < forwardMax && lateral < lateralMax && proj > bestProj) {
      bestProj = proj
      bestVi = vi
    }
  }
  if (bestVi != null) return bestVi
  return nearestVertexOnCutLineMiterTarget(cutLine, M, CUT_VERTEX_MATCH_MM)
}

/** Nächstes Polygon-Vertex an `target` (Distanz < maxDist), nur an echten (nicht kollinearen) Ecken. */
function nearestVertexOnCutLineMiterTarget(
  cutLine: Curve[],
  target: Point,
  maxDist: number
): number | null {
  const n = cutLine.length
  let best: number | null = null
  let bestD = maxDist
  for (let vi = 0; vi < n; vi++) {
    if (!cutLineVertexIsSignificantCorner(cutLine, vi)) continue
    const p = vertexAt(cutLine, vi)
    const dd = Math.hypot(p.x - target.x, p.y - target.y)
    if (dd < bestD) {
      bestD = dd
      best = vi
    }
  }
  return best
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
 * Ein Naht-Ende (`start` = Zuordnungs-Anfang, `end` = Zuordnungs-Ende): längere Miter-Spitze auf
 * trim auf Länge von ref kürzen. Nur cutLine; seamLine unverändert.
 */
function partnerTrimLongerMiterToShorterAtSeamEnd(
  refPiece: PatternPiece,
  trimPiece: PatternPiece,
  resolvedIndicesRef: number[],
  resolvedIndicesTrim: number[],
  which: 'start' | 'end'
): PatternPiece | null {
  const dRef = refPiece.seamAllowanceMm
  const dTrim = trimPiece.seamAllowanceMm
  if (
    dTrim == null ||
    dTrim <= 0 ||
    dRef == null ||
    dRef <= 0 ||
    trimPiece.seamLine.length < 3 ||
    refPiece.seamLine.length < 3 ||
    !allLineSegments(trimPiece.cutLine)
  ) {
    return null
  }

  const masterRef = getCurvesForSeamEdge(refPiece)
  const masterTrim = getCurvesForSeamEdge(trimPiece)
  const nRef = masterRef.length
  const nTrim = masterTrim.length
  const firstCiRef = resolvedIndicesRef[0]
  const lastCiRef = resolvedIndicesRef[resolvedIndicesRef.length - 1]
  const firstCiTrim = resolvedIndicesTrim[0]
  const lastCiTrim = resolvedIndicesTrim[resolvedIndicesTrim.length - 1]

  const { viB: viTrim, viA: viRef } = partnerVertexIndicesAtSeamEnds(
    nRef,
    nTrim,
    firstCiRef,
    lastCiRef,
    firstCiTrim,
    lastCiTrim,
    which
  )

  const analyticRef = analyticMiterPointAtSeamVertex(refPiece.seamLine, viRef, dRef)
  const analyticTrim = analyticMiterPointAtSeamVertex(trimPiece.seamLine, viTrim, dTrim)
  if (!analyticRef || !analyticTrim) return null

  const cornerT = analyticTrim.corner
  const Mt = analyticTrim.miter
  const cornerR = analyticRef.corner
  const Mr = analyticRef.miter
  const LtrimAnalytic = Math.hypot(Mt.x - cornerT.x, Mt.y - cornerT.y)
  const Lref = Math.hypot(Mr.x - cornerR.x, Mr.y - cornerR.y)
  if (LtrimAnalytic < 1e-6 || Lref < 1e-6) return null

  const viCut =
    cutVertexIndexForAnalyticMiterCap(trimPiece.cutLine, cornerT, Mt, dTrim) ??
    nearestVertexOnCutLineMiterTarget(trimPiece.cutLine, Mt, CUT_VERTEX_MATCH_MM)
  if (viCut == null) return null
  if (!cutLineVertexIsSignificantCorner(trimPiece.cutLine, viCut)) return null

  const pTip = vertexAt(trimPiece.cutLine, viCut)
  /** Länge der aktuellen CutLine-Spitze (wichtig für idempotentes reapply nach erstem Trim). */
  const Ltip = Math.hypot(pTip.x - cornerT.x, pTip.y - cornerT.y)

  const E = PARTNER_TRIM_LENGTH_EPS_MM
  if (Ltip < Lref - 0.25) return null

  let targetLen: number
  if (Ltip > Lref + E) {
    targetLen = Lref
  } else if (Math.abs(Ltip - Lref) <= 0.12 && Ltip > dTrim * 0.62) {
    targetLen = Math.max(dTrim * 0.55, Math.min(Ltip, Lref) - 0.1)
  } else {
    return null
  }
  if (Ltip <= targetLen + E) return null

  const inv = 1 / LtrimAnalytic
  const newTip: Point = {
    x: cornerT.x + (Mt.x - cornerT.x) * inv * targetLen,
    y: cornerT.y + (Mt.y - cornerT.y) * inv * targetLen,
  }

  const newCut = replaceVertexInClosedLineCurves(trimPiece.cutLine, viCut, newTip)
  const a0 = signedAreaCurves(trimPiece.cutLine)
  const a1 = signedAreaCurves(newCut)
  if (Math.abs(a1) < 1e-6 || a0 * a1 <= 0) return null

  const notches = resyncNotchesAfterCutLineRebuilt(trimPiece.notches, trimPiece.cutLine, newCut)
  return applySharpCornerPromotion({ ...trimPiece, cutLine: newCut, notches })
}

/**
 * Partner-Trim an **beiden** Enden der zugeordneten Naht (siehe `partnerTrimLongerMiterToShorterAtSeamEnd`).
 */
function partnerTrimLongerMiterToShorter(
  refPiece: PatternPiece,
  trimPiece: PatternPiece,
  resolvedIndicesRef: number[],
  resolvedIndicesTrim: number[]
): PatternPiece | null {
  let piece = trimPiece
  let changed = false
  for (const which of ['start', 'end'] as const) {
    const next = partnerTrimLongerMiterToShorterAtSeamEnd(
      refPiece,
      piece,
      resolvedIndicesRef,
      resolvedIndicesTrim,
      which
    )
    if (next) {
      piece = next
      changed = true
    }
  }
  return changed ? piece : null
}

export function applySeamAssignmentCutTrim(
  pieceA: PatternPiece,
  pieceB: PatternPiece,
  resolvedIndicesA: number[],
  resolvedIndicesB: number[]
): { pieceA: PatternPiece; pieceB: PatternPiece } | null {
  if (!SEAM_ASSIGNMENT_CUT_TRIM_ENABLED) return null

  let nextA = pieceA
  let nextB = pieceB
  const tB = partnerTrimLongerMiterToShorter(nextA, nextB, resolvedIndicesA, resolvedIndicesB)
  if (tB) nextB = tB
  const tA = partnerTrimLongerMiterToShorter(nextB, nextA, resolvedIndicesB, resolvedIndicesA)
  if (tA) nextA = tA
  if (!tA && !tB) return null

  return { pieceA: nextA, pieceB: nextB }
}

/**
 * Wendet die Nahtzuordnungs-Schnittkontur-Korrektur für **alle** Zuordnungen nacheinander an
 * (z. B. nach neuer Ableitung der cutLine aus der Naht — sonst fehlt der Zopf-Trim).
 */
export function reapplySeamAssignmentCutTrimsForAllPieces(
  pieces: PatternPiece[],
  seamAssignments: readonly SeamAssignment[]
): { pieces: PatternPiece[]; changed: boolean } {
  if (seamAssignments.length === 0) return { pieces, changed: false }
  let next = pieces
  let changed = false
  for (const a of seamAssignments) {
    const pieceA = next.find((p) => p.id === a.pieceIdA)
    const pieceB = next.find((p) => p.id === a.pieceIdB)
    if (!pieceA || !pieceB) continue
    const trimmed = applySeamAssignmentCutTrim(
      pieceA,
      pieceB,
      resolvedSeamAssignmentCurveIndices(pieceA, a.curveIndicesA),
      resolvedSeamAssignmentCurveIndices(pieceB, a.curveIndicesB)
    )
    if (trimmed) {
      changed = true
      next = next.map((p) => {
        if (p.id === a.pieceIdA) return trimmed.pieceA
        if (p.id === a.pieceIdB) return trimmed.pieceB
        return p
      })
    }
  }
  return { pieces: next, changed }
}

/**
 * Optionale Nahtzuordnungs-Korrektur: nur die Schnittkontur (cutLine). seamLine unverändert.
 *
 * An beiden Enden der Naht (Anfang↔Anfang und Ende↔Ende, wie die Messpfeile) werden die
 * Teile virtuell auf die Naht gelegt, eines gewendet. In den ersten 30 mm muss die
 * Schnitt-Ecke deckungsgleich sein. Die Zugabe der Nahtkante bleibt parallel.
 *
 * Deaktivieren: `SEAM_ASSIGNMENT_CUT_TRIM_ENABLED = false` oder Aufruf in `useStore.ts` entfernen.
 */

import type { Curve, PatternPiece, Point, SeamAssignment, SeamMeasureDir } from '../types/model'
import { isInternalSeamAssignment } from './internalSeamAssignment'
import { bezierDerivativeAt, signedAreaCurves } from './curveToPath'
import { resyncNotchesAfterCutLineRebuilt } from './notchResyncCutLine'
import { applySharpCornerPromotion } from './softVertexPromotion'
import { effectiveSeamMeasureDirs, resolvedSeamAssignmentCurveIndices } from './seamUtils'
import { vertexPosition as vertexAt } from './geometryConstants'

export const SEAM_ASSIGNMENT_CUT_TRIM_ENABLED = true

const EPS = 1e-9
/** So weit entlang der Naht, ab der Ecke, müssen die Schnitte deckungsgleich sein. */
const CORNER_MATCH_MM = 30

function allLineSegments(curves: Curve[]): boolean {
  return curves.every((c) => c.type === 'line')
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

function dot2(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y
}

function intersectLines(p1: Point, d1: Point, p2: Point, d2: Point): Point | null {
  const cr = cross2(d1, d2)
  if (Math.abs(cr) < EPS) return null
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const s = cross2({ x: dx, y: dy }, d2) / cr
  return { x: p1.x + s * d1.x, y: p1.y + s * d1.y }
}

type SeamEndFrame = {
  corner: Point
  /** Quadratischer Endpunkt der Nahtzugabe, direkt außen vor der Ecke. */
  square: Point
  /** Quadratischer Endpunkt der Nachbarkante. */
  squareAdj: Point
  miter: Point
  /** Richtung entlang der Nahtzugabe, von der Ecke weg über das Nahtende hinaus. */
  past: Point
  /** Wie weit die Miter-Spitze über das quadratische Ende hinausragt (mm, entlang der Naht). */
  overhang: number
}

/**
 * Konvexe Naht-Ecke: parallele Zugabe der Nahtkante und der Nachbarkante, plus Miter-Spitze.
 * `seamLeaves` = die zugeordnete Kante verlässt diese Ecke in Konturrichtung.
 */
function seamEndFrame(seamLine: Curve[], vi: number, seamLeaves: boolean, dMm: number): SeamEndFrame | null {
  const n = seamLine.length
  if (n < 3 || dMm <= 0) return null
  const prevCi = (vi - 1 + n) % n
  const T_in = unitTangentForward(seamLine, prevCi, 1)
  const T_out = unitTangentForward(seamLine, vi, 0)
  const N_in = outwardUnitNormal(seamLine, prevCi, 1)
  const N_out = outwardUnitNormal(seamLine, vi, 0)
  if (!T_in || !T_out || !N_in || !N_out) return null
  const area = signedAreaCurves(seamLine)
  if (cross2(T_in, T_out) * area <= EPS) return null

  const nSeam = seamLeaves ? N_out : N_in
  const nAdj = seamLeaves ? N_in : N_out
  const into = seamLeaves ? T_out : { x: -T_in.x, y: -T_in.y }
  const tSeam = seamLeaves ? T_out : T_in
  const tAdj = seamLeaves ? T_in : T_out
  const corner = vertexAt(seamLine, vi)
  const square = { x: corner.x + nSeam.x * dMm, y: corner.y + nSeam.y * dMm }
  const squareAdj = { x: corner.x + nAdj.x * dMm, y: corner.y + nAdj.y * dMm }
  const miter = intersectLines(square, tSeam, squareAdj, tAdj)
  if (!miter) return null
  const past = { x: -into.x, y: -into.y }
  const overhang = dot2({ x: miter.x - square.x, y: miter.y - square.y }, past)
  if (overhang < dMm * 0.2) return null
  return { corner, square, squareAdj, miter, past, overhang }
}

type SeamFrame = { origin: Point; u: Point; v: Point }

function toFrame(p: Point, f: SeamFrame): Point {
  return {
    x: (p.x - f.origin.x) * f.u.x + (p.y - f.origin.y) * f.u.y,
    y: (p.x - f.origin.x) * f.v.x + (p.y - f.origin.y) * f.v.y,
  }
}

function fromFrame(uv: Point, f: SeamFrame): Point {
  return {
    x: f.origin.x + f.u.x * uv.x + f.v.x * uv.y,
    y: f.origin.y + f.u.y * uv.x + f.v.y * uv.y,
  }
}

/** Partnerpunkt in die Koordinaten des zu schneidenden Teils, Naht und Außenseite deckungsgleich. */
function overlayOnTrim(p: Point, partner: SeamFrame, trim: SeamFrame): Point {
  return fromFrame(toFrame(p, partner), trim)
}

function pointInRing(pt: Point, ring: Point[]): boolean {
  let inside = false
  const n = ring.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[j]
    const b = ring[i]
    if (!a || !b) continue
    const intersect = a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y + 1e-15) + a.x
    if (intersect) inside = !inside
  }
  return inside
}

function distToRing(pt: Point, ring: Point[]): number {
  let m = Infinity
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % n]
    if (!a || !b) continue
    const abx = b.x - a.x
    const aby = b.y - a.y
    const ab2 = abx * abx + aby * aby
    let t = ab2 < 1e-18 ? 0 : ((pt.x - a.x) * abx + (pt.y - a.y) * aby) / ab2
    t = Math.max(0, Math.min(1, t))
    const d = Math.hypot(pt.x - (a.x + t * abx), pt.y - (a.y + t * aby))
    if (d < m) m = d
  }
  return m
}

function sticksOutOf(pt: Point, ring: Point[]): boolean {
  if (pointInRing(pt, ring)) return false
  return distToRing(pt, ring) > 0.4
}

function segmentHit(a: Point, b: Point, c: Point, d: Point): { point: Point; t: number } | null {
  const rx = b.x - a.x
  const ry = b.y - a.y
  const sx = d.x - c.x
  const sy = d.y - c.y
  const den = rx * sy - ry * sx
  if (Math.abs(den) < 1e-12) return null
  const qpx = c.x - a.x
  const qpy = c.y - a.y
  const t = (qpx * sy - qpy * sx) / den
  const u = (qpx * ry - qpy * rx) / den
  if (t < -1e-5 || t > 1 + 1e-5 || u < -1e-5 || u > 1 + 1e-5) return null
  return { point: { x: a.x + t * rx, y: a.y + t * ry }, t }
}

function nearestRingHit(from: Point, to: Point, ring: Point[]): { point: Point; edge: number } | null {
  let best: { point: Point; edge: number; t: number } | null = null
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const c = ring[i]
    const d = ring[(i + 1) % n]
    if (!c || !d) continue
    const hit = segmentHit(from, to, c, d)
    if (!hit) continue
    if (!best || hit.t > best.t) best = { point: hit.point, edge: i, t: hit.t }
  }
  return best ? { point: best.point, edge: best.edge } : null
}

function arcAlongRing(ring: Point[], fromEdge: number, toEdge: number, fromPt: Point, toPt: Point, step: 1 | -1): Point[] {
  const n = ring.length
  const pts: Point[] = [fromPt]
  const push = (p: Point) => {
    const last = pts[pts.length - 1]!
    if (Math.hypot(last.x - p.x, last.y - p.y) > 0.15) pts.push(p)
  }
  if (fromEdge === toEdge) {
    push(toPt)
    return pts
  }
  let e = fromEdge
  for (let guard = 0; guard < n; guard++) {
    const passed = step === 1 ? ring[(e + 1) % n] : ring[e]
    if (passed) push(passed)
    e = (e + step + n) % n
    if (e === toEdge) break
  }
  push(toPt)
  pts[pts.length - 1] = toPt
  return pts
}

/** Eckpunkt der Kante in Messrichtung. +1 = mit dem Kurvenindex, −1 = dagegen. */
function vertexForMeasureEnd(
  n: number,
  firstCi: number,
  lastCi: number,
  dir: SeamMeasureDir,
  which: 'start' | 'end',
): number {
  const indexStart = firstCi
  const indexEnd = (lastCi + 1) % n
  const start = dir === 1 ? indexStart : indexEnd
  const end = dir === 1 ? indexEnd : indexStart
  return which === 'start' ? start : end
}

/** Eine zusammenhängende Kette von `true`-Ecken, sonst null. */
function contiguousHitChain(hit: boolean[]): number[] | null {
  const n = hit.length
  const count = hit.filter(Boolean).length
  if (count === 0) return []
  let start = -1
  for (let i = 0; i < n; i++) {
    if (hit[i] && !hit[(i - 1 + n) % n]) {
      start = i
      break
    }
  }
  if (start < 0) return null
  const chain: number[] = []
  for (let k = 0; k < count; k++) {
    const i = (start + k) % n
    if (!hit[i]) return null
    chain.push(i)
  }
  return chain.length === count ? chain : null
}

/** Ersetzt eine Eckenkette durch die Punkte der Partner-Ecke, in Konturrichtung. */
function replaceVertexChainWithPoints(curves: Curve[], chain: number[], points: Point[]): Curve[] | null {
  const n = curves.length
  if (chain.length === 0 || points.length === 0 || !allLineSegments(curves)) return null
  const cleaned: Point[] = []
  for (const p of points) {
    const prev = cleaned[cleaned.length - 1]
    if (!prev || Math.hypot(prev.x - p.x, prev.y - p.y) > 0.15) cleaned.push(p)
  }
  if (cleaned.length === 0) return null
  const firstVi = chain[0]!
  const lastVi = chain[chain.length - 1]!
  const prevI = (firstVi - 1 + n) % n
  const nextI = lastVi
  const prev = curves[prevI]
  const next = curves[nextI]
  if (!prev || !next || prev.type !== 'line' || next.type !== 'line') return null
  const first = cleaned[0]!
  const last = cleaned[cleaned.length - 1]!
  const updatedPrev: Curve = { type: 'line', start: { ...prev.start }, end: { ...first } }
  const updatedNext: Curve = { type: 'line', start: { ...last }, end: { ...next.end } }
  const mids: Curve[] = []
  for (let i = 0; i < cleaned.length - 1; i++) {
    const a = cleaned[i]!
    const b = cleaned[i + 1]!
    if (Math.hypot(a.x - b.x, a.y - b.y) < 0.05) continue
    mids.push({ type: 'line', start: { ...a }, end: { ...b } })
  }
  if (
    Math.hypot(updatedPrev.end.x - updatedPrev.start.x, updatedPrev.end.y - updatedPrev.start.y) < 0.05 ||
    Math.hypot(updatedNext.end.x - updatedNext.start.x, updatedNext.end.y - updatedNext.start.y) < 0.05
  ) {
    return null
  }
  const drop = new Set(chain)
  const out: Curve[] = []
  for (let i = 0; i < n; i++) {
    if (i === prevI) {
      out.push(updatedPrev)
      continue
    }
    if (i === nextI) {
      out.push(...mids)
      out.push(updatedNext)
      continue
    }
    if (drop.has(i)) continue
    const c = curves[i]
    if (!c || c.type !== 'line') return null
    out.push({ type: 'line', start: { ...c.start }, end: { ...c.end } })
  }
  return out.length >= 3 ? out : null
}

/**
 * Ein Naht-Ende: das Teil wird auf die Partner-Naht gelegt (gewendet, gleiche Außenseite).
 * Was in den ersten 30 mm über die Partner-Ecke hinaussteht, wird durch deren Kante ersetzt.
 */
function partnerTrimLongerMiterToShorterAtSeamEnd(
  refPiece: PatternPiece,
  trimPiece: PatternPiece,
  resolvedIndicesRef: number[],
  resolvedIndicesTrim: number[],
  dirRef: SeamMeasureDir,
  dirTrim: SeamMeasureDir,
  which: 'start' | 'end',
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
    resolvedIndicesRef.length === 0 ||
    resolvedIndicesTrim.length === 0 ||
    !allLineSegments(trimPiece.cutLine) ||
    !allLineSegments(refPiece.cutLine)
  ) {
    return null
  }

  const viRef = vertexForMeasureEnd(
    refPiece.seamLine.length,
    resolvedIndicesRef[0]!,
    resolvedIndicesRef[resolvedIndicesRef.length - 1]!,
    dirRef,
    which,
  )
  const viTrim = vertexForMeasureEnd(
    trimPiece.seamLine.length,
    resolvedIndicesTrim[0]!,
    resolvedIndicesTrim[resolvedIndicesTrim.length - 1]!,
    dirTrim,
    which,
  )
  const refFrameSrc = seamEndFrame(refPiece.seamLine, viRef, viRef === resolvedIndicesRef[0], dRef)
  const trimFrameSrc = seamEndFrame(trimPiece.seamLine, viTrim, viTrim === resolvedIndicesTrim[0], dTrim)
  if (!refFrameSrc || !trimFrameSrc) return null
  const partnerFrame: SeamFrame = {
    origin: refFrameSrc.corner,
    u: { x: -refFrameSrc.past.x, y: -refFrameSrc.past.y },
    v: { x: refFrameSrc.square.x - refFrameSrc.corner.x, y: refFrameSrc.square.y - refFrameSrc.corner.y },
  }
  const trimFrame: SeamFrame = {
    origin: trimFrameSrc.corner,
    u: { x: -trimFrameSrc.past.x, y: -trimFrameSrc.past.y },
    v: { x: trimFrameSrc.square.x - trimFrameSrc.corner.x, y: trimFrameSrc.square.y - trimFrameSrc.corner.y },
  }
  const vLen = Math.hypot(trimFrame.v.x, trimFrame.v.y)
  const pvLen = Math.hypot(partnerFrame.v.x, partnerFrame.v.y)
  if (vLen < 1e-6 || pvLen < 1e-6) return null
  trimFrame.v = { x: trimFrame.v.x / vLen, y: trimFrame.v.y / vLen }
  partnerFrame.v = { x: partnerFrame.v.x / pvLen, y: partnerFrame.v.y / pvLen }

  const partnerRing = refPiece.cutLine.map((c) => overlayOnTrim(c.start, partnerFrame, trimFrame))
  const hit = trimPiece.cutLine.map((c) => {
    const uv = toFrame(c.start, trimFrame)
    return uv.x <= CORNER_MATCH_MM && uv.y > -2 && sticksOutOf(c.start, partnerRing)
  })
  const chain = contiguousHitChain(hit)
  if (!chain || chain.length === 0) return null

  const n = trimPiece.cutLine.length
  const prevVi = (chain[0]! - 1 + n) % n
  const nextVi = (chain[chain.length - 1]! + 1) % n
  const prevPt = vertexAt(trimPiece.cutLine, prevVi)
  const nextPt = vertexAt(trimPiece.cutLine, nextVi)
  const firstOut = vertexAt(trimPiece.cutLine, chain[0]!)
  const lastOut = vertexAt(trimPiece.cutLine, chain[chain.length - 1]!)
  const hitIn = nearestRingHit(prevPt, firstOut, partnerRing)
  const hitOut = nearestRingHit(nextPt, lastOut, partnerRing)
  if (!hitIn || !hitOut) return null

  const forward = arcAlongRing(partnerRing, hitIn.edge, hitOut.edge, hitIn.point, hitOut.point, 1)
  const backward = arcAlongRing(partnerRing, hitIn.edge, hitOut.edge, hitIn.point, hitOut.point, -1)
  const score = (pts: Point[]) => Math.max(...pts.map((p) => toFrame(p, trimFrame).x))
  const arc = score(forward) <= score(backward) ? forward : backward
  if (score(arc) > CORNER_MATCH_MM + 2) return null

  const newCut = replaceVertexChainWithPoints(trimPiece.cutLine, chain, arc)
  if (!newCut) return null
  const a0 = signedAreaCurves(trimPiece.cutLine)
  const a1 = signedAreaCurves(newCut)
  if (Math.abs(a1) < 1e-6 || a0 * a1 <= 0 || Math.abs(a1) > Math.abs(a0) + 0.5) return null

  const notches = resyncNotchesAfterCutLineRebuilt(trimPiece.notches, trimPiece.cutLine, newCut)
  return applySharpCornerPromotion({ ...trimPiece, cutLine: newCut, notches })
}

/** Beide Enden der Naht, Anfang an Anfang und Ende an Ende. */
function partnerTrimLongerMiterToShorter(
  refPiece: PatternPiece,
  trimPiece: PatternPiece,
  resolvedIndicesRef: number[],
  resolvedIndicesTrim: number[],
  dirRef: SeamMeasureDir,
  dirTrim: SeamMeasureDir,
): PatternPiece | null {
  let piece = trimPiece
  let changed = false
  for (const which of ['start', 'end'] as const) {
    const next = partnerTrimLongerMiterToShorterAtSeamEnd(
      refPiece,
      piece,
      resolvedIndicesRef,
      resolvedIndicesTrim,
      dirRef,
      dirTrim,
      which,
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
  resolvedIndicesB: number[],
  options?: { enabled?: boolean; measureDirA?: SeamMeasureDir; measureDirB?: SeamMeasureDir },
): { pieceA: PatternPiece; pieceB: PatternPiece } | null {
  const enabled = options?.enabled ?? SEAM_ASSIGNMENT_CUT_TRIM_ENABLED
  if (!enabled) return null
  const dirA = options?.measureDirA === -1 ? -1 : 1
  const dirB = options?.measureDirB === -1 ? -1 : options?.measureDirB === 1 ? 1 : -1

  let nextA = pieceA
  let nextB = pieceB
  const tB = partnerTrimLongerMiterToShorter(nextA, nextB, resolvedIndicesA, resolvedIndicesB, dirA, dirB)
  if (tB) nextB = tB
  const tA = partnerTrimLongerMiterToShorter(nextB, nextA, resolvedIndicesB, resolvedIndicesA, dirB, dirA)
  if (tA) nextA = tA
  if (!tA && !tB) return null

  return { pieceA: nextA, pieceB: nextB }
}

/**
 * Wendet die Nahtzuordnungs-Schnittkontur-Korrektur für **alle** Zuordnungen nacheinander an
 * (z. B. nach neuer Ableitung der cutLine aus der Naht — sonst fehlt der Zopf-Trim).
 */
export function reapplySeamAssignmentCutTrimsForAllPieces(
  pieces: PatternPiece[],
  seamAssignments: readonly SeamAssignment[],
  options?: { enabled?: boolean }
): { pieces: PatternPiece[]; changed: boolean } {
  if (seamAssignments.length === 0) return { pieces, changed: false }
  let next = pieces
  let changed = false
  for (const a of seamAssignments) {
    if (isInternalSeamAssignment(a)) continue
    const pieceA = next.find((p) => p.id === a.pieceIdA)
    const pieceB = next.find((p) => p.id === a.pieceIdB)
    if (!pieceA || !pieceB) continue
    const dirs = effectiveSeamMeasureDirs(a, pieceA, pieceB)
    const trimmed = applySeamAssignmentCutTrim(
      pieceA,
      pieceB,
      resolvedSeamAssignmentCurveIndices(pieceA, a.curveIndicesA),
      resolvedSeamAssignmentCurveIndices(pieceB, a.curveIndicesB),
      { ...options, measureDirA: dirs.dirA, measureDirB: dirs.dirB },
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

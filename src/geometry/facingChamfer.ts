import type { Curve, PatternPiece, Point } from '../types/model'
import { bezierAt, signedAreaCurves } from './curveToPath'
import { getEffectiveSoftVerticesCut } from './seamUtils'
import { interiorAngleAtVertexDegrees } from './softVertexPromotion'

const MIN_CHAMFER_MM = 0.5
/**
 * Nur echte Knicke chamfern. Tessellationspunkte entlang einer Kurve (Clipper-Offset)
 * sind nahezu kollinear (~180°) und würden sonst die gesamte Nahtzugabe „auffressen“.
 */
const MAX_INTERIOR_DEG_FOR_CHAMFER = 165
/** Max. Anteil der angrenzenden Cut-Kante, der pro Ecke abgeschnitten wird. */
const MAX_EDGE_TRIM_FRAC = 0.45
/** Mindestens so viel der Cut-Kante bleibt als paralleles Mittelstück (NZ sichtbar). */
const MIN_EDGE_FLAT_FRAC = 0.25
const MIN_EDGE_FLAT_MM = 8

function cloneCurves(curves: Curve[]): Curve[] {
  return curves.map((c) =>
    c.type === 'line'
      ? { type: 'line' as const, start: { ...c.start }, end: { ...c.end } }
      : {
          type: 'bezier' as const,
          start: { ...c.start },
          end: { ...c.end },
          cp1: { ...c.cp1 },
          cp2: { ...c.cp2 },
        }
  )
}

function vertexAt(curves: Curve[], vi: number): Point {
  const n = curves.length
  const i = ((vi % n) + n) % n
  return { ...curves[i].start }
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y
}

function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y }
}

function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y }
}

function scale(a: Point, s: number): Point {
  return { x: a.x * s, y: a.y * s }
}

/**
 * Zur Naht-Ecke S die passende **scharfe** Cut-Ecke (Miter-Spitze).
 * Unter scharfen Kandidaten die **nächste** (nicht die fernste): bei großer NZ könnten
 * sonst Nachbar-Ecken in Reichweite liegen und die Fase die NZ abschneiden.
 */
function bestSharpCutCornerForSeamVertex(
  cut: Curve[],
  S: Point,
  maxPairDist: number,
  softCut: Set<number>
): { index: number; dist: number; C: Point } | null {
  if (cut.length < 3) return null
  let best: { index: number; dist: number; C: Point } | null = null
  for (let i = 0; i < cut.length; i++) {
    if (softCut.has(i)) continue
    const C = vertexAt(cut, i)
    const d = Math.hypot(C.x - S.x, C.y - S.y)
    if (d < MIN_CHAMFER_MM || d > maxPairDist) continue
    const interiorDeg = interiorAngleAtVertexDegrees(cut, i)
    if (interiorDeg == null || interiorDeg > MAX_INTERIOR_DEG_FOR_CHAMFER) continue
    if (!best || d < best.dist) best = { index: i, dist: d, C }
  }
  return best
}

function maxSeamAllowanceMm(piece: PatternPiece): number {
  let max = piece.seamAllowanceMm ?? 0
  for (const e of piece.edgeSeamAllowances ?? []) {
    if (typeof e.mm === 'number' && Number.isFinite(e.mm)) max = Math.max(max, e.mm)
  }
  return max
}

/** Geschlossene Kontur → Punktring (Start jedes Segments). Bézier werden grob abgetastet. */
function curvesToRing(curves: Curve[]): Point[] {
  const ring: Point[] = []
  for (const c of curves) {
    if (c.type === 'line') {
      ring.push({ ...c.start })
    } else {
      const steps = 12
      for (let i = 0; i < steps; i++) {
        const t = i / steps
        ring.push(bezierAt(c, t))
      }
    }
  }
  return ring
}

function ringToLineCurves(ring: Point[]): Curve[] {
  if (ring.length < 3) return []
  const out: Curve[] = []
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-9) continue
    out.push({ type: 'line', start: { ...a }, end: { ...b } })
  }
  return out.length >= 3 ? out : []
}

/** Schnitt Gerade (P−S)·n = 0 mit Segment a→b; t in [0,1] oder null. */
function hitPlaneOnSegment(a: Point, b: Point, S: Point, nVec: Point): { point: Point; t: number } | null {
  const ab = sub(b, a)
  const denom = dot(ab, nVec)
  if (Math.abs(denom) < 1e-12) return null
  const t = dot(sub(S, a), nVec) / denom
  if (t < -1e-6 || t > 1 + 1e-6) return null
  const tc = Math.max(0, Math.min(1, t))
  return { point: add(a, scale(ab, tc)), t: tc }
}

/**
 * Punkt auf a→b in Abstand `trimMm` von b (Ecke) zurück.
 */
function pointBackFromEnd(a: Point, b: Point, trimMm: number): Point {
  const len = dist(a, b)
  if (len < 1e-12) return { ...b }
  const t = Math.max(0, Math.min(1, 1 - trimMm / len))
  return add(a, scale(sub(b, a), t))
}

function maxTrimForEdge(edgeLen: number): number {
  if (edgeLen < MIN_CHAMFER_MM * 2) return 0
  const minFlat = Math.min(Math.max(MIN_EDGE_FLAT_MM, edgeLen * MIN_EDGE_FLAT_FRAC), edgeLen * 0.5)
  const byFlat = Math.max(0, (edgeLen - minFlat) / 2)
  return Math.min(edgeLen * MAX_EDGE_TRIM_FRAC, byFlat)
}

/**
 * Lokale Fase an Ring-Ecke `cornerIdx`: ersetzt C durch T_prev und T_next,
 * begrenzt auf Kantenanteil — keine unendliche Halbebene (die die NZ mittig auffrisst).
 */
function localChamferRingCorner(ring: Point[], cornerIdx: number, S: Point): Point[] | null {
  const n = ring.length
  if (n < 3 || cornerIdx < 0 || cornerIdx >= n) return null
  const C = ring[cornerIdx]
  const prev = ring[(cornerIdx - 1 + n) % n]
  const next = ring[(cornerIdx + 1) % n]
  const nVec = sub(C, S)
  if (Math.hypot(nVec.x, nVec.y) < MIN_CHAMFER_MM) return null

  const lenPrev = dist(prev, C)
  const lenNext = dist(C, next)
  const maxPrev = maxTrimForEdge(lenPrev)
  const maxNext = maxTrimForEdge(lenNext)
  if (maxPrev < MIN_CHAMFER_MM || maxNext < MIN_CHAMFER_MM) return null

  // Zu kurze Kanten relativ zur Fase: lieber keine Fase als NZ-Kollaps beim Sync nach Parent-Edit
  const minEdge = Math.min(lenPrev, lenNext)
  const depth = Math.hypot(nVec.x, nVec.y)
  if (minEdge < depth * 1.25) return null

  // Ideal: Fase durch Naht-Ecke S
  const hitPrev = hitPlaneOnSegment(prev, C, S, nVec)
  const hitNext = hitPlaneOnSegment(C, next, S, nVec)

  let trimPrev = hitPrev ? dist(hitPrev.point, C) : maxPrev
  let trimNext = hitNext ? dist(hitNext.point, C) : maxNext
  trimPrev = Math.min(Math.max(trimPrev, MIN_CHAMFER_MM), maxPrev)
  trimNext = Math.min(Math.max(trimNext, MIN_CHAMFER_MM), maxNext)

  const tPrev = pointBackFromEnd(prev, C, trimPrev)
  const tNext = add(C, scale(sub(next, C), Math.min(1, trimNext / Math.max(lenNext, 1e-12))))

  if (dist(tPrev, tNext) < MIN_CHAMFER_MM) return null

  const out: Point[] = []
  for (let i = 0; i < n; i++) {
    if (i === cornerIdx) {
      out.push({ ...tPrev }, { ...tNext })
    } else {
      out.push({ ...ring[i] })
    }
  }
  return out
}

/**
 * Schneidet scharfe Ecken der **Schnittkontur** in der Nahtzugabe ab (lokale Fase).
 * Treiber: Naht-Ecken → passende scharfe Cut-Ecke. Kantenmitte behält parallele NZ.
 */
export function chamferCutLineCornersInSeamAllowance(piece: PatternPiece): Curve[] {
  const cut = piece.cutLine
  if (cut.length < 3) return cloneCurves(cut)

  const softCut = new Set(getEffectiveSoftVerticesCut(piece))
  const softMaster = new Set(piece.softVerticesMaster ?? [])
  const saDefault = piece.seamAllowanceMm ?? 0
  const maxSa = maxSeamAllowanceMm(piece)
  if (saDefault <= 0 && maxSa <= 0) {
    return cloneCurves(cut)
  }

  const seam = piece.seamLine.length >= 3 ? piece.seamLine : null
  if (!seam) return cloneCurves(cut)

  const maxPairDist = Math.max(maxSa, saDefault, 1) * 2.5 + 1

  type Corner = { ringIndex: number; S: Point }
  const corners: Corner[] = []

  // Ring 1:1 zu Line-Cut-Vertices (Clipper); Bézier-Cuts werden abgetastet — Index-Match nur bei Lines.
  const ring0 = curvesToRing(cut)
  const useVertexIndexAsRing = cut.every((c) => c.type === 'line') && ring0.length === cut.length

  for (let si = 0; si < seam.length; si++) {
    if (softMaster.has(si)) continue
    const interiorDeg = interiorAngleAtVertexDegrees(seam, si)
    if (interiorDeg == null || interiorDeg > MAX_INTERIOR_DEG_FOR_CHAMFER) continue

    const S = vertexAt(seam, si)
    const corner = bestSharpCutCornerForSeamVertex(cut, S, maxPairDist, softCut)
    if (!corner) continue

    let ringIndex = corner.index
    if (!useVertexIndexAsRing) {
      // Nächsten Ringpunkt zur Cut-Ecke suchen
      let best = 0
      let bestD = Infinity
      for (let i = 0; i < ring0.length; i++) {
        const d = dist(ring0[i], corner.C)
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
      if (bestD > maxPairDist) continue
      ringIndex = best
    }

    corners.push({ ringIndex, S: { ...S } })
  }

  if (corners.length === 0) return cloneCurves(cut)

  // Hohe Indizes zuerst: Einfügen (+1 Vertex) verschiebt nur höhere Indizes nicht die noch offenen.
  corners.sort((a, b) => b.ringIndex - a.ringIndex)

  let ring = ring0.map((p) => ({ ...p }))
  let applied = 0
  for (const c of corners) {
    const nextRing = localChamferRingCorner(ring, c.ringIndex, c.S)
    if (!nextRing) continue
    ring = nextRing
    applied++
  }

  if (applied === 0) return cloneCurves(cut)

  const cleaned: Point[] = []
  for (const p of ring) {
    const prev = cleaned[cleaned.length - 1]
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) >= 1e-4) cleaned.push(p)
  }
  if (
    cleaned.length >= 2 &&
    Math.hypot(cleaned[0].x - cleaned[cleaned.length - 1].x, cleaned[0].y - cleaned[cleaned.length - 1].y) <
      1e-4
  ) {
    cleaned.pop()
  }

  const out = ringToLineCurves(cleaned)
  if (out.length < 3) return cloneCurves(cut)

  const seamArea = Math.abs(signedAreaCurves(seam))
  const outArea = Math.abs(signedAreaCurves(out))
  if (seamArea >= 1 && outArea < seamArea * 1.02) {
    return cloneCurves(cut)
  }

  return out
}

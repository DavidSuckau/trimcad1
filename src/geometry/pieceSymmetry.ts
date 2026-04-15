import type { Curve, Point } from '../types/model'
// @ts-expect-error clipper-lib has no types
import ClipperLib from 'clipper-lib'
import { closedPointsToLineCurves, tessellateCurvesToPoints } from './offset'
import { samePoint } from './geometryConstants'
import { bezierAt } from './curveToPath'

const SCALE = 100000
const HALF_PLANE_EXTENT_MM = 1e7

type IntPoint = { X: number; Y: number }

function toIntPoint(p: Point): IntPoint {
  return new ClipperLib.IntPoint2(Math.round(p.x * SCALE), Math.round(p.y * SCALE))
}

function fromIntPoint(ip: IntPoint): Point {
  return { x: ip.X / SCALE, y: ip.Y / SCALE }
}

export function mirrorPointAcrossLine(p: Point, a: Point, b: Point): Point {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const len2 = vx * vx + vy * vy
  if (len2 < 1e-18) return { ...p }
  const t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2
  const projX = a.x + t * vx
  const projY = a.y + t * vy
  return { x: 2 * projX - p.x, y: 2 * projY - p.y }
}

export function mirrorCurveAcrossLine(c: Curve, a: Point, b: Point): Curve {
  if (c.type === 'line') {
    return {
      type: 'line',
      start: mirrorPointAcrossLine(c.start, a, b),
      end: mirrorPointAcrossLine(c.end, a, b),
    }
  }
  return {
    type: 'bezier',
    start: mirrorPointAcrossLine(c.start, a, b),
    end: mirrorPointAcrossLine(c.end, a, b),
    cp1: mirrorPointAcrossLine(c.cp1, a, b),
    cp2: mirrorPointAcrossLine(c.cp2, a, b),
  }
}

/** Kreuzprodukt (B−A) × (P−A); > 0: P links von der Geraden A→B (mathematisch positiv, y nach oben). */
export function crossZ(a: Point, b: Point, p: Point): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
}

/** `left` = Halbebene mit crossZ ≥ 0. */
export type PieceSymmetryKeepSide = 'left' | 'right'

export function pointInKeepHalfPlane(
  p: Point,
  axisA: Point,
  axisB: Point,
  keepSide: PieceSymmetryKeepSide
): boolean {
  const c = crossZ(axisA, axisB, p)
  const eps = 1e-6
  if (keepSide === 'left') return c >= -eps
  return c <= eps
}

export function curveReferencePoint(c: Curve): Point {
  if (c.type === 'line') {
    return { x: (c.start.x + c.end.x) / 2, y: (c.start.y + c.end.y) / 2 }
  }
  return bezierAt(c, 0.5)
}

/** Richtungswinkel (Grad) an einer Geraden spiegeln (2D). */
export function mirrorAngleDegrees(angleDeg: number, axisA: Point, axisB: Point): number {
  const rad = (angleDeg * Math.PI) / 180
  const vx = Math.cos(rad)
  const vy = Math.sin(rad)
  const ax = axisB.x - axisA.x
  const ay = axisB.y - axisA.y
  const len = Math.hypot(ax, ay)
  if (len < 1e-12) return angleDeg
  const tx = ax / len
  const ty = ay / len
  const nx = -ty
  const ny = tx
  const dot = vx * nx + vy * ny
  const vrx = vx - 2 * dot * nx
  const vry = vy - 2 * dot * ny
  return (Math.atan2(vry, vrx) * 180) / Math.PI
}

function signedAreaRing(pts: Point[]): number {
  let a = 0
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return a / 2
}

function largestPathByAbsArea(solution: IntPoint[][]): Point[] | null {
  if (solution.length === 0) return null
  let bestPts: Point[] | null = null
  let best = -1
  for (const path of solution) {
    if (path.length < 3) continue
    const pts = path.map(fromIntPoint)
    let ring = [...pts]
    if (ring.length > 1 && samePoint(ring[0], ring[ring.length - 1])) ring.pop()
    if (ring.length < 3) continue
    const area = Math.abs(signedAreaRing(ring))
    if (area > best) {
      best = area
      bestPts = pts
    }
  }
  return bestPts
}

/** Halbebene als Dreieck: Kante A–B + ein Punkt weit in Richtung der gewünschten Seite (crossZ / Clipper-windungsfest). */
function halfPlaneClipPolygon(a: Point, b: Point, keepSide: PieceSymmetryKeepSide): Point[] {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const len = Math.hypot(vx, vy)
  if (len < 1e-9) return []
  let nx = -vy / len
  let ny = vx / len
  if (keepSide === 'right') {
    nx = -nx
    ny = -ny
  }
  const R = HALF_PLANE_EXTENT_MM
  const M = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const c = { x: M.x + nx * R, y: M.y + ny * R }
  return [a, b, c]
}

function clipperExecute(
  subjectPaths: IntPoint[][],
  clipPaths: IntPoint[][],
  clipType: number,
  subjFill: number,
  clipFill: number
): IntPoint[][] {
  const c = new ClipperLib.Clipper()
  c.StrictlySimple = true
  for (const path of subjectPaths) {
    c.AddPath(path, ClipperLib.PolyType.ptSubject, true)
  }
  for (const path of clipPaths) {
    c.AddPath(path, ClipperLib.PolyType.ptClip, true)
  }
  const solution: IntPoint[][] = []
  c.Execute(clipType, solution, subjFill, clipFill)
  return solution
}

/** Union mehrerer Pfade; wiederholt bis stabil (zwei aneinandergrenzende Hälften können zuerst als zwei Pfade zurückkommen). */
function clipperUnionAll(paths: IntPoint[][], subjFill: number): IntPoint[][] {
  let merged = paths
  for (let iter = 0; iter < 12; iter++) {
    if (merged.length <= 1) break
    const c = new ClipperLib.Clipper()
    c.StrictlySimple = true
    for (const path of merged) {
      c.AddPath(path, ClipperLib.PolyType.ptSubject, true)
    }
    const solution: IntPoint[][] = []
    c.Execute(ClipperLib.ClipType.ctUnion, solution, subjFill, subjFill)
    if (solution.length === 0) return merged
    if (solution.length >= merged.length && iter > 0) break
    merged = solution
  }
  return merged
}

function ringToOpenPoints(ring: Point[]): Point[] {
  const out = [...ring]
  if (out.length > 1 && samePoint(out[0], out[out.length - 1])) out.pop()
  return out
}

function mirrorPathPoints(pts: Point[], a: Point, b: Point): Point[] {
  return pts.map((p) => mirrorPointAcrossLine(p, a, b))
}

export type PieceSymmetryContourResult =
  | { ok: true; curves: Curve[] }
  | { ok: false; message: string }

/**
 * Symmetrische geschlossene Kontur: behaltene Halbebene wird an der Achse gespiegelt und mit der behaltenen Hälfte vereinigt.
 */
export function buildSymmetricContour(
  masterCurves: Curve[],
  axisA: Point,
  axisB: Point,
  keepSide: PieceSymmetryKeepSide
): PieceSymmetryContourResult {
  if (masterCurves.length < 3) {
    return { ok: false, message: 'Kontur zu kurz für Symmetrie.' }
  }
  const dx = axisB.x - axisA.x
  const dy = axisB.y - axisA.y
  if (dx * dx + dy * dy < 1e-12) {
    return { ok: false, message: 'Spiegelachse: Punkte zu nah beieinander.' }
  }

  const polyPts = tessellateCurvesToPoints(masterCurves, 64)
  if (polyPts.length < 3) {
    return { ok: false, message: 'Kontur konnte nicht verarbeitet werden.' }
  }
  const ring = ringToOpenPoints(polyPts)
  if (ring.length < 3) {
    return { ok: false, message: 'Kontur zu wenig Punkte.' }
  }

  const subjectPath = ring.map(toIntPoint)
  const clipPoly = halfPlaneClipPolygon(axisA, axisB, keepSide)
  const clipPath = clipPoly.map(toIntPoint)

  const tryIntersection = (subj: IntPoint[], clip: IntPoint[]) =>
    clipperExecute([subj], [clip], ClipperLib.ClipType.ctIntersection, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)

  let intersection = tryIntersection(subjectPath, clipPath)
  if (intersection.length === 0 || !largestPathByAbsArea(intersection)) {
    intersection = tryIntersection(subjectPath, [...clipPath].reverse())
  }
  if (intersection.length === 0 || !largestPathByAbsArea(intersection)) {
    intersection = clipperExecute(
      [subjectPath],
      [clipPath],
      ClipperLib.ClipType.ctIntersection,
      ClipperLib.PolyFillType.pftEvenOdd,
      ClipperLib.PolyFillType.pftEvenOdd
    )
  }
  if (intersection.length === 0 || !largestPathByAbsArea(intersection)) {
    intersection = clipperExecute(
      [subjectPath],
      [[...clipPath].reverse()],
      ClipperLib.ClipType.ctIntersection,
      ClipperLib.PolyFillType.pftEvenOdd,
      ClipperLib.PolyFillType.pftEvenOdd
    )
  }

  if (intersection.length > 1) {
    return {
      ok: false,
      message: 'Symmetrie: Kontur wird durch die Achse in mehrere getrennte Flächen geteilt.',
    }
  }

  const keptArea = largestPathByAbsArea(intersection)
  if (!keptArea || keptArea.length < 3) {
    return {
      ok: false,
      message: 'Keine Schnittfläche auf der gewählten Seite — Achse prüfen (teilend?).',
    }
  }

  const kept = ringToOpenPoints(keptArea)
  const mirroredKept = mirrorPathPoints(kept, axisA, axisB)

  const path1 = kept.map(toIntPoint)
  const path2 = mirroredKept.map(toIntPoint)

  let unionSol = clipperUnionAll([path1, path2], ClipperLib.PolyFillType.pftNonZero)
  if (unionSol.length === 0) {
    unionSol = clipperUnionAll([path1, path2], ClipperLib.PolyFillType.pftEvenOdd)
  }

  const outArea = largestPathByAbsArea(unionSol)
  if (!outArea || outArea.length < 3) {
    return { ok: false, message: 'Vereinigung der gespiegelten Hälften fehlgeschlagen.' }
  }

  let outRing = ringToOpenPoints(outArea)
  const curves = closedPointsToLineCurves(outRing, 0.18)
  if (curves.length < 3) {
    return { ok: false, message: 'Ergebnis-Kontur ungültig.' }
  }
  return { ok: true, curves }
}

import type { BezierCurve, Curve, PatternPiece, Point } from '../types/model'
import { enumerateEdges, type EnumeratedEdge } from './edgeEnumeration'
import { getCurvesForSeamEdge } from './seamUtils'
import { masterEdgeIsStraightLine } from './horizontalLevelEdge'
// @ts-expect-error clipper-lib has no types
import ClipperLib from 'clipper-lib'
import { closedPointsToLineCurves, tessellateCurvesToPoints } from './offset'
import { samePoint } from './geometryConstants'
import { bezierAt, bezierDerivativeAt, curvesBounds, totalPathLength, splitBezierAt } from './curveToPath'

// —— Konstanten —————————————————————————————————————————————————————————————

const EPS_GEOMETRY = 1e-9
const EPS_LENGTH = 1e-12
const EPS_HALF_PLANE = 1e-6
const SCALE = 100_000
const TESS_SAMPLES_MIN = 16
const TESS_SAMPLES_MAX = 128
const TESS_SAMPLES_PER_MM = 0.85
/** Halbebene-Rechteck: Ausdehnung entlang/normal zur Achse (× Kontur-Diagonale). */
const HALF_PLANE_EXTENT_FACTOR = 20
/** Zusatzreserve für Halbebene-Rechteck relativ zu `baseExtent` (Punkte auf Kontur). */
const HALF_PLANE_CONTEXT_MARGIN = 1
/** Frühabbruch: Kontur liegt (fast) vollständig auf der Behalteseite. */
const FULL_KEEP_REL_TOLERANCE = 0.995
const FULL_KEEP_ABS_TOLERANCE_MM2 = 0.25
const UNION_FILLTYPE = ClipperLib.PolyFillType.pftNonZero
const UNION_MERGE_MAX_ITER = 8

type IntPoint = { X: number; Y: number }

// —— 1. Basisgeometrie ——————————————————————————————————————————————————————

function distSq(a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return dx * dx + dy * dy
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

function ringBounds(pts: Point[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (pts.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

function ringDiagonalMm(pts: Point[]): number {
  const b = ringBounds(pts)
  if (!b) return 1
  const w = b.maxX - b.minX
  const h = b.maxY - b.minY
  return Math.hypot(w, h) || 1
}

function ringToOpenPoints(ring: Point[]): Point[] {
  const out = [...ring]
  if (out.length > 1 && samePoint(out[0], out[out.length - 1])) out.pop()
  return out
}

function ensureCounterClockwiseOpenRing(pts: Point[]): Point[] {
  if (pts.length < 3) return pts
  return signedAreaRing(pts) < 0 ? [...pts].reverse() : [...pts]
}

/** Spiegelung kehrt die Orientierung um (det = −1); `.reverse()` stellt die Umlaufrichtung wieder her. */
function mirrorOpenRingForUnion(keptCcw: Point[], axisA: Point, axisB: Point): Point[] {
  const mirrored = [...mirrorPathPoints(keptCcw, axisA, axisB)].reverse()
  if (signedAreaRing(mirrored) < 0) mirrored.reverse()
  return mirrored
}

function isContourFullyOnKeepSide(fullArea: number, keptArea: number): boolean {
  if (fullArea <= EPS_GEOMETRY) return false
  const missing = fullArea - keptArea
  const absTol = Math.max(FULL_KEEP_ABS_TOLERANCE_MM2, fullArea * (1 - FULL_KEEP_REL_TOLERANCE))
  return missing <= absTol
}

function toIntPoint(p: Point): IntPoint {
  return new ClipperLib.IntPoint2(Math.round(p.x * SCALE), Math.round(p.y * SCALE))
}

function fromIntPoint(ip: IntPoint): Point {
  return { x: ip.X / SCALE, y: ip.Y / SCALE }
}

function intPathToOpenRing(path: IntPoint[]): Point[] | null {
  if (path.length < 3) return null
  return ringToOpenPoints(path.map(fromIntPoint))
}

export function mirrorPointAcrossLine(p: Point, a: Point, b: Point): Point {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const len2 = vx * vx + vy * vy
  if (len2 < EPS_LENGTH) return { ...p }
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
  if (len < EPS_LENGTH) return angleDeg
  const tx = ax / len
  const ty = ay / len
  const nx = -ty
  const ny = tx
  const dot = vx * nx + vy * ny
  const vrx = vx - 2 * dot * nx
  const vry = vy - 2 * dot * ny
  return (Math.atan2(vry, vrx) * 180) / Math.PI
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
  if (keepSide === 'left') return c >= -EPS_HALF_PLANE
  return c <= EPS_HALF_PLANE
}

/** Schnitt einer Geraden (A→B) mit einer achsenausgerichteten Bounding-Box (Liang–Barsky). */
export function clipLineToAxisAlignedRect(
  axisA: Point,
  axisB: Point,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): { p1: Point; p2: Point } | null {
  const dx = axisB.x - axisA.x
  const dy = axisB.y - axisA.y
  let t0 = -Infinity
  let t1 = Infinity
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < EPS_LENGTH) return q >= -EPS_GEOMETRY
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
    return true
  }
  if (!clip(-dx, axisA.x - minX)) return null
  if (!clip(dx, maxX - axisA.x)) return null
  if (!clip(-dy, axisA.y - minY)) return null
  if (!clip(dy, maxY - axisA.y)) return null
  if (t0 > t1) return null
  return {
    p1: { x: axisA.x + t0 * dx, y: axisA.y + t0 * dy },
    p2: { x: axisA.x + t1 * dx, y: axisA.y + t1 * dy },
  }
}

/** Spiegelachse auf die Ausdehnung der Teil-Kontur beschränken (für Anzeige). */
export function symmetryAxisClippedToPieceBounds(
  axisA: Point,
  axisB: Point,
  curves: Curve[],
  paddingMm = 0
): { p1: Point; p2: Point } | null {
  const bounds = curvesBounds(curves)
  if (!bounds) return null
  return clipLineToAxisAlignedRect(
    axisA,
    axisB,
    bounds.minX - paddingMm,
    bounds.minY - paddingMm,
    bounds.maxX + paddingMm,
    bounds.maxY + paddingMm
  )
}

// —— 2. Achsenfunktionen ————————————————————————————————————————————————————

function tangentAxisExtentMm(curves: Curve[]): number {
  const bounds = curvesBounds(curves)
  if (!bounds) return HALF_PLANE_EXTENT_FACTOR * 100
  const w = bounds.maxX - bounds.minX
  const h = bounds.maxY - bounds.minY
  return Math.hypot(w, h) * HALF_PLANE_EXTENT_FACTOR
}

function axisEndpointsAlongTangent(px: number, py: number, tx: number, ty: number, extent: number): {
  axisA: Point
  axisB: Point
} {
  return {
    axisA: { x: px - tx * extent, y: py - ty * extent },
    axisB: { x: px + tx * extent, y: py + ty * extent },
  }
}

/** Spiegelachse für interne Linie: Sehne von Kurvenstart zu -ende (auch bei Bézier). */
export function symmetryAxisEndpointsFromInternalCurve(c: Curve): { axisA: Point; axisB: Point } {
  return { axisA: { ...c.start }, axisB: { ...c.end } }
}

/**
 * Spiegelachse entlang einer **geraden** Kante der Master-Kontur (Seam bei NZ, sonst Cut).
 * `null`, wenn die Kante kein reines Liniensegment ist (z. B. Bézier).
 */
export function symmetryAxisEndpointsFromStraightMasterEdge(
  piece: PatternPiece,
  edgeIndex: number
): { axisA: Point; axisB: Point } | null {
  const edges = enumerateEdges(piece)
  const edge = edges.find((e) => e.edgeIndex === edgeIndex)
  if (!edge) return null
  const masterK = getCurvesForSeamEdge(piece)
  const curves = edge.curveIndices.map((ci) => masterK[ci]).filter(Boolean) as Curve[]
  if (curves.length === 0) return null
  for (const seg of curves) {
    if (seg.type === 'bezier') return null
  }
  const first = curves[0] as Extract<Curve, { type: 'line' }>
  const last = curves[curves.length - 1] as Extract<Curve, { type: 'line' }>
  return { axisA: { ...first.start }, axisB: { ...last.end } }
}

/**
 * Spiegelachse = Tangente der Kontur am Trefferpunkt (Orthogonalprojektion der Maus auf die Kurve).
 */
export function symmetryAxisEndpointsFromCurveTangentHit(
  curves: Curve[],
  curveIndex: number,
  t: number
): { axisA: Point; axisB: Point } | null {
  const c = curves[curveIndex]
  if (!c) return null
  const extent = tangentAxisExtentMm(curves)
  if (c.type === 'line') {
    const dx = c.end.x - c.start.x
    const dy = c.end.y - c.start.y
    const len = Math.hypot(dx, dy)
    if (len < EPS_LENGTH) return null
    const clampedT = Math.max(0, Math.min(1, t))
    const px = c.start.x + clampedT * dx
    const py = c.start.y + clampedT * dy
    return axisEndpointsAlongTangent(px, py, dx / len, dy / len, extent)
  }
  const clampedT = Math.max(0, Math.min(1, t))
  const p = bezierAt(c, clampedT)
  const d = bezierDerivativeAt(c, clampedT)
  const len = Math.hypot(d.x, d.y)
  if (len < EPS_LENGTH) return null
  return axisEndpointsAlongTangent(p.x, p.y, d.x / len, d.y / len, extent)
}

/**
 * Spiegelachse nach Kantenwahl: rein gerade Master-Kante = Sehne Ecke–Ecke; sonst Tangente am
 * nächsten Punkt (`curveHitIndex`, `t`) auf der Kontur.
 */
export function symmetryAxisFromMasterEdgePick(
  piece: PatternPiece,
  edge: EnumeratedEdge,
  curveHitIndex: number,
  curveHitT: number
): { axisA: Point; axisB: Point } | null {
  const masterK = getCurvesForSeamEdge(piece)
  if (!edge.curveIndices.includes(curveHitIndex)) return null
  if (masterEdgeIsStraightLine(masterK, edge)) {
    return symmetryAxisEndpointsFromStraightMasterEdge(piece, edge.edgeIndex)
  }
  return symmetryAxisEndpointsFromCurveTangentHit(masterK, curveHitIndex, curveHitT)
}

// —— 3. Polygonisierung ————————————————————————————————————————————————————
// Langfristig: krümmungsbasierte Unterteilung (max. Abstand zur Bézier), sobald
// tessellateCurvesToPoints das unterstützt.

function adaptiveTessellationSamples(curves: Curve[]): number {
  const perimeter = totalPathLength(curves)
  const byLength = Math.ceil(perimeter * TESS_SAMPLES_PER_MM)
  return Math.max(TESS_SAMPLES_MIN, Math.min(TESS_SAMPLES_MAX, byLength))
}

function polygonizeContour(curves: Curve[]): Point[] | null {
  const samples = adaptiveTessellationSamples(curves)
  const polyPts = tessellateCurvesToPoints(curves, samples)
  if (polyPts.length < 3) return null
  const ring = ringToOpenPoints(polyPts)
  return ring.length >= 3 ? ring : null
}

function pointsToClipperPath(pts: Point[]): IntPoint[] {
  return pts.map(toIntPoint)
}

function openRingsFromSolution(solution: IntPoint[][]): Point[][] {
  const out: Point[][] = []
  for (const path of solution) {
    const ring = intPathToOpenRing(path)
    if (ring && ring.length >= 3) out.push(ring)
  }
  return out
}

// —— 4. Clipper-Hilfen ——————————————————————————————————————————————————————

function runClipper(
  subjectPaths: IntPoint[][],
  clipPaths: IntPoint[][],
  clipType: number
): IntPoint[][] {
  const c = new ClipperLib.Clipper()
  c.StrictlySimple = true
  if (subjectPaths.length > 0) {
    c.AddPaths(subjectPaths, ClipperLib.PolyType.ptSubject, true)
  }
  if (clipPaths.length > 0) {
    c.AddPaths(clipPaths, ClipperLib.PolyType.ptClip, true)
  }
  const solution: IntPoint[][] = []
  c.Execute(clipType, solution, UNION_FILLTYPE, UNION_FILLTYPE)
  return solution
}

function executeIntersection(subjectPaths: IntPoint[][], clipPaths: IntPoint[][]): IntPoint[][] {
  return runClipper(subjectPaths, clipPaths, ClipperLib.ClipType.ctIntersection)
}

function executeUnion(paths: IntPoint[][]): IntPoint[][] {
  if (paths.length === 0) return []
  const c = new ClipperLib.Clipper()
  c.StrictlySimple = true
  c.AddPaths(paths, ClipperLib.PolyType.ptSubject, true)
  const solution: IntPoint[][] = []
  c.Execute(ClipperLib.ClipType.ctUnion, solution, UNION_FILLTYPE, UNION_FILLTYPE)
  return solution
}

function unionSolutionFingerprint(solution: IntPoint[][]): string {
  const parts = solution
    .map((path) => {
      const ring = intPathToOpenRing(path)
      if (!ring) return '0:0'
      const area = Math.round(Math.abs(signedAreaRing(ring)) * 1000)
      return `${ring.length}:${area}`
    })
    .sort()
  return `${solution.length}|${parts.join(';')}`
}

/** Vereinigt alle Pfade; Abbruch wenn sich Anzahl, Flächen und Eckzahlen nicht mehr ändern. */
function executeUnionUntilStable(paths: IntPoint[][]): IntPoint[][] {
  let merged = paths.filter((p) => p.length >= 3)
  if (merged.length <= 1) return merged

  let prevFp = unionSolutionFingerprint(merged)
  for (let iter = 0; iter < UNION_MERGE_MAX_ITER; iter++) {
    const next = executeUnion(merged)
    if (next.length === 0) return merged
    const nextFp = unionSolutionFingerprint(next)
    if (nextFp === prevFp) return next
    prevFp = nextFp
    merged = next
  }
  return merged
}

function largestPathByAbsArea(solution: IntPoint[][]): Point[] | null {
  if (solution.length === 0) return null
  let bestPts: Point[] | null = null
  let best = -1
  for (const path of solution) {
    const ring = intPathToOpenRing(path)
    if (!ring) continue
    const area = Math.abs(signedAreaRing(ring))
    if (area > best) {
      best = area
      bestPts = ring
    }
  }
  return bestPts
}

function totalAbsArea(solution: IntPoint[][]): number {
  let sum = 0
  for (const path of solution) {
    const ring = intPathToOpenRing(path)
    if (ring) sum += Math.abs(signedAreaRing(ring))
  }
  return sum
}

/**
 * Halbebene als großes Rechteck: Achse als eine Kante, Ausdehnung in Normalenrichtung.
 * Kontext-Ring bestimmt die minimale Ausdehnung (Diagonale × Faktor, schräge Achsen).
 */
function halfPlaneClipRectangle(
  axisA: Point,
  axisB: Point,
  keepSide: PieceSymmetryKeepSide,
  contextRing: Point[]
): Point[] {
  const vx = axisB.x - axisA.x
  const vy = axisB.y - axisA.y
  const axisLen = Math.hypot(vx, vy)
  if (axisLen < EPS_GEOMETRY) return []

  const tx = vx / axisLen
  const ty = vy / axisLen
  let nx = -ty
  let ny = tx
  if (keepSide === 'right') {
    nx = -nx
    ny = -ny
  }

  const baseExtent = ringDiagonalMm(contextRing) * HALF_PLANE_EXTENT_FACTOR
  let extentAlong = baseExtent + axisLen
  let extentNormal = baseExtent

  for (const p of contextRing) {
    const relX = p.x - axisA.x
    const relY = p.y - axisA.y
    const along = relX * tx + relY * ty
    const normal = relX * nx + relY * ny
    extentAlong = Math.max(extentAlong, Math.abs(along) + baseExtent * HALF_PLANE_CONTEXT_MARGIN)
    if (normal > -EPS_HALF_PLANE) {
      extentNormal = Math.max(extentNormal, normal + baseExtent * HALF_PLANE_CONTEXT_MARGIN)
    }
  }

  const aBack = { x: axisA.x - tx * extentAlong, y: axisA.y - ty * extentAlong }
  const bFwd = { x: axisB.x + tx * extentAlong, y: axisB.y + ty * extentAlong }
  const bFar = { x: bFwd.x + nx * extentNormal, y: bFwd.y + ny * extentNormal }
  const aFar = { x: aBack.x + nx * extentNormal, y: aBack.y + ny * extentNormal }

  return [aBack, bFwd, bFar, aFar]
}

/** Halbebene-Clippolygone für UI (Vorlagen- vs. gespiegelte Seite). */
export function getSymmetryHalfPlaneClipPolygons(
  axisA: Point,
  axisB: Point,
  keepSide: PieceSymmetryKeepSide,
  contextCurves: Curve[]
): { keep: Point[]; mirror: Point[] } | null {
  const bounds = curvesBounds(contextCurves)
  if (!bounds) return null
  const ring: Point[] = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ]
  const keep = halfPlaneClipRectangle(axisA, axisB, keepSide, ring)
  const mirrorSide: PieceSymmetryKeepSide = keepSide === 'left' ? 'right' : 'left'
  const mirror = halfPlaneClipRectangle(axisA, axisB, mirrorSide, ring)
  if (keep.length < 3 || mirror.length < 3) return null
  return { keep, mirror }
}

export function symmetryClipPolygonPointsAttr(pts: Point[]): string {
  return pts.map((p) => `${p.x},${p.y}`).join(' ')
}

// —— 5. Symmetriealgorithmus ————————————————————————————————————————————————

export type PieceSymmetryContourResult =
  | { ok: true; curves: Curve[] }
  | { ok: false; message: string }

function mirrorPathPoints(pts: Point[], a: Point, b: Point): Point[] {
  return pts.map((p) => mirrorPointAcrossLine(p, a, b))
}

function unionKeptAndMirroredHalves(
  keptRings: Point[][],
  axisA: Point,
  axisB: Point
): Point[] | null {
  const paths: IntPoint[][] = []
  for (const ring of keptRings) {
    const kept = ensureCounterClockwiseOpenRing(ring)
    paths.push(pointsToClipperPath(kept))
    paths.push(pointsToClipperPath(mirrorOpenRingForUnion(kept, axisA, axisB)))
  }
  const unionSol = executeUnionUntilStable(paths)
  if (unionSol.length === 0) return null
  if (unionSol.length > 1) {
    console.warn(
      `[pieceSymmetry] Vereinigung lieferte ${unionSol.length} getrennte Polygone (Fläche gesamt ${totalAbsArea(unionSol).toFixed(1)} mm²).`,
    )
  }
  return largestPathByAbsArea(unionSol)
}

type HalfSide = 'keep' | 'mirror' | 'axis'

function pointHalfSide(
  p: Point,
  axisA: Point,
  axisB: Point,
  keepSide: PieceSymmetryKeepSide
): HalfSide {
  const cz = crossZ(axisA, axisB, p)
  if (Math.abs(cz) < EPS_HALF_PLANE * 1000 + 0.05) return 'axis'
  return pointInKeepHalfPlane(p, axisA, axisB, keepSide) ? 'keep' : 'mirror'
}

function nearPt(a: Point, b: Point, eps = 0.15): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= eps
}

function cloneSymCurve(c: Curve): Curve {
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

function reverseSymCurve(c: Curve): Curve {
  if (c.type === 'line') {
    return { type: 'line', start: { ...c.end }, end: { ...c.start } }
  }
  return {
    type: 'bezier',
    start: { ...c.end },
    end: { ...c.start },
    cp1: { ...c.cp2 },
    cp2: { ...c.cp1 },
  }
}

/** Schnitt Gerade P0→P1 mit Achse A→B; t in (0,1) oder null. */
function lineSegmentAxisHit(
  p0: Point,
  p1: Point,
  axisA: Point,
  axisB: Point
): { point: Point; t: number } | null {
  const dx = p1.x - p0.x
  const dy = p1.y - p0.y
  const ax = axisB.x - axisA.x
  const ay = axisB.y - axisA.y
  const denom = dx * ay - dy * ax
  if (Math.abs(denom) < EPS_GEOMETRY) return null
  const ex = axisA.x - p0.x
  const ey = axisA.y - p0.y
  const t = (ex * ay - ey * ax) / denom
  const u = (ex * dy - ey * dx) / denom
  if (t < 1e-6 || t > 1 - 1e-6) return null
  if (u < -0.05 || u > 1.05) return null
  return { point: { x: p0.x + t * dx, y: p0.y + t * dy }, t }
}

/** Erster Achsen-Schnitt einer Bézier (Abtastung); t in (0,1) oder null. */
function bezierAxisHitT(b: BezierCurve, axisA: Point, axisB: Point, keepSide: PieceSymmetryKeepSide): number | null {
  const steps = 48
  let prev = pointHalfSide(b.start, axisA, axisB, keepSide)
  let prevT = 0
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const side = pointHalfSide(bezierAt(b, t), axisA, axisB, keepSide)
    if (prev !== 'axis' && side !== 'axis' && prev !== side) {
      let lo = prevT
      let hi = t
      for (let k = 0; k < 20; k++) {
        const mid = (lo + hi) / 2
        const ms = pointHalfSide(bezierAt(b, mid), axisA, axisB, keepSide)
        if (ms === 'axis' || ms !== prev) hi = mid
        else lo = mid
      }
      const hit = (lo + hi) / 2
      if (hit > 1e-4 && hit < 1 - 1e-4) return hit
    }
    if (side !== 'axis') prev = side
    prevT = t
  }
  return null
}

/**
 * Keep-Anteile einer Kurve (Reihenfolge entlang der Kurve).
 * Markiert, ob Start/Ende durch Achsen-Schnitt entstanden (→ weiche Punkte).
 */
function keepPortionsOfCurve(
  c: Curve,
  axisA: Point,
  axisB: Point,
  keepSide: PieceSymmetryKeepSide
): { curve: Curve; splitStart: boolean; splitEnd: boolean }[] {
  const s0 = pointHalfSide(c.start, axisA, axisB, keepSide)
  const s1 = pointHalfSide(c.end, axisA, axisB, keepSide)

  if (s0 === 'mirror' && s1 === 'mirror') {
    // Bézier kann trotzdem die Achse kreuzen (beide Enden auf Mirror)
    if (c.type === 'bezier') {
      const tHit = bezierAxisHitT(c, axisA, axisB, keepSide)
      if (tHit != null) {
        const [a, b] = splitBezierAt(c, tHit)
        return [
          ...keepPortionsOfCurve(a, axisA, axisB, keepSide),
          ...keepPortionsOfCurve(b, axisA, axisB, keepSide),
        ]
      }
    }
    return []
  }

  if (s0 !== 'mirror' && s1 !== 'mirror') {
    // komplett keep oder Achse; Bézier-Ausbuchtung zur Mirror-Seite prüfen
    if (c.type === 'bezier') {
      const mid = pointHalfSide(bezierAt(c, 0.5), axisA, axisB, keepSide)
      if (mid === 'mirror') {
        const tHit = bezierAxisHitT(c, axisA, axisB, keepSide)
        if (tHit != null) {
          const [a, b] = splitBezierAt(c, tHit)
          return [
            ...keepPortionsOfCurve(a, axisA, axisB, keepSide),
            ...keepPortionsOfCurve(b, axisA, axisB, keepSide),
          ]
        }
      }
    }
    if (s0 === 'axis' && s1 === 'axis') {
      // reine Achsen-Sehne: nicht Teil der Außenkontur
      return []
    }
    return [{ curve: cloneSymCurve(c), splitStart: s0 === 'axis', splitEnd: s1 === 'axis' }]
  }

  // Kreuzung keep ↔ mirror
  if (c.type === 'line') {
    const hit = lineSegmentAxisHit(c.start, c.end, axisA, axisB)
    if (!hit) {
      return s0 === 'keep' || s0 === 'axis'
        ? [{ curve: cloneSymCurve(c), splitStart: false, splitEnd: false }]
        : []
    }
    if (s0 === 'keep' || s0 === 'axis') {
      return [
        {
          curve: { type: 'line', start: { ...c.start }, end: { ...hit.point } },
          splitStart: s0 === 'axis',
          splitEnd: true,
        },
      ]
    }
    return [
      {
        curve: { type: 'line', start: { ...hit.point }, end: { ...c.end } },
        splitStart: true,
        splitEnd: s1 === 'axis',
      },
    ]
  }

  const tHit = bezierAxisHitT(c, axisA, axisB, keepSide)
  if (tHit == null) {
    return s0 === 'keep' || s0 === 'axis'
      ? [{ curve: cloneSymCurve(c), splitStart: false, splitEnd: false }]
      : []
  }
  const [left, right] = splitBezierAt(c, tHit)
  if (s0 === 'keep' || s0 === 'axis') {
    return [{ curve: left, splitStart: s0 === 'axis', splitEnd: true }]
  }
  return [{ curve: right, splitStart: true, splitEnd: s1 === 'axis' }]
}

export type SymmetricContourPreserveResult = {
  curves: Curve[]
  /** Vertex-Indizes, die durch Achsen-Schnitt entstanden (sollten weich sein). */
  softFromAxisSplit: number[]
}

/**
 * Symmetrische Kontur unter Erhalt von Bézier/Linien (kein Clipper-Tessellat).
 * Keep-Halbebene + Spiegelung; Achsen-Schnittpunkte als weiche Vertices.
 */
export function buildSymmetricContourPreservingCurves(
  masterCurves: Curve[],
  axisA: Point,
  axisB: Point,
  keepSide: PieceSymmetryKeepSide
): SymmetricContourPreserveResult | null {
  if (masterCurves.length < 3) return null
  if (distSq(axisA, axisB) < EPS_LENGTH) return null

  // Wie Clipper: wenn die Kontur schon ganz auf der Keep-Seite liegt (Achse am Rand),
  // nichts spiegeln. Halbteil an der Achse hat kleinere Keep-Fläche → weiter spiegeln.
  const ring = polygonizeContour(masterCurves)
  if (ring) {
    const clipPoly = halfPlaneClipRectangle(axisA, axisB, keepSide, ring)
    if (clipPoly.length >= 4) {
      const intersection = executeIntersection(
        [pointsToClipperPath(ring)],
        [pointsToClipperPath(clipPoly)]
      )
      if (intersection.length > 0) {
        const keptMerged = executeUnionUntilStable(intersection)
        const fullArea = Math.abs(signedAreaRing(ring))
        const keptArea = totalAbsArea(keptMerged)
        if (isContourFullyOnKeepSide(fullArea, keptArea)) {
          return { curves: masterCurves.map(cloneSymCurve), softFromAxisSplit: [] }
        }
      }
    }
  }

  type Part = { curve: Curve; splitStart: boolean; splitEnd: boolean }
  const parts: Part[] = []
  for (const c of masterCurves) {
    parts.push(...keepPortionsOfCurve(c, axisA, axisB, keepSide))
  }
  if (parts.length === 0) return null

  // Ketten verbinden (Endpunkt → Start)
  const chains: Part[][] = []
  let cur: Part[] = [parts[0]!]
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i]!
    const prev = cur[cur.length - 1]!
    if (nearPt(prev.curve.end, p.curve.start)) {
      cur.push(p)
    } else {
      chains.push(cur)
      cur = [p]
    }
  }
  chains.push(cur)

  // Eine offene Kette von Achse→Achse: ggf. Ketten am gemeinsamen Endpunkt rotieren/verknüpfen
  let chain = chains[0]!
  if (chains.length > 1) {
    // Versuche, alle keep-Teile zu einer Kette zu verbinden, deren Enden auf der Achse liegen
    const unused = chains.slice(1)
    let guard = 0
    while (unused.length > 0 && guard++ < 64) {
      const head = chain[0]!.curve.start
      const tail = chain[chain.length - 1]!.curve.end
      let linked = false
      for (let i = 0; i < unused.length; i++) {
        const other = unused[i]!
        const oHead = other[0]!.curve.start
        const oTail = other[other.length - 1]!.curve.end
        if (nearPt(tail, oHead)) {
          chain = [...chain, ...other]
          unused.splice(i, 1)
          linked = true
          break
        }
        if (nearPt(head, oTail)) {
          chain = [...other, ...chain]
          unused.splice(i, 1)
          linked = true
          break
        }
        if (nearPt(tail, oTail)) {
          chain = [...chain, ...other.map((p) => ({
            curve: reverseSymCurve(p.curve),
            splitStart: p.splitEnd,
            splitEnd: p.splitStart,
          })).reverse()]
          unused.splice(i, 1)
          linked = true
          break
        }
        if (nearPt(head, oHead)) {
          chain = [
            ...other
              .map((p) => ({
                curve: reverseSymCurve(p.curve),
                splitStart: p.splitEnd,
                splitEnd: p.splitStart,
              }))
              .reverse(),
            ...chain,
          ]
          unused.splice(i, 1)
          linked = true
          break
        }
      }
      if (!linked) break
    }
    if (unused.length > 0) return null
  }

  const start = chain[0]!.curve.start
  const end = chain[chain.length - 1]!.curve.end
  const startOnAxis = pointHalfSide(start, axisA, axisB, keepSide) === 'axis'
  const endOnAxis = pointHalfSide(end, axisA, axisB, keepSide) === 'axis'
  if (!startOnAxis || !endOnAxis) return null
  if (nearPt(start, end)) return null // degeneriert

  // Keep-Kette + gespiegelte Umkehrung (Achsenpunkte bleiben)
  const keepCurves = chain.map((p) => cloneSymCurve(p.curve))
  const mirrored = keepCurves
    .map((c) => reverseSymCurve(mirrorCurveAcrossLine(c, axisA, axisB)))
    .reverse()

  const out: Curve[] = [...keepCurves, ...mirrored]
  // Endpunkte snappen
  for (let i = 0; i < out.length; i++) {
    const next = out[(i + 1) % out.length]!
    if (!nearPt(out[i]!.end, next.start, 0.25)) {
      // erzwingen
      const mid = {
        x: (out[i]!.end.x + next.start.x) / 2,
        y: (out[i]!.end.y + next.start.y) / 2,
      }
      out[i] = { ...out[i]!, end: mid } as Curve
      out[(i + 1) % out.length] = { ...next, start: mid } as Curve
    }
  }

  const softFromAxisSplit: number[] = []
  const n = out.length
  // Vertex i = start of out[i]; Achsen-Splits aus keep-Kette + gespiegelte Partner
  for (let i = 0; i < keepCurves.length; i++) {
    const part = chain[i]!
    if (part.splitStart) softFromAxisSplit.push(i)
    if (part.splitEnd) softFromAxisSplit.push((i + 1) % n)
  }
  // Spiegel-Partner der keep-Vertices: Index in der zweiten Hälfte
  // keep vertex i ↔ mirror vertex (n - i) % n  (bei offener Kette Länge k: mirror starts at k)
  const k = keepCurves.length
  for (const vi of [...softFromAxisSplit]) {
    if (vi < k) {
      const mirrorVi = (n - vi) % n
      softFromAxisSplit.push(mirrorVi)
    }
  }

  return {
    curves: out,
    softFromAxisSplit: [...new Set(softFromAxisSplit)].sort((a, b) => a - b),
  }
}

/**
 * Symmetrische geschlossene Kontur: behaltene Halbebene wird an der Achse gespiegelt und vereinigt.
 * Bevorzugt kurven-erhaltend (Bézier bleiben); Clipper nur als Fallback.
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
  if (distSq(axisA, axisB) < EPS_LENGTH) {
    return { ok: false, message: 'Spiegelachse: Punkte zu nah beieinander.' }
  }

  const preserved = buildSymmetricContourPreservingCurves(masterCurves, axisA, axisB, keepSide)
  if (preserved && preserved.curves.length >= 3) {
    return { ok: true, curves: preserved.curves }
  }

  const ring = polygonizeContour(masterCurves)
  if (!ring) {
    return { ok: false, message: 'Kontur konnte nicht verarbeitet werden.' }
  }

  const clipPoly = halfPlaneClipRectangle(axisA, axisB, keepSide, ring)
  if (clipPoly.length < 4) {
    return { ok: false, message: 'Halbebene konnte nicht erzeugt werden.' }
  }

  const intersection = executeIntersection([pointsToClipperPath(ring)], [pointsToClipperPath(clipPoly)])
  if (intersection.length === 0) {
    return {
      ok: false,
      message: 'Keine Schnittfläche auf der gewählten Seite — Achse prüfen (teilend?).',
    }
  }

  const keptMerged = executeUnionUntilStable(intersection)
  const keptRings = openRingsFromSolution(keptMerged)
  if (keptRings.length === 0) {
    return {
      ok: false,
      message: 'Keine Schnittfläche auf der gewählten Seite — Achse prüfen (teilend?).',
    }
  }

  const fullArea = Math.abs(signedAreaRing(ring))
  const keptArea = totalAbsArea(keptMerged)
  if (isContourFullyOnKeepSide(fullArea, keptArea)) {
    return { ok: true, curves: masterCurves }
  }

  if (keptMerged.length > 1) {
    console.warn(
      `[pieceSymmetry] Schnitt lieferte ${keptMerged.length} Teilpolygone — alle werden gespiegelt und vereinigt.`,
    )
  }

  const outRing = unionKeptAndMirroredHalves(keptRings, axisA, axisB)
  if (!outRing || outRing.length < 3) {
    return { ok: false, message: 'Vereinigung der gespiegelten Hälften fehlgeschlagen.' }
  }

  const curves = closedPointsToLineCurves(outRing, 0.18)
  if (curves.length < 3) {
    return { ok: false, message: 'Ergebnis-Kontur ungültig.' }
  }
  return { ok: true, curves }
}

import type { Curve, Point } from '../types/model'
import { bezierAt, outwardNormalAngleAt, signedAreaCurves, curvesBounds } from './curveToPath'
// @ts-expect-error clipper-lib has no types
import ClipperLib from 'clipper-lib'

const SCALE = 10000

type IntPoint = { X: number; Y: number }

function toIntPoint(p: Point): IntPoint {
  return new ClipperLib.IntPoint2(Math.round(p.x * SCALE), Math.round(p.y * SCALE))
}

function fromIntPoint(ip: IntPoint): Point {
  return { x: ip.X / SCALE, y: ip.Y / SCALE }
}

const BEZIER_SAMPLES = 64

export type OffsetOptions = {
  joinType?: 'miter' | 'round' | 'square'
  miterLimit?: number
}

function samePoint(a: Point, b: Point, eps = 1e-6): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps
}

/** Kurven in Punktliste umwandeln; Bézier wird fein abgetastet, damit die Naht oben der Kurve folgt. */
function curvesToPoints(curves: Curve[]): Point[] {
  const out: Point[] = []
  for (const c of curves) {
    if (c.type === 'line') {
      if (out.length === 0 || !samePoint(out[out.length - 1], c.start)) {
        out.push({ ...c.start })
      }
      out.push({ ...c.end })
    } else {
      if (out.length === 0 || !samePoint(out[out.length - 1], c.start)) {
        out.push({ ...c.start })
      }
      for (let i = 1; i < BEZIER_SAMPLES; i++) {
        out.push(bezierAt(c, i / BEZIER_SAMPLES))
      }
      out.push({ ...c.end })
    }
  }
  return out
}

/** Convert points to line segments (Curve[]). */
function pointsToLineCurves(pts: Point[]): Curve[] {
  const out: Curve[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    out.push({ type: 'line', start: pts[i], end: pts[i + 1] })
  }
  return out
}

/** Douglas-Peucker: reduces a point list while keeping the shape within tolerance. */
function simplifyPoints(pts: Point[], tolerance: number): Point[] {
  if (pts.length <= 2) return pts
  let maxDist = 0
  let maxIdx = 0
  const first = pts[0]
  const last = pts[pts.length - 1]
  const dx = last.x - first.x
  const dy = last.y - first.y
  const lenSq = dx * dx + dy * dy
  for (let i = 1; i < pts.length - 1; i++) {
    let dist: number
    if (lenSq < 1e-12) {
      dist = Math.hypot(pts[i].x - first.x, pts[i].y - first.y)
    } else {
      const t = ((pts[i].x - first.x) * dx + (pts[i].y - first.y) * dy) / lenSq
      const projX = first.x + t * dx
      const projY = first.y + t * dy
      dist = Math.hypot(pts[i].x - projX, pts[i].y - projY)
    }
    if (dist > maxDist) {
      maxDist = dist
      maxIdx = i
    }
  }
  if (maxDist > tolerance) {
    const left = simplifyPoints(pts.slice(0, maxIdx + 1), tolerance)
    const right = simplifyPoints(pts.slice(maxIdx), tolerance)
    return [...left.slice(0, -1), ...right]
  }
  return [first, last]
}

/** Simplify a closed polygon: apply Douglas-Peucker on the ring. */
function simplifyClosedPolygon(pts: Point[], tolerance: number): Point[] {
  if (pts.length <= 3) return pts
  // Find the point farthest from pt[0] as second anchor for splitting the ring
  let maxDist = 0
  let splitIdx = Math.floor(pts.length / 2)
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y)
    if (d > maxDist) { maxDist = d; splitIdx = i }
  }
  const half1 = simplifyPoints(pts.slice(0, splitIdx + 1), tolerance)
  const half2 = simplifyPoints([...pts.slice(splitIdx), pts[0]], tolerance)
  const result = [...half1.slice(0, -1), ...half2.slice(0, -1)]
  return result.length >= 3 ? result : pts
}

/**
 * Offset a closed path by delta mm (positive = outward).
 * Uses clipper-lib; curves are flattened to line segments.
 * Default join type is round (besser für Textil-Schnittmuster).
 */
export function offsetCurves(curves: Curve[], deltaMm: number, options?: OffsetOptions): Curve[] {
  if (curves.length === 0) return []
  const pts = curvesToPoints(curves)
  if (pts.length < 3) return []
  const path = pts.map(toIntPoint)
  const co = new ClipperLib.ClipperOffset()
  const jt = options?.joinType === 'miter' ? ClipperLib.JoinType.jtMiter
    : options?.joinType === 'square' ? ClipperLib.JoinType.jtSquare
    : ClipperLib.JoinType.jtRound
  if (options?.miterLimit != null) co.MiterLimit = options.miterLimit
  co.AddPath(path, jt, ClipperLib.EndType.etClosedPolygon)
  const solution: IntPoint[][] = []
  co.Execute(solution, deltaMm * SCALE)
  if (solution.length === 0 || solution[0].length < 2) return []
  let outPts = solution[0].map(fromIntPoint)
  if (outPts.length > 1 && outPts[0].x === outPts[outPts.length - 1].x && outPts[0].y === outPts[outPts.length - 1].y) {
    outPts.pop()
  }
  outPts = simplifyClosedPolygon(outPts, 0.15)
  const segs = pointsToLineCurves(outPts)
  if (outPts.length >= 3) {
    segs.push({ type: 'line', start: outPts[outPts.length - 1], end: outPts[0] })
  }
  return segs
}


/** Kontur umkehren (Umlaufsinn wechseln): Segmentreihenfolge und Start/Ende pro Segment. */
function reverseCurves(curves: Curve[]): Curve[] {
  if (curves.length === 0) return []
  const out: Curve[] = []
  for (let i = curves.length - 1; i >= 0; i--) {
    const c = curves[i]
    if (c.type === 'line') {
      out.push({ type: 'line', start: { ...c.end }, end: { ...c.start } })
    } else {
      out.push({
        type: 'bezier',
        start: { ...c.end },
        end: { ...c.start },
        cp1: { ...c.cp2 },
        cp2: { ...c.cp1 },
      })
    }
  }
  return out
}

const MITER_LIMIT = 2.0
const MIN_COS_HALF = 1 / MITER_LIMIT // 0.5 — corresponds to ~60° half-angle

/**
 * Offset-Vertex mit Miter-Join berechnen. Bei spitzen Ecken wird das
 * Miter auf MITER_LIMIT * delta begrenzt (Textil-/Schnittteil-tauglich).
 */
function miterOffsetVertex(
  curves: Curve[],
  vertexIdx: number,
  deltaMm: number
): Point {
  const n = curves.length
  const prevIdx = (vertexIdx - 1 + n) % n
  const vertex = curves[vertexIdx].start

  const prevAngleRad = (outwardNormalAngleAt(curves, prevIdx, 1.0) * Math.PI) / 180
  const currAngleRad = (outwardNormalAngleAt(curves, vertexIdx, 0.0) * Math.PI) / 180
  const n1x = Math.cos(prevAngleRad)
  const n1y = Math.sin(prevAngleRad)
  const n2x = Math.cos(currAngleRad)
  const n2y = Math.sin(currAngleRad)

  const bx = n1x + n2x
  const by = n1y + n2y
  const bLen = Math.hypot(bx, by)

  if (bLen < 1e-10) {
    return { x: vertex.x + deltaMm * n1x, y: vertex.y + deltaMm * n1y }
  }
  const ubx = bx / bLen
  const uby = by / bLen
  const cosHalf = n1x * ubx + n1y * uby

  let miterDist: number
  if (cosHalf >= MIN_COS_HALF) {
    miterDist = deltaMm / cosHalf
  } else if (cosHalf > 0) {
    miterDist = deltaMm * MITER_LIMIT
  } else {
    miterDist = deltaMm * MITER_LIMIT * (cosHalf >= 0 ? 1 : -1)
  }
  return { x: vertex.x + miterDist * ubx, y: vertex.y + miterDist * uby }
}

/**
 * Bézier-Kontrollpunkte für den Offset per Sampling + Least-Squares-Fit
 * bestimmen. Ergibt eine deutlich bessere parallele Approximation als
 * einfaches Verschieben entlang einzelner Normalen (Tiller-Hanson).
 */
function fitOffsetBezierCPs(
  curves: Curve[],
  segIdx: number,
  deltaMm: number,
  startV: Point,
  endV: Point
): { cp1: Point; cp2: Point } {
  const c = curves[segIdx] as import('../types/model').BezierCurve
  const samples = [0.15, 0.3, 0.5, 0.7, 0.85]

  let sumAA = 0, sumAB = 0, sumBB = 0
  let sumARx = 0, sumARy = 0, sumBRx = 0, sumBRy = 0

  for (const t of samples) {
    const u = 1 - t
    const a = 3 * u * u * t
    const b = 3 * u * t * t

    const origPt = bezierAt(c, t)
    const nRad = (outwardNormalAngleAt(curves, segIdx, t) * Math.PI) / 180
    const targetX = origPt.x + deltaMm * Math.cos(nRad)
    const targetY = origPt.y + deltaMm * Math.sin(nRad)

    const u3 = u * u * u
    const t3 = t * t * t
    const rx = targetX - u3 * startV.x - t3 * endV.x
    const ry = targetY - u3 * startV.y - t3 * endV.y

    sumAA += a * a
    sumAB += a * b
    sumBB += b * b
    sumARx += a * rx
    sumARy += a * ry
    sumBRx += b * rx
    sumBRy += b * ry
  }

  const det = sumAA * sumBB - sumAB * sumAB
  if (Math.abs(det) < 1e-20) {
    const midRad = (outwardNormalAngleAt(curves, segIdx, 0.5) * Math.PI) / 180
    return {
      cp1: { x: c.cp1.x + deltaMm * Math.cos(midRad), y: c.cp1.y + deltaMm * Math.sin(midRad) },
      cp2: { x: c.cp2.x + deltaMm * Math.cos(midRad), y: c.cp2.y + deltaMm * Math.sin(midRad) },
    }
  }

  return {
    cp1: {
      x: (sumBB * sumARx - sumAB * sumBRx) / det,
      y: (sumBB * sumARy - sumAB * sumBRy) / det,
    },
    cp2: {
      x: (sumAA * sumBRx - sumAB * sumARx) / det,
      y: (sumAA * sumBRy - sumAB * sumARy) / det,
    },
  }
}

/**
 * Strukturtreuer Offset mit Miter-Join und Sampling-basiertem Bézier-Fit.
 * Jeder Eckpunkt wird entlang der Winkelhalbierenden verschoben (mit
 * Miter-Limit für spitze Ecken). Bézier-Kontrollpunkte werden per
 * Least-Squares an abgetastete Offset-Punkte gefittet, damit die
 * Nahtlinie auch bei starker Krümmung parallel bleibt.
 */
function structurePreservingOffset(curves: Curve[], deltaMm: number): Curve[] {
  const n = curves.length
  if (n === 0) return []

  const vertices: Point[] = []
  for (let i = 0; i < n; i++) {
    vertices.push(miterOffsetVertex(curves, i, deltaMm))
  }

  const result: Curve[] = []
  for (let i = 0; i < n; i++) {
    const startV = vertices[i]
    const endV = vertices[(i + 1) % n]
    const c = curves[i]

    if (c.type === 'line') {
      result.push({ type: 'line', start: startV, end: endV })
    } else {
      const { cp1, cp2 } = fitOffsetBezierCPs(curves, i, deltaMm, startV, endV)
      result.push({ type: 'bezier', start: startV, end: endV, cp1, cp2 })
    }
  }
  return result
}

/**
 * Schnittlinie (seamLine) aus der gezeichneten Nahtlinie (cutLine):
 * Offset nach AUSSEN um die Nahtzugabe. Das Teil wird größer.
 * cutLine = was der Nutzer zeichnet (Nahtlinie, wo genäht wird).
 * Ergebnis = Schnittlinie (wo geschnitten wird, außen herum).
 * Strukturtreuer Per-Segment-Offset, damit seamLine dieselbe Segmentstruktur hat wie cutLine.
 */
export function offsetCurvesInwardForSeam(cutLine: Curve[], seamAllowanceMm: number): Curve[] {
  if (cutLine.length === 0 || seamAllowanceMm <= 0) return []
  const raw = structurePreservingOffset(cutLine, seamAllowanceMm)
  if (raw.length === 0) return []
  const cutArea = signedAreaCurves(cutLine)
  const seamArea = signedAreaCurves(raw)
  if (cutArea * seamArea < 0) return reverseCurves(raw)
  return raw
}

/**
 * Einzelnes Segment um deltaMm in Außenrichtung verschieben.
 * Für Linien: einheitliche Verschiebung entlang Mittennormale.
 * Für Bézier: Start/cp1 entlang Startnormale, cp2/Ende entlang Endnormale (paralleler Offset).
 */
export function offsetSegmentPoints(
  curves: Curve[],
  curveIndex: number,
  deltaMm: number
): { start: Point; end: Point; cp1?: Point; cp2?: Point } | null {
  if (curveIndex < 0 || curveIndex >= curves.length) return null
  const c = curves[curveIndex]
  if (c.type === 'line') {
    const angleDeg = outwardNormalAngleAt(curves, curveIndex, 0.5)
    const rad = (angleDeg * Math.PI) / 180
    const dx = deltaMm * Math.cos(rad)
    const dy = deltaMm * Math.sin(rad)
    return {
      start: { x: c.start.x + dx, y: c.start.y + dy },
      end: { x: c.end.x + dx, y: c.end.y + dy },
    }
  }
  const angleStart = outwardNormalAngleAt(curves, curveIndex, 0)
  const angleCp1 = outwardNormalAngleAt(curves, curveIndex, 1 / 3)
  const angleCp2 = outwardNormalAngleAt(curves, curveIndex, 2 / 3)
  const angleEnd = outwardNormalAngleAt(curves, curveIndex, 1)
  const radS = (angleStart * Math.PI) / 180
  const radCp1 = (angleCp1 * Math.PI) / 180
  const radCp2 = (angleCp2 * Math.PI) / 180
  const radE = (angleEnd * Math.PI) / 180
  const dxS = deltaMm * Math.cos(radS)
  const dyS = deltaMm * Math.sin(radS)
  const dxE = deltaMm * Math.cos(radE)
  const dyE = deltaMm * Math.sin(radE)
  return {
    start: { x: c.start.x + dxS, y: c.start.y + dyS },
    end: { x: c.end.x + dxE, y: c.end.y + dyE },
    cp1: { x: c.cp1.x + deltaMm * Math.cos(radCp1), y: c.cp1.y + deltaMm * Math.sin(radCp1) },
    cp2: { x: c.cp2.x + deltaMm * Math.cos(radCp2), y: c.cp2.y + deltaMm * Math.sin(radCp2) },
  }
}

/** Prüft ob Nahtzugabe für die Kontur gültig ist. */
export function validateSeamAllowance(
  cutLine: Curve[],
  seamAllowanceMm: number
): { valid: boolean; warning?: string } {
  if (cutLine.length < 3) return { valid: false, warning: 'Kontur hat weniger als 3 Segmente' }
  if (seamAllowanceMm <= 0) return { valid: false, warning: 'Nahtzugabe muss positiv sein' }
  const bounds = curvesBounds(cutLine)
  if (!bounds) return { valid: false, warning: 'Bounding-Box konnte nicht berechnet werden' }
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const minDim = Math.min(width, height)
  if (seamAllowanceMm >= minDim / 2) {
    return {
      valid: false,
      warning: `Nahtzugabe (${seamAllowanceMm} mm) ist zu groß für die Kontur (min. Dimension: ${minDim.toFixed(1)} mm)`,
    }
  }
  if (seamAllowanceMm >= minDim / 3) {
    return {
      valid: true,
      warning: `Nahtzugabe ist relativ groß im Verhältnis zur Kontur`,
    }
  }
  return { valid: true }
}

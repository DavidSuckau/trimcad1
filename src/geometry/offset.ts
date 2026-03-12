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

/**
 * Nahtlinie (seamLine) aus der Schnittlinie (cutLine):
 * Offset nach INNEN um die Nahtzugabe. Gleichmäßiger Abstand durch Clipper.
 * Clipper garantiert konstante Distanz – kein Dünnerwerden an Ecken/Kurven.
 */
export function offsetCurvesInwardForSeam(cutLine: Curve[], seamAllowanceMm: number): Curve[] {
  if (cutLine.length === 0 || seamAllowanceMm <= 0) return []
  const raw = offsetCurves(cutLine, -seamAllowanceMm, { joinType: 'round' })
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

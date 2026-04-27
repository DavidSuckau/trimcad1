import type { Curve, BezierCurve, Point, LineSegment } from '../types/model'
import { lerpPt as lerp } from './geometryConstants'

/** Kubische Bézier bei t auswerten: B(t). */
export function bezierAt(b: BezierCurve, t: number): Point {
  const u = 1 - t
  const u2 = u * u
  const u3 = u2 * u
  const t2 = t * t
  const t3 = t2 * t
  return {
    x: u3 * b.start.x + 3 * u2 * t * b.cp1.x + 3 * u * t2 * b.cp2.x + t3 * b.end.x,
    y: u3 * b.start.y + 3 * u2 * t * b.cp1.y + 3 * u * t2 * b.cp2.y + t3 * b.end.y,
  }
}

/**
 * Kontrollpunkt C so dass bei cp1=cp2=C der Punkt auf der Kurve bei t genau bei pointOnCurve liegt.
 * Nur sinnvoll für 0 < t < 1.
 */
export function controlPointForPointOnCurve(
  b: BezierCurve,
  t: number,
  pointOnCurve: Point
): Point | null {
  if (t <= 0 || t >= 1) return null
  const u = 1 - t
  const denom = 3 * u * t
  if (Math.abs(denom) < 1e-10) return null
  const u3 = u * u * u
  const t3 = t * t * t
  return {
    x: (pointOnCurve.x - u3 * b.start.x - t3 * b.end.x) / denom,
    y: (pointOnCurve.y - u3 * b.start.y - t3 * b.end.y) / denom,
  }
}

/**
 * Berechnet neues cp1/cp2 so dass die Kurve bei t möglichst zu newPoint passt.
 * Verschiebung der Kontrollpunkte mit Gewicht (1−t) / t — weniger starr als gleiche Delta auf beide.
 */
export function adjustControlPointsForPointOnCurve(
  b: BezierCurve,
  t: number,
  newPoint: Point
): { cp1: Point; cp2: Point } | null {
  if (t <= 0 || t >= 1) return null
  const u = 1 - t
  const denom = 3 * u * t
  if (Math.abs(denom) < 1e-10) return null
  const current = bezierAt(b, t)
  const dx = (newPoint.x - current.x) / denom
  const dy = (newPoint.y - current.y) / denom
  const w1 = u
  const w2 = t
  return {
    cp1: { x: b.cp1.x + dx * w1, y: b.cp1.y + dy * w1 },
    cp2: { x: b.cp2.x + dx * w2, y: b.cp2.y + dy * w2 },
  }
}

/** Ableitung der kubischen Bézier bei t: B'(t). */
export function bezierDerivativeAt(b: BezierCurve, t: number): Point {
  const u = 1 - t
  const u2 = u * u
  const t2 = t * t
  return {
    x: 3 * u2 * (b.cp1.x - b.start.x) + 6 * u * t * (b.cp2.x - b.cp1.x) + 3 * t2 * (b.end.x - b.cp2.x),
    y: 3 * u2 * (b.cp1.y - b.start.y) + 6 * u * t * (b.cp2.y - b.cp1.y) + 3 * t2 * (b.end.y - b.cp2.y),
  }
}

/** Anzahl Polygon-Stützstellen für Bézier-Bogenlänge: kurze/gerade Segmente weniger, stark gekrümmte mehr. */
function bezierArcLengthSampleCount(c: BezierCurve): number {
  const dx0 = c.end.x - c.start.x
  const dy0 = c.end.y - c.start.y
  const chord = Math.sqrt(dx0 * dx0 + dy0 * dy0)
  const dx1 = c.cp1.x - c.start.x
  const dy1 = c.cp1.y - c.start.y
  const dx2 = c.cp2.x - c.cp1.x
  const dy2 = c.cp2.y - c.cp1.y
  const dx3 = c.end.x - c.cp2.x
  const dy3 = c.end.y - c.cp2.y
  const controlNet =
    Math.sqrt(dx1 * dx1 + dy1 * dy1) + Math.sqrt(dx2 * dx2 + dy2 * dy2) + Math.sqrt(dx3 * dx3 + dy3 * dy3)
  const flatness = Math.max(0, controlNet - chord)
  return Math.min(64, Math.max(8, Math.ceil(flatness * 2)))
}

/** Bogenlänge entlang des Kurvensegments von Parameter t0 bis t1 (beide in [0,1]). */
export function curveSegmentArcLength(c: Curve, t0: number, t1: number): number {
  if (c.type === 'line') {
    const dx = c.end.x - c.start.x
    const dy = c.end.y - c.start.y
    return (t1 - t0) * Math.sqrt(dx * dx + dy * dy)
  }
  const n = bezierArcLengthSampleCount(c)
  let sum = 0
  let prev = bezierAt(c, t0)
  const dt = t1 - t0
  for (let i = 1; i <= n; i++) {
    const t = t0 + dt * (i / n)
    const pt = bezierAt(c, t)
    const px = pt.x - prev.x
    const py = pt.y - prev.y
    sum += Math.sqrt(px * px + py * py)
    prev = pt
  }
  return sum
}

/** LUT: kumulative Bogenlänge von 0 bis i/steps für kubische Bézier. */
function buildBezierCumulativeArcLength(b: BezierCurve, steps: number): number[] {
  const cum: number[] = new Array(steps + 1)
  cum[0] = 0
  for (let i = 1; i <= steps; i++) {
    const t0 = (i - 1) / steps
    const t1 = i / steps
    cum[i] = cum[i - 1] + curveSegmentArcLength(b, t0, t1)
  }
  return cum
}

/** Parameter t ∈ [0,1] mit Bogenlänge von 0 bis t ≈ targetLen (bei gegebener LUT). */
function tForBezierArcLengthFromStart(
  b: BezierCurve,
  targetLen: number,
  cum: number[],
  steps: number
): number {
  const total = cum[steps]
  if (targetLen <= 0) return 0
  if (targetLen >= total) return 1
  let lo = 0
  let hi = steps
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (cum[mid] <= targetLen) lo = mid
    else hi = mid
  }
  const k = lo
  const t0 = k / steps
  const tHi = (k + 1) / steps
  let loT = t0
  let hiT = tHi
  for (let step = 0; step < 24; step++) {
    const mid = (loT + hiT) / 2
    const len = cum[k] + curveSegmentArcLength(b, t0, mid)
    if (len < targetLen) loT = mid
    else hiT = mid
  }
  return Math.max(0, Math.min(1, (loT + hiT) / 2))
}

const BEZIER_ARC_LUT_STEPS = 48

/** Kubische Bézier bei Parameter t teilen (de Casteljau); liefert [Teil 1, Teil 2]. */
export function splitBezierAt(b: BezierCurve, t: number): [BezierCurve, BezierCurve] {
  const p0 = b.start
  const p1 = b.cp1
  const p2 = b.cp2
  const p3 = b.end
  const p01 = lerp(p0, p1, t)
  const p12 = lerp(p1, p2, t)
  const p23 = lerp(p2, p3, t)
  const p012 = lerp(p01, p12, t)
  const p123 = lerp(p12, p23, t)
  const p0123 = lerp(p012, p123, t)
  return [
    { type: 'bezier', start: { ...p0 }, end: { ...p0123 }, cp1: { ...p01 }, cp2: { ...p012 } },
    { type: 'bezier', start: { ...p0123 }, end: { ...p3 }, cp1: { ...p123 }, cp2: { ...p23 } },
  ]
}

/**
 * Liegt `cp2` praktisch auf dem End-Eck, liefert Join oft null → Kontur wird beim Vertex-Löschen begradigt.
 * Minimaler Schub entlang der erwarteten Tangente (Richtung cp1→Ecke bzw. Ecke→cp2).
 */
function nudgeBezierJoinCp2TowardInterior(seg1: BezierCurve, minDist: number): Point {
  const B = seg1.cp1
  const C = seg1.cp2
  const D = seg1.end
  const dx = D.x - C.x
  const dy = D.y - C.y
  if (Math.hypot(dx, dy) >= minDist) return C
  const bx = D.x - B.x
  const by = D.y - B.y
  const bl = Math.hypot(bx, by)
  if (bl < 1e-12) return { x: D.x - minDist, y: D.y }
  const s = minDist / bl
  return { x: D.x - bx * s, y: D.y - by * s }
}

function nudgeBezierJoinCp1TowardInterior(seg2: BezierCurve, minDist: number): Point {
  const D = seg2.start
  const E = seg2.cp1
  const F = seg2.cp2
  const dx = E.x - D.x
  const dy = E.y - D.y
  if (Math.hypot(dx, dy) >= minDist) return E
  const fx = F.x - D.x
  const fy = F.y - D.y
  const fl = Math.hypot(fx, fy)
  if (fl < 1e-12) return { x: D.x + minDist, y: D.y }
  const s = minDist / fl
  return { x: D.x + fx * s, y: D.y + fy * s }
}

/**
 * Vereinigt zwei benachbarte kubische Bézier-Segmente (De-Casteljau-Rückführung).
 * Voraussetzung: seg1.end === seg2.start. Gibt null zurück bei numerischer Instabilität.
 */
export function joinBezierSegments(seg1: BezierCurve, seg2: BezierCurve): BezierCurve | null {
  const A = seg1.start
  const B = seg1.cp1
  const D = seg1.end
  const F = seg2.cp2
  const G = seg2.end
  const chord = Math.hypot(G.x - A.x, G.y - A.y)
  const minDist = Math.max(1e-5, chord * 1e-7)
  const C = nudgeBezierJoinCp2TowardInterior(seg1, minDist)
  const E = nudgeBezierJoinCp1TowardInterior(seg2, minDist)
  const dxDC = D.x - C.x
  const dyDC = D.y - C.y
  const dxED = E.x - D.x
  const dyED = E.y - D.y
  const dDC = Math.sqrt(dxDC * dxDC + dyDC * dyDC)
  const dED = Math.sqrt(dxED * dxED + dyED * dyED)
  const eps = 1e-6
  if (dDC < eps || dED < eps) return null
  const kRaw = dED / dDC
  if (!Number.isFinite(kRaw)) return null
  const k = Math.min(1e6, Math.max(1e-6, kRaw))
  const k1 = 1 + k
  const P = { x: k1 * B.x - k * A.x, y: k1 * B.y - k * A.y }
  const Q = { x: (k1 / k) * F.x - (1 / k) * G.x, y: (k1 / k) * F.y - (1 / k) * G.y }
  return { type: 'bezier', start: { ...A }, end: { ...G }, cp1: P, cp2: Q }
}

/**
 * Gerades Liniensegment als kubische Bézier (Kontrollpunkte auf der Strecke).
 * Ermöglicht `joinBezierSegments` über eine Linie und ein echtes Bézier hinweg.
 */
export function lineSegmentToCollinearBezier(line: LineSegment): BezierCurve {
  const S = line.start
  const E = line.end
  return {
    type: 'bezier',
    start: { ...S },
    end: { ...E },
    cp1: { x: S.x + (E.x - S.x) / 3, y: S.y + (E.y - S.y) / 3 },
    cp2: { x: S.x + (2 * (E.x - S.x)) / 3, y: S.y + (2 * (E.y - S.y)) / 3 },
  }
}

export type CurveToPathDOptions = { closed?: boolean }

/** SVG-Pfad `d` aus Kurven; mit `closed: true` ein geschlossener Ring (ein `M`, dann Kanten, `Z`). */
export function curveToPathD(curves: Curve[], options?: CurveToPathDOptions): string {
  if (curves.length === 0) return ''
  if (options?.closed) {
    const first = curves[0]
    const start = first.start
    let d = `M ${start.x} ${start.y}`
    for (const c of curves) {
      if (c.type === 'line') {
        d += ` L ${c.end.x} ${c.end.y}`
      } else {
        d += ` C ${c.cp1.x} ${c.cp1.y} ${c.cp2.x} ${c.cp2.y} ${c.end.x} ${c.end.y}`
      }
    }
    d += ' Z'
    return d
  }
  return curves.map((c) => (c.type === 'line' ? lineToD(c) : bezierToD(c))).join(' ')
}

function lineToD(c: { start: { x: number; y: number }; end: { x: number; y: number } }): string {
  return `M ${c.start.x} ${c.start.y} L ${c.end.x} ${c.end.y}`
}

function bezierToD(c: {
  start: { x: number; y: number }
  end: { x: number; y: number }
  cp1: { x: number; y: number }
  cp2: { x: number; y: number }
}): string {
  return `M ${c.start.x} ${c.start.y} C ${c.cp1.x} ${c.cp1.y} ${c.cp2.x} ${c.cp2.y} ${c.end.x} ${c.end.y}`
}

/** Bogenlänge vom Konturstart bis zu (curveIndex, t) in mm. */
export function pathLengthAt(curves: Curve[], curveIndex: number, t: number): number {
  if (curves.length === 0) return 0
  const ci = Math.max(0, Math.min(curveIndex, curves.length - 1))
  let acc = 0
  for (let i = 0; i < ci; i++) {
    acc += curveSegmentArcLength(curves[i], 0, 1)
  }
  acc += curveSegmentArcLength(curves[ci], 0, Math.max(0, Math.min(1, t)))
  return acc
}

/** Gesamtlänge der Kontur in mm. */
export function totalPathLength(curves: Curve[]): number {
  let acc = 0
  for (const c of curves) {
    acc += curveSegmentArcLength(c, 0, 1)
  }
  return acc
}

/** Punkt auf der Kontur bei gegebener Bogenlänge (mm vom Start). Geschlossene Kontur: pathLengthMm wird modulo Gesamtlänge genommen. */
export function pointAtPathLength(
  curves: Curve[],
  pathLengthMm: number
): { curveIndex: number; t: number; point: Point } | null {
  if (curves.length === 0) return null
  const total = totalPathLength(curves)
  if (total <= 0) return null
  let L = pathLengthMm % total
  if (L < 0) L += total
  // Notch am Konturende: pathLengthMm === total (oder Vielfaches) → L wird 0; sonst würde er am Start landen
  if (L < 1e-9 && pathLengthMm > 1e-9) L = total
  let acc = 0
  for (let i = 0; i < curves.length; i++) {
    const segLen = curveSegmentArcLength(curves[i], 0, 1)
    if (acc + segLen >= L - 1e-9) {
      const local = Math.max(0, L - acc)
      const c = curves[i]
      let t: number
      if (c.type === 'line') {
        t = segLen > 0 ? local / segLen : 0
      } else {
        const cum = buildBezierCumulativeArcLength(c, BEZIER_ARC_LUT_STEPS)
        t = tForBezierArcLengthFromStart(c, local, cum, BEZIER_ARC_LUT_STEPS)
      }
      t = Math.max(0, Math.min(1, t))
      const point =
        c.type === 'line'
          ? { x: c.start.x + t * (c.end.x - c.start.x), y: c.start.y + t * (c.end.y - c.start.y) }
          : bezierAt(c, t)
      return { curveIndex: i, t, point }
    }
    acc += segLen
  }
  const last = curves[curves.length - 1]
  const point = last.type === 'line' ? { ...last.end } : bezierAt(last, 1)
  return { curveIndex: curves.length - 1, t: 1, point }
}

const CUT_LINE_CLOSED_LOOP_EPS_MM = 0.01

/** True wenn Start der ersten Kurve mit Ende der letzten zusammenfällt (geschlossene Kontur in mm). */
export function cutLineFormsClosedLoop(curves: Curve[]): boolean {
  if (curves.length === 0) return false
  const s = curves[0].start
  const last = curves[curves.length - 1]
  const e = last.type === 'line' ? last.end : bezierAt(last, 1)
  const dx = s.x - e.x
  const dy = s.y - e.y
  return Math.hypot(dx, dy) < CUT_LINE_CLOSED_LOOP_EPS_MM
}

/** Eine durchgehende geschlossene Kontur (ein Pfad) – Füllung gilt für das ganze Teil. */
export function closedPathD(curves: Curve[]): string {
  return curveToPathD(curves, { closed: true })
}

/** Nullstellen der Ableitung einer kubischen Bézier-Koordinate (t ∈ (0,1)). */
function bezierExtremaT(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = p1 - p0
  const b = p2 - p1
  const c = p3 - p2
  const A = a - 2 * b + c
  const B = 2 * (b - a)
  const C = a
  const result: number[] = []
  if (Math.abs(A) < 1e-12) {
    if (Math.abs(B) > 1e-12) {
      const t = -C / B
      if (t > 0 && t < 1) result.push(t)
    }
  } else {
    const disc = B * B - 4 * A * C
    if (disc >= 0) {
      const sqrtDisc = Math.sqrt(disc)
      const t1 = (-B + sqrtDisc) / (2 * A)
      const t2 = (-B - sqrtDisc) / (2 * A)
      if (t1 > 0 && t1 < 1) result.push(t1)
      if (t2 > 0 && t2 < 1 && Math.abs(t2 - t1) > 1e-12) result.push(t2)
    }
  }
  return result
}

/** Bounding-Box einer Kontur mit echten Bézier-Extrema (statt nur Kontrollpunkten). */
export function curvesBounds(curves: Curve[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (curves.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  function include(x: number, y: number) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  for (const c of curves) {
    include(c.start.x, c.start.y)
    include(c.end.x, c.end.y)
    if (c.type === 'bezier') {
      for (const t of bezierExtremaT(c.start.x, c.cp1.x, c.cp2.x, c.end.x)) {
        const pt = bezierAt(c, t)
        include(pt.x, pt.y)
      }
      for (const t of bezierExtremaT(c.start.y, c.cp1.y, c.cp2.y, c.end.y)) {
        const pt = bezierAt(c, t)
        include(pt.x, pt.y)
      }
    }
  }
  if (minX === Infinity) return null
  return { minX, minY, maxX, maxY }
}

const SIGNED_AREA_SAMPLES_PER_SEGMENT = 10

/** Signed area (Shoelace) einer geschlossenen Kontur; positiv = CCW in Math-Koordinaten. */
export function signedAreaCurves(curves: Curve[]): number {
  if (curves.length === 0) return 0
  const pts: Point[] = []
  const S = SIGNED_AREA_SAMPLES_PER_SEGMENT
  for (const c of curves) {
    for (let k = 0; k < S; k++) {
      const t = k / S
      if (c.type === 'line') {
        pts.push({
          x: c.start.x + t * (c.end.x - c.start.x),
          y: c.start.y + t * (c.end.y - c.start.y),
        })
      } else {
        pts.push(bezierAt(c, t))
      }
    }
  }
  if (pts.length < 3) return 0
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return area / 2
}

/** Außen-Normalenwinkel in Grad – bestimmt Richtung über Umlaufsinn (Winding) statt Centroid. */
export function outwardNormalAngleAt(curves: Curve[], curveIndex: number, t: number): number {
  if (curves.length === 0) return 0
  const ci = Math.max(0, Math.min(curveIndex, curves.length - 1))
  const c = curves[ci]
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
  const len = Math.hypot(tx, ty) || 1
  const nx = -ty / len
  const ny = tx / len
  const area = signedAreaCurves(curves)
  // CCW (area > 0): outward = right normal = (-nx, -ny)
  // CW  (area < 0): outward = left normal  = (nx, ny)
  const ox = area >= 0 ? -nx : nx
  const oy = area >= 0 ? -ny : ny
  return (Math.atan2(oy, ox) * 180) / Math.PI
}

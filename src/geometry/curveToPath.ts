import type { Curve, BezierCurve, Point } from '../types/model'

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }
}

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
 * Berechnet neues cp1/cp2 so dass die Kurve bei t durch newPoint geht,
 * dabei bleibt der Abstand zwischen cp1 und cp2 erhalten (keine Kollabierung).
 * Delta wird gleichmäßig auf beide Kontrollpunkte verteilt.
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
  return {
    cp1: { x: b.cp1.x + dx, y: b.cp1.y + dy },
    cp2: { x: b.cp2.x + dx, y: b.cp2.y + dy },
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

/** Bogenlänge entlang des Kurvensegments von Parameter t0 bis t1 (beide in [0,1]). */
export function curveSegmentArcLength(c: Curve, t0: number, t1: number): number {
  if (c.type === 'line') {
    const len = Math.hypot(c.end.x - c.start.x, c.end.y - c.start.y)
    return (t1 - t0) * len
  }
  const n = 24
  let sum = 0
  let prev = bezierAt(c, t0)
  for (let i = 1; i <= n; i++) {
    const t = t0 + (t1 - t0) * (i / n)
    const pt = bezierAt(c, t)
    sum += Math.hypot(pt.x - prev.x, pt.y - prev.y)
    prev = pt
  }
  return sum
}

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

export function curveToPathD(curves: Curve[]): string {
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
  let acc = 0
  for (let i = 0; i < curveIndex; i++) {
    acc += curveSegmentArcLength(curves[i], 0, 1)
  }
  acc += curveSegmentArcLength(curves[curveIndex], 0, t)
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
        let lo = 0
        let hi = 1
        for (let step = 0; step < 24; step++) {
          const mid = (lo + hi) / 2
          const len = curveSegmentArcLength(c, 0, mid)
          if (len < local) lo = mid
          else hi = mid
        }
        t = (lo + hi) / 2
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

/** Eine durchgehende geschlossene Kontur (ein Pfad) – Füllung gilt für das ganze Teil. */
export function closedPathD(curves: Curve[]): string {
  if (curves.length === 0) return ''
  const first = curves[0]
  const start = first.type === 'line' ? first.start : first.start
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

/** Signed area (Shoelace) einer geschlossenen Kontur; positiv = CCW in Math-Koordinaten. */
export function signedAreaCurves(curves: Curve[]): number {
  if (curves.length === 0) return 0
  const pts: Point[] = [curves[0].start]
  for (const c of curves) pts.push(c.end)
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

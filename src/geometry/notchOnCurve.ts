import type { Curve, Notch, Point } from '../types/model'
import { splitBezierAt, pathLengthAt, totalPathLength, pointAtPathLength, outwardNormalAngleAt } from './curveToPath'
import { nearestCurveIndexAndPoint } from './nearestOnCurve'

const VERTEX_T_EPS = 0.05

/** Innen-Normalenwinkel (Grad) an (curveIndex, t). An Vertices (t≈0 oder t≈1) Winkelhalbierende der beiden Segmente. */
function inwardNormalAngleAt(curves: Curve[], curveIndex: number, t: number): number {
  const n = curves.length
  if (n === 0) return 0
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const toDeg = (rad: number) => (rad * 180) / Math.PI
  const toVector = (deg: number) => ({ x: Math.cos(toRad(deg)), y: Math.sin(toRad(deg)) })
  const inward = (ci: number, tt: number) => outwardNormalAngleAt(curves, ci, tt) + 180

  if (t <= VERTEX_T_EPS) {
    const prevIdx = (curveIndex - 1 + n) % n
    const a1 = inward(prevIdx, 1)
    const a2 = inward(curveIndex, 0)
    const v1 = toVector(a1)
    const v2 = toVector(a2)
    const sx = v1.x + v2.x
    const sy = v1.y + v2.y
    const len = Math.hypot(sx, sy)
    if (len < 1e-10) return a1
    return toDeg(Math.atan2(sy, sx))
  }
  if (t >= 1 - VERTEX_T_EPS) {
    const nextIdx = (curveIndex + 1) % n
    const a1 = inward(curveIndex, 1)
    const a2 = inward(nextIdx, 0)
    const v1 = toVector(a1)
    const v2 = toVector(a2)
    const sx = v1.x + v2.x
    const sy = v1.y + v2.y
    const len = Math.hypot(sx, sy)
    if (len < 1e-10) return a1
    return toDeg(Math.atan2(sy, sx))
  }
  return inward(curveIndex, t)
}

/**
 * Kanonische Notch-Position: notch.position ist die einzige Wahrheitsquelle.
 * Ausnahme: vertexIndex-Notches folgen dem Vertex (Knickpunkt auf der CutLine).
 */
export function getNotchPositionAndAngle(
  notch: Notch,
  cutLine: Curve[],
  _seamLine?: Curve[]
): { position: Point; angle: number } {
  const vi = notch.vertexIndex
  if (vi != null && vi >= 0 && vi < cutLine.length) {
    const position = { ...cutLine[vi].start }
    const angle = inwardNormalAngleAt(cutLine, vi, 0)
    return { position, angle }
  }
  return { position: notch.position, angle: notch.angle }
}

/** Projiziert notch.position auf die CutLine → (curveIndex, t). */
export function getNotchCurveIndexAndT(notch: Notch, cutLine: Curve[], _seamLine?: Curve[]): { curveIndex: number; t: number } | null {
  if (cutLine.length === 0) return null
  const { position } = getNotchPositionAndAngle(notch, cutLine)
  const r = nearestCurveIndexAndPoint(position, cutLine)
  return r ? { curveIndex: r.curveIndex, t: r.t ?? 0 } : null
}

/**
 * Notch-Position auf der Nahtlinie.
 * Projiziert die CutLine-Position des Notchs direkt auf die SeamLine
 * via Euclidean-Nearest-Point. Bei einer parallelen Offset-Kurve
 * entspricht der nächste Punkt immer dem Normalen-Fußpunkt.
 */
export function getNotchPositionAndAngleOnSeamLine(
  notch: Notch,
  cutLine: Curve[],
  seamLine: Curve[]
): { position: Point; angle: number } | null {
  if (seamLine.length === 0) return null

  const cutPos = getNotchPositionAndAngleOnCutLine(notch, cutLine, seamLine)
  const nearest = nearestCurveIndexAndPoint(cutPos.position, seamLine)
  if (!nearest) return null

  const t = nearest.t ?? 0
  const angle = inwardNormalAngleAt(seamLine, nearest.curveIndex, t)
  return { position: nearest.point, angle }
}

/**
 * Notch-Position auf der Außenkontur: Projektion von notch.position auf die cutLine.
 */
export function getNotchPositionAndAngleOnCutLine(
  notch: Notch,
  cutLine: Curve[],
  _seamLine: Curve[]
): { position: Point; angle: number } {
  if (cutLine.length === 0) return { position: notch.position, angle: notch.angle }
  const { position } = getNotchPositionAndAngle(notch, cutLine)
  const nearest = nearestCurveIndexAndPoint(position, cutLine)
  if (!nearest) return { position: notch.position, angle: notch.angle }
  const t = nearest.t ?? 0
  const angle = inwardNormalAngleAt(cutLine, nearest.curveIndex, t)
  return { position: nearest.point, angle }
}

/** Ecken der Kerbe (Basis auf Kontur, Spitze ins Teil). Nur für Vorschau/Drag-Preview. */
export function notchTriangleCorners(
  position: Point,
  angleDeg: number,
  depth: number,
  width: number
): [Point, Point, Point] {
  const rad = (angleDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const w2 = width / 2
  const baseLeft = { x: position.x - w2 * sin, y: position.y + w2 * cos }
  const baseRight = { x: position.x + w2 * sin, y: position.y - w2 * cos }
  const tip = { x: position.x + depth * cos, y: position.y + depth * sin }
  return [baseLeft, baseRight, tip]
}

/**
 * Berechnet die tatsächlichen Kerb-Punkte (links, rechts, Spitze) eines Notchs
 * auf einer Kurve. Basispunkte liegen ON the curve bei ±width/2 Bogenlänge
 * vom Zentrum – identisch zur Geometrie in cutLineWithNotchCutouts.
 */
export function notchCutoutPoints(
  position: Point,
  angle: number,
  depth: number,
  width: number,
  curves: Curve[]
): { left: Point; right: Point; tip: Point } | null {
  if (curves.length === 0) return null
  const nearest = nearestCurveIndexAndPoint(position, curves)
  if (!nearest) return null

  const total = totalPathLength(curves)
  if (total <= 0) return null

  const Lcenter = pathLengthAt(curves, nearest.curveIndex, nearest.t ?? 0)
  let Lleft = Lcenter - width / 2
  let Lright = Lcenter + width / 2
  if (Lleft < 0) Lleft = 0
  if (Lright > total) Lright = total
  if (Lright - Lleft < 0.1) return null

  const left = pointAtPathLength(curves, Lleft)
  const right = pointAtPathLength(curves, Lright)
  if (!left || !right) return null

  const rad = (angle * Math.PI) / 180
  const tip: Point = {
    x: position.x + depth * Math.cos(rad),
    y: position.y + depth * Math.sin(rad),
  }
  return { left: left.point, right: right.point, tip }
}

/* ------------------------------------------------------------------ */
/*  Cut-Line mit eingearbeiteten Notch-V-Kerben                       */
/* ------------------------------------------------------------------ */

function lerpPt(a: Point, b: Point, t: number): Point {
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }
}

function copyCurve(c: Curve): Curve {
  if (c.type === 'line') return { type: 'line', start: { ...c.start }, end: { ...c.end } }
  return { type: 'bezier', start: { ...c.start }, end: { ...c.end }, cp1: { ...c.cp1 }, cp2: { ...c.cp2 } }
}

/**
 * Extrahiert einen Abschnitt der Kontur zwischen (fromCI, fromT) und (toCI, toT).
 * Bezier-Segmente werden bei Bedarf via de Casteljau geteilt.
 */
export function extractCurvePortion(
  curves: Curve[],
  fromCI: number,
  fromT: number,
  toCI: number,
  toT: number
): Curve[] {
  const result: Curve[] = []
  fromT = Math.max(0, Math.min(1, fromT))
  toT = Math.max(0, Math.min(1, toT))

  let sCI = fromCI
  let sT = fromT
  if (sT >= 1 - 1e-9 && sCI < toCI) { sCI++; sT = 0 }

  let eCI = toCI
  let eT = toT
  if (eT <= 1e-9 && eCI > sCI) { eCI--; eT = 1 }

  if (sCI > eCI || (sCI === eCI && eT <= sT + 1e-9)) return result

  if (sCI === eCI) {
    const c = curves[sCI]
    if (c.type === 'line') {
      result.push({ type: 'line', start: lerpPt(c.start, c.end, sT), end: lerpPt(c.start, c.end, eT) })
    } else {
      if (sT < 1e-9 && eT > 1 - 1e-9) {
        result.push(copyCurve(c))
      } else if (sT < 1e-9) {
        result.push(splitBezierAt(c, eT)[0])
      } else if (eT > 1 - 1e-9) {
        result.push(splitBezierAt(c, sT)[1])
      } else {
        const afterFrom = splitBezierAt(c, sT)[1]
        const adjT = (eT - sT) / (1 - sT)
        result.push(splitBezierAt(afterFrom, adjT)[0])
      }
    }
    return result
  }

  // First segment: sT → 1
  {
    const c = curves[sCI]
    if (sT < 1e-9) {
      result.push(copyCurve(c))
    } else if (c.type === 'line') {
      result.push({ type: 'line', start: lerpPt(c.start, c.end, sT), end: { ...c.end } })
    } else {
      result.push(splitBezierAt(c, sT)[1])
    }
  }

  // Middle segments (full)
  for (let i = sCI + 1; i < eCI; i++) {
    result.push(copyCurve(curves[i]))
  }

  // Last segment: 0 → eT
  {
    const c = curves[eCI]
    if (eT > 1 - 1e-9) {
      result.push(copyCurve(c))
    } else if (c.type === 'line') {
      result.push({ type: 'line', start: { ...c.start }, end: lerpPt(c.start, c.end, eT) })
    } else {
      result.push(splitBezierAt(c, eT)[0])
    }
  }

  return result
}

type NotchInterval = {
  Lleft: number
  Lright: number
  leftPt: Point
  rightPt: Point
  tip: Point
  leftCI: number
  leftT: number
  rightCI: number
  rightT: number
}

/**
 * Erzeugt eine neue Curve[], in der die Notch-V-Kerben als echte Einschnitte
 * in die Außenkontur eingearbeitet sind. Für DXF-Export und visuelle Darstellung.
 */
export function cutLineWithNotchCutouts(
  cutLine: Curve[],
  notches: Notch[],
  seamLine: Curve[]
): Curve[] {
  if (cutLine.length < 3 || notches.length === 0) return cutLine

  const total = totalPathLength(cutLine)
  if (total <= 0) return cutLine

  const intervals: NotchInterval[] = []

  for (const n of notches) {
    const ct = getNotchCurveIndexAndT(n, cutLine, seamLine)
    if (!ct) continue

    const Lcenter = pathLengthAt(cutLine, ct.curveIndex, ct.t)
    const width = n.width ?? 6
    const depth = n.depth

    let Lleft = Lcenter - width / 2
    let Lright = Lcenter + width / 2

    if (Lleft < 0) Lleft = 0
    if (Lright > total) Lright = total
    if (Lright - Lleft < 0.1) continue

    const left = pointAtPathLength(cutLine, Lleft)
    const right = pointAtPathLength(cutLine, Lright)
    if (!left || !right) continue

    const { position: center, angle } = getNotchPositionAndAngleOnCutLine(n, cutLine, seamLine)
    const rad = (angle * Math.PI) / 180
    const tip: Point = {
      x: center.x + depth * Math.cos(rad),
      y: center.y + depth * Math.sin(rad),
    }

    intervals.push({
      Lleft, Lright,
      leftPt: left.point, rightPt: right.point, tip,
      leftCI: left.curveIndex, leftT: left.t,
      rightCI: right.curveIndex, rightT: right.t,
    })
  }

  if (intervals.length === 0) return cutLine

  intervals.sort((a, b) => a.Lleft - b.Lleft)

  // Overlapping intervals: nur den ersten behalten
  const clean: NotchInterval[] = [intervals[0]]
  for (let i = 1; i < intervals.length; i++) {
    if (intervals[i].Lleft >= clean[clean.length - 1].Lright - 1e-6) {
      clean.push(intervals[i])
    }
  }

  const result: Curve[] = []
  let curCI = 0
  let curT = 0

  for (const iv of clean) {
    // Original-Kontur von (curCI, curT) bis (iv.leftCI, iv.leftT)
    if (iv.leftCI > curCI || (iv.leftCI === curCI && iv.leftT > curT + 1e-9)) {
      result.push(...extractCurvePortion(cutLine, curCI, curT, iv.leftCI, iv.leftT))
    }

    // V-Detour: leftPt → tip → rightPt
    result.push({ type: 'line', start: { ...iv.leftPt }, end: { ...iv.tip } })
    result.push({ type: 'line', start: { ...iv.tip }, end: { ...iv.rightPt } })

    curCI = iv.rightCI
    curT = iv.rightT
  }

  // Restliche Kontur bis zum Ende
  if (curCI < cutLine.length - 1 || curT < 1 - 1e-9) {
    result.push(...extractCurvePortion(cutLine, curCI, curT, cutLine.length - 1, 1))
  }

  return result
}

/**
 * Erzeugt eine neue Curve[], in der die Notch-V-Kerben als echte Einschnitte
 * in die Nahtlinie eingearbeitet sind – analog zu cutLineWithNotchCutouts.
 */
export function seamLineWithNotchCutouts(
  cutLine: Curve[],
  notches: Notch[],
  seamLine: Curve[]
): Curve[] {
  if (seamLine.length < 3 || notches.length === 0) return seamLine

  const total = totalPathLength(seamLine)
  if (total <= 0) return seamLine

  const intervals: NotchInterval[] = []

  for (const n of notches) {
    const seamPos = getNotchPositionAndAngleOnSeamLine(n, cutLine, seamLine)
    if (!seamPos) continue

    const nearest = nearestCurveIndexAndPoint(seamPos.position, seamLine)
    if (!nearest) continue

    const Lcenter = pathLengthAt(seamLine, nearest.curveIndex, nearest.t ?? 0)
    const width = n.width ?? 6
    const depth = n.depth

    let Lleft = Lcenter - width / 2
    let Lright = Lcenter + width / 2

    if (Lleft < 0) Lleft = 0
    if (Lright > total) Lright = total
    if (Lright - Lleft < 0.1) continue

    const left = pointAtPathLength(seamLine, Lleft)
    const right = pointAtPathLength(seamLine, Lright)
    if (!left || !right) continue

    const rad = (seamPos.angle * Math.PI) / 180
    const tip: Point = {
      x: seamPos.position.x + depth * Math.cos(rad),
      y: seamPos.position.y + depth * Math.sin(rad),
    }

    intervals.push({
      Lleft, Lright,
      leftPt: left.point, rightPt: right.point, tip,
      leftCI: left.curveIndex, leftT: left.t,
      rightCI: right.curveIndex, rightT: right.t,
    })
  }

  if (intervals.length === 0) return seamLine

  intervals.sort((a, b) => a.Lleft - b.Lleft)

  const clean: NotchInterval[] = [intervals[0]]
  for (let i = 1; i < intervals.length; i++) {
    if (intervals[i].Lleft >= clean[clean.length - 1].Lright - 1e-6) {
      clean.push(intervals[i])
    }
  }

  const result: Curve[] = []
  let curCI = 0
  let curT = 0

  for (const iv of clean) {
    if (iv.leftCI > curCI || (iv.leftCI === curCI && iv.leftT > curT + 1e-9)) {
      result.push(...extractCurvePortion(seamLine, curCI, curT, iv.leftCI, iv.leftT))
    }
    result.push({ type: 'line', start: { ...iv.leftPt }, end: { ...iv.tip } })
    result.push({ type: 'line', start: { ...iv.tip }, end: { ...iv.rightPt } })
    curCI = iv.rightCI
    curT = iv.rightT
  }

  if (curCI < seamLine.length - 1 || curT < 1 - 1e-9) {
    result.push(...extractCurvePortion(seamLine, curCI, curT, seamLine.length - 1, 1))
  }

  return result
}

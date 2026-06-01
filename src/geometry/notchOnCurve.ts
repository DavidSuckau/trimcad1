import type { Curve, Notch, NotchType, Point } from '../types/model'
import {
  splitBezierAt,
  bezierAt,
  pathLengthAt,
  totalPathLength,
  pointAtPathLength,
  outwardNormalAngleAt,
} from './curveToPath'
import { isNotchOnInternalLine } from './notchOnInternalLine'
import { nearestCurveIndexAndPoint } from './nearestOnCurve'
import { VERTEX_T_EPS, lerpPt } from './geometryConstants'

/** Innen-Normalenwinkel (Grad) an (curveIndex, t). An Vertices (t≈0 oder t≈1) Winkelhalbierende der beiden Segmente. */
function inwardNormalAngleAt(curves: Curve[], curveIndex: number, t: number): number {
  const n = curves.length
  if (n === 0) return 0
  curveIndex = Math.max(0, Math.min(curveIndex, n - 1))
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
    if (len < 1e-10) return Number.isFinite(a1) ? a1 : 0
    const out = toDeg(Math.atan2(sy, sx))
    return Number.isFinite(out) ? out : (Number.isFinite(a1) ? a1 : 0)
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
    if (len < 1e-10) return Number.isFinite(a1) ? a1 : 0
    const out = toDeg(Math.atan2(sy, sx))
    return Number.isFinite(out) ? out : (Number.isFinite(a1) ? a1 : 0)
  }
  const direct = inward(curveIndex, t)
  return Number.isFinite(direct) ? direct : 0
}

/**
 * **Primary anchoring auf der Schnittkontur (cutLine)** — Lesepfad:
 *
 * 1. `sNormalized` → Bogenlänge `sNormalized * Umfang` entlang der Kontur.
 * 2. `arcLengthMm` → absolute Bogenlänge vom Konturstart.
 * 3. Sonst Projektion von `position` auf die `cutLine`.
 */
export function resolveNotchCutLineAnchor(
  notch: Notch,
  cutLine: Curve[]
): { curveIndex: number; t: number } | null {
  if (isNotchOnInternalLine(notch)) return null
  if (cutLine.length === 0) return null

  const total = totalPathLength(cutLine)
  if (total <= 0) return null

  const sn = notch.sNormalized
  if (sn != null && Number.isFinite(sn)) {
    const sClamped = Math.max(0, Math.min(1, sn))
    const L = sClamped * total
    const pt = pointAtPathLength(cutLine, L)
    if (!pt) return null
    return { curveIndex: pt.curveIndex, t: pt.t }
  }

  const al = notch.arcLengthMm
  if (al != null && Number.isFinite(al)) {
    const L = Math.max(0, Math.min(total, al))
    const pt = pointAtPathLength(cutLine, L)
    if (!pt) return null
    return { curveIndex: pt.curveIndex, t: pt.t }
  }

  const r = nearestCurveIndexAndPoint(notch.position, cutLine)
  return r ? { curveIndex: r.curveIndex, t: r.t ?? 0 } : null
}

function pointOnCurveAt(curves: Curve[], curveIndex: number, t: number): Point | null {
  if (curveIndex < 0 || curveIndex >= curves.length) return null
  const c = curves[curveIndex]
  const tt = Math.max(0, Math.min(1, t))
  if (c.type === 'line') {
    return {
      x: c.start.x + tt * (c.end.x - c.start.x),
      y: c.start.y + tt * (c.end.y - c.start.y),
    }
  }
  return bezierAt(c, tt)
}

/**
 * Setzt `sNormalized`, `arcLengthMm`, `position`, `angle` konsistent zur aktuellen **cutLine**
 * über `resolveNotchCutLineAnchor` (freie Lage auf der Kontur). `vertexIndex` wird nicht gesetzt.
 */
export function materializeNotchAnchorsOnCutLine(notch: Notch, cutLine: Curve[]): Notch | null {
  if (isNotchOnInternalLine(notch)) return null
  if (cutLine.length === 0) return null
  const total = totalPathLength(cutLine)
  if (total <= 0) return null

  const anchor = resolveNotchCutLineAnchor(notch, cutLine)
  if (!anchor) return null
  const L = pathLengthAt(cutLine, anchor.curveIndex, anchor.t)
  const sNorm = L / total
  const position = pointOnCurveAt(cutLine, anchor.curveIndex, anchor.t)
  if (!position) return null
  const angle = inwardNormalAngleAt(cutLine, anchor.curveIndex, anchor.t)
  return {
    ...notch,
    vertexIndex: undefined,
    sNormalized: sNorm,
    arcLengthMm: L,
    position,
    angle,
  }
}

export function getNotchCutLineParameter(notch: Notch, cutLine: Curve[]): { curveIndex: number; t: number } | null {
  return resolveNotchCutLineAnchor(notch, cutLine)
}

export function getNotchPositionAndAngle(
  notch: Notch,
  cutLine: Curve[],
  _seamLine?: Curve[]
): { position: Point; angle: number } {
  const fallbackPos = Number.isFinite(notch.position.x) && Number.isFinite(notch.position.y)
    ? notch.position
    : { x: 0, y: 0 }
  const fallbackAngle = Number.isFinite(notch.angle) ? notch.angle : 0
  if (isNotchOnInternalLine(notch)) {
    return { position: fallbackPos, angle: fallbackAngle }
  }
  const anchor = resolveNotchCutLineAnchor(notch, cutLine)
  if (!anchor) {
    return { position: fallbackPos, angle: fallbackAngle }
  }
  const position = pointOnCurveAt(cutLine, anchor.curveIndex, anchor.t)
  if (!position) {
    return { position: fallbackPos, angle: fallbackAngle }
  }
  const angle = inwardNormalAngleAt(cutLine, anchor.curveIndex, anchor.t)
  return { position, angle: Number.isFinite(angle) ? angle : fallbackAngle }
}

/** Parametrische Lage auf der cutLine; siehe `getNotchCutLineParameter`. */
export function getNotchCurveIndexAndT(notch: Notch, cutLine: Curve[], _seamLine?: Curve[]): { curveIndex: number; t: number } | null {
  return getNotchCutLineParameter(notch, cutLine)
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
  if (isNotchOnInternalLine(notch)) return null
  if (seamLine.length === 0) return null

  const cutPos = getNotchPositionAndAngleOnCutLine(notch, cutLine, seamLine)
  const nearest = nearestCurveIndexAndPoint(cutPos.position, seamLine)
  if (!nearest) return null

  const t = nearest.t ?? 0
  const angle = inwardNormalAngleAt(seamLine, nearest.curveIndex, t)
  return { position: nearest.point, angle }
}

/** Notch-Position auf der Außenkontur (gleiche Quelle wie `getNotchPositionAndAngle` auf der cutLine). */
export function getNotchPositionAndAngleOnCutLine(
  notch: Notch,
  cutLine: Curve[],
  _seamLine: Curve[]
): { position: Point; angle: number } {
  return getNotchPositionAndAngle(notch, cutLine)
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

/** Geometrie: V-Kerbe in der Kontur vs. Strich = eine Linie (Rand → innen, Länge = Tiefe). */
export type NotchCutoutGeom =
  | { kind: 'v'; left: Point; right: Point; tip: Point }
  | { kind: 'line'; start: Point; end: Point }

/**
 * Berechnet die tatsächlichen Kerb-Punkte auf einer Kurve.
 * - **single (Strich):** eine Linie senkrecht (Innen-Normale) von `position` mit Länge `depth` — **kein** V-Einschnitt in die Polylinie.
 * - **v / double:** klassische V-Kerbe (links, Spitze, rechts) entlang ±width/2 Bogenlänge — wie `cutLineWithNotchCutouts`.
 */
export function notchCutoutPoints(
  position: Point,
  angle: number,
  depth: number,
  width: number,
  curves: Curve[],
  anchor: { curveIndex: number; t: number } | null | undefined,
  notchType: NotchType
): NotchCutoutGeom | null {
  const safeAngle = Number.isFinite(angle) ? angle : 0
  const safePos: Point =
    Number.isFinite(position.x) && Number.isFinite(position.y) ? position : { x: 0, y: 0 }
  const fallbackLine = (): NotchCutoutGeom => {
    const d = Math.max(1e-6, depth)
    const rad = (safeAngle * Math.PI) / 180
    return {
      kind: 'line',
      start: { ...safePos },
      end: { x: safePos.x + d * Math.cos(rad), y: safePos.y + d * Math.sin(rad) },
    }
  }

  if (notchType === 'single') {
    return fallbackLine()
  }

  if (curves.length === 0) return null

  let curveIndex: number
  let t: number
  if (
    anchor &&
    Number.isFinite(anchor.curveIndex) &&
    Number.isFinite(anchor.t) &&
    anchor.curveIndex >= 0 &&
    anchor.curveIndex < curves.length
  ) {
    curveIndex = anchor.curveIndex
    t = Math.max(0, Math.min(1, anchor.t))
  } else {
    const nearest = nearestCurveIndexAndPoint(position, curves)
    if (!nearest) return null
    curveIndex = nearest.curveIndex
    t = nearest.t ?? 0
  }

  const total = totalPathLength(curves)
  if (total <= 0) return null

  const Lcenter = pathLengthAt(curves, curveIndex, t)
  let Lleft = Lcenter - width / 2
  let Lright = Lcenter + width / 2
  if (Lleft < 0) Lleft = 0
  if (Lright > total) Lright = total
  if (Lright - Lleft < 0.1) return fallbackLine()

  const left = pointAtPathLength(curves, Lleft)
  const right = pointAtPathLength(curves, Lright)
  if (!left || !right) return fallbackLine()

  const rad = (safeAngle * Math.PI) / 180
  const tip: Point = {
    x: safePos.x + depth * Math.cos(rad),
    y: safePos.y + depth * Math.sin(rad),
  }
  return { kind: 'v', left: left.point, right: right.point, tip }
}

/* ------------------------------------------------------------------ */
/*  Cut-Line mit eingearbeiteten Notch-V-Kerben                       */
/* ------------------------------------------------------------------ */

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
  if (curves.length === 0) return result
  fromCI = Math.max(0, Math.min(fromCI, curves.length - 1))
  toCI = Math.max(0, Math.min(toCI, curves.length - 1))
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
  leftCI: number
  leftT: number
  rightCI: number
  rightT: number
  tip: Point
}

/**
 * Erzeugt eine neue Curve[], in der **V-Kerben** als Einschnitte in die Außenkontur eingearbeitet sind.
 * **Strich-Kerben (`single`)** bleiben außerhalb der Polylinie (eigenes LINE im DXF / Overlay in der UI).
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
    if (isNotchOnInternalLine(n)) continue

    const ct = getNotchCurveIndexAndT(n, cutLine, seamLine)
    if (!ct) continue

    const Lcenter = pathLengthAt(cutLine, ct.curveIndex, ct.t)
    // Strichkerbe: schmale V-Einbuchtung (für DXF/Gerber-Polylinie erkennbar)
    const width =
      n.type === 'single' ? Math.max(1.5, Math.min(n.width ?? 6, 3)) : (n.width ?? 6)
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
      Lleft,
      Lright,
      leftPt: left.point,
      rightPt: right.point,
      tip,
      leftCI: left.curveIndex,
      leftT: left.t,
      rightCI: right.curveIndex,
      rightT: right.t,
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
 * Wie `cutLineWithNotchCutouts`, aber für die Nahtlinie. **Strich-Kerben** werden übersprungen.
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
    if (isNotchOnInternalLine(n)) continue
    if (n.type === 'single') continue

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
      Lleft,
      Lright,
      leftPt: left.point,
      rightPt: right.point,
      tip,
      leftCI: left.curveIndex,
      leftT: left.t,
      rightCI: right.curveIndex,
      rightT: right.t,
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

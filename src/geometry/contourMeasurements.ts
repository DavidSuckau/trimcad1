import type { PatternPiece, Point } from '../types/model'
import { pathLengthAt, totalPathLength, pointAtPathLength, bezierDerivativeAt } from './curveToPath'
import { getNotchCurveIndexAndT } from './notchOnCurve'

/** Stationen näher als diese Bogenlänge (mm) gelten als identisch (Ecke + Kerbe am selben Punkt). */
const STATION_MERGE_MM = 0.4
/** Kürzeste angezeigte Teilstrecke (mm). */
const MIN_DISPLAY_MM = 0.12

export type ContourMeasurement = {
  /** Bogenlänge entlang der Außenkontur (mm). */
  lengthMm: number
  midpoint: Point
  /** Tangente in Grad (Richtung wachsender Konturparameter). */
  tangentDeg: number
}

type Station = { s: number; p: Point }

function tangentDegAtCurve(curves: PatternPiece['cutLine'], curveIndex: number, t: number): number {
  const c = curves[curveIndex]
  if (!c) return 0
  if (c.type === 'line') {
    return (Math.atan2(c.end.y - c.start.y, c.end.x - c.start.x) * 180) / Math.PI
  }
  const d = bezierDerivativeAt(c, t)
  if (Math.hypot(d.x, d.y) < 1e-12) return 0
  return (Math.atan2(d.y, d.x) * 180) / Math.PI
}

/**
 * Alle Teilstrecken entlang der **Schnittkontur** (cutLine) zwischen aufeinanderfolgenden
 * „Stationen“: Eckpunkte (Polygon-Ecken) und Kerben (Mittelpunkt auf der Kontur).
 * Maße = Bogenlängen in mm (Geraden exakt, Bézier numerisch).
 */
export function getCutLineContourMeasurements(piece: PatternPiece): ContourMeasurement[] {
  const cutLine = piece.cutLine
  const n = cutLine.length
  if (n < 2) return []

  const total = totalPathLength(cutLine)
  if (total <= MIN_DISPLAY_MM) return []

  const stations: Station[] = []

  for (let i = 0; i < n; i++) {
    const s = pathLengthAt(cutLine, i, 0)
    stations.push({ s, p: { ...cutLine[i].start } })
  }

  for (const notch of piece.notches) {
    const ct = getNotchCurveIndexAndT(notch, cutLine)
    if (!ct) continue
    let t = ct.t
    t = Math.max(0, Math.min(1, t))
    const s = pathLengthAt(cutLine, ct.curveIndex, t)
    const pr = pointAtPathLength(cutLine, s)
    if (!pr) continue
    stations.push({ s, p: pr.point })
  }

  stations.sort((a, b) => a.s - b.s)

  const merged: Station[] = []
  for (const st of stations) {
    if (merged.length === 0) {
      merged.push({ ...st })
      continue
    }
    const last = merged[merged.length - 1]
    if (Math.abs(st.s - last.s) < STATION_MERGE_MM) {
      last.s = (last.s + st.s) / 2
      last.p = { x: (last.p.x + st.p.x) / 2, y: (last.p.y + st.p.y) / 2 }
      continue
    }
    merged.push({ ...st })
  }

  const m = merged.length
  if (m < 2) return []

  const out: ContourMeasurement[] = []

  for (let i = 0; i < m; i++) {
    const a = merged[i]
    const b = merged[(i + 1) % m]
    let len: number
    let midArc: number

    if (i < m - 1) {
      len = b.s - a.s
      midArc = (a.s + b.s) / 2
    } else {
      len = total - a.s + b.s
      const rawMid = a.s + len / 2
      midArc = ((rawMid % total) + total) % total
    }

    if (len < MIN_DISPLAY_MM) continue

    const pr = pointAtPathLength(cutLine, midArc)
    if (!pr) continue
    const tangentDeg = tangentDegAtCurve(cutLine, pr.curveIndex, pr.t)
    out.push({ lengthMm: len, midpoint: pr.point, tangentDeg })
  }

  return out
}

import type { Notch, PatternPiece, Point } from '../types/model'
import { pathLengthAt, totalPathLength, pointAtPathLength, bezierDerivativeAt } from './curveToPath'
import { getNotchCurveIndexAndT, getNotchPositionAndAngleOnSeamLine } from './notchOnCurve'
import { nearestCurveIndexAndPoint } from './nearestOnCurve'

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
 * Bei Nahtzugabe ist die Schnittkontur (cutLine) oft eine Clipper-Polylinie mit sehr vielen
 * kurzen Segmenten — Konturmaße sollen dann der **bearbeitbaren Nahtlinie** folgen (wie Eckpunkte).
 */
function useSeamLineForContourMeasurements(piece: PatternPiece): boolean {
  return (
    piece.seamAllowanceMm != null &&
    piece.seamLine.length >= 3 &&
    piece.cutLine.length >= 3 &&
    piece.seamLine.length < piece.cutLine.length
  )
}

function notchToCurveParameterOnContour(
  notch: Notch,
  contour: PatternPiece['cutLine'],
  piece: PatternPiece,
  measureOnSeam: boolean
): { curveIndex: number; t: number } | null {
  if (contour.length === 0) return null
  if (notch.vertexIndex != null && notch.vertexIndex >= 0 && notch.vertexIndex < contour.length) {
    return { curveIndex: notch.vertexIndex, t: 0 }
  }
  if (measureOnSeam && piece.seamLine.length > 0 && piece.cutLine.length > 0) {
    const onSeam = getNotchPositionAndAngleOnSeamLine(notch, piece.cutLine, piece.seamLine)
    if (onSeam) {
      const r = nearestCurveIndexAndPoint(onSeam.position, contour)
      if (r) return { curveIndex: r.curveIndex, t: r.t ?? 0 }
    }
  }
  return getNotchCurveIndexAndT(notch, piece.cutLine)
}

/**
 * Alle Teilstrecken entlang der gewählten Außen-/Arbeitskontur zwischen aufeinanderfolgenden
 * „Stationen“: Eckpunkte (Polygon-Ecken) und Kerben (Mittelpunkt auf der Kontur).
 * Maße = Bogenlängen in mm (Geraden exakt, Bézier numerisch).
 *
 * Mit Nahtzugabe und tessellierter cutLine werden die Maße entlang der **seamLine** gebildet,
 * damit nicht jedes Clipper-Segment ein eigenes Label bekommt.
 */
export function getCutLineContourMeasurements(piece: PatternPiece): ContourMeasurement[] {
  const measureOnSeam = useSeamLineForContourMeasurements(piece)
  const contour = measureOnSeam ? piece.seamLine : piece.cutLine
  const n = contour.length
  if (n < 2) return []

  const total = totalPathLength(contour)
  if (total <= MIN_DISPLAY_MM) return []

  const stations: Station[] = []

  for (let i = 0; i < n; i++) {
    const s = pathLengthAt(contour, i, 0)
    stations.push({ s, p: { ...contour[i].start } })
  }

  for (const notch of piece.notches) {
    const ct = notchToCurveParameterOnContour(notch, contour, piece, measureOnSeam)
    if (!ct) continue
    let t = ct.t
    t = Math.max(0, Math.min(1, t))
    const s = pathLengthAt(contour, ct.curveIndex, t)
    const pr = pointAtPathLength(contour, s)
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

    const pr = pointAtPathLength(contour, midArc)
    if (!pr) continue
    const tangentDeg = tangentDegAtCurve(contour, pr.curveIndex, pr.t)
    out.push({ lengthMm: len, midpoint: pr.point, tangentDeg })
  }

  return out
}

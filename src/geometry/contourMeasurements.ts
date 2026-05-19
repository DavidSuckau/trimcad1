import type { PatternPiece, Point } from '../types/model'
import { totalPathLength, pointAtPathLength, bezierDerivativeAt } from './curveToPath'
import { collectContourMeasurementStationArcLengths } from './measurementStations'

/** Kürzeste angezeigte Teilstrecke (mm). */
const MIN_DISPLAY_MM = 0.01

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

/**
 * Alle Teilstrecken entlang der gewählten Außen-/Arbeitskontur zwischen aufeinanderfolgenden
 * „Stationen“: feste Eckpunkte (rot) und Kerben — keine weichen (blauen) Ecken.
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

  const stationS = collectContourMeasurementStationArcLengths(piece, contour)
  const merged: Station[] = []
  for (const s of stationS) {
    const pr = pointAtPathLength(contour, s)
    if (!pr) continue
    merged.push({ s, p: pr.point })
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

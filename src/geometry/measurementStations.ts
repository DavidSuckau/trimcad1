import type { Curve, Notch, PatternPiece } from '../types/model'
import { cutLineFormsClosedLoop, pathLengthAt, totalPathLength } from './curveToPath'
import { getNotchCurveIndexAndT, getNotchPositionAndAngle } from './notchOnCurve'
import { nearestCurveIndexAndPoint } from './nearestOnCurve'
import {
  internalLineSegmentPathLength,
  internalLineSegmentTotalLength,
  isNotchOnInternalLine,
  resolveNotchInternalLineAnchor,
} from './notchOnInternalLine'
import { masterSoftVertexIndexSet } from './seamUtils'

const STATION_MERGE_MM = 0.4

/** Weiche Eckpunkte (blau) auf der gegebenen Kontur — keine Maß-Station. */
export function softVertexIndicesOnContour(piece: PatternPiece, contour: Curve[]): Set<number> {
  const n = contour.length
  if (n === 0) return new Set()
  if (contour === piece.seamLine && piece.seamAllowanceMm != null && piece.seamLine.length >= 3) {
    return masterSoftVertexIndexSet(piece)
  }
  const out = new Set<number>()
  for (const vi of piece.softVertices ?? []) {
    if (vi >= 0 && vi < n) out.add(vi)
  }
  return out
}

function mergeSortedStations(stations: number[]): number[] {
  const sorted = [...stations].sort((a, b) => a - b)
  const merged: number[] = []
  for (const s of sorted) {
    if (merged.length === 0) {
      merged.push(s)
      continue
    }
    const last = merged[merged.length - 1]
    if (Math.abs(s - last) < STATION_MERGE_MM) {
      merged[merged.length - 1] = (last + s) / 2
    } else {
      merged.push(s)
    }
  }
  return merged
}

function collectHardVertexArcLengths(contour: Curve[], softSet: Set<number>): number[] {
  const n = contour.length
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    if (!softSet.has(i)) out.push(pathLengthAt(contour, i, 0))
  }
  return out
}

function collectNotchArcLengthsOnCurves(
  notches: Notch[],
  contour: Curve[],
  piece: PatternPiece,
  excludeNotchId?: string,
): number[] {
  const out: number[] = []
  for (const notch of notches) {
    if (excludeNotchId && notch.id === excludeNotchId) continue
    if (contour === piece.cutLine) {
      const ct = getNotchCurveIndexAndT(notch, contour)
      if (!ct) continue
      const t = Math.max(0, Math.min(1, ct.t))
      out.push(pathLengthAt(contour, ct.curveIndex, t))
      continue
    }
    const { position } = getNotchPositionAndAngle(notch, piece.cutLine, piece.seamLine)
    const nr = nearestCurveIndexAndPoint(position, contour)
    if (!nr || nr.t == null) continue
    out.push(pathLengthAt(contour, nr.curveIndex, nr.t))
  }
  return out
}

/** Abstände entlang einer beliebigen Kontur (Schnitt, Naht oder interne Linie). */
export function getNotchMeasurementDistancesOnContour(
  piece: PatternPiece,
  contour: Curve[],
  curveIndex: number,
  t: number,
  options?: { excludeNotchId?: string; onInternalLine?: boolean },
): NotchMeasurementDistances {
  if (options?.onInternalLine) {
    return getInternalLineNotchMeasurementDistances(
      piece,
      curveIndex,
      t,
      options.excludeNotchId,
    )
  }
  const total = totalPathLength(contour)
  const closed = cutLineFormsClosedLoop(contour)
  const anchorS = pathLengthAt(contour, curveIndex, t)
  const softSet = softVertexIndicesOnContour(piece, contour)
  const stations = mergeSortedStations([
    ...collectHardVertexArcLengths(contour, softSet),
    ...collectNotchArcLengthsOnCurves(piece.notches, contour, piece, options?.excludeNotchId),
  ])
  const { prevS, nextS, leftMm, rightMm } = prevNextStationOnPath(anchorS, stations, closed, total)
  return {
    distanceMmLeft: leftMm,
    distanceMmRight: rightMm,
    anchorS,
    boundPrevS: prevS,
    boundNextS: nextS,
  }
}

function collectInternalNotchArcLengthsOnSegment(
  notches: Notch[],
  internalLines: Curve[],
  curveIndex: number,
  excludeNotchId?: string,
): number[] {
  const out: number[] = []
  for (const notch of notches) {
    if (excludeNotchId && notch.id === excludeNotchId) continue
    if (!isNotchOnInternalLine(notch)) continue
    const anchor = resolveNotchInternalLineAnchor(notch, internalLines)
    if (!anchor || anchor.curveIndex !== curveIndex) continue
    out.push(internalLineSegmentPathLength(internalLines, anchor.curveIndex, anchor.t))
  }
  return out
}

/** Alle Bogenlängen-Stationen für Konturmaße: nur harte Ecken + Kerben. */
export function collectContourMeasurementStationArcLengths(
  piece: PatternPiece,
  contour: Curve[],
): number[] {
  const softSet = softVertexIndicesOnContour(piece, contour)
  const stations = [
    ...collectHardVertexArcLengths(contour, softSet),
    ...collectNotchArcLengthsOnCurves(piece.notches, contour, piece),
  ]
  return mergeSortedStations(stations)
}

function arcForward(closed: boolean, total: number, from: number, to: number): number {
  let d = to - from
  if (closed) {
    if (d < 0) d += total
  } else {
    d = Math.max(0, d)
  }
  return d
}

function prevNextStationOnPath(
  anchorS: number,
  stations: number[],
  closed: boolean,
  total: number,
): { prevS: number; nextS: number; leftMm: number; rightMm: number } {
  if (stations.length === 0) {
    return closed
      ? { prevS: 0, nextS: 0, leftMm: 0, rightMm: 0 }
      : { prevS: 0, nextS: total, leftMm: anchorS, rightMm: total - anchorS }
  }
  const sorted = mergeSortedStations(stations)
  let prevS = sorted[0]
  let nextS = sorted[sorted.length - 1]
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]
    if (s < anchorS - STATION_MERGE_MM) prevS = s
    if (s > anchorS + STATION_MERGE_MM) {
      nextS = s
      break
    }
  }
  if (closed) {
    const hasStrictPrev = sorted.some((s) => s < anchorS - STATION_MERGE_MM)
    const hasStrictNext = sorted.some((s) => s > anchorS + STATION_MERGE_MM)
    if (!hasStrictPrev) prevS = sorted[sorted.length - 1]
    if (!hasStrictNext) nextS = sorted[0]
  } else {
    if (!sorted.some((s) => s < anchorS - STATION_MERGE_MM)) prevS = 0
    if (!sorted.some((s) => s > anchorS + STATION_MERGE_MM)) nextS = total
  }
  const leftMm = arcForward(closed, total, prevS, anchorS)
  const rightMm = arcForward(closed, total, anchorS, nextS)
  return { prevS, nextS, leftMm, rightMm }
}

export type NotchMeasurementDistances = {
  distanceMmLeft: number
  distanceMmRight: number
  anchorS: number
  boundPrevS: number
  boundNextS: number
}

/** Abstände einer Kerbe entlang der Schnittkontur — nur zu harten Ecken und anderen Kerben. */
export function getCutLineNotchMeasurementDistances(
  piece: PatternPiece,
  curveIndex: number,
  t: number,
  excludeNotchId?: string,
): NotchMeasurementDistances {
  return getNotchMeasurementDistancesOnContour(piece, piece.cutLine, curveIndex, t, {
    excludeNotchId,
  })
}

/** Abstände einer Kerbe auf internen Linien (offene Polylinie). */
export function getInternalLineNotchMeasurementDistances(
  piece: PatternPiece,
  curveIndex: number,
  t: number,
  excludeNotchId?: string,
): NotchMeasurementDistances {
  const lines = piece.internalLines
  const segLen = internalLineSegmentTotalLength(lines, curveIndex)
  const anchorS = internalLineSegmentPathLength(lines, curveIndex, t)
  const stations = mergeSortedStations([
    0,
    ...(segLen > STATION_MERGE_MM ? [segLen] : []),
    ...collectInternalNotchArcLengthsOnSegment(piece.notches, lines, curveIndex, excludeNotchId),
  ])
  const { prevS, nextS, leftMm, rightMm } = prevNextStationOnPath(anchorS, stations, false, segLen)
  return {
    distanceMmLeft: leftMm,
    distanceMmRight: rightMm,
    anchorS,
    boundPrevS: prevS,
    boundNextS: nextS,
  }
}

/** Ziel-Bogenlänge beim Abstands-Editor (mm von Anker entlang der Kontur). */
export function targetArcLengthForNotchDistanceEdit(
  anchorS: number,
  boundPrevS: number,
  boundNextS: number,
  side: 'left' | 'right',
  distanceMm: number,
  closed: boolean,
  total: number,
): number {
  const mm = Math.max(0, distanceMm)
  if (side === 'left') {
    const maxLeft = arcForward(closed, total, boundPrevS, anchorS)
    const d = Math.min(mm, Math.max(0, maxLeft - STATION_MERGE_MM))
    let target = anchorS - d
    if (closed) {
      while (target < 0) target += total
      target %= total
    } else {
      target = Math.max(boundPrevS, target)
    }
    return target
  }
  const maxRight = arcForward(closed, total, anchorS, boundNextS)
  const d = Math.min(mm, Math.max(0, maxRight - STATION_MERGE_MM))
  let target = anchorS + d
  if (closed) {
    target %= total
  } else {
    target = Math.min(boundNextS, target)
  }
  return target
}

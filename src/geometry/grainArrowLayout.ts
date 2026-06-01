import type { Curve, Line, PatternPiece, Point } from '../types/model'
import { bezierDerivativeAt, curvesBounds } from './curveToPath'
import { nearestCurveIndexAndPoint } from './nearestOnCurve'

/** Max. Abstand Linienmitte → Schnittkontur (mm) zum Snappen an eine Kante. */
export const GRAIN_SNAP_TO_EDGE_MM = 14

/** Feste Schaftlänge beim ersten Anlegen der Laufrichtung (mm); ändert sich danach nicht automatisch. */
export const GRAIN_LINE_DEFAULT_LENGTH_MM = 100

/** Pfeilkopf und Querstrich: feste mm-Größe, unabhängig von Schaftlänge. */
export const GRAIN_ARROW_HEAD_WIDTH_MM = 6
export const GRAIN_ARROW_HEAD_HEIGHT_MM = 8
export const GRAIN_ARROW_TICK_LEN_MM = 30

/** Erzeugt eine vertikale Laufrichtungslinie fester Länge am Stückmittelpunkt (+22 mm seitlich). */
export function createDefaultGrainLine(piece: PatternPiece): Line {
  const bounds = curvesBounds(piece.cutLine)
  const half = GRAIN_LINE_DEFAULT_LENGTH_MM / 2
  if (!bounds) {
    return { start: { x: 22, y: -half }, end: { x: 22, y: half } }
  }
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  const grainCx = cx + 22
  return { start: { x: grainCx, y: cy - half }, end: { x: grainCx, y: cy + half } }
}

/** Setzt `grainLine` einmalig, wenn noch keine gespeichert ist. */
export function withDefaultGrainLine(piece: PatternPiece): PatternPiece {
  if (piece.grainLine != null || piece.cutLine.length < 3) return piece
  return { ...piece, grainLine: createDefaultGrainLine(piece) }
}

/** Gespeicherte Laufrichtung oder feste Standardlinie (nur Anzeige, wenn noch nicht materialisiert). */
export function getPieceGrainLine(piece: PatternPiece): Line {
  if (piece.grainLine) return piece.grainLine
  return createDefaultGrainLine(piece)
}

/**
 * Geometrie des gezeichneten Laufrichtungspfeils (Teilkoordinaten) — wie in PieceGroup gerendert.
 */
export function getGrainArrowLayout(piece: PatternPiece): {
  line: Line
  tickStart: Point
  tickEnd: Point
  tickBaseLeft: Point
  tickBaseRight: Point
  tickTriangleD: string
  endTip: Point
  baseLeft: Point
  baseRight: Point
  triangleD: string
} | null {
  if (piece.cutLine.length < 3) return null
  const line = getPieceGrainLine(piece)
  const aw = GRAIN_ARROW_HEAD_WIDTH_MM
  const ah = GRAIN_ARROW_HEAD_HEIGHT_MM
  const tickLen = GRAIN_ARROW_TICK_LEN_MM
  const angle = Math.atan2(line.end.y - line.start.y, line.end.x - line.start.x)
  const endTip = { ...line.end }
  const baseMidX = endTip.x - ah * Math.cos(angle)
  const baseMidY = endTip.y - ah * Math.sin(angle)
  const baseLeft = { x: baseMidX - aw * Math.sin(angle), y: baseMidY + aw * Math.cos(angle) }
  const baseRight = { x: baseMidX + aw * Math.sin(angle), y: baseMidY - aw * Math.cos(angle) }
  const perpX = -Math.sin(angle)
  const perpY = Math.cos(angle)
  const midX = (line.start.x + line.end.x) / 2
  const midY = (line.start.y + line.end.y) / 2
  const tickStart = { x: midX, y: midY }
  const tickEnd = { x: midX + perpX * tickLen, y: midY + perpY * tickLen }
  const tickAngle = Math.atan2(tickEnd.y - tickStart.y, tickEnd.x - tickStart.x)
  const tickTip = { ...tickEnd }
  const tickAh = ah * 0.75
  const tickAw = aw * 0.75
  const tickBaseMidX = tickTip.x - tickAh * Math.cos(tickAngle)
  const tickBaseMidY = tickTip.y - tickAh * Math.sin(tickAngle)
  const tickBaseLeft = {
    x: tickBaseMidX - tickAw * Math.sin(tickAngle),
    y: tickBaseMidY + tickAw * Math.cos(tickAngle),
  }
  const tickBaseRight = {
    x: tickBaseMidX + tickAw * Math.sin(tickAngle),
    y: tickBaseMidY - tickAw * Math.cos(tickAngle),
  }
  const tickTriangleD = `M ${tickTip.x} ${tickTip.y} L ${tickBaseLeft.x} ${tickBaseLeft.y} L ${tickBaseRight.x} ${tickBaseRight.y} Z`
  const triangleD = `M ${endTip.x} ${endTip.y} L ${baseLeft.x} ${baseLeft.y} L ${baseRight.x} ${baseRight.y} Z`
  return {
    line,
    tickStart,
    tickEnd,
    tickBaseLeft,
    tickBaseRight,
    tickTriangleD,
    endTip,
    baseLeft,
    baseRight,
    triangleD,
  }
}

function smallestAngleDiffDeg(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180
}

function contourTangentAngleDeg(curves: Curve[], curveIndex: number, t: number): number {
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
 * Laufrichtungslinie parallel zur Kontur-Tangente; optional Mittelpunkt auf `anchorPoint` setzen
 * (z. B. nächster Punkt auf der Kante beim Snappen).
 */
export function alignGrainLineToContourTangent(line: Line, tangentDeg: number, anchorPoint?: Point): Line {
  const curDeg =
    (Math.atan2(line.end.y - line.start.y, line.end.x - line.start.x) * 180) / Math.PI
  const opt0 = tangentDeg
  const opt1 = tangentDeg + 180
  const diff0 = Math.abs(smallestAngleDiffDeg(curDeg, opt0))
  const diff1 = Math.abs(smallestAngleDiffDeg(curDeg, opt1))
  const use1 = diff1 < diff0 - 1e-6
  const dirDeg = use1 ? opt1 : opt0
  const rad = (dirDeg * Math.PI) / 180
  const ux = Math.cos(rad)
  const uy = Math.sin(rad)
  const mx = anchorPoint?.x ?? (line.start.x + line.end.x) / 2
  const my = anchorPoint?.y ?? (line.start.y + line.end.y) / 2
  let L = Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y)
  if (L < 1e-6) L = GRAIN_LINE_DEFAULT_LENGTH_MM
  const half = L / 2
  return {
    start: { x: mx - ux * half, y: my - uy * half },
    end: { x: mx + ux * half, y: my + uy * half },
  }
}

/** Snapt Laufrichtung an die nächste Schnittkante (parallel + Mittelpunkt auf der Kante). */
export function snapGrainLineToContourEdge(
  line: Line,
  curves: Curve[],
  maxDistanceMm = GRAIN_SNAP_TO_EDGE_MM
): Line | null {
  if (curves.length === 0) return null
  const mid = {
    x: (line.start.x + line.end.x) / 2,
    y: (line.start.y + line.end.y) / 2,
  }
  const nr = nearestCurveIndexAndPoint(mid, curves)
  if (!nr || nr.distance > maxDistanceMm) return null
  const tangDeg = contourTangentAngleDeg(curves, nr.curveIndex, nr.t ?? 0)
  return alignGrainLineToContourTangent(line, tangDeg, nr.point)
}

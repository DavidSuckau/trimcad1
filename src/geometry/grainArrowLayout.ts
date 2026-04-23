import type { Line, PatternPiece, Point } from '../types/model'
import { curvesBounds } from './curveToPath'

/** Aktuelle Laufrichtungslinie (piece.grainLine oder Default vertikal). */
export function getPieceGrainLine(piece: PatternPiece): Line {
  if (piece.grainLine) return piece.grainLine
  const bounds = curvesBounds(piece.cutLine)
  if (!bounds) return { start: { x: 0, y: 0 }, end: { x: 0, y: 1 } }
  const cx = (bounds.minX + bounds.maxX) / 2
  const h = bounds.maxY - bounds.minY
  const inset = Math.max(h * 0.2, 3)
  const topY = bounds.minY + inset
  const bottomY = bounds.maxY - inset
  const grainCx = cx + 22
  return { start: { x: grainCx, y: topY }, end: { x: grainCx, y: bottomY } }
}

/**
 * Geometrie des gezeichneten Laufrichtungspfeils (Teilkoordinaten) — wie in PieceGroup gerendert.
 */
export function getGrainArrowLayout(piece: PatternPiece): {
  line: Line
  tickStart: Point
  tickEnd: Point
  endTip: Point
  baseLeft: Point
  baseRight: Point
  triangleD: string
} | null {
  if (piece.cutLine.length < 3) return null
  const bounds = curvesBounds(piece.cutLine)
  if (!bounds) return null
  const line = getPieceGrainLine(piece)
  const shaftH = Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y) || 1
  const awNom = 6
  const ahNom = 8
  /** Mittlere Querlinie: nur nach links, ca. 3 cm. */
  const tickLenNom = 30
  const scale = Math.min(1, shaftH / (2 * ahNom))
  const aw = awNom * scale
  const ah = ahNom * scale
  const tickLen = tickLenNom * scale
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
  // Nur einseitig nach links der Laufrichtung (kein rechter Anteil).
  const tickStart = { x: midX, y: midY }
  const tickEnd = { x: midX + perpX * tickLen, y: midY + perpY * tickLen }
  const triangleD = `M ${endTip.x} ${endTip.y} L ${baseLeft.x} ${baseLeft.y} L ${baseRight.x} ${baseRight.y} Z`
  return { line, tickStart, tickEnd, endTip, baseLeft, baseRight, triangleD }
}

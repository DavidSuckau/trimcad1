import { nearestCurveIndexAndPoint } from '../geometry/nearestOnCurve'
import { outwardNormalAngleAt } from '../geometry/curveToPath'
import { isNotchSpacingValidForCandidate } from '../geometry/notchMinSpacing'
import type { Notch, NotchType, PatternPiece } from '../types/model'

export type NotchPlacementResult = { ok: true; notch: Notch } | { ok: false; error: string }

/**
 * Kerbe an die Schnittkontur snappen (lokale Teilkoordinaten), Winkel nach außen wie im Editor.
 */
export function createNotchForAiPlacement(
  piece: PatternPiece,
  positionLocalX: number,
  positionLocalY: number,
  notchType: NotchType,
  depthMm: number,
  widthMm: number,
  angleDegOptional?: number,
): NotchPlacementResult {
  if (piece.cutLine.length < 2) {
    return { ok: false, error: 'Teil hat keine gueltige Schnittkontur.' }
  }
  const position = { x: positionLocalX, y: positionLocalY }
  const nearest = nearestCurveIndexAndPoint(position, piece.cutLine)
  if (!nearest) {
    return { ok: false, error: 'Position laesst sich nicht auf die Schnittkontur projizieren.' }
  }
  const notchPos = nearest.point
  const angle =
    angleDegOptional !== undefined && Number.isFinite(angleDegOptional)
      ? angleDegOptional
      : outwardNormalAngleAt(piece.cutLine, nearest.curveIndex, nearest.t ?? 0) + 180
  const id = 'n' + Math.random().toString(36).slice(2, 9)
  const notch: Notch = {
    id,
    position: notchPos,
    angle,
    type: notchType,
    depth: Math.max(0.1, depthMm),
    width: Math.max(0.1, widthMm),
  }
  if (!isNotchSpacingValidForCandidate(piece, notch)) {
    return { ok: false, error: 'Kerbe zu nah an einer anderen Kerbe (mind. 4 mm entlang der Kontur).' }
  }
  return { ok: true, notch }
}

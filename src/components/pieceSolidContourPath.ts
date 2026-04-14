import { closedPathD } from '../geometry/curveToPath'
import { cutLineWithNotchCutouts, seamLineWithNotchCutouts } from '../geometry/notchOnCurve'
import type { PatternPiece } from '../types/model'

export type PieceContourDisplayPaths = {
  solidPath: string | null
  dashedPath: string | null
  hasSeam: boolean
}

/**
 * Solide + gestrichelte Kontur wie in PieceGroup (Schnitt vs. Naht je nach Ansicht),
 * inkl. Kerben-Cutouts. Eine Quelle für Hauptzeichnung und Ghost-Overlay.
 */
export function getPieceContourDisplayPaths(
  piece: PatternPiece,
  cutSeamSwapped: boolean,
  excludeNotchId?: string | null,
): PieceContourDisplayPaths {
  const { cutLine, seamLine, notches } = piece
  const notchesForCutouts = excludeNotchId ? notches.filter((n) => n.id !== excludeNotchId) : notches
  const mergedCutLine = cutLineWithNotchCutouts(cutLine, notchesForCutouts, seamLine)
  const cutPath = closedPathD(mergedCutLine)
  const mergedSeamLine = seamLineWithNotchCutouts(cutLine, notchesForCutouts, seamLine)
  const seamPath = closedPathD(mergedSeamLine)
  const hasSeam = !!(seamPath && seamLine.length >= 3)
  const solidIsCut = !hasSeam || cutSeamSwapped
  const solidPath = solidIsCut ? cutPath : seamPath
  const dashedPath = solidIsCut ? seamPath : cutPath
  const solidOk = solidPath && String(solidPath).trim()
  const dashedOk = dashedPath && String(dashedPath).trim()
  return {
    solidPath: solidOk ? solidPath : null,
    dashedPath: dashedOk ? dashedPath : null,
    hasSeam,
  }
}

/** Nur die sichtbare Hauptkontur (solid), z. B. Ghost-Overlay. */
export function pieceSolidContourPathD(
  piece: PatternPiece,
  cutSeamSwapped: boolean,
  excludeNotchId?: string | null,
): string | null {
  return getPieceContourDisplayPaths(piece, cutSeamSwapped, excludeNotchId).solidPath
}

export function pieceGroupTransformAttr(piece: PatternPiece): string {
  const { transform } = piece
  return `translate(${transform.x},${transform.y}) rotate(${transform.rotation}) scale(${transform.mirrored ? -1 : 1},1)`
}

import { closedPathD, curveToPathD, cutLineFormsClosedLoop } from '../geometry/curveToPath'
import { cutLineWithNotchCutouts, seamLineWithNotchCutouts } from '../geometry/notchOnCurve'
import { getDisplayedCutLine, getDisplayedSeamLine } from '../geometry/vertexMaster'
import type { PatternPiece } from '../types/model'

export type PieceContourDisplayPaths = {
  solidPath: string | null
  dashedPath: string | null
  hasSeam: boolean
  /** Wenn true: keine Flächenfüllung für die Hauptkontur (offene Polylinie). */
  solidStrokeOnly: boolean
  dashedStrokeOnly: boolean
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
  const { notches } = piece
  const displayedCutLine = getDisplayedCutLine(piece).curves
  const displayedSeamLine = getDisplayedSeamLine(piece).curves
  const notchesForCutouts = excludeNotchId ? notches.filter((n) => n.id !== excludeNotchId) : notches
  const mergedCutLine = cutLineWithNotchCutouts(displayedCutLine, notchesForCutouts, displayedSeamLine)
  const mergedSeamLine = seamLineWithNotchCutouts(displayedCutLine, notchesForCutouts, displayedSeamLine)

  const cutClosed = mergedCutLine.length > 0 && cutLineFormsClosedLoop(mergedCutLine)
  const seamClosed =
    mergedSeamLine.length >= 2 && cutLineFormsClosedLoop(mergedSeamLine)

  const cutPathRaw = cutClosed ? closedPathD(mergedCutLine) : curveToPathD(mergedCutLine, { closed: false })
  const seamPathRaw =
    mergedSeamLine.length === 0
      ? ''
      : seamClosed
        ? closedPathD(mergedSeamLine)
        : curveToPathD(mergedSeamLine, { closed: false })

  const hasSeam = !!(seamPathRaw && String(seamPathRaw).trim() && displayedSeamLine.length >= 3)
  const solidIsCut = !hasSeam || cutSeamSwapped
  const solidPath = solidIsCut ? cutPathRaw : seamPathRaw
  const dashedPath = solidIsCut ? seamPathRaw : cutPathRaw
  const solidOk = solidPath && String(solidPath).trim()
  const dashedOk = dashedPath && String(dashedPath).trim()
  const solidStrokeOnly = solidIsCut ? !cutClosed : !seamClosed
  const dashedStrokeOnly = solidIsCut ? !seamClosed : !cutClosed
  return {
    solidPath: solidOk ? solidPath : null,
    dashedPath: dashedOk ? dashedPath : null,
    hasSeam,
    solidStrokeOnly,
    dashedStrokeOnly,
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

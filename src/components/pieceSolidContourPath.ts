import { closedPathD, curveToPathD, cutLineFormsClosedLoop } from '../geometry/curveToPath'
import { cutLineWithNotchCutouts, seamLineWithNotchCutouts } from '../geometry/notchOnCurve'
import { getDisplayedCutLine, getDisplayedSeamLine } from '../geometry/vertexMaster'
import { pieceGeomEpoch } from '../perf/interactionQuality'
import type { PatternPiece } from '../types/model'

export type PieceContourDisplayPaths = {
  solidPath: string | null
  dashedPath: string | null
  hasSeam: boolean
  /** Wenn true: keine Flächenfüllung für die Hauptkontur (offene Polylinie). */
  solidStrokeOnly: boolean
  dashedStrokeOnly: boolean
}

const PATH_CACHE_MAX = 64
const pathCache = new Map<string, PieceContourDisplayPaths>()

function pathCacheGet(key: string): PieceContourDisplayPaths | undefined {
  const hit = pathCache.get(key)
  if (hit === undefined) return undefined
  pathCache.delete(key)
  pathCache.set(key, hit)
  return hit
}

function pathCacheSet(key: string, value: PieceContourDisplayPaths): void {
  if (pathCache.has(key)) pathCache.delete(key)
  pathCache.set(key, value)
  while (pathCache.size > PATH_CACHE_MAX) {
    const oldest = pathCache.keys().next().value
    if (oldest === undefined) break
    pathCache.delete(oldest)
  }
}

export function clearPieceContourPathCache(): void {
  pathCache.clear()
}

/**
 * Solide + gestrichelte Kontur wie in PieceGroup (Schnitt vs. Naht je nach Ansicht),
 * inkl. Kerben-Cutouts. Eine Quelle für Hauptzeichnung und Ghost-Overlay.
 */
export function getPieceContourDisplayPaths(
  piece: PatternPiece,
  cutSeamSwapped: boolean,
  excludeNotchId?: string | null,
  simplifyNotches?: boolean,
): PieceContourDisplayPaths {
  const geomEpoch = pieceGeomEpoch(piece)
  const cacheKey = `${piece.id}|${geomEpoch}|${cutSeamSwapped}|${excludeNotchId ?? ''}|${simplifyNotches ? 1 : 0}`
  const cached = pathCacheGet(cacheKey)
  if (cached) return cached

  const { notches } = piece
  const displayedCutLine = getDisplayedCutLine(piece).curves
  const displayedSeamLine = getDisplayedSeamLine(piece).curves
  const notchesForCutouts = simplifyNotches
    ? []
    : excludeNotchId
      ? notches.filter((n) => n.id !== excludeNotchId)
      : notches
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
  const result: PieceContourDisplayPaths = {
    solidPath: solidOk ? solidPath : null,
    dashedPath: dashedOk ? dashedPath : null,
    hasSeam,
    solidStrokeOnly,
    dashedStrokeOnly,
  }
  pathCacheSet(cacheKey, result)
  return result
}

/** Nur die sichtbare Hauptkontur (solid), z. B. Ghost-Overlay. */
export function pieceSolidContourPathD(
  piece: PatternPiece,
  cutSeamSwapped: boolean,
  excludeNotchId?: string | null,
  simplifyNotches?: boolean,
): string | null {
  return getPieceContourDisplayPaths(piece, cutSeamSwapped, excludeNotchId, simplifyNotches).solidPath
}

export function pieceGroupTransformAttr(piece: PatternPiece): string {
  const { transform } = piece
  return `translate(${transform.x},${transform.y}) rotate(${transform.rotation}) scale(${transform.mirrored ? -1 : 1},1)`
}

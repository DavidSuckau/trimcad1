import type { Notch, PatternPiece } from '../types/model'
import { pathLengthAt, totalPathLength } from './curveToPath'
import { nearestCurveIndexAndPoint } from './nearestOnCurve'
import { resolveNotchCutLineAnchor } from './notchOnCurve'

/** Mindestabstand zwischen zwei Kerben entlang der Schnittkontur (Cut Line), in mm. */
export const NOTCH_MIN_SPACING_MM = 4

const LENGTH_EPS = 0.05

/**
 * Kleinster Abstand entlang der geschlossenen cutLine (Bogenlänge) zwischen dem
 * Kandidaten (curveIndex, t) und jedem anderen Notch. `excludeNotchId` z. B. beim Verschieben.
 */
export function minContourGapToOtherNotchesMm(
  piece: PatternPiece,
  candidateCurveIndex: number,
  candidateT: number,
  excludeNotchId?: string
): number {
  const cutLine = piece.cutLine
  if (cutLine.length < 2) return Number.POSITIVE_INFINITY
  const total = totalPathLength(cutLine)
  if (total <= LENGTH_EPS) return Number.POSITIVE_INFINITY

  const s0 = pathLengthAt(cutLine, candidateCurveIndex, candidateT)
  let minGap = Number.POSITIVE_INFINITY

  for (const n of piece.notches) {
    if (excludeNotchId != null && n.id === excludeNotchId) continue
    const anchor = resolveNotchCutLineAnchor(n, cutLine)
    if (!anchor) continue
    const s = pathLengthAt(cutLine, anchor.curveIndex, anchor.t)
    const d1 = Math.abs(s0 - s)
    const along = Math.min(d1, total - d1)
    if (along < minGap) minGap = along
  }

  return minGap
}

export function isNotchSpacingValid(
  piece: PatternPiece,
  candidateCurveIndex: number,
  candidateT: number,
  excludeNotchId?: string,
  minMm: number = NOTCH_MIN_SPACING_MM
): boolean {
  return minContourGapToOtherNotchesMm(piece, candidateCurveIndex, candidateT, excludeNotchId) >= minMm - LENGTH_EPS
}

/** Prüft Abstand für einen (noch nicht gespeicherten) Notch anhand von Anker / Position. */
export function isNotchSpacingValidForCandidate(
  piece: PatternPiece,
  candidate: Pick<Notch, 'position' | 'angle' | 'sNormalized' | 'arcLengthMm'>,
  excludeNotchId?: string,
  minMm: number = NOTCH_MIN_SPACING_MM
): boolean {
  const cutLine = piece.cutLine
  if (cutLine.length === 0) return true
  const anchor = resolveNotchCutLineAnchor(candidate as Notch, cutLine)
  if (anchor) {
    return isNotchSpacingValid(piece, anchor.curveIndex, anchor.t, excludeNotchId, minMm)
  }
  const nr = nearestCurveIndexAndPoint(candidate.position, cutLine)
  if (!nr) return false
  return isNotchSpacingValid(piece, nr.curveIndex, nr.t ?? 0, excludeNotchId, minMm)
}

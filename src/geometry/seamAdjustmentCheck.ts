import type { PatternPiece, SeamAssignment } from '../types/model'
import { isInternalSeamAssignment } from './internalSeamAssignment'
import {
  bestSeamSubSegmentPairing,
  edgeLengthInNotchRange,
  getNotchesOnEdgeInRange,
  getSubSegments,
  resolvedSeamAssignmentCurveIndices,
} from './seamUtils'

/** Mindestabweichung eines Subsegments (mm), ab der der Anpassungsdialog erscheint. */
export const SEAM_ADJUSTMENT_MISMATCH_TOLERANCE_MM = 0.1

/** Kerben gelten als bereits ausgerichtet, wenn die Zielposition näher als dieser Wert liegt. */
export const SEAM_ADJUSTMENT_NOTCH_ALIGNED_EPS_MM = 0.05

function roundMm(v: number): number {
  return Math.round(v * 100) / 100
}

export type SeamAdjustmentEvaluation = {
  fingerprint: string
  needsDialog: boolean
  lenA: number
  ncA: number
  ncB: number
  notchMismatch: boolean
  diffs: { idx: number; diff: number }[]
  canAdjust: boolean
  maxMismatchMm: number
}

/**
 * Geometrie-Signatur einer Naht-Zuordnung (unabhängig von Teil-Transform).
 * Gleiche Signatur nach Verschieben/Drehen → kein erneuter Dialog nötig.
 */
export function seamAdjustmentFingerprint(
  assignment: SeamAssignment,
  pieceA: PatternPiece,
  pieceB: PatternPiece
): string {
  const idxA = resolvedSeamAssignmentCurveIndices(pieceA, assignment.curveIndicesA)
  const idxB = resolvedSeamAssignmentCurveIndices(pieceB, assignment.curveIndicesB)
  const subsA = getSubSegments(pieceA, idxA, undefined, assignment.notchRangeA)
  const subsB = getSubSegments(pieceB, idxB, undefined, assignment.notchRangeB)
  const notchesA = getNotchesOnEdgeInRange(pieceA, idxA, assignment.notchRangeA)
  const notchesB = getNotchesOnEdgeInRange(pieceB, idxB, assignment.notchRangeB)
  return JSON.stringify({
    lenA: roundMm(edgeLengthInNotchRange(pieceA, idxA, assignment.notchRangeA)),
    lenB: roundMm(edgeLengthInNotchRange(pieceB, idxB, assignment.notchRangeB)),
    ncA: notchesA.length,
    ncB: notchesB.length,
    subsA: subsA.map((s) => roundMm(s.length)),
    subsB: subsB.map((s) => roundMm(s.length)),
    arcsA: notchesA.map((n) => roundMm(n.arcLength)),
    arcsB: notchesB.map((n) => roundMm(n.arcLength)),
  })
}

export function evaluateSeamAdjustment(
  assignment: SeamAssignment,
  pieceA: PatternPiece,
  pieceB: PatternPiece
): SeamAdjustmentEvaluation | null {
  if (isInternalSeamAssignment(assignment)) return null

  const idxA = resolvedSeamAssignmentCurveIndices(pieceA, assignment.curveIndicesA)
  const idxB = resolvedSeamAssignmentCurveIndices(pieceB, assignment.curveIndicesB)
  const lenA = edgeLengthInNotchRange(pieceA, idxA, assignment.notchRangeA)
  const lenB = edgeLengthInNotchRange(pieceB, idxB, assignment.notchRangeB)
  const ncA = getNotchesOnEdgeInRange(pieceA, idxA, assignment.notchRangeA).length
  const ncB = getNotchesOnEdgeInRange(pieceB, idxB, assignment.notchRangeB).length
  const fingerprint = seamAdjustmentFingerprint(assignment, pieceA, pieceB)

  const notchMismatch = ncA !== ncB
  const diffs: { idx: number; diff: number }[] = []

  if (Math.abs(lenA - lenB) >= SEAM_ADJUSTMENT_MISMATCH_TOLERANCE_MM) {
    return {
      fingerprint,
      needsDialog: false,
      lenA,
      ncA,
      ncB,
      notchMismatch,
      diffs,
      canAdjust: false,
      maxMismatchMm: Math.abs(lenA - lenB),
    }
  }

  if (notchMismatch || ncA < 1) {
    return {
      fingerprint,
      needsDialog: false,
      lenA,
      ncA,
      ncB,
      notchMismatch,
      diffs,
      canAdjust: false,
      maxMismatchMm: 0,
    }
  }

  const subsA = getSubSegments(pieceA, idxA, undefined, assignment.notchRangeA)
  const subsB = getSubSegments(pieceB, idxB, undefined, assignment.notchRangeB)
  const pairing = bestSeamSubSegmentPairing(subsA, subsB)

  if (!pairing || subsA.length < 2) {
    return {
      fingerprint,
      needsDialog: false,
      lenA,
      ncA,
      ncB,
      notchMismatch,
      diffs,
      canAdjust: false,
      maxMismatchMm: 0,
    }
  }

  const rev = pairing.reverseB
  for (let i = 0; i < subsA.length; i++) {
    const sb = rev ? subsB[subsB.length - 1 - i] : subsB[i]
    const d = Math.abs(subsA[i].length - sb.length)
    if (d >= SEAM_ADJUSTMENT_MISMATCH_TOLERANCE_MM) diffs.push({ idx: i + 1, diff: d })
  }

  const needsDialog = pairing.maxSegmentMismatchMm >= SEAM_ADJUSTMENT_MISMATCH_TOLERANCE_MM
  return {
    fingerprint,
    needsDialog,
    lenA,
    ncA,
    ncB,
    notchMismatch,
    diffs,
    canAdjust: diffs.length > 0,
    maxMismatchMm: pairing.maxSegmentMismatchMm,
  }
}

/** Nach welchen Drag-Arten die Nahtanpassung geprüft werden soll (nicht bei reiner Teilverschiebung/Drehung). */
export function dragTriggersSeamAdjustmentCheck(kind: string | undefined): boolean {
  if (!kind) return false
  return (
    kind === 'vertex' ||
    kind === 'controlpoint' ||
    kind === 'pointOnCurve' ||
    kind === 'internalPointOnCurve' ||
    kind === 'internalLineVertex' ||
    kind === 'notchMove' ||
    kind === 'notch' ||
    kind === 'roundCorner'
  )
}

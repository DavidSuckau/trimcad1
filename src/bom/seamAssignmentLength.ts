import type { PatternPiece, SeamAssignment } from '../types/model'
import { internalSeamAssignmentLengthMm, isInternalSeamAssignment } from '../geometry/internalSeamAssignment'
import {
  edgeLengthInNotchRange,
  getCurvesForSeamEdge,
  resolvedSeamAssignmentCurveIndices,
} from '../geometry/seamUtils'

/** Bogenlänge einer Nahtzuordnung in mm (Kante A bzw. interne Linie). */
export function seamAssignmentLengthMm(
  pieceA: PatternPiece,
  assignment: SeamAssignment,
): number {
  if (isInternalSeamAssignment(assignment)) {
    return internalSeamAssignmentLengthMm(pieceA, assignment)
  }
  const idxA = resolvedSeamAssignmentCurveIndices(pieceA, assignment.curveIndicesA)
  const curvesA = getCurvesForSeamEdge(pieceA)
  return edgeLengthInNotchRange(pieceA, idxA, assignment.notchRangeA, curvesA)
}

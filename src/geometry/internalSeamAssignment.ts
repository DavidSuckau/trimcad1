import type { Curve, PatternPiece, Point, ProfileAssignment, SeamAssignment } from '../types/model'
import { curveSegmentArcLength } from './curveToPath'
import { nearestCurveIndexAndPoint } from './nearestOnCurve'
import {
  deriveInternalNotchRoleRangeAtArcLength,
  deriveInternalNotchRoleRangeOnPath,
  getInternalProfileCurvesInRange,
  getSingleInternalLineCurveIndices,
  internalProfileEdgeTotalLength,
} from './internalLineProfile'
import type { NotchBoundaryRange } from './seamUtils'

export function isInternalSeamAssignment(a: SeamAssignment): boolean {
  return a.isInternalSingle === true
}

export function isPairSeamAssignment(a: SeamAssignment): boolean {
  return !isInternalSeamAssignment(a)
}

/** Genau ein Segment in `internalLines` für diese Zuordnung. */
/** Genau ein `internalLines`-Segment — keine Polylinie über mehrere Einträge. */
export function getInternalSeamAssignmentCurveIndices(
  piece: PatternPiece,
  assignment: SeamAssignment
): number[] {
  if (!isInternalSeamAssignment(assignment)) return []
  const clicked = assignment.clickedCurveA
  if (clicked >= 0 && clicked < piece.internalLines.length) {
    return getSingleInternalLineCurveIndices(clicked)
  }
  const first = assignment.curveIndicesA[0]
  return first != null && first >= 0 && first < piece.internalLines.length
    ? getSingleInternalLineCurveIndices(first)
    : []
}

export function getInternalSeamAssignmentCurves(
  piece: PatternPiece,
  assignment: SeamAssignment
): Curve[] {
  if (!isInternalSeamAssignment(assignment)) return []
  const range: NotchBoundaryRange | null =
    assignment.notchRangeA?.startNotchId || assignment.notchRangeA?.endNotchId
      ? assignment.notchRangeA
      : null
  const indices = getInternalSeamAssignmentCurveIndices(piece, assignment)
  return getInternalProfileCurvesInRange(piece, indices, range)
}

export function internalSeamAssignmentLengthMm(
  piece: PatternPiece,
  assignment: SeamAssignment
): number {
  if (!isInternalSeamAssignment(assignment)) return 0
  const range = assignment.notchRangeA ?? null
  const indices = getInternalSeamAssignmentCurveIndices(piece, assignment)
  return internalProfileEdgeTotalLength(piece, indices, range)
}

export function hitInternalLineForSeamAssignment(
  local: Point,
  piece: PatternPiece,
  hitMm: number
): { curveIndices: number[]; curveIndex: number; t: number; distance: number } | null {
  if (piece.internalLines.length === 0) return null
  const nearest = nearestCurveIndexAndPoint(local, piece.internalLines)
  if (!nearest || nearest.distance >= hitMm) return null
  return {
    curveIndices: getSingleInternalLineCurveIndices(nearest.curveIndex),
    curveIndex: nearest.curveIndex,
    t: nearest.t ?? 0.5,
    distance: nearest.distance,
  }
}

export function remapProfileAssignmentsAfterInternalLineRemove(
  assignments: ProfileAssignment[],
  pieceId: string,
  removedCurveIndex: number
): ProfileAssignment[] {
  return assignments
    .filter((pa) => {
      if (pa.pieceId !== pieceId || !pa.onInternalLine) return true
      return pa.edgeIndex !== removedCurveIndex
    })
    .map((pa) => {
      if (pa.pieceId !== pieceId || !pa.onInternalLine) return pa
      if (pa.edgeIndex > removedCurveIndex) return { ...pa, edgeIndex: pa.edgeIndex - 1 }
      return pa
    })
}

export function remapInternalSeamAssignmentsAfterInternalLineRemove(
  assignments: SeamAssignment[],
  pieceId: string,
  removedCurveIndex: number
): SeamAssignment[] {
  return assignments.flatMap((a) => {
    if (!isInternalSeamAssignment(a) || a.pieceIdA !== pieceId) return [a]
    const ci = a.clickedCurveA
    if (ci === removedCurveIndex) return []
    const newCi = ci > removedCurveIndex ? ci - 1 : ci
    return [{ ...a, curveIndicesA: [newCi], clickedCurveA: newCi }]
  })
}

export function normalizeInternalSeamAssignmentCurveIndices(
  piece: PatternPiece,
  assignment: SeamAssignment
): SeamAssignment {
  if (!isInternalSeamAssignment(assignment)) return assignment
  const indices = getInternalSeamAssignmentCurveIndices(piece, assignment)
  const ci = indices[0] ?? assignment.clickedCurveA
  if (
    assignment.curveIndicesA.length === indices.length &&
    assignment.curveIndicesA[0] === ci &&
    assignment.clickedCurveA === ci
  ) {
    return assignment
  }
  return { ...assignment, curveIndicesA: indices, clickedCurveA: ci }
}

export function deriveInternalSeamNotchRangeAtClick(
  piece: PatternPiece,
  curveIndex: number,
  t: number
): NotchBoundaryRange | undefined {
  const curveIndices = getSingleInternalLineCurveIndices(curveIndex)
  const seg = piece.internalLines[curveIndex]
  const arcOnPath = seg ? curveSegmentArcLength(seg, 0, t) : 0
  return (
    deriveInternalNotchRoleRangeAtArcLength(piece, curveIndices, arcOnPath) ??
    deriveInternalNotchRoleRangeOnPath(piece, curveIndices) ??
    undefined
  )
}

import type { Curve, PatternPiece, Point, SeamAssignment } from '../types/model'
import { curveSegmentArcLength } from './curveToPath'
import { nearestCurveIndexAndPoint } from './nearestOnCurve'
import {
  deriveInternalNotchRoleRangeAtArcLength,
  deriveInternalNotchRoleRangeOnPath,
  getInternalProfileCurveIndices,
  getInternalProfileCurvesInRange,
  internalProfileEdgeTotalLength,
} from './internalLineProfile'
import type { NotchBoundaryRange } from './seamUtils'

export function isInternalSeamAssignment(a: SeamAssignment): boolean {
  return a.isInternalSingle === true
}

export function isPairSeamAssignment(a: SeamAssignment): boolean {
  return !isInternalSeamAssignment(a)
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
  const indices =
    assignment.curveIndicesA.length > 0
      ? assignment.curveIndicesA
      : getInternalProfileCurveIndices(piece)
  return getInternalProfileCurvesInRange(piece, indices, range)
}

export function internalSeamAssignmentLengthMm(
  piece: PatternPiece,
  assignment: SeamAssignment
): number {
  if (!isInternalSeamAssignment(assignment)) return 0
  const range = assignment.notchRangeA ?? null
  const indices =
    assignment.curveIndicesA.length > 0
      ? assignment.curveIndicesA
      : getInternalProfileCurveIndices(piece)
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
    curveIndices: getInternalProfileCurveIndices(piece),
    curveIndex: nearest.curveIndex,
    t: nearest.t ?? 0.5,
    distance: nearest.distance,
  }
}

export function deriveInternalSeamNotchRangeAtClick(
  piece: PatternPiece,
  curveIndices: number[],
  curveIndex: number,
  t: number
): NotchBoundaryRange | undefined {
  const lengths = curveIndices.map((ci) => {
    const seg = piece.internalLines[ci]
    return seg ? curveSegmentArcLength(seg, 0, 1) : 0
  })
  const prefix = lengths.slice(0, curveIndices.indexOf(curveIndex)).reduce((a, b) => a + b, 0)
  const seg = piece.internalLines[curveIndex]
  const arcOnPath = prefix + (seg ? curveSegmentArcLength(seg, 0, t) : 0)
  return (
    deriveInternalNotchRoleRangeAtArcLength(piece, curveIndices, arcOnPath) ??
    deriveInternalNotchRoleRangeOnPath(piece, curveIndices) ??
    undefined
  )
}

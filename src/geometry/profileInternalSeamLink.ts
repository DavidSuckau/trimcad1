import type { PatternPiece, ProfileAssignment, SeamAssignment, Workspace } from '../types/model'
import { isInternalSeamAssignment } from './internalSeamAssignment'
import {
  getInternalProfileCurveIndices,
  getNotchesOnInternalProfilePath,
  getProfileAssignmentInternalCurveIndices,
  internalProfileEdgeTotalLength,
} from './internalLineProfile'
import { getInternalSeamAssignmentCurveIndices } from './internalSeamAssignment'
import type { NotchBoundaryRange } from './seamUtils'

export type InternalPathArcInterval = { startArc: number; endArc: number }

function profileNotchRange(pa: ProfileAssignment): NotchBoundaryRange | null {
  if (!pa.startNotchId && !pa.endNotchId) return null
  return { startNotchId: pa.startNotchId, endNotchId: pa.endNotchId }
}

/** Bogenlängen-Intervall [startArc, endArc] auf der internen Polylinie. */
export function internalPathArcInterval(
  piece: PatternPiece,
  range?: NotchBoundaryRange | null,
  curveIndices?: number[]
): InternalPathArcInterval {
  const indices = curveIndices ?? getInternalProfileCurveIndices(piece)
  const total = internalProfileEdgeTotalLength(piece, indices, null)
  if (total <= 0) return { startArc: 0, endArc: 0 }
  if (!range?.startNotchId && !range?.endNotchId) {
    return { startArc: 0, endArc: total }
  }
  const all = getNotchesOnInternalProfilePath(piece, indices)
  const start = range.startNotchId ? all.find((n) => n.notchId === range.startNotchId) : null
  const end = range.endNotchId ? all.find((n) => n.notchId === range.endNotchId) : null
  const startArc = start ? start.arcLength : 0
  const endArc = end ? end.arcLength : total
  if (endArc > startArc) return { startArc, endArc }
  return { startArc: 0, endArc: total }
}

export function arcIntervalsOverlap(a: InternalPathArcInterval, b: InternalPathArcInterval): boolean {
  const overlap = Math.min(a.endArc, b.endArc) - Math.max(a.startArc, b.startArc)
  return overlap > 1e-6
}

export function arcIntervalOverlapLength(
  a: InternalPathArcInterval,
  b: InternalPathArcInterval
): number {
  return Math.max(0, Math.min(a.endArc, b.endArc) - Math.max(a.startArc, b.startArc))
}

export function isProfileSewnWithInternalSeam(pa: ProfileAssignment): boolean {
  return pa.onInternalLine === true && pa.internalLineAttachment === 'with_seam'
}

export function profileOverlapsInternalSeam(
  piece: PatternPiece,
  profile: ProfileAssignment,
  seam: SeamAssignment
): boolean {
  if (!profile.onInternalLine || !isInternalSeamAssignment(seam)) return false
  if (seam.pieceIdA !== profile.pieceId) return false
  if (piece.internalLines.length === 0) return false

  const profileInterval = internalPathArcInterval(
    piece,
    profileNotchRange(profile),
    getProfileAssignmentInternalCurveIndices(piece, profile)
  )
  const seamInterval = internalPathArcInterval(
    piece,
    seam.notchRangeA ?? null,
    getInternalSeamAssignmentCurveIndices(piece, seam)
  )
  return arcIntervalsOverlap(profileInterval, seamInterval)
}

export function profilesForInternalSeam(
  workspace: Workspace,
  seam: SeamAssignment
): ProfileAssignment[] {
  if (!isInternalSeamAssignment(seam)) return []
  const piece = workspace.pieces.find((p) => p.id === seam.pieceIdA)
  if (!piece) return []
  const profiles = workspace.profileAssignments ?? []
  return profiles.filter(
    (pa) =>
      isProfileSewnWithInternalSeam(pa) &&
      pa.pieceId === seam.pieceIdA &&
      profileOverlapsInternalSeam(piece, pa, seam)
  )
}

export function internalSeamForProfile(
  workspace: Workspace,
  profile: ProfileAssignment
): SeamAssignment | null {
  if (!isProfileSewnWithInternalSeam(profile)) return null
  const piece = workspace.pieces.find((p) => p.id === profile.pieceId)
  if (!piece) return null

  let best: SeamAssignment | null = null
  let bestOverlap = 0
  for (const seam of workspace.seamAssignments) {
    if (!profileOverlapsInternalSeam(piece, profile, seam)) continue
    const len = arcIntervalOverlapLength(
      internalPathArcInterval(
        piece,
        profileNotchRange(profile),
        getProfileAssignmentInternalCurveIndices(piece, profile)
      ),
      internalPathArcInterval(
        piece,
        seam.notchRangeA ?? null,
        getInternalSeamAssignmentCurveIndices(piece, seam)
      )
    )
    if (len > bestOverlap) {
      bestOverlap = len
      best = seam
    }
  }
  return best
}

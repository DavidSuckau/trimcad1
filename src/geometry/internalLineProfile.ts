import type { Curve, PatternPiece, Point, ProfileAssignment } from '../types/model'
import { bezierDerivativeAt, curveSegmentArcLength, signedAreaCurves } from './curveToPath'
import { nearestPointOnCurves } from './nearestOnCurve'
import {
  edgeLengthInNotchRange,
  getCurvesForSeamEdge,
  getEdgeCurvesInNotchRange,
  type NotchBoundaryRange,
  type NotchRoleRange,
} from './seamUtils'
import { enumerateEdges } from './edgeEnumeration'
import {
  isNotchOnInternalLine,
  resolveNotchInternalLineAnchor,
} from './notchOnInternalLine'

/** Ein einzelnes Segment in `internalLines` (ein Eintrag = eine Linie Punkt→Punkt). */
export function getSingleInternalLineCurveIndices(curveIndex: number): number[] {
  return curveIndex >= 0 ? [curveIndex] : []
}

/** Curve-Indices für ein Profil auf interner Linie (genau ein Segment). */
export function getProfileAssignmentInternalCurveIndices(
  piece: PatternPiece,
  pa: ProfileAssignment
): number[] {
  if (!pa.onInternalLine) return []
  const ci = pa.edgeIndex
  if (ci < 0 || ci >= piece.internalLines.length) return []
  return [ci]
}

export function getNotchesOnInternalProfilePath(
  piece: PatternPiece,
  curveIndices: number[],
  curves: Curve[] = piece.internalLines
): { notchId: string; arcLength: number }[] {
  if (curveIndices.length === 0 || curves.length === 0) return []

  const cumLengths: number[] = [0]
  for (const ci of curveIndices) {
    const seg = curves[ci]
    if (!seg) continue
    cumLengths.push(cumLengths[cumLengths.length - 1] + curveSegmentArcLength(seg, 0, 1))
  }

  const ciToIdx = new Map<number, number>()
  for (let i = 0; i < curveIndices.length; i++) ciToIdx.set(curveIndices[i], i)

  const ciSet = new Set(curveIndices)
  const result: { notchId: string; arcLength: number }[] = []

  for (const n of piece.notches) {
    if (!isNotchOnInternalLine(n)) continue
    const anchor = resolveNotchInternalLineAnchor(n, curves)
    if (!anchor || !ciSet.has(anchor.curveIndex)) continue
    const idx = ciToIdx.get(anchor.curveIndex)
    if (idx == null) continue
    const seg = curves[anchor.curveIndex]
    if (!seg) continue
    result.push({
      notchId: n.id,
      arcLength: cumLengths[idx] + curveSegmentArcLength(seg, 0, anchor.t),
    })
  }

  result.sort((a, b) => a.arcLength - b.arcLength)
  return result
}

function edgeTotalLengthOnCurves(curveIndices: number[], curves: Curve[]): number {
  let total = 0
  for (const ci of curveIndices) {
    const seg = curves[ci]
    if (seg) total += curveSegmentArcLength(seg, 0, 1)
  }
  return total
}

export function internalProfileEdgeTotalLength(
  piece: PatternPiece,
  curveIndices: number[],
  range?: NotchBoundaryRange | null
): number {
  const curves = piece.internalLines
  if (curveIndices.length === 0) return 0
  const all = getNotchesOnInternalProfilePath(piece, curveIndices, curves)
  const total = edgeTotalLengthOnCurves(curveIndices, curves)
  if (!range?.startNotchId && !range?.endNotchId) return total
  const start = range.startNotchId ? all.find((n) => n.notchId === range.startNotchId) : null
  const end = range.endNotchId ? all.find((n) => n.notchId === range.endNotchId) : null
  if (start && end && end.arcLength > start.arcLength) return end.arcLength - start.arcLength
  if (start && !end) return Math.max(0, total - start.arcLength)
  if (!start && end) return Math.max(0, end.arcLength)
  return total
}

export function deriveInternalNotchRoleRangeOnPath(
  piece: PatternPiece,
  curveIndices: number[]
): NotchRoleRange | null {
  if (curveIndices.length === 0) return null
  const curves = piece.internalLines
  const notches = getNotchesOnInternalProfilePath(piece, curveIndices, curves)
  if (notches.length < 2) return null
  const roleById = new Map(piece.notches.map((n) => [n.id, n.role]))
  const starts = notches.filter((n) => {
    const r = roleById.get(n.notchId)
    return r === 'nahtanfang' || r === 'beides'
  })
  const ends = notches.filter((n) => {
    const r = roleById.get(n.notchId)
    return r === 'nahtende' || r === 'beides'
  })
  if (starts.length !== 1 || ends.length !== 1) return null
  if (starts[0].notchId === ends[0].notchId) return null
  return { startNotchId: starts[0].notchId, endNotchId: ends[0].notchId }
}

export function deriveInternalNotchRoleRangeAtArcLength(
  piece: PatternPiece,
  curveIndices: number[],
  arcLengthOnEdge: number
): NotchBoundaryRange | null {
  const curves = piece.internalLines
  const notches = getNotchesOnInternalProfilePath(piece, curveIndices, curves)
  if (notches.length === 0) return null
  const roleById = new Map(piece.notches.map((n) => [n.id, n.role]))
  const starts = notches.filter((n) => {
    const r = roleById.get(n.notchId)
    return (r === 'nahtanfang' || r === 'beides') && n.arcLength <= arcLengthOnEdge
  })
  const ends = notches.filter((n) => {
    const r = roleById.get(n.notchId)
    return (r === 'nahtende' || r === 'beides') && n.arcLength >= arcLengthOnEdge
  })
  if (starts.length === 0 && ends.length === 0) return null
  if (starts.length === 0) return { endNotchId: ends[0].notchId }
  if (ends.length === 0) return { startNotchId: starts[starts.length - 1].notchId }
  const start = starts[starts.length - 1]
  const end = ends[0]
  if (start.notchId === end.notchId || start.arcLength >= end.arcLength) return null
  return { startNotchId: start.notchId, endNotchId: end.notchId }
}

/** Geometrie zwischen Rollen-Kerben auf der internen Polylinie. */
export function getInternalProfileCurvesInRange(
  piece: PatternPiece,
  curveIndices: number[],
  range?: NotchBoundaryRange | null
): Curve[] {
  return getEdgeCurvesInNotchRange(
    piece,
    curveIndices,
    range,
    piece.internalLines,
    getNotchesOnInternalProfilePath
  )
}

export function profileAssignmentLengthMm(piece: PatternPiece, pa: ProfileAssignment): number {
  const range: NotchBoundaryRange | null =
    pa.startNotchId || pa.endNotchId
      ? { startNotchId: pa.startNotchId, endNotchId: pa.endNotchId }
      : null
  if (pa.onInternalLine) {
    return internalProfileEdgeTotalLength(piece, getProfileAssignmentInternalCurveIndices(piece, pa), range)
  }
  const edges = enumerateEdges(piece)
  const edge = edges.find((e) => e.edgeIndex === pa.edgeIndex)
  if (!edge) return 0
  return edgeLengthInNotchRange(piece, edge.curveIndices, range)
}

/** Stückliste/Export: feste Soll-Länge wenn gesetzt, sonst gemessene Länge. */
export function profileAssignmentBillLengthMm(piece: PatternPiece, pa: ProfileAssignment): number {
  if (pa.targetLengthMm != null && Number.isFinite(pa.targetLengthMm) && pa.targetLengthMm > 0) {
    return pa.targetLengthMm
  }
  return profileAssignmentLengthMm(piece, pa)
}

export function getProfileAssignmentDisplayCurves(
  piece: PatternPiece,
  pa: ProfileAssignment
): Curve[] {
  const range: NotchBoundaryRange | null =
    pa.startNotchId || pa.endNotchId
      ? { startNotchId: pa.startNotchId, endNotchId: pa.endNotchId }
      : null

  if (pa.onInternalLine) {
    return getInternalProfileCurvesInRange(
      piece,
      getProfileAssignmentInternalCurveIndices(piece, pa),
      range
    )
  }

  const masterK = getCurvesForSeamEdge(piece)
  const edges = enumerateEdges(piece)
  const edge = edges.find((e) => e.edgeIndex === pa.edgeIndex)
  if (!edge) return []
  return getEdgeCurvesInNotchRange(piece, edge.curveIndices, range, masterK)
}

export type ProfileOffsetMode = 'contour-outward' | 'internal-left'

/** Abstand der sichtbaren Profil-Linie zur Kante (mm), wie in der Canvas-Darstellung. */
export const PROFILE_DISPLAY_OFFSET_MM = 20

const PROFILE_KEY_LABEL_EXTRA_MM = 10
const PROFILE_DETAIL_LABEL_EXTRA_MM = 16

function profileOffsetSign(
  mode: ProfileOffsetMode,
  masterKForContourSign?: Curve[]
): number {
  if (mode === 'internal-left') return 1
  const area = masterKForContourSign ? signedAreaCurves(masterKForContourSign) : 0
  return area >= 0 ? -1 : 1
}

function offsetProfileCurve(seg: Curve, outSign: number, offsetMm: number): Curve {
  if (seg.type === 'line') {
    const tdx = seg.end.x - seg.start.x
    const tdy = seg.end.y - seg.start.y
    const tlen = Math.hypot(tdx, tdy) || 1
    const ox = outSign * (-tdy / tlen) * offsetMm
    const oy = outSign * (tdx / tlen) * offsetMm
    return {
      type: 'line',
      start: { x: seg.start.x + ox, y: seg.start.y + oy },
      end: { x: seg.end.x + ox, y: seg.end.y + oy },
    }
  }
  const d0 = bezierDerivativeAt(seg, 0)
  const d1 = bezierDerivativeAt(seg, 1)
  const len0 = Math.hypot(d0.x, d0.y) || 1
  const len1 = Math.hypot(d1.x, d1.y) || 1
  const o0x = outSign * (-d0.y / len0) * offsetMm
  const o0y = outSign * (d0.x / len0) * offsetMm
  const o1x = outSign * (-d1.y / len1) * offsetMm
  const o1y = outSign * (d1.x / len1) * offsetMm
  return {
    type: 'bezier',
    start: { x: seg.start.x + o0x, y: seg.start.y + o0y },
    cp1: { x: seg.cp1.x + o0x, y: seg.cp1.y + o0y },
    cp2: { x: seg.cp2.x + o1x, y: seg.cp2.y + o1y },
    end: { x: seg.end.x + o1x, y: seg.end.y + o1y },
  }
}

/** Offset-Kurven der Profil-Darstellung (Teilkoordinaten, mm). */
export function getProfileAssignmentOffsetCurves(
  piece: PatternPiece,
  pa: ProfileAssignment,
  offsetMm: number = PROFILE_DISPLAY_OFFSET_MM
): Curve[] {
  const curves = getProfileAssignmentDisplayCurves(piece, pa)
  if (curves.length === 0) return []
  const masterK = getCurvesForSeamEdge(piece)
  const mode: ProfileOffsetMode = pa.onInternalLine ? 'internal-left' : 'contour-outward'
  const outSign = profileOffsetSign(mode, masterK)
  return curves.map((seg) => offsetProfileCurve(seg, outSign, offsetMm))
}

/** Label-Positionen der Profil-Darstellung (Teilkoordinaten, mm). */
export function getProfileAssignmentLabelPositions(
  piece: PatternPiece,
  pa: ProfileAssignment
): { key: Point; detail: Point } | null {
  const curves = getProfileAssignmentDisplayCurves(piece, pa)
  if (curves.length === 0) return null
  const firstSeg = curves[0]
  const lastSeg = curves[curves.length - 1]
  const startL = firstSeg.start
  const endL = lastSeg.end
  const edgeDx = endL.x - startL.x
  const edgeDy = endL.y - startL.y
  const edgeLen = Math.hypot(edgeDx, edgeDy) || 1
  const midLocal = { x: (startL.x + endL.x) / 2, y: (startL.y + endL.y) / 2 }
  const masterK = getCurvesForSeamEdge(piece)
  const mode: ProfileOffsetMode = pa.onInternalLine ? 'internal-left' : 'contour-outward'
  const outSign = profileOffsetSign(mode, masterK)
  const nxLocal = outSign * (-edgeDy / edgeLen)
  const nyLocal = outSign * (edgeDx / edgeLen)
  const keyOffsetMm = PROFILE_DISPLAY_OFFSET_MM + PROFILE_KEY_LABEL_EXTRA_MM
  const detailOffsetMm = PROFILE_DISPLAY_OFFSET_MM + PROFILE_DETAIL_LABEL_EXTRA_MM
  return {
    key: { x: midLocal.x + nxLocal * keyOffsetMm, y: midLocal.y + nyLocal * keyOffsetMm },
    detail: {
      x: midLocal.x + nxLocal * detailOffsetMm,
      y: midLocal.y + nyLocal * detailOffsetMm,
    },
  }
}

/** Treffer für Profil bearbeiten: Linie, Kennung und Detail-Label (Teilkoordinaten). */
export function hitProfileAssignment(
  piece: PatternPiece,
  pa: ProfileAssignment,
  local: Point,
  hitMm: number
): boolean {
  const offsetCurves = getProfileAssignmentOffsetCurves(piece, pa)
  if (offsetCurves.length > 0) {
    const nearest = nearestPointOnCurves(local, offsetCurves)
    if (nearest.distance <= hitMm) return true
  }
  const labels = getProfileAssignmentLabelPositions(piece, pa)
  if (!labels) return false
  if (Math.hypot(local.x - labels.key.x, local.y - labels.key.y) <= hitMm) return true
  if (Math.hypot(local.x - labels.detail.x, local.y - labels.detail.y) <= hitMm * 1.25) return true
  return false
}

/** Offset-Pfad für Profil-Linie (Teilkoordinaten, mm). */
export function buildProfileOffsetPathD(
  curves: Curve[],
  offsetMm: number,
  mode: ProfileOffsetMode,
  masterKForContourSign?: Curve[]
): string {
  const outSign = profileOffsetSign(mode, masterKForContourSign)
  let d = ''
  for (const seg of curves) {
    if (!seg) continue
    const off = offsetProfileCurve(seg, outSign, offsetMm)
    if (off.type === 'line') {
      d += `M ${off.start.x} ${off.start.y} L ${off.end.x} ${off.end.y} `
    } else {
      d += `M ${off.start.x} ${off.start.y} C ${off.cp1.x} ${off.cp1.y} ${off.cp2.x} ${off.cp2.y} ${off.end.x} ${off.end.y} `
    }
  }
  return d
}

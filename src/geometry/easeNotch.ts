import type {
  Curve,
  EaseNotchSource,
  Notch,
  PatternPiece,
  Point,
  SeamAssignment,
} from '../types/model'
import { pointAtPathLength, totalPathLength } from './curveToPath'
import { isInternalSeamAssignment } from './internalSeamAssignment'
import { isEaseNotch, isPassNotch } from './notchPurpose'
import {
  bestSeamSubSegmentPairing,
  edgeLengthInNotchRange,
  edgeTotalLength,
  getCurvesForSeamEdge,
  getNotchesOnEdge,
  getSubSegments,
  materializeNotchAtEdgeArcLength,
  resolvedSeamAssignmentCurveIndices,
} from './seamUtils'

export { isEaseNotch, isPassNotch } from './notchPurpose'

export const EASE_DEFAULT_SPACING_MM = 8
export const EASE_PASS_CLEARANCE_MM = 5
export const EASE_END_MARGIN_MM = 2
/** Relative Krümmungs-Kennzahl (Dreiecksfläche / Sehnen²); darüber = gekrümmt. */
export const EASE_CURVATURE_THRESHOLD = 0.012
export const EASE_CURVATURE_HALF_WINDOW_MM = 4
export const EASE_DEFAULT_DEPTH_MM = 2.5
export const EASE_DEFAULT_WIDTH_MM = 0.8

export type EaseSuggestion = {
  assignmentId: string
  /** Relative Lagen auf Kante A im aktiven Notch-Range [0,1]. */
  relativeTs: number[]
  spacingMm: number
  reverseB: boolean
  rangeStartA: number
  rangeEndA: number
  rangeStartB: number
  rangeEndB: number
}

function edgeCurvesForIndices(piece: PatternPiece, curveIndices: number[]): Curve[] {
  const master = getCurvesForSeamEdge(piece)
  return curveIndices.map((ci) => master[ci]).filter(Boolean) as Curve[]
}

/** Einfache lokale Krümmungs-Proxy über drei Punkte (±Fenster). */
export function localCurvatureProxy(edgeCurves: Curve[], arcMm: number, halfWindowMm = EASE_CURVATURE_HALF_WINDOW_MM): number {
  const total = totalPathLength(edgeCurves)
  if (total <= 1e-6) return 0
  const a0 = Math.max(0, arcMm - halfWindowMm)
  const a1 = Math.min(total, arcMm)
  const a2 = Math.min(total, arcMm + halfWindowMm)
  if (a2 - a0 < halfWindowMm * 0.5) return 0
  const p0 = pointAtPathLength(edgeCurves, a0)?.point
  const p1 = pointAtPathLength(edgeCurves, a1)?.point
  const p2 = pointAtPathLength(edgeCurves, a2)?.point
  if (!p0 || !p1 || !p2) return 0
  const area = Math.abs((p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x))
  const chord = Math.hypot(p2.x - p0.x, p2.y - p0.y)
  if (chord < 1e-6) return 0
  return area / (chord * chord)
}

function isCurvedAt(edgeCurves: Curve[], arcMm: number): boolean {
  return localCurvatureProxy(edgeCurves, arcMm) >= EASE_CURVATURE_THRESHOLD
}

function rangeBoundsMm(
  piece: PatternPiece,
  curveIndices: number[],
  range: SeamAssignment['notchRangeA'],
): { start: number; end: number } {
  const total = edgeTotalLength(piece, curveIndices)
  if (!range) return { start: 0, end: total }
  const len = edgeLengthInNotchRange(piece, curveIndices, range)
  const all = getNotchesOnEdge(piece, curveIndices)
  const start = range.startNotchId ? all.find((n) => n.notchId === range.startNotchId)?.arcLength ?? 0 : 0
  const end = range.endNotchId ? all.find((n) => n.notchId === range.endNotchId)?.arcLength ?? total : total
  if (end > start) return { start, end }
  // Fallback: volle Kante, wenn Range inkonsistent
  return { start: 0, end: total || len }
}

/**
 * Orientierung A↔B: bei genug Pass-Subsegmenten wie Nahtanpassung; sonst typisch gegenläufig.
 */
export function resolveEaseReverseB(
  assignment: SeamAssignment,
  pieceA: PatternPiece,
  pieceB: PatternPiece,
): boolean {
  const idxA = resolvedSeamAssignmentCurveIndices(pieceA, assignment.curveIndicesA)
  const idxB = resolvedSeamAssignmentCurveIndices(pieceB, assignment.curveIndicesB)
  const subsA = getSubSegments(pieceA, idxA, undefined, assignment.notchRangeA)
  const subsB = getSubSegments(pieceB, idxB, undefined, assignment.notchRangeB)
  const pairing = bestSeamSubSegmentPairing(subsA, subsB)
  if (pairing && subsA.length >= 2) return pairing.reverseB
  return true
}

/**
 * Vorschläge: relative t auf Kante A (im Notch-Range), nur in gekrümmten Bereichen, Abstand zu Pass-Kerben.
 */
export function suggestEaseRelativeTs(
  assignment: SeamAssignment,
  pieceA: PatternPiece,
  pieceB: PatternPiece,
  spacingMm: number = EASE_DEFAULT_SPACING_MM,
): EaseSuggestion | null {
  if (isInternalSeamAssignment(assignment)) return null
  if (spacingMm < 2 || !Number.isFinite(spacingMm)) return null

  const idxA = resolvedSeamAssignmentCurveIndices(pieceA, assignment.curveIndicesA)
  const idxB = resolvedSeamAssignmentCurveIndices(pieceB, assignment.curveIndicesB)
  if (idxA.length === 0 || idxB.length === 0) return null

  const boundsA = rangeBoundsMm(pieceA, idxA, assignment.notchRangeA)
  const boundsB = rangeBoundsMm(pieceB, idxB, assignment.notchRangeB)
  const spanA = boundsA.end - boundsA.start
  if (spanA < spacingMm * 2) return null

  const edgeA = edgeCurvesForIndices(pieceA, idxA)
  const passArcs = getNotchesOnEdge(pieceA, idxA)
    .filter((row) => {
      const n = pieceA.notches.find((x) => x.id === row.notchId)
      return n && isPassNotch(n)
    })
    .map((r) => r.arcLength)

  const relativeTs: number[] = []
  const margin = Math.min(EASE_END_MARGIN_MM, spanA * 0.08)
  const start = boundsA.start + margin
  const end = boundsA.end - margin
  if (end - start < spacingMm) return null

  for (let arc = start; arc <= end + 1e-6; arc += spacingMm) {
    const clamped = Math.min(end, Math.max(start, arc))
    if (!isCurvedAt(edgeA, clamped)) continue
    const nearPass = passArcs.some((p) => Math.abs(p - clamped) < EASE_PASS_CLEARANCE_MM)
    if (nearPass) continue
    const t = (clamped - boundsA.start) / spanA
    if (relativeTs.length > 0 && Math.abs(t - relativeTs[relativeTs.length - 1]!) * spanA < spacingMm * 0.55) {
      continue
    }
    relativeTs.push(Math.max(0, Math.min(1, t)))
  }

  if (relativeTs.length === 0) return null

  return {
    assignmentId: assignment.id,
    relativeTs,
    spacingMm,
    reverseB: resolveEaseReverseB(assignment, pieceA, pieceB),
    rangeStartA: boundsA.start,
    rangeEndA: boundsA.end,
    rangeStartB: boundsB.start,
    rangeEndB: boundsB.end,
  }
}

export function easeArcOnSide(
  suggestion: Pick<EaseSuggestion, 'relativeTs' | 'reverseB' | 'rangeStartA' | 'rangeEndA' | 'rangeStartB' | 'rangeEndB'>,
  relativeT: number,
  side: 'A' | 'B',
): number {
  const t = Math.max(0, Math.min(1, relativeT))
  if (side === 'A') {
    return suggestion.rangeStartA + t * (suggestion.rangeEndA - suggestion.rangeStartA)
  }
  const tB = suggestion.reverseB ? 1 - t : t
  return suggestion.rangeStartB + tB * (suggestion.rangeEndB - suggestion.rangeStartB)
}

export type EasePairDraft = {
  pairKey: string
  relativeT: number
  notchA: Notch
  notchB: Notch
}

export function buildEasePairDrafts(
  assignment: SeamAssignment,
  pieceA: PatternPiece,
  pieceB: PatternPiece,
  suggestion: EaseSuggestion,
  opts: {
    generateId: () => string
    source?: EaseNotchSource
    depthMm?: number
    widthMm?: number
  },
): EasePairDraft[] {
  const idxA = resolvedSeamAssignmentCurveIndices(pieceA, assignment.curveIndicesA)
  const idxB = resolvedSeamAssignmentCurveIndices(pieceB, assignment.curveIndicesB)
  const depth = opts.depthMm ?? EASE_DEFAULT_DEPTH_MM
  const width = opts.widthMm ?? EASE_DEFAULT_WIDTH_MM
  const source = opts.source ?? 'auto'
  const out: EasePairDraft[] = []

  for (const relativeT of suggestion.relativeTs) {
    const pairKey = opts.generateId()
    const arcA = easeArcOnSide(suggestion, relativeT, 'A')
    const arcB = easeArcOnSide(suggestion, relativeT, 'B')
    const baseA: Notch = {
      id: opts.generateId(),
      position: { x: 0, y: 0 },
      angle: 0,
      type: 'single',
      depth,
      width,
      purpose: 'ease',
      seamAssignmentId: assignment.id,
      easePairKey: pairKey,
      easeSource: source,
    }
    const baseB: Notch = {
      ...baseA,
      id: opts.generateId(),
      position: { x: 0, y: 0 },
    }
    const notchA = materializeNotchAtEdgeArcLength(baseA, pieceA, idxA, arcA)
    const notchB = materializeNotchAtEdgeArcLength(baseB, pieceB, idxB, arcB)
    if (!notchA || !notchB) continue
    out.push({ pairKey, relativeT, notchA, notchB })
  }
  return out
}

/** Preview-Punkte (piece-local) für Geister-Anzeige. */
export function easePreviewPoints(
  assignment: SeamAssignment,
  pieceA: PatternPiece,
  pieceB: PatternPiece,
  suggestion: EaseSuggestion,
): { side: 'A' | 'B'; point: Point; pieceId: string }[] {
  const idxA = resolvedSeamAssignmentCurveIndices(pieceA, assignment.curveIndicesA)
  const idxB = resolvedSeamAssignmentCurveIndices(pieceB, assignment.curveIndicesB)
  const edgeA = edgeCurvesForIndices(pieceA, idxA)
  const edgeB = edgeCurvesForIndices(pieceB, idxB)
  const pts: { side: 'A' | 'B'; point: Point; pieceId: string }[] = []
  for (const t of suggestion.relativeTs) {
    const arcA = easeArcOnSide(suggestion, t, 'A')
    const arcB = easeArcOnSide(suggestion, t, 'B')
    const pA = pointAtPathLength(edgeA, arcA)?.point
    const pB = pointAtPathLength(edgeB, arcB)?.point
    if (pA) pts.push({ side: 'A', point: pA, pieceId: pieceA.id })
    if (pB) pts.push({ side: 'B', point: pB, pieceId: pieceB.id })
  }
  return pts
}

export function stripEaseNotchesForAssignment(pieces: PatternPiece[], assignmentId: string): PatternPiece[] {
  return pieces.map((p) => ({
    ...p,
    notches: p.notches.filter((n) => !(isEaseNotch(n) && n.seamAssignmentId === assignmentId)),
  }))
}

export function stripAllEaseNotchesLinkedToAssignments(
  pieces: PatternPiece[],
  removedAssignmentIds: Set<string>,
): PatternPiece[] {
  if (removedAssignmentIds.size === 0) return pieces
  return pieces.map((p) => ({
    ...p,
    notches: p.notches.filter(
      (n) => !(isEaseNotch(n) && n.seamAssignmentId != null && removedAssignmentIds.has(n.seamAssignmentId)),
    ),
  }))
}

export function countEasePairsForAssignment(pieces: PatternPiece[], assignmentId: string): number {
  const keys = new Set<string>()
  for (const p of pieces) {
    for (const n of p.notches) {
      if (isEaseNotch(n) && n.seamAssignmentId === assignmentId && n.easePairKey) {
        keys.add(n.easePairKey)
      }
    }
  }
  return keys.size
}

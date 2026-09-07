import type { Curve, Notch, PatternPiece, Point, SeamAssignment } from '../types/model'
import { isInternalSeamAssignment } from './internalSeamAssignment'
import {
  getCurvesForSeamEdge,
  resolvedSeamAssignmentCurveIndices,
} from './seamUtils'
import { pointAtPathLength } from './curveToPath'
import {
  getSeamAssignmentDisplayMetrics,
  type SeamAssignmentDisplayMetrics,
} from './seamAdjustmentCheck'

function fallbackSegMid(segs: Curve[]): Point {
  const seg = segs[Math.floor(segs.length / 2)]!
  return {
    x: (seg.start.x + seg.end.x) / 2,
    y: (seg.start.y + seg.end.y) / 2,
  }
}

export type SeamPruefOverlayEntry = {
  assignmentId: string
  pieceIdA: string
  pieceIdB: string
  metrics: SeamAssignmentDisplayMetrics
  midALocal: Point
  midBLocal: Point
}

type CacheRec = {
  assignment: SeamAssignment
  cutA: Curve[]
  seamA: Curve[]
  notchesA: Notch[]
  cutB: Curve[]
  seamB: Curve[]
  notchesB: Notch[]
  saA: number | null | undefined
  saB: number | null | undefined
  entry: SeamPruefOverlayEntry
}

function sameNumArr(a: number[], b: number[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function sameNotchRange(
  a: SeamAssignment['notchRangeA'],
  b: SeamAssignment['notchRangeA'],
): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  return a.startNotchId === b.startNotchId && a.endNotchId === b.endNotchId
}

/** Zuordnung unverändert bzgl. Geometrie-Bezug (ohne Meta wie orderNumber/seamKind). */
function assignmentGeometryEqual(a: SeamAssignment, b: SeamAssignment): boolean {
  if (a === b) return true
  return (
    a.pieceIdA === b.pieceIdA &&
    a.pieceIdB === b.pieceIdB &&
    sameNumArr(a.curveIndicesA, b.curveIndicesA) &&
    sameNumArr(a.curveIndicesB, b.curveIndicesB) &&
    sameNotchRange(a.notchRangeA, b.notchRangeA) &&
    sameNotchRange(a.notchRangeB, b.notchRangeB)
  )
}

function pieceGeometryHit(prev: CacheRec, pieceA: PatternPiece, pieceB: PatternPiece): boolean {
  return (
    prev.cutA === pieceA.cutLine &&
    prev.seamA === pieceA.seamLine &&
    prev.notchesA === pieceA.notches &&
    prev.saA === pieceA.seamAllowanceMm &&
    prev.cutB === pieceB.cutLine &&
    prev.seamB === pieceB.seamLine &&
    prev.notchesB === pieceB.notches &&
    prev.saB === pieceB.seamAllowanceMm
  )
}

/**
 * Baut Anzeige-Einträge für Naht-Prüfanzeigen.
 * Cache hält teure Metriken über reine Transform-Änderungen (Verschieben/Drehen) hinweg.
 */
export function buildSeamPruefOverlayEntries(
  assignments: SeamAssignment[],
  pieces: PatternPiece[],
  cache: Map<string, CacheRec>,
): SeamPruefOverlayEntry[] {
  const byId = new Map(pieces.map((p) => [p.id, p]))
  const keep = new Set<string>()
  const out: SeamPruefOverlayEntry[] = []

  for (const a of assignments) {
    if (isInternalSeamAssignment(a)) continue
    const pieceA = byId.get(a.pieceIdA)
    const pieceB = byId.get(a.pieceIdB)
    if (!pieceA?.cutLine?.length || !pieceB?.cutLine?.length) continue

    keep.add(a.id)
    const prev = cache.get(a.id)
    if (prev && assignmentGeometryEqual(prev.assignment, a) && pieceGeometryHit(prev, pieceA, pieceB)) {
      out.push(prev.entry)
      continue
    }

    const metrics = getSeamAssignmentDisplayMetrics(a, pieceA, pieceB)
    if (!metrics) continue

    const idxA = resolvedSeamAssignmentCurveIndices(pieceA, a.curveIndicesA)
    const idxB = resolvedSeamAssignmentCurveIndices(pieceB, a.curveIndicesB)
    const curvesA = getCurvesForSeamEdge(pieceA)
    const curvesB = getCurvesForSeamEdge(pieceB)
    const segsA = idxA.map((ci) => curvesA[ci]).filter(Boolean)
    const segsB = idxB.map((ci) => curvesB[ci]).filter(Boolean)
    if (segsA.length === 0 || segsB.length === 0) continue

    const midResultA = pointAtPathLength(segsA, metrics.lenA / 2)
    const midResultB = pointAtPathLength(segsB, metrics.lenB / 2)
    const midALocal = midResultA ? midResultA.point : fallbackSegMid(segsA)
    const midBLocal = midResultB ? midResultB.point : fallbackSegMid(segsB)

    const entry: SeamPruefOverlayEntry = {
      assignmentId: a.id,
      pieceIdA: a.pieceIdA,
      pieceIdB: a.pieceIdB,
      metrics,
      midALocal,
      midBLocal,
    }
    cache.set(a.id, {
      assignment: a,
      cutA: pieceA.cutLine,
      seamA: pieceA.seamLine,
      notchesA: pieceA.notches,
      cutB: pieceB.cutLine,
      seamB: pieceB.seamLine,
      notchesB: pieceB.notches,
      saA: pieceA.seamAllowanceMm,
      saB: pieceB.seamAllowanceMm,
      entry,
    })
    out.push(entry)
  }

  for (const id of [...cache.keys()]) {
    if (!keep.has(id)) cache.delete(id)
  }
  return out
}

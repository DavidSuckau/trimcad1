import type { PatternPiece, EdgeSeamAllowance, ProfileAssignment, Curve, Point } from '../types/model'
import { bezierAt } from './curveToPath'
import { masterSoftVertexIndexSet, masterNotchVertexIndexSet } from './seamUtils'
import { getCurvesForSeamEdge } from './seamUtils'
import { nearestCurveIndexAndPoint } from './nearestOnCurve'

export type EnumeratedEdge = {
  edgeIndex: number
  curveIndices: number[]
  /** Start-Corner vertex index on master contour. */
  startCornerVi: number
}

/**
 * Zählt alle Kanten (Ecke-zu-Ecke-Segmentgruppen) auf der Master-Kontur auf.
 * Corner = harter Vertex (nicht soft, nicht Notch-anchored).
 * Rückgabe ist sortiert nach Umlaufrichtung, beginnend beim kleinsten Corner-Index.
 */
export function enumerateEdges(piece: PatternPiece): EnumeratedEdge[] {
  const curves = getCurvesForSeamEdge(piece)
  const n = curves.length
  if (n === 0) return []

  const softSet = masterSoftVertexIndexSet(piece)
  const notchVIs = masterNotchVertexIndexSet(piece)
  const isCorner = (vi: number) => !softSet.has(vi) && !notchVIs.has(vi)

  const corners: number[] = []
  for (let vi = 0; vi < n; vi++) {
    if (isCorner(vi)) corners.push(vi)
  }

  if (corners.length === 0) {
    return [{ edgeIndex: 0, curveIndices: Array.from({ length: n }, (_, i) => i), startCornerVi: 0 }]
  }

  const edges: EnumeratedEdge[] = []
  for (let ci = 0; ci < corners.length; ci++) {
    const startVi = corners[ci]
    const endVi = corners[(ci + 1) % corners.length]
    const indices: number[] = []
    let vi = startVi
    while (true) {
      indices.push(vi)
      const next = (vi + 1) % n
      if (next === endVi) break
      vi = next
    }
    if (indices.length === 0) indices.push(startVi)
    edges.push({ edgeIndex: ci, curveIndices: indices, startCornerVi: startVi })
  }
  return edges
}

/**
 * Liefert die effektive Nahtzugabe (mm) für einen gegebenen curveIndex auf der Master-Kontur.
 * Beachtet `edgeSeamAllowances` Overrides; fällt auf `seamAllowanceMm` zurück.
 */
export function getAllowanceForCurveIndex(
  piece: PatternPiece,
  curveIndex: number,
  edges?: EnumeratedEdge[]
): number {
  const defaultMm = piece.seamAllowanceMm ?? 0
  const overrides = piece.edgeSeamAllowances
  if (!overrides || overrides.length === 0) return defaultMm

  const edgeList = edges ?? enumerateEdges(piece)
  const overrideMap = new Map<number, number>()
  for (const o of overrides) overrideMap.set(o.edgeIndex, o.allowanceMm)

  for (const edge of edgeList) {
    if (edge.curveIndices.includes(curveIndex)) {
      return overrideMap.get(edge.edgeIndex) ?? defaultMm
    }
  }
  return defaultMm
}

/**
 * Baut eine Map curveIndex → allowanceMm für alle Segmente der Master-Kontur.
 * Wird vom variablen Offset-Algorithmus konsumiert.
 */
export function buildCurveIndexAllowanceMap(
  piece: PatternPiece,
  edges?: EnumeratedEdge[]
): Map<number, number> {
  const defaultMm = piece.seamAllowanceMm ?? 0
  const edgeList = edges ?? enumerateEdges(piece)
  const overrideMap = new Map<number, number>()
  if (piece.edgeSeamAllowances) {
    for (const o of piece.edgeSeamAllowances) overrideMap.set(o.edgeIndex, o.allowanceMm)
  }

  const result = new Map<number, number>()
  for (const edge of edgeList) {
    const mm = overrideMap.get(edge.edgeIndex) ?? defaultMm
    for (const ci of edge.curveIndices) {
      result.set(ci, mm)
    }
  }
  return result
}

/** Prüft ob irgendein Edge-Override vom Default abweicht (= variabler Offset nötig). */
export function hasVariableAllowance(piece: PatternPiece): boolean {
  const overrides = piece.edgeSeamAllowances
  if (!overrides || overrides.length === 0) return false
  const defaultMm = piece.seamAllowanceMm ?? 0
  return overrides.some(o => o.allowanceMm !== defaultMm)
}

// ---------------------------------------------------------------------------
// Geometrisches Remap von edgeSeamAllowances nach Topologie-Änderungen
// ---------------------------------------------------------------------------

function curveMidpoint(c: Curve): Point {
  if (c.type === 'line') {
    return { x: (c.start.x + c.end.x) / 2, y: (c.start.y + c.end.y) / 2 }
  }
  return bezierAt(c, 0.5)
}

/**
 * Robustes, geometrie-basiertes Remap von `edgeSeamAllowances` zwischen
 * zwei Piece-Zuständen (vor/nach einer Topologie-Änderung).
 *
 * Funktionsweise:
 * 1. Expandiert die alten Per-Edge-Overrides zu Per-Curve-Allowances (alte Enumeration)
 * 2. Projiziert jede neue Kurve geometrisch auf die nächstgelegene alte Kurve
 * 3. Überträgt die Allowance und rekonstruiert Per-Edge-Overrides (neue Enumeration)
 *
 * Funktioniert bei: Vertex-Insert/Remove, Soft↔Hard-Toggle, Segment-Split, etc.
 */
export function remapEdgeSeamAllowances(
  oldPiece: PatternPiece,
  newPiece: PatternPiece,
): EdgeSeamAllowance[] | undefined {
  const overrides = oldPiece.edgeSeamAllowances
  if (!overrides || overrides.length === 0) return undefined

  const defaultMm = newPiece.seamAllowanceMm ?? oldPiece.seamAllowanceMm ?? 0

  const oldCurves = getCurvesForSeamEdge(oldPiece)
  const newCurves = getCurvesForSeamEdge(newPiece)

  if (oldCurves.length === 0 || newCurves.length === 0) return undefined

  const oldCurveAllowance = buildCurveIndexAllowanceMap(oldPiece)

  // Für jede neue Kurve: geometrisch nächste alte Kurve finden, Allowance übertragen
  const newCurveAllowance = new Map<number, number>()
  for (let ni = 0; ni < newCurves.length; ni++) {
    const mid = curveMidpoint(newCurves[ni])
    const nearest = nearestCurveIndexAndPoint(mid, oldCurves)
    if (nearest) {
      const mm = oldCurveAllowance.get(nearest.curveIndex)
      if (mm != null) newCurveAllowance.set(ni, mm)
    }
  }

  // Neue Kanten aufbauen und Per-Edge-Overrides rekonstruieren
  const newEdges = enumerateEdges(newPiece)
  const result: EdgeSeamAllowance[] = []

  for (const edge of newEdges) {
    const counts = new Map<number, number>()
    for (const ci of edge.curveIndices) {
      const mm = newCurveAllowance.get(ci)
      if (mm != null && mm !== defaultMm) {
        counts.set(mm, (counts.get(mm) ?? 0) + 1)
      }
    }
    if (counts.size === 0) continue

    let bestMm = defaultMm
    let bestCount = 0
    for (const [mm, count] of counts) {
      if (count > bestCount) { bestMm = mm; bestCount = count }
    }
    if (bestMm !== defaultMm) {
      result.push({ edgeIndex: edge.edgeIndex, allowanceMm: bestMm })
    }
  }

  return result.length > 0 ? result : undefined
}

/**
 * Remapt `ProfileAssignment.edgeIndex` nach Topologie-Änderungen (Vertex-Insert/Remove,
 * Soft/Hard-Toggle).
 *
 * Strategie: Für jede Kurve der alten Kante wird per Majority-Vote ermittelt, welche
 * neue Kante die meisten Kurven enthält. So bleibt die Zuordnung stabil, auch wenn eine
 * Kante durch einen neuen Corner gesplittet wird.
 */
export function remapProfileAssignmentsForPiece(
  oldPiece: PatternPiece,
  newPiece: PatternPiece,
  assignments: ProfileAssignment[],
): ProfileAssignment[] {
  const pieceId = oldPiece.id
  const relevant = assignments.filter((pa) => pa.pieceId === pieceId)
  if (relevant.length === 0) return assignments

  const internalOnly = relevant.filter((pa) => pa.onInternalLine)
  if (internalOnly.length === relevant.length) {
    return assignments.map((pa) => {
      if (pa.pieceId !== pieceId || !pa.onInternalLine) return pa
      if (newPiece.internalLines.length === 0) return pa
      return { ...pa, edgeIndex: 0 }
    })
  }

  const oldEdges = enumerateEdges(oldPiece)
  const newEdges = enumerateEdges(newPiece)
  if (oldEdges.length === 0 || newEdges.length === 0) {
    return assignments.filter((pa) => pa.pieceId !== pieceId)
  }

  const oldCurves = getCurvesForSeamEdge(oldPiece)
  const newCurves = getCurvesForSeamEdge(newPiece)

  const newEdgeForCurveIndex = new Map<number, number>()
  for (const ne of newEdges) {
    for (const ci of ne.curveIndices) newEdgeForCurveIndex.set(ci, ne.edgeIndex)
  }

  const mapping = new Map<number, number>()
  for (const oldEdge of oldEdges) {
    const votes = new Map<number, number>()
    for (const ci of oldEdge.curveIndices) {
      const mp = curveMidpoint(oldCurves[ci])
      const near = nearestCurveIndexAndPoint(mp, newCurves)
      if (!near) continue
      const newEI = newEdgeForCurveIndex.get(near.curveIndex)
      if (newEI != null) votes.set(newEI, (votes.get(newEI) ?? 0) + 1)
    }
    let bestEdge = -1, bestCount = 0
    for (const [ei, cnt] of votes) {
      if (cnt > bestCount) { bestEdge = ei; bestCount = cnt }
    }
    if (bestEdge >= 0) mapping.set(oldEdge.edgeIndex, bestEdge)
  }

  return assignments.map((pa) => {
    if (pa.pieceId !== pieceId) return pa
    const newIdx = mapping.get(pa.edgeIndex)
    if (newIdx == null) return pa
    if (newIdx === pa.edgeIndex) return pa
    return { ...pa, edgeIndex: newIdx }
  })
}

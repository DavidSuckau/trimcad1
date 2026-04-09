import type { PatternPiece, EdgeSeamAllowance } from '../types/model'
import { masterSoftVertexIndexSet, masterNotchVertexIndexSet } from './seamUtils'
import { getCurvesForSeamEdge } from './seamUtils'

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

/**
 * Passt `edgeSeamAllowances`-Indices an, nachdem ein Vertex eingefügt wurde.
 * `insertedMasterVi` = der Master-Vertex-Index an dem eingefügt wurde.
 * Wenn der eingefügte Vertex eine neue Ecke (nicht soft) wäre, verschieben sich edgeIndices.
 * Da eingefügte Punkte typischerweise soft sind, ändert sich die Edge-Enumeration nicht.
 */
export function adjustEdgeAllowancesAfterInsert(
  edgeSeamAllowances: EdgeSeamAllowance[] | undefined,
  _insertedMasterVi: number,
  isSoft: boolean
): EdgeSeamAllowance[] | undefined {
  if (!edgeSeamAllowances || edgeSeamAllowances.length === 0) return edgeSeamAllowances
  if (isSoft) return edgeSeamAllowances
  // Hard-Corner wurde eingefügt → eine bestehende Kante wird gesplittet.
  // Da wir nicht wissen welche Kante, re-enumerieren wir: der Aufrufer muss
  // nach dem Insert die Stücke vergleichen und die Allowance der alten Kante auf beide Hälften übertragen.
  // Für den Moment: bei Hard-Insert Overrides löschen (konservativer Fallback).
  return undefined
}

/**
 * Passt `edgeSeamAllowances`-Indices an, nachdem ein Vertex entfernt wurde.
 * Wenn ein harter Eckpunkt gelöscht wird, werden zwei Kanten zu einer → die Allowance
 * der verbleibenden Kante wird die der Kante mit dem niedrigeren edgeIndex.
 */
export function adjustEdgeAllowancesAfterRemove(
  edgeSeamAllowances: EdgeSeamAllowance[] | undefined,
  _removedMasterVi: number,
  wasSoft: boolean
): EdgeSeamAllowance[] | undefined {
  if (!edgeSeamAllowances || edgeSeamAllowances.length === 0) return edgeSeamAllowances
  if (wasSoft) return edgeSeamAllowances
  // Hard-Corner gelöscht → konservativer Fallback: Overrides löschen.
  return undefined
}

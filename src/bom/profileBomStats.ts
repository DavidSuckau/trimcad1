import type { ProfileAssignment, PatternPiece } from '../types/model'
import { enumerateEdges } from '../geometry/edgeEnumeration'
import { edgeTotalLength } from '../geometry/seamUtils'

export type ProfileBomRow = {
  profileKey: string
  profileName: string
  internalArticleNumber?: string
  supplierNumber?: string
  totalLengthMm: number
  count: number
}

/**
 * Aggregiert alle Profilzuordnungen für die Stückliste.
 * Gleicher `profileKey` + `internalArticleNumber` = eine Zeile (Längen summiert).
 */
export function aggregateProfileBom(
  assignments: ProfileAssignment[],
  pieces: PatternPiece[],
): ProfileBomRow[] {
  const pieceById = new Map(pieces.map((p) => [p.id, p]))
  const map = new Map<string, ProfileBomRow>()

  for (const pa of assignments) {
    const piece = pieceById.get(pa.pieceId)
    if (!piece) continue
    const edges = enumerateEdges(piece)
    const edge = edges.find((e) => e.edgeIndex === pa.edgeIndex)
    const lengthMm = edge ? edgeTotalLength(piece, edge.curveIndices) : 0

    const groupKey = `${pa.profileKey}|||${pa.internalArticleNumber ?? ''}`
    const existing = map.get(groupKey)
    if (existing) {
      existing.totalLengthMm += lengthMm
      existing.count += 1
    } else {
      map.set(groupKey, {
        profileKey: pa.profileKey,
        profileName: pa.profileName,
        internalArticleNumber: pa.internalArticleNumber,
        supplierNumber: pa.supplierNumber,
        totalLengthMm: lengthMm,
        count: 1,
      })
    }
  }

  return [...map.values()].sort((a, b) => a.profileKey.localeCompare(b.profileKey))
}

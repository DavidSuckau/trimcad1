import type { PatternPiece, ProfileAssignment } from '../types/model'
import { enumerateEdges } from '../geometry/edgeEnumeration'
import { edgeTotalLength } from '../geometry/seamUtils'

/** Unterhalb: Hinweis „sehr kurz“ (mm). */
export const PROFILE_EDGE_WARN_MIN_MM = 5

/** Mindest-Länge der Vorher-Kante, damit eine prozentuale Änderung gemeldet wird. */
export const PROFILE_EDGE_WARN_PREV_MIN_MM = 8

/** Rel. Längenänderung ab der gewarnt wird (PROF-008). */
export const PROFILE_EDGE_WARN_CHANGE_RATIO = 0.25

/**
 * Kurze Texte für Toast (ohne Präfix `warn:`). Vergleicht Zuordnungen mit gleicher `id`
 * auf derselben Teil-Geometrie vorher/nachher.
 */
export function formatProfileEdgeGeometryWarnings(
  prevPiece: PatternPiece,
  nextPiece: PatternPiece,
  prevAssignments: ProfileAssignment[],
  nextAssignments: ProfileAssignment[],
): string | null {
  if (prevPiece.id !== nextPiece.id) return null
  const msgs: string[] = []
  const edgesNext = enumerateEdges(nextPiece)

  for (const pa of nextAssignments) {
    if (pa.pieceId !== nextPiece.id) continue
    const edge = edgesNext.find((e) => e.edgeIndex === pa.edgeIndex)
    if (!edge) continue
    const len = edgeTotalLength(nextPiece, edge.curveIndices)
    if (len < PROFILE_EDGE_WARN_MIN_MM) {
      msgs.push(`Profil „${pa.profileKey}“: Kante sehr kurz (${len.toFixed(1)} mm).`)
    }

    const prevPa = prevAssignments.find((x) => x.id === pa.id && x.pieceId === pa.pieceId)
    if (!prevPa) continue
    const edgesPrev = enumerateEdges(prevPiece)
    const pEdge = edgesPrev.find((e) => e.edgeIndex === prevPa.edgeIndex)
    if (!pEdge) continue
    const prevLen = edgeTotalLength(prevPiece, pEdge.curveIndices)
    if (
      prevLen >= PROFILE_EDGE_WARN_PREV_MIN_MM &&
      len > 0 &&
      Math.abs(len - prevLen) / prevLen >= PROFILE_EDGE_WARN_CHANGE_RATIO
    ) {
      const pct = Math.round((Math.abs(len - prevLen) / prevLen) * 100)
      msgs.push(`Profil „${pa.profileKey}“: Länge ca. ${pct} % geändert (${prevLen.toFixed(1)} → ${len.toFixed(1)} mm).`)
    }
  }

  if (msgs.length === 0) return null
  return msgs.slice(0, 2).join(' ')
}

export function mergeWarnToasts(existing: string | null, addition: string | null): string | null {
  if (!addition) return existing
  const add = addition.startsWith('warn:') ? addition : `warn:${addition}`
  if (!existing) return add
  const base = existing.startsWith('warn:') ? existing.slice(5) : existing
  const extra = add.startsWith('warn:') ? add.slice(5) : add
  return `warn:${base} — ${extra}`
}

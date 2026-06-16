import type { NotchRole } from '../types/model'
import type { NotchBoundaryRange } from './seamUtils'

const PROFILE_BOUNDARY_ROLES: ReadonlySet<NotchRole> = new Set(['nahtanfang', 'nahtende', 'beides'])

/** Kerbe eignet sich als Profil-Grenze (Nahtanfang, Nahtende oder beides). */
export function isProfileBoundaryNotchRole(role?: NotchRole | null): boolean {
  return role != null && PROFILE_BOUNDARY_ROLES.has(role)
}

type ArcNotch = { notchId: string; arcLength: number }

function roleBoundNotches(
  notches: ArcNotch[],
  roleById: Map<string, NotchRole | undefined>
): ArcNotch[] {
  return notches.filter((n) => isProfileBoundaryNotchRole(roleById.get(n.notchId)))
}

/**
 * Profil-Strecke relativ zur Klickposition auf einer Kante/Pfad:
 * - zwischen zwei Rollen-Kerben (Rollen-Typ egal),
 * - von Eckpunkt (Pfadstart) bis Rollen-Kerbe,
 * - von Rollen-Kerbe bis Eckpunkt (Pfadende).
 */
export function deriveProfileBoundaryRangeAtArcLength(
  notchesOnPath: ArcNotch[],
  arcLengthOnEdge: number,
  roleById: Map<string, NotchRole | undefined>
): NotchBoundaryRange | null {
  const bound = roleBoundNotches(notchesOnPath, roleById)
  if (bound.length === 0) return null

  const eps = 1e-6
  const before = bound.filter((n) => n.arcLength <= arcLengthOnEdge + eps)
  const after = bound.filter((n) => n.arcLength >= arcLengthOnEdge - eps)

  if (before.length > 0 && after.length > 0) {
    const start = before[before.length - 1]!
    const endAfter = after.find((n) => n.arcLength > start.arcLength + eps)
    if (endAfter && start.notchId !== endAfter.notchId) {
      return { startNotchId: start.notchId, endNotchId: endAfter.notchId }
    }
    // Klick direkt auf eine Rollen-Kerbe: Intervall zur nächsten Nachbar-Kerbe
    if (before.length >= 2) {
      const prev = before[before.length - 2]!
      if (start.arcLength - prev.arcLength > eps && prev.notchId !== start.notchId) {
        return { startNotchId: prev.notchId, endNotchId: start.notchId }
      }
    }
    const startBefore = after.find((n) => n.arcLength < start.arcLength - eps)
    if (startBefore && startBefore.notchId !== start.notchId) {
      return { startNotchId: startBefore.notchId, endNotchId: start.notchId }
    }
  }

  if (before.length > 0 && after.length === 0) {
    return { startNotchId: before[before.length - 1]!.notchId }
  }
  if (before.length === 0 && after.length > 0) {
    return { endNotchId: after[0]!.notchId }
  }

  return null
}

/** Fallback: genau zwei Rollen-Kerben auf dem Pfad → gesamtes Zwischensegment. */
export function deriveProfileBoundaryRangeOnPath(
  notchesOnPath: ArcNotch[],
  roleById: Map<string, NotchRole | undefined>
): NotchBoundaryRange | null {
  const bound = roleBoundNotches(notchesOnPath, roleById).sort((a, b) => a.arcLength - b.arcLength)
  if (bound.length !== 2) return null
  if (bound[1]!.arcLength <= bound[0]!.arcLength + 1e-6) return null
  return { startNotchId: bound[0]!.notchId, endNotchId: bound[1]!.notchId }
}

export function pieceNotchRoleById(piece: { notches: { id: string; role?: NotchRole }[] }): Map<string, NotchRole | undefined> {
  return new Map(piece.notches.map((n) => [n.id, n.role]))
}

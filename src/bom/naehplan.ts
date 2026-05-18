import type { PatternPiece, ProfileAssignment, SeamAssignment, Workspace } from '../types/model'
import { SEAM_ASSIGNMENT_KIND_IDS, SEAM_ASSIGNMENT_KIND_LABELS } from '../types/model'
import { isInternalSeamAssignment } from '../geometry/internalSeamAssignment'
import { profileAssignmentLengthMm } from '../geometry/internalLineProfile'
import {
  internalSeamForProfile,
  isProfileSewnWithInternalSeam,
  profilesForInternalSeam,
} from '../geometry/profileInternalSeamLink'
import { seamAssignmentLengthMm } from './seamAssignmentLength'

export type NaehplanRow = {
  /** Laufende Position nach Sortierung (1 … n) */
  stepNr: number
  /** Anzeige einer Zeile, z. B. „1. Schliessnaht … · 120,0 mm“ */
  line: string
  lengthMm: number
}

export type NaehplanSeamKindTotal = {
  kindKey: string
  kindLabel: string
  totalLengthMm: number
}

export type ProfilnahtRow = {
  line: string
  lengthMm: number
}

const PROFILNAHT_KIND_LABEL = 'Profilnaht'
const UNSET_SEAM_KIND_KEY = '__unset__'
const UNSET_SEAM_KIND_LABEL = 'Naht (ohne Art)'

function teilLabel(p: PatternPiece): string {
  return `Teil ${p.number}`
}

function fmtLengthMm(mm: number): string {
  return mm.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

function seamKindLabel(seamKind: SeamAssignment['seamKind']): string {
  if (seamKind == null) return 'Naht'
  return SEAM_ASSIGNMENT_KIND_LABELS[seamKind] ?? 'Naht'
}

function seamKindKey(seamKind: SeamAssignment['seamKind']): string {
  if (seamKind == null) return UNSET_SEAM_KIND_KEY
  return seamKind
}

function assignmentStillValid(a: SeamAssignment, byId: Map<string, PatternPiece>): boolean {
  if (!byId.has(a.pieceIdA)) return false
  if (isInternalSeamAssignment(a)) return true
  return byId.has(a.pieceIdB)
}

function profileAssignmentStillValid(pa: ProfileAssignment, byId: Map<string, PatternPiece>): boolean {
  return byId.has(pa.pieceId)
}

function formatProfilesInklSuffix(profiles: ProfileAssignment[]): string {
  if (profiles.length === 0) return ''
  const parts = profiles.map((p) => `${p.profileName} (${p.profileKey})`)
  return ` inkl. Profil ${parts.join(', ')}`
}

/**
 * Nahtzuordnungen als Nähplan: sortiert nach `orderNumber` (ohne Nummer zuletzt, Reihenfolge im Array),
 * nur Einträge, bei denen die referenzierten Teile noch existieren.
 */
export function buildNaehplanRows(workspace: Workspace): NaehplanRow[] {
  const { pieces, seamAssignments } = workspace
  const byId = new Map(pieces.map((p) => [p.id, p]))

  const indexed = seamAssignments
    .map((a, originalIndex) => ({ a, originalIndex }))
    .filter(({ a }) => assignmentStillValid(a, byId))

  indexed.sort((x, y) => {
    const ox = x.a.orderNumber
    const oy = y.a.orderNumber
    const xHas = ox != null && Number.isFinite(ox)
    const yHas = oy != null && Number.isFinite(oy)
    if (xHas && yHas) return ox! - oy!
    if (xHas && !yHas) return -1
    if (!xHas && yHas) return 1
    return x.originalIndex - y.originalIndex
  })

  return indexed.map(({ a }, i) => {
    const pa = byId.get(a.pieceIdA)!
    const kind = seamKindLabel(a.seamKind)
    const stepNr = i + 1
    const lengthMm = seamAssignmentLengthMm(pa, a)
    const lenLabel = fmtLengthMm(lengthMm)
    const linkedProfiles = isInternalSeamAssignment(a) ? profilesForInternalSeam(workspace, a) : []
    const profileSuffix = formatProfilesInklSuffix(linkedProfiles)
    const base = isInternalSeamAssignment(a)
      ? `${stepNr}. ${kind} auf interner Linie${profileSuffix}, ${teilLabel(pa)}`
      : `${stepNr}. ${kind} ${teilLabel(pa)} an ${teilLabel(byId.get(a.pieceIdB)!)}`
    const line = `${base} · ${lenLabel} mm`
    return { stepNr, line, lengthMm }
  })
}

/** Summen der Nahtlängen je Nahtart (ohne Profilnaht). */
export function buildNaehplanSeamKindTotals(workspace: Workspace): NaehplanSeamKindTotal[] {
  const { pieces, seamAssignments } = workspace
  const byId = new Map(pieces.map((p) => [p.id, p]))
  const sums = new Map<string, number>()

  for (const a of seamAssignments) {
    if (!assignmentStillValid(a, byId)) continue
    const pa = byId.get(a.pieceIdA)!
    const key = seamKindKey(a.seamKind)
    const len = seamAssignmentLengthMm(pa, a)
    sums.set(key, (sums.get(key) ?? 0) + len)
  }

  const orderedKeys: string[] = [
    ...SEAM_ASSIGNMENT_KIND_IDS,
    UNSET_SEAM_KIND_KEY,
  ].filter((k) => (sums.get(k) ?? 0) > 0)

  return orderedKeys.map((kindKey) => ({
    kindKey,
    kindLabel:
      kindKey === UNSET_SEAM_KIND_KEY
        ? UNSET_SEAM_KIND_LABEL
        : SEAM_ASSIGNMENT_KIND_LABELS[kindKey as keyof typeof SEAM_ASSIGNMENT_KIND_LABELS] ?? kindKey,
    totalLengthMm: sums.get(kindKey) ?? 0,
  }))
}

/** Einzelne Profilzuordnungen für die Stückliste (Art „Profilnaht“). */
export function buildProfilnahtRows(workspace: Workspace): ProfilnahtRow[] {
  const { pieces, profileAssignments } = workspace
  const byId = new Map(pieces.map((p) => [p.id, p]))
  const rows: ProfilnahtRow[] = []

  for (const pa of profileAssignments ?? []) {
    if (!profileAssignmentStillValid(pa, byId)) continue
    if (isProfileSewnWithInternalSeam(pa) && internalSeamForProfile(workspace, pa)) continue
    const piece = byId.get(pa.pieceId)!
    const lengthMm = profileAssignmentLengthMm(piece, pa)
    const where = pa.onInternalLine ? 'interne Linie' : `Kante ${pa.edgeIndex + 1}`
    const line = `${PROFILNAHT_KIND_LABEL} · ${pa.profileName} (${pa.profileKey}) · ${teilLabel(piece)}, ${where} · ${fmtLengthMm(lengthMm)} mm`
    rows.push({ line, lengthMm })
  }

  return rows.sort((a, b) => a.line.localeCompare(b.line, 'de'))
}

/** Gesamtlänge aller Profilnähte in mm. */
export function profilnahtTotalLengthMm(workspace: Workspace): number {
  return buildProfilnahtRows(workspace).reduce((sum, r) => sum + r.lengthMm, 0)
}

export { PROFILNAHT_KIND_LABEL }

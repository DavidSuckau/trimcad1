import type { PatternPiece, SeamAssignment, Workspace } from '../types/model'
import { SEAM_ASSIGNMENT_KIND_LABELS } from '../types/model'

export type NaehplanRow = {
  /** Laufende Position nach Sortierung (1 … n) */
  stepNr: number
  /** Anzeige einer Zeile, z. B. „1 Schliessnaht / Standardnaht Teil 001 an Teil 002“ */
  line: string
}

function teilLabel(p: PatternPiece): string {
  return `Teil ${p.number}`
}

function seamKindLabel(seamKind: SeamAssignment['seamKind']): string {
  if (seamKind == null) return 'Naht'
  return SEAM_ASSIGNMENT_KIND_LABELS[seamKind] ?? 'Naht'
}

/**
 * Nahtzuordnungen als Nähplan: sortiert nach `orderNumber` (ohne Nummer zuletzt, Reihenfolge im Array),
 * nur Einträge, bei denen beide Teile noch existieren.
 */
export function buildNaehplanRows(workspace: Workspace): NaehplanRow[] {
  const { pieces, seamAssignments } = workspace
  const byId = new Map(pieces.map((p) => [p.id, p]))

  const indexed = seamAssignments
    .map((a, originalIndex) => ({ a, originalIndex }))
    .filter(({ a }) => byId.has(a.pieceIdA) && byId.has(a.pieceIdB))

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
    const pb = byId.get(a.pieceIdB)!
    const kind = seamKindLabel(a.seamKind)
    const stepNr = i + 1
    const line = `${stepNr}. ${kind} ${teilLabel(pa)} an ${teilLabel(pb)}`
    return { stepNr, line }
  })
}

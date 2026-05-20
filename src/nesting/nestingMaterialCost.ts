import type { PatternPiece } from '../types/model'
import type { MaterialCatalogRow } from '../material/materialCatalogTypes'
import { findCatalogRowByMaterialKey } from '../bom/materialCatalogCost'
import { getCutLineAreaMm2 } from '../bom/pieceBomStats'
import { piecesForMaterial } from './nestingMaterial'

export type NestingMaterialCostResult = {
  costEuro: number | null
  /** z. B. „2,450 m × 12,00 €/m“ */
  formulaLabel: string | null
  /** Geschätzt (ohne berechneten Zuschnittplan). */
  isEstimate: boolean
}

export function fmtEuroNesting(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
}

function fmtNumDe(n: number, digits: number): string {
  return n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/**
 * Stoffkosten aus Rollenverbrauch (Zuschnittplan) und Katalog-EK.
 * lfm: Länge (m) × EK; m²: Länge × Rollenbreite × EK/m².
 */
export function nestingRollMaterialCost(
  usedLengthMm: number,
  rollWidthMm: number,
  row: MaterialCatalogRow | null,
): NestingMaterialCostResult {
  if (!row) return { costEuro: null, formulaLabel: null, isEstimate: false }
  const price = row.purchasePrice
  if (price == null || !Number.isFinite(price) || usedLengthMm <= 0) {
    return { costEuro: null, formulaLabel: null, isEstimate: false }
  }

  const lengthM = usedLengthMm / 1000
  const widthM = rollWidthMm / 1000

  if (row.priceBasis === 'lfm') {
    const costEuro = price * lengthM
    const unit = fmtEuroNesting(price)
    return {
      costEuro,
      formulaLabel: `${fmtNumDe(lengthM, 3)} m × ${unit}/m`,
      isEstimate: false,
    }
  }

  if (row.priceBasis === 'm2') {
    const areaM2 = lengthM * widthM
    const costEuro = price * areaM2
    const unit = fmtEuroNesting(price)
    return {
      costEuro,
      formulaLabel: `${fmtNumDe(lengthM, 3)} m × ${fmtNumDe(widthM, 3)} m × ${unit}/m²`,
      isEstimate: false,
    }
  }

  return { costEuro: null, formulaLabel: null, isEstimate: false }
}

/** Mindest-Rollenlänge aus Teileflächen und Stückzahlen (ohne Nesting-Lücken). */
export function estimateRollLengthMmFromPieces(
  materialPieces: PatternPiece[],
  nestingInputs: Record<string, number>,
  rollWidthMm: number,
): number {
  if (rollWidthMm <= 0) return 0
  let totalAreaMm2 = 0
  for (const p of materialPieces) {
    const q = Math.max(0, Math.floor(nestingInputs[p.id] ?? 0))
    if (q <= 0) continue
    totalAreaMm2 += getCutLineAreaMm2(p) * q
  }
  if (totalAreaMm2 <= 0) return 0
  return totalAreaMm2 / rollWidthMm
}

export function materialHasNestingPieces(
  materialKey: string,
  pieces: PatternPiece[],
  nestingInputs: Record<string, number>,
): boolean {
  return piecesForMaterial(pieces, materialKey).some((p) => (nestingInputs[p.id] ?? 0) > 0)
}

export type NestingCostSummary = {
  /** Aktuelles Material (Plan oder Schätzung). */
  current: NestingMaterialCostResult & { materialLabel: string }
  /** Summe aller Materialien mit Stückzahl > 0. */
  totalAllMaterialsEuro: number | null
  /** Anzahl Materialien in der Summe. */
  materialCountInTotal: number
  /** Einzelmaterialien für Aufschlüsselung (optional). */
  byMaterial: Array<{ materialKey: string; label: string; cost: NestingMaterialCostResult }>
}

export function summarizeNestingMaterialCosts(params: {
  materialOptions: Array<{ materialKey: string; label: string; rollWidthMm: number }>
  pieces: PatternPiece[]
  nestingInputs: Record<string, number>
  catalogRows: MaterialCatalogRow[]
  selectedMaterialKey: string | null
  selectedPlanUsedLengthMm: number | null
}): NestingCostSummary | null {
  const {
    materialOptions,
    pieces,
    nestingInputs,
    catalogRows,
    selectedMaterialKey,
    selectedPlanUsedLengthMm,
  } = params

  const activeOptions = materialOptions.filter((o) =>
    materialHasNestingPieces(o.materialKey, pieces, nestingInputs),
  )
  if (activeOptions.length === 0) return null

  const byMaterial: NestingCostSummary['byMaterial'] = []
  let totalSum = 0
  let totalFinite = 0

  for (const opt of activeOptions) {
    const row = findCatalogRowByMaterialKey(catalogRows, opt.materialKey)
    const mp = piecesForMaterial(pieces, opt.materialKey)
    const isSelected = opt.materialKey === selectedMaterialKey
    const usedLengthMm =
      isSelected && selectedPlanUsedLengthMm != null && selectedPlanUsedLengthMm > 0
        ? selectedPlanUsedLengthMm
        : estimateRollLengthMmFromPieces(mp, nestingInputs, opt.rollWidthMm)
    const cost = nestingRollMaterialCost(usedLengthMm, opt.rollWidthMm, row)
    const withEstimate: NestingMaterialCostResult = {
      ...cost,
      isEstimate: !(isSelected && selectedPlanUsedLengthMm != null && selectedPlanUsedLengthMm > 0),
    }
    byMaterial.push({ materialKey: opt.materialKey, label: opt.label, cost: withEstimate })
    if (withEstimate.costEuro != null && Number.isFinite(withEstimate.costEuro)) {
      totalSum += withEstimate.costEuro
      totalFinite++
    }
  }

  const selectedOpt = activeOptions.find((o) => o.materialKey === selectedMaterialKey) ?? activeOptions[0]
  const currentEntry = byMaterial.find((b) => b.materialKey === selectedOpt.materialKey) ?? byMaterial[0]

  return {
    current: {
      materialLabel: currentEntry.label,
      ...currentEntry.cost,
    },
    totalAllMaterialsEuro: totalFinite > 0 ? totalSum : null,
    materialCountInTotal: activeOptions.length,
    byMaterial,
  }
}

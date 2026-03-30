import type { BomMaterialGroup } from './pieceBomStats'
import { materialLabelForBom } from './pieceBomStats'

export type MaterialAreaShare = {
  materialKey: string
  label: string
  totalAreaM2: number
  /** 0–100, gerundet für Anzeige */
  pct: number
}

/**
 * Flächenanteil je Material zur Gesamtfläche (Stückliste).
 */
export function computeMaterialAreaShares(
  byMaterial: BomMaterialGroup[],
  grandTotalAreaM2: number,
): MaterialAreaShare[] {
  if (!byMaterial.length || !(grandTotalAreaM2 > 0)) return []

  return byMaterial.map((g) => ({
    materialKey: g.materialKey,
    label: materialLabelForBom(g.materialKey),
    totalAreaM2: g.totalAreaM2,
    pct: (g.totalAreaM2 / grandTotalAreaM2) * 100,
  }))
}

/** Deutlich unterscheidbare Füllfarben für SVG-Segmente (kein reines Weiß). */
export const MATERIAL_PIE_COLORS = [
  '#1976d2',
  '#2e7d32',
  '#ed6c02',
  '#7b1fa2',
  '#c62828',
  '#00838f',
  '#5d4037',
  '#455a64',
  '#6a1b9a',
  '#1565c0',
]

import type { PatternPiece } from '../types/model'
import { signedAreaCurves, totalPathLength } from '../geometry/curveToPath'

/** Trimmt Material-String; leerer String bleibt leer (Anzeige separat). */
export function materialKeyForBom(material: string | undefined): string {
  return (material ?? '').trim()
}

export function materialLabelForBom(key: string): string {
  return key === '' ? '—' : key
}

export function getCutLineAreaMm2(piece: PatternPiece): number {
  if (!piece.cutLine.length) return 0
  return Math.abs(signedAreaCurves(piece.cutLine))
}

export function getCutLinePerimeterMm(piece: PatternPiece): number {
  if (!piece.cutLine.length) return 0
  return totalPathLength(piece.cutLine)
}

export type BomAggregateRow = {
  materialKey: string
  quantity: number
  areaMm2: number
  perimeterMm: number
}

export type BomMaterialGroup = {
  materialKey: string
  totalAreaM2: number
  totalPerimeterM: number
  /** Summe der Stückzahlen der Teile in dieser Gruppe */
  quantitySum: number
}

export type BomGrandTotals = {
  totalAreaM2: number
  totalPerimeterM: number
}

/**
 * Summiert Fläche (m²) und Umfang (m) gewichtet mit Stückzahl, gruppiert nach Material.
 */
export function aggregateBomByMaterial(rows: BomAggregateRow[]): {
  byMaterial: BomMaterialGroup[]
  grand: BomGrandTotals
} {
  const map = new Map<string, { areaM2: number; perimeterM: number; quantitySum: number }>()

  let grandAreaM2 = 0
  let grandPerimeterM = 0

  for (const row of rows) {
    const key = materialKeyForBom(row.materialKey)
    const q = Math.max(1, Math.floor(Number(row.quantity)) || 1)
    const areaM2 = (row.areaMm2 / 1_000_000) * q
    const perimeterM = (row.perimeterMm / 1000) * q

    grandAreaM2 += areaM2
    grandPerimeterM += perimeterM

    const prev = map.get(key)
    if (prev) {
      prev.areaM2 += areaM2
      prev.perimeterM += perimeterM
      prev.quantitySum += q
    } else {
      map.set(key, { areaM2, perimeterM, quantitySum: q })
    }
  }

  const byMaterial: BomMaterialGroup[] = [...map.entries()]
    .map(([materialKey, v]) => ({
      materialKey,
      totalAreaM2: v.areaM2,
      totalPerimeterM: v.perimeterM,
      quantitySum: v.quantitySum,
    }))
    .sort((a, b) => materialLabelForBom(a.materialKey).localeCompare(materialLabelForBom(b.materialKey), 'de'))

  return {
    byMaterial,
    grand: { totalAreaM2: grandAreaM2, totalPerimeterM: grandPerimeterM },
  }
}

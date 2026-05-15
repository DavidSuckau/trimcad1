import type { PatternPiece } from '../types/model'
import type { MaterialCatalogRow } from '../material/materialCatalogTypes'
import { getCutLineAreaMm2, materialKeyForBom } from './pieceBomStats'

export function findCatalogRowByMaterialKey(
  catalogRows: MaterialCatalogRow[],
  materialKey: string,
): MaterialCatalogRow | null {
  const k = materialKeyForBom(materialKey)
  if (!k) return null
  for (const row of catalogRows) {
    if (row.materialNumber.trim() === k) return row
  }
  return null
}

/** Katalog-Beschreibung zum Material-Key (Stückliste); ohne Treffer oder leer → „—“. */
export function catalogMaterialDescription(
  catalogRows: MaterialCatalogRow[],
  materialKey: string,
): string {
  const row = findCatalogRowByMaterialKey(catalogRows, materialKey)
  const d = row?.description?.trim()
  return d ? d : '—'
}

/**
 * Materialkosten für ein Teil (EK × Verbrauch), nur bei Katalogtreffer und gültigem EK.
 * Laufmeter: vereinfacht Fläche / Rollenbreite; ohne Rollenbreite bei lfm → null.
 */
export function pieceMaterialCostEuro(piece: PatternPiece, row: MaterialCatalogRow | null): number | null {
  if (!row) return null
  const price = row.purchasePrice
  if (price == null || !Number.isFinite(price)) return null

  const q = Math.max(1, Math.floor(Number(piece.bomQuantity)) || 1)
  const areaMm2 = getCutLineAreaMm2(piece)
  const areaM2 = (areaMm2 / 1_000_000) * q

  if (row.priceBasis === 'm2') {
    return price * areaM2
  }

  if (row.priceBasis === 'lfm') {
    const wMm = row.rollWidthMm
    if (wMm == null || !Number.isFinite(wMm) || wMm <= 0) return null
    const widthM = wMm / 1000
    const lfm = areaM2 / widthM
    return price * lfm
  }

  return null
}

/** Summe Materialkosten je Material-Key (wie Stückliste gruppiert). */
export function materialCostSumByMaterialKey(
  pieces: PatternPiece[],
  catalogRows: MaterialCatalogRow[],
): Map<string, number> {
  const sums = new Map<string, number>()
  for (const p of pieces) {
    const key = materialKeyForBom(p.material)
    const row = findCatalogRowByMaterialKey(catalogRows, key)
    const c = pieceMaterialCostEuro(p, row)
    if (c != null && Number.isFinite(c)) {
      sums.set(key, (sums.get(key) ?? 0) + c)
    }
  }
  return sums
}

export function totalMaterialCostEuro(pieces: PatternPiece[], catalogRows: MaterialCatalogRow[]): number {
  let total = 0
  for (const p of pieces) {
    const row = findCatalogRowByMaterialKey(catalogRows, materialKeyForBom(p.material))
    const c = pieceMaterialCostEuro(p, row)
    if (c != null && Number.isFinite(c)) total += c
  }
  return total
}

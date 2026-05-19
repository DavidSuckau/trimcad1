import type { PatternPiece } from '../types/model'
import { loadMaterialCatalog } from '../material/materialCatalogStorage'
import {
  aggregateBomByMaterial,
  getCutLineAreaMm2,
  getCutLinePerimeterMm,
  materialKeyForBom,
} from './pieceBomStats'
import {
  findCatalogRowByMaterialKey,
  pieceMaterialCostEuro,
  totalMaterialCostEuro,
} from './materialCatalogCost'

export type LiveBomSummary = {
  pieceCount: number
  totalAreaM2: number
  totalPerimeterM: number
  /** Summe Material (€) aus Katalog; null wenn kein Teil mit gültigem EK. */
  totalMaterialEuro: number | null
  /** Teile mit berechenbarem Katalogpreis. */
  pricedPieceCount: number
  /** Teile ohne Materialnr. oder ohne EK/Rollenbreite im Katalog. */
  unpricedPieceCount: number
}

/** Wie Stückliste – für Live-Anzeige auf der Arbeitsfläche (reagiert auf cutLine / bomQuantity / material). */
export function computeLiveBomSummary(pieces: PatternPiece[]): LiveBomSummary {
  const catalogRows = loadMaterialCatalog().rows
  const rows = pieces.map((p) => ({
    materialKey: p.material ?? '',
    quantity: p.bomQuantity ?? 1,
    areaMm2: getCutLineAreaMm2(p),
    perimeterMm: getCutLinePerimeterMm(p),
  }))
  const { grand } = aggregateBomByMaterial(rows)

  let pricedPieceCount = 0
  let unpricedPieceCount = 0
  for (const p of pieces) {
    const key = materialKeyForBom(p.material)
    const row = findCatalogRowByMaterialKey(catalogRows, key)
    const c = pieceMaterialCostEuro(p, row)
    if (c != null && Number.isFinite(c)) pricedPieceCount++
    else unpricedPieceCount++
  }

  const totalMaterialEuro =
    pricedPieceCount > 0 ? totalMaterialCostEuro(pieces, catalogRows) : null

  return {
    pieceCount: pieces.length,
    totalAreaM2: grand.totalAreaM2,
    totalPerimeterM: grand.totalPerimeterM,
    totalMaterialEuro,
    pricedPieceCount,
    unpricedPieceCount,
  }
}

export function fmtLiveBomAreaM2(m2: number): string {
  return m2.toLocaleString('de-DE', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}

export function fmtLiveBomPerimeterM(m: number): string {
  return m.toLocaleString('de-DE', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
}

export function fmtLiveBomEuro(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
}

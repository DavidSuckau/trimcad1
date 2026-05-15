import { describe, expect, it } from 'vitest'
import type { MaterialCatalogRow } from '../material/materialCatalogTypes'
import type { PatternPiece } from '../types/model'
import {
  findCatalogRowByMaterialKey,
  catalogMaterialDescription,
  materialCostSumByMaterialKey,
  pieceMaterialCostEuro,
  totalMaterialCostEuro,
} from './materialCatalogCost'

const square100: PatternPiece['cutLine'] = [
  { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
  { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
  { type: 'line', start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
  { type: 'line', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
]

function makePiece(over: Partial<PatternPiece> = {}): PatternPiece {
  return {
    id: 'p1',
    number: '001',
    name: 'Teil',
    cutLine: square100,
    seamLine: [],
    notches: [],
    drills: [],
    grainLine: null,
    internalLines: [],
    internalCircles: [],
    layer: 'CUT',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    material: 'M-1',
    bomQuantity: 1,
    ...over,
  }
}

function row(partial: Partial<MaterialCatalogRow>): MaterialCatalogRow {
  return {
    id: 'c1',
    createdAt: '2026-01-01T00:00:00.000Z',
    materialNumber: 'M-1',
    supplierSku: '',
    description: '',
    supplierName: '',
    purchasePrice: 10,
    priceBasis: 'm2',
    rollWidthMm: null,
    category: '',
    thicknessLabel: '',
    grainDirection: 'frei',
    storageLocation: '',
    quantityOnHand: null,
    ...partial,
  }
}

describe('materialCatalogCost', () => {
  it('findet Katalogzeile nach Materialnummer', () => {
    const rows = [row({ materialNumber: '  X-9  ' })]
    expect(findCatalogRowByMaterialKey(rows, 'X-9')).not.toBeNull()
    expect(findCatalogRowByMaterialKey(rows, 'X-9')?.materialNumber).toBe('  X-9  ')
  })

  it('m2: Kosten = EK × Fläche × Stückzahl', () => {
    const p = makePiece({ bomQuantity: 2 })
    const r = row({ purchasePrice: 5, priceBasis: 'm2' })
    // Fläche 100*100 mm² = 0,01 m²; × 2 Stück = 0,02 m²; × 5 €/m² = 0,10 €
    expect(pieceMaterialCostEuro(p, r)).toBeCloseTo(0.1, 6)
  })

  it('lfm: Kosten = EK × (Fläche / Rollenbreite)', () => {
    const p = makePiece({ bomQuantity: 1 })
    const r = row({
      purchasePrice: 8,
      priceBasis: 'lfm',
      rollWidthMm: 1000,
    })
    // 0,01 m² / 1 m Breite = 0,01 Lfm; × 8 €/m = 0,08 €
    expect(pieceMaterialCostEuro(p, r)).toBeCloseTo(0.08, 6)
  })

  it('lfm ohne Rollenbreite → null', () => {
    const p = makePiece()
    const r = row({ priceBasis: 'lfm', rollWidthMm: null })
    expect(pieceMaterialCostEuro(p, r)).toBeNull()
  })

  it('ohne EK → null', () => {
    const p = makePiece()
    const r = row({ purchasePrice: null })
    expect(pieceMaterialCostEuro(p, r)).toBeNull()
  })

  it('materialCostSumByMaterialKey summiert gleiche Material-Keys', () => {
    const a = makePiece({ id: 'a', material: 'M-1' })
    const b = makePiece({ id: 'b', material: 'M-1' })
    const cat = [row({ materialNumber: 'M-1', purchasePrice: 10, priceBasis: 'm2' })]
    const sums = materialCostSumByMaterialKey([a, b], cat)
    // je 0,01 m² × 10 = 0,1; Summe 0,2
    expect(sums.get('M-1')).toBeCloseTo(0.2, 5)
  })

  it('totalMaterialCostEuro', () => {
    const p = makePiece()
    const cat = [row({ purchasePrice: 10, priceBasis: 'm2' })]
    expect(totalMaterialCostEuro([p], cat)).toBeCloseTo(0.1, 5)
  })

  it('catalogMaterialDescription: Text aus Katalog oder —', () => {
    const cat = [row({ materialNumber: 'M-1', description: '  Jersey  ' })]
    expect(catalogMaterialDescription(cat, 'M-1')).toBe('Jersey')
    expect(catalogMaterialDescription(cat, 'unbekannt')).toBe('—')
    expect(catalogMaterialDescription(cat, '')).toBe('—')
  })
})

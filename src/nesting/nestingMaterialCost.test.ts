import { describe, expect, it } from 'vitest'
import type { MaterialCatalogRow } from '../material/materialCatalogTypes'
import type { PatternPiece } from '../types/model'
import { nestingRollMaterialCost, summarizeNestingMaterialCosts } from './nestingMaterialCost'

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
    rollWidthMm: 1000,
    category: '',
    thicknessLabel: '',
    grainDirection: 'frei',
    storageLocation: '',
    quantityOnHand: null,
    projectName: '',
    ...partial,
  }
}

describe('nestingRollMaterialCost', () => {
  it('lfm: Länge × EK', () => {
    const r = nestingRollMaterialCost(2500, 1500, row({ priceBasis: 'lfm', purchasePrice: 12 }))
    expect(r.costEuro).toBeCloseTo(30, 5)
    expect(r.formulaLabel).toContain('2,500 m')
  })

  it('m²: Länge × Breite × EK', () => {
    const r = nestingRollMaterialCost(2000, 1000, row({ priceBasis: 'm2', purchasePrice: 5 }))
    // 2 m × 1 m × 5 €/m² = 10 €
    expect(r.costEuro).toBeCloseTo(10, 5)
  })
})

describe('summarizeNestingMaterialCosts', () => {
  it('summiert zwei Materialien', () => {
    const p1 = makePiece({ id: 'a', material: 'M-1' })
    const p2 = makePiece({ id: 'b', material: 'M-2' })
    const cat = [
      row({ materialNumber: 'M-1', purchasePrice: 10, priceBasis: 'lfm' }),
      row({ materialNumber: 'M-2', purchasePrice: 10, priceBasis: 'lfm' }),
    ]
    const summary = summarizeNestingMaterialCosts({
      materialOptions: [
        { materialKey: 'M-1', label: 'Stoff A', rollWidthMm: 1000 },
        { materialKey: 'M-2', label: 'Stoff B', rollWidthMm: 1000 },
      ],
      pieces: [p1, p2],
      nestingInputs: { a: 1, b: 1 },
      catalogRows: cat,
      selectedMaterialKey: 'M-1',
      selectedPlanUsedLengthMm: 1000,
    })
    expect(summary).not.toBeNull()
    expect(summary!.materialCountInTotal).toBe(2)
    expect(summary!.totalAllMaterialsEuro).toBeGreaterThan(0)
    expect(summary!.current.isEstimate).toBe(false)
  })
})

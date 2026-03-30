import { describe, expect, it } from 'vitest'
import { computeMaterialAreaShares } from './materialAreaShare'
import type { BomMaterialGroup } from './pieceBomStats'

describe('computeMaterialAreaShares', () => {
  it('liefert Prozentanteile zur Gesamtfläche', () => {
    const byMaterial: BomMaterialGroup[] = [
      { materialKey: 'A', totalAreaM2: 2, totalPerimeterM: 4, quantitySum: 2 },
      { materialKey: 'B', totalAreaM2: 8, totalPerimeterM: 6, quantitySum: 1 },
    ]
    const rows = computeMaterialAreaShares(byMaterial, 10)
    expect(rows).toHaveLength(2)
    expect(rows[0].pct).toBeCloseTo(20, 5)
    expect(rows[1].pct).toBeCloseTo(80, 5)
  })

  it('liefert leer bei fehlender Gesamtfläche', () => {
    const byMaterial: BomMaterialGroup[] = [
      { materialKey: 'A', totalAreaM2: 0, totalPerimeterM: 0, quantitySum: 1 },
    ]
    expect(computeMaterialAreaShares(byMaterial, 0)).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { aggregateBomByMaterial, materialKeyForBom } from './pieceBomStats'

describe('aggregateBomByMaterial', () => {
  it('aggregiert zwei Materialien und leeres Material', () => {
    const { byMaterial, grand } = aggregateBomByMaterial([
      { materialKey: 'Baumwolle', quantity: 2, areaMm2: 1_000_000, perimeterMm: 4000 },
      { materialKey: 'Baumwolle', quantity: 1, areaMm2: 500_000, perimeterMm: 2000 },
      { materialKey: 'Seide', quantity: 1, areaMm2: 200_000, perimeterMm: 2000 },
      { materialKey: '', quantity: 1, areaMm2: 100_000, perimeterMm: 1000 },
    ])

    const baum = byMaterial.find((g) => g.materialKey === 'Baumwolle')
    expect(baum).toBeDefined()
    expect(baum!.totalAreaM2).toBeCloseTo(2 + 0.5, 6)
    expect(baum!.totalPerimeterM).toBeCloseTo(8 + 2, 6)
    expect(baum!.quantitySum).toBe(3)

    const seide = byMaterial.find((g) => g.materialKey === 'Seide')
    expect(seide!.totalAreaM2).toBeCloseTo(0.2, 6)
    expect(seide!.totalPerimeterM).toBeCloseTo(2, 6)

    const empty = byMaterial.find((g) => g.materialKey === '')
    expect(empty!.totalAreaM2).toBeCloseTo(0.1, 6)

    expect(grand.totalAreaM2).toBeCloseTo(2 + 0.5 + 0.2 + 0.1, 5)
    expect(grand.totalPerimeterM).toBeCloseTo(8 + 2 + 2 + 1, 5)
  })

  it('trimmt Material-Schlüssel für Gruppierung', () => {
    const { byMaterial } = aggregateBomByMaterial([
      { materialKey: '  Wolle ', quantity: 1, areaMm2: 1_000_000, perimeterMm: 4000 },
      { materialKey: 'Wolle', quantity: 1, areaMm2: 1_000_000, perimeterMm: 4000 },
    ])
    expect(byMaterial.filter((g) => g.materialKey === 'Wolle').length).toBe(1)
    expect(byMaterial[0].totalAreaM2).toBeCloseTo(2, 5)
  })
})

describe('materialKeyForBom', () => {
  it('trimmt', () => {
    expect(materialKeyForBom('  x  ')).toBe('x')
  })
})

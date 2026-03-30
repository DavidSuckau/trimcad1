import { describe, expect, it } from 'vitest'
import { buildMaterialPieSvgDocument } from './buildMaterialPieSvg'
import type { MaterialAreaShare } from './materialAreaShare'

describe('buildMaterialPieSvgDocument', () => {
  it('liefert SVG mit Tortenpfaden bei zwei Materialien', () => {
    const shares: MaterialAreaShare[] = [
      { materialKey: 'A', label: 'Baumwolle', totalAreaM2: 1, pct: 25 },
      { materialKey: 'B', label: 'Seide', totalAreaM2: 3, pct: 75 },
    ]
    const svg = buildMaterialPieSvgDocument(shares)
    expect(svg).toBeTruthy()
    expect(svg).toContain('<svg')
    expect(svg).toContain('<path')
    expect(svg).toContain('Baumwolle')
  })

  it('liefert null bei leerer Liste', () => {
    expect(buildMaterialPieSvgDocument([])).toBeNull()
  })
})

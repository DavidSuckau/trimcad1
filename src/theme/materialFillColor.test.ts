import { describe, expect, it } from 'vitest'
import { materialKeyNormalized, pieceInteriorFillFromMaterial } from './materialFillColor'

describe('pieceInteriorFillFromMaterial', () => {
  it('liefert null bei leerem Material', () => {
    expect(pieceInteriorFillFromMaterial('', false)).toBeNull()
    expect(pieceInteriorFillFromMaterial('   ', true)).toBeNull()
    expect(pieceInteriorFillFromMaterial(undefined, false)).toBeNull()
  })

  it('gleicher normalisierter Text → gleiche Farbe', () => {
    const a = pieceInteriorFillFromMaterial('Leder', false)
    const b = pieceInteriorFillFromMaterial('  leder  ', false)
    expect(a).toBeTruthy()
    expect(a).toBe(b)
  })

  it('unterschiedliche Materialien → unterschiedliche Farben', () => {
    const x = pieceInteriorFillFromMaterial('Baumwolle', false)
    const y = pieceInteriorFillFromMaterial('Polyester', false)
    expect(x).not.toBe(y)
  })

  it('Light und Dark liefern HSL-Strings', () => {
    expect(pieceInteriorFillFromMaterial('Wolle', false)).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/)
    expect(pieceInteriorFillFromMaterial('Wolle', true)).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/)
  })
})

describe('materialKeyNormalized', () => {
  it('trimmt und vereinheitlicht Großschreibung', () => {
    expect(materialKeyNormalized('  Leder  ')).toBe('leder')
  })
})

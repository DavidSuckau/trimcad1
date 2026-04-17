import { describe, expect, it } from 'vitest'
import { strokeColorForProfileKey } from './profileKeyColor'

describe('strokeColorForProfileKey', () => {
  it('liefert stabile, unterschiedliche Farben pro Kennung', () => {
    const a = strokeColorForProfileKey('A', false)
    const b = strokeColorForProfileKey('B', false)
    expect(a).toMatch(/^hsl\(/)
    expect(b).toMatch(/^hsl\(/)
    expect(a).not.toBe(b)
  })

  it('unterscheidet Hell- und Dunkelmodus', () => {
    const light = strokeColorForProfileKey('X', false)
    const dark = strokeColorForProfileKey('X', true)
    expect(light).not.toBe(dark)
  })
})

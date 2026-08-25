import { describe, expect, it } from 'vitest'
import { isInternalCircleHole, pathWithInternalCircleHoles, svgCircleSubpath } from './internalCirclePath'

describe('internalCirclePath', () => {
  it('baut geschlossenen Kreis-Subpfad', () => {
    const d = svgCircleSubpath(10, 20, 5)
    expect(d).toContain('A 5 5')
    expect(d.endsWith('Z')).toBe(true)
  })

  it('hängt nur hole-Kreise an den Außenpfad', () => {
    const outer = 'M 0 0 L 100 0 L 100 100 L 0 100 Z'
    const withHoles = pathWithInternalCircleHoles(outer, [
      { id: 'a', center: { x: 50, y: 50 }, radius: 10, mode: 'line' },
      { id: 'b', center: { x: 30, y: 30 }, radius: 8, mode: 'hole' },
    ])
    expect(withHoles.startsWith(outer)).toBe(true)
    expect(withHoles).toContain(svgCircleSubpath(30, 30, 8))
    expect(withHoles).not.toContain(svgCircleSubpath(50, 50, 10))
  })

  it('isInternalCircleHole', () => {
    expect(isInternalCircleHole({ id: '1', center: { x: 0, y: 0 }, radius: 1 })).toBe(false)
    expect(isInternalCircleHole({ id: '1', center: { x: 0, y: 0 }, radius: 1, mode: 'line' })).toBe(false)
    expect(isInternalCircleHole({ id: '1', center: { x: 0, y: 0 }, radius: 1, mode: 'hole' })).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { buildSymmetricContour, crossZ, mirrorPointAcrossLine } from './pieceSymmetry'
import type { Curve } from '../types/model'

const square = (size: number): Curve[] => [
  { type: 'line', start: { x: 0, y: 0 }, end: { x: size, y: 0 } },
  { type: 'line', start: { x: size, y: 0 }, end: { x: size, y: size } },
  { type: 'line', start: { x: size, y: size }, end: { x: 0, y: size } },
  { type: 'line', start: { x: 0, y: size }, end: { x: 0, y: 0 } },
]

describe('pieceSymmetry', () => {
  it('mirrorPointAcrossLine: horizontal axis y=50', () => {
    const a = { x: 0, y: 50 }
    const b = { x: 100, y: 50 }
    const p = { x: 30, y: 80 }
    const m = mirrorPointAcrossLine(p, a, b)
    expect(m.x).toBeCloseTo(30, 5)
    expect(m.y).toBeCloseTo(20, 5)
  })

  it('crossZ: left of vector is positive', () => {
    const a = { x: 0, y: 0 }
    const b = { x: 10, y: 0 }
    expect(crossZ(a, b, { x: 5, y: 5 })).toBeGreaterThan(0)
    expect(crossZ(a, b, { x: 5, y: -5 })).toBeLessThan(0)
  })

  it('buildSymmetricContour: Quadrat, vertikale Achse durch Mitte, linke Hälfte behalten', () => {
    const curves = square(100)
    const r = buildSymmetricContour(curves, { x: 50, y: -10 }, { x: 50, y: 110 }, 'left')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const xs = r.curves.flatMap((c) => [c.start.x, c.end.x])
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    expect(minX).toBeCloseTo(0, 0)
    expect(maxX).toBeCloseTo(100, 0)
  })

  it('buildSymmetricContour: identische Achsenpunkte scheitern', () => {
    const curves = square(100)
    const r = buildSymmetricContour(curves, { x: 1, y: 1 }, { x: 1, y: 1 }, 'left')
    expect(r.ok).toBe(false)
  })
})

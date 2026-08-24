import { describe, expect, it } from 'vitest'
import type { Curve } from '../types/model'
import { parallelCurveFromSegment } from './offset'

const squareWithBezierTop: Curve[] = [
  { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
  { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
  {
    type: 'bezier',
    start: { x: 100, y: 100 },
    cp1: { x: 70, y: 130 },
    cp2: { x: 30, y: 130 },
    end: { x: 0, y: 100 },
  },
  { type: 'line', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
]

describe('parallelCurveFromSegment', () => {
  it('erzeugt bei Linie eine parallele Linie', () => {
    const c = parallelCurveFromSegment(squareWithBezierTop, 0, 10)
    expect(c?.type).toBe('line')
    if (c?.type !== 'line') return
    expect(c.start.y).toBeCloseTo(-10, 3)
    expect(c.end.y).toBeCloseTo(-10, 3)
  })

  it('erzeugt bei Bézier eine parallele Bézier mit Kontrollpunkten', () => {
    const c = parallelCurveFromSegment(squareWithBezierTop, 2, 10)
    expect(c?.type).toBe('bezier')
    if (c?.type !== 'bezier') return
    expect(c.cp1).toBeDefined()
    expect(c.cp2).toBeDefined()
    // Außen-Offset nach oben: Start/Ende und CPs verschieben sich in +y-Richtung
    expect(c.start.y).toBeGreaterThan(100)
    expect(c.end.y).toBeGreaterThan(100)
    expect(c.cp1.y).toBeGreaterThan(130)
    expect(c.cp2.y).toBeGreaterThan(130)
  })
})

import { describe, expect, it } from 'vitest'
import type { Curve } from '../types/model'
import { clipperOffsetClosedPolygon } from './offset'
import { curvesBounds, signedAreaCurves } from './curveToPath'

function square(size: number): Curve[] {
  return [
    { type: 'line', start: { x: 0, y: 0 }, end: { x: size, y: 0 } },
    { type: 'line', start: { x: size, y: 0 }, end: { x: size, y: size } },
    { type: 'line', start: { x: size, y: size }, end: { x: 0, y: size } },
    { type: 'line', start: { x: 0, y: size }, end: { x: 0, y: 0 } },
  ]
}

describe('clipper2 offset (opt-in)', () => {
  it('expandiert Quadrat ähnlich wie Clipper1', () => {
    const seam = square(100)
    const c1 = clipperOffsetClosedPolygon(seam, 10, { joinType: 'miter', miterLimit: 3, simplifyTolerance: 0.15 })
    const c2 = clipperOffsetClosedPolygon(seam, 10, {
      joinType: 'miter',
      miterLimit: 3,
      simplifyTolerance: 0.15,
      offsetEngine: 'clipper2',
    })
    expect(c1.lineCurves.length).toBeGreaterThanOrEqual(4)
    expect(c2.lineCurves.length).toBeGreaterThanOrEqual(4)
    expect(c1.solutionPathCount).toBe(1)
    expect(c2.solutionPathCount).toBe(1)

    const b1 = curvesBounds(c1.lineCurves)!
    const b2 = curvesBounds(c2.lineCurves)!
    expect(b1.minX).toBeCloseTo(-10, 0)
    expect(b1.maxX).toBeCloseTo(110, 0)
    expect(b2.minX).toBeCloseTo(-10, 0)
    expect(b2.maxX).toBeCloseTo(110, 0)
    expect(Math.sign(signedAreaCurves(c1.lineCurves))).toBe(Math.sign(signedAreaCurves(seam)))
    expect(Math.sign(signedAreaCurves(c2.lineCurves))).toBe(Math.sign(signedAreaCurves(seam)))
  })
})

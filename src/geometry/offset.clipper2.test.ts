import { describe, expect, it } from 'vitest'
import type { Curve } from '../types/model'
import { clipperOffsetClosedPolygon, DEFAULT_OFFSET_ENGINE } from './offset'
import { curvesBounds, signedAreaCurves } from './curveToPath'

function square(size: number): Curve[] {
  return [
    { type: 'line', start: { x: 0, y: 0 }, end: { x: size, y: 0 } },
    { type: 'line', start: { x: size, y: 0 }, end: { x: size, y: size } },
    { type: 'line', start: { x: size, y: size }, end: { x: 0, y: size } },
    { type: 'line', start: { x: 0, y: size }, end: { x: 0, y: 0 } },
  ]
}

describe('clipper2 offset (default)', () => {
  it('DEFAULT_OFFSET_ENGINE ist clipper2', () => {
    expect(DEFAULT_OFFSET_ENGINE).toBe('clipper2')
  })

  it('expandiert Quadrat (Default Clipper2)', () => {
    const seam = square(100)
    const out = clipperOffsetClosedPolygon(seam, 10, { joinType: 'miter', miterLimit: 3, simplifyTolerance: 0.15 })
    expect(out.lineCurves.length).toBeGreaterThanOrEqual(4)
    expect(out.solutionPathCount).toBe(1)
    const b = curvesBounds(out.lineCurves)!
    expect(b.minX).toBeCloseTo(-10, 0)
    expect(b.maxX).toBeCloseTo(110, 0)
    expect(Math.sign(signedAreaCurves(out.lineCurves))).toBe(Math.sign(signedAreaCurves(seam)))
  })

  it('Clipper2 und Clipper1 liefern ähnliche Bounds auf Quadrat', () => {
    const seam = square(100)
    const c2 = clipperOffsetClosedPolygon(seam, 10, { joinType: 'miter', miterLimit: 3, simplifyTolerance: 0.15 })
    const c1 = clipperOffsetClosedPolygon(seam, 10, {
      joinType: 'miter',
      miterLimit: 3,
      simplifyTolerance: 0.15,
      offsetEngine: 'clipper1',
    })
    const b1 = curvesBounds(c1.lineCurves)!
    const b2 = curvesBounds(c2.lineCurves)!
    expect(b2.minX).toBeCloseTo(b1.minX, 0)
    expect(b2.maxX).toBeCloseTo(b1.maxX, 0)
  })
})

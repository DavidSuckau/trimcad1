import { describe, expect, it } from 'vitest'
import type { Curve } from '../types/model'
import { nearestCurveIndexAndPoint, nearestPointOnCurves } from './nearestOnCurve'

const curves: Curve[] = [
  { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
  {
    type: 'bezier',
    start: { x: 100, y: 0 },
    end: { x: 100, y: 100 },
    cp1: { x: 140, y: 20 },
    cp2: { x: 140, y: 80 },
  },
]

describe('nearestOnCurve quality', () => {
  it('coarse and fine both find a near point on the line', () => {
    const p = { x: 50, y: 3 }
    const fine = nearestPointOnCurves(p, curves, { quality: 'fine' })
    const coarse = nearestPointOnCurves(p, curves, { quality: 'coarse' })
    expect(fine.distance).toBeLessThan(5)
    expect(coarse.distance).toBeLessThan(5)
    expect(Math.abs(fine.point.x - 50)).toBeLessThan(1)
    expect(Math.abs(coarse.point.x - 50)).toBeLessThan(1)
  })

  it('coarse and fine both find a near point on the bezier', () => {
    const p = { x: 120, y: 50 }
    const fine = nearestCurveIndexAndPoint(p, curves, { quality: 'fine' })
    const coarse = nearestCurveIndexAndPoint(p, curves, { quality: 'coarse' })
    expect(fine).not.toBeNull()
    expect(coarse).not.toBeNull()
    expect(fine!.curveIndex).toBe(1)
    expect(coarse!.curveIndex).toBe(1)
    expect(fine!.distance).toBeLessThan(30)
    expect(coarse!.distance).toBeLessThan(35)
  })

  it('maxDistMm skips far beziers', () => {
    const far = { x: -1000, y: -1000 }
    const hit = nearestCurveIndexAndPoint(far, [curves[1]!], { quality: 'coarse', maxDistMm: 10 })
    expect(hit).toBeNull()
  })

  it('stays backward compatible without options', () => {
    const r = nearestPointOnCurves({ x: 50, y: 0 }, curves)
    expect(r.distance).toBeLessThan(0.01)
  })
})

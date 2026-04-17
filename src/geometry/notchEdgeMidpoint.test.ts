import { describe, expect, it } from 'vitest'
import {
  evenlySpacedTsOnLineSegment,
  lineSegmentLengthMm,
  midpointOnLineSegment,
  pointAtLineSegmentT,
} from './notchEdgeMidpoint'

describe('midpointOnLineSegment', () => {
  it('liefert geometrische Mitte und t 0.5', () => {
    const curve = {
      type: 'line' as const,
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
    }
    const r = midpointOnLineSegment(curve)
    expect(r.t).toBe(0.5)
    expect(r.point.x).toBe(50)
    expect(r.point.y).toBe(0)
  })
})

describe('evenlySpacedTsOnLineSegment', () => {
  it('n=5 liefert sechs Teilungen innen', () => {
    const ts = evenlySpacedTsOnLineSegment(5)
    expect(ts).toEqual([1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6])
  })
})

describe('pointAtLineSegmentT / lineSegmentLengthMm', () => {
  it('Interpoliert und Länge', () => {
    const seg = { type: 'line' as const, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    expect(lineSegmentLengthMm(seg)).toBe(10)
    const p = pointAtLineSegmentT(seg, 0.25)
    expect(p.x).toBe(2.5)
    expect(p.y).toBe(0)
  })
})

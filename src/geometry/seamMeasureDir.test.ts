import { describe, expect, it } from 'vitest'
import type { PatternPiece } from '../types/model'
import { measureArrowOnCurves, seamStartFromClick } from './seamUtils'

function squarePiece(): PatternPiece {
  const pts = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 40 },
    { x: 0, y: 40 },
  ]
  return {
    id: 'sq',
    number: '1',
    name: 'sq',
    cutLine: pts.map((p, i) => ({
      type: 'line' as const,
      start: p,
      end: pts[(i + 1) % pts.length]!,
    })),
    seamLine: [],
    notches: [],
    drills: [],
    grainLine: null,
    internalLines: [],
    internalCircles: [],
    layer: 'CUT',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    softVertices: [],
    fillInterior: true,
    material: '',
    bomQuantity: 1,
  }
}

describe('seamStartFromClick', () => {
  const piece = squarePiece()

  it('nimmt die nähere Ecke als Start und die Kante als Messrichtung', () => {
    const fromStart = seamStartFromClick(piece, [0], { x: 2, y: 0.2 })
    expect(fromStart?.measureDir).toBe(1)
    expect(fromStart?.startVi).toBe(0)

    const fromEnd = seamStartFromClick(piece, [0], { x: 98, y: -0.2 })
    expect(fromEnd?.measureDir).toBe(-1)
    expect(fromEnd?.startVi).toBe(1)
    expect(fromEnd!.distanceMm).toBeLessThan(fromStart!.distanceMm + 100)
  })
})

describe('measureArrowOnCurves', () => {
  const curves = squarePiece().cutLine

  it('zeigt vom Startpunkt in die Messrichtung', () => {
    const forward = measureArrowOnCurves([curves[0]!], 1, 16)
    expect(forward).not.toBeNull()
    expect(forward!.origin.x).toBeCloseTo(0)
    expect(forward!.tip.x).toBeGreaterThan(forward!.origin.x)

    const back = measureArrowOnCurves([curves[0]!], -1, 16)
    expect(back!.origin.x).toBeCloseTo(100)
    expect(back!.tip.x).toBeLessThan(back!.origin.x)
  })
})

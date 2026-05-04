import { describe, expect, it } from 'vitest'
import type { Curve, PatternPiece } from '../types/model'
import { deriveNotchRoleRangeOnEdge, edgeLengthInNotchRange, getNotchesOnEdgeInRange } from './seamUtils'

function square(size: number): Curve[] {
  return [
    { type: 'line', start: { x: 0, y: 0 }, end: { x: size, y: 0 } },
    { type: 'line', start: { x: size, y: 0 }, end: { x: size, y: size } },
    { type: 'line', start: { x: size, y: size }, end: { x: 0, y: size } },
    { type: 'line', start: { x: 0, y: size }, end: { x: 0, y: 0 } },
  ]
}

function pieceWithNotches(): PatternPiece {
  const cutLine = square(100)
  return {
    id: 'p1',
    number: '1',
    name: 'Teil',
    cutLine,
    seamLine: [],
    notches: [
      { id: 's', position: { x: 10, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6, arcLengthMm: 10, sNormalized: 0.025, role: 'nahtanfang' },
      { id: 'm', position: { x: 40, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6, arcLengthMm: 40, sNormalized: 0.1 },
      { id: 'e', position: { x: 70, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6, arcLengthMm: 70, sNormalized: 0.175, role: 'nahtende' },
    ],
    drills: [],
    grainLine: null,
    internalLines: [],
    internalCircles: [],
    layer: 'CUT',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    softVertices: [],
    fillInterior: true,
  }
}

describe('seam notch role ranges', () => {
  it('leitet eindeutige Notch-Range aus Rollen auf der Kante ab', () => {
    const piece = pieceWithNotches()
    const range = deriveNotchRoleRangeOnEdge(piece, [0])
    expect(range).toEqual({ startNotchId: 's', endNotchId: 'e' })
  })

  it('filtert Notches im Intervall (zwischen Start und Ende)', () => {
    const piece = pieceWithNotches()
    const range = deriveNotchRoleRangeOnEdge(piece, [0])
    const inner = getNotchesOnEdgeInRange(piece, [0], range)
    expect(inner.map((n) => n.notchId)).toEqual(['m'])
  })

  it('berechnet Segmentlaenge zwischen Rollen-Notches', () => {
    const piece = pieceWithNotches()
    const range = deriveNotchRoleRangeOnEdge(piece, [0])
    expect(edgeLengthInNotchRange(piece, [0], range)).toBeCloseTo(60, 4)
  })
})

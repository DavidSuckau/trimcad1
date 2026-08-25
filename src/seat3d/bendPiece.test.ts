import { describe, expect, it } from 'vitest'
import { mapFlatToSeat, buildBentPieceGeometry, SEAT_MM } from './bendPiece'
import { sampleClosedContour, contourBounds } from './sampleContour'
import type { Curve } from '../types/model'

function square(size: number, origin = 0): Curve[] {
  const o = origin
  const s = size
  return [
    { type: 'line', start: { x: o, y: o }, end: { x: o + s, y: o } },
    { type: 'line', start: { x: o + s, y: o }, end: { x: o + s, y: o + s } },
    { type: 'line', start: { x: o + s, y: o + s }, end: { x: o, y: o + s } },
    { type: 'line', start: { x: o, y: o + s }, end: { x: o, y: o } },
  ]
}

describe('seat3d bend', () => {
  it('mapFlatToSeat: Kissen liegt etwa auf cushionY', () => {
    const p = mapFlatToSeat(0, 0, 'cushion')
    expect(p.y).toBeCloseTo(SEAT_MM.cushionY, 0)
  })

  it('mapFlatToSeat: Lehne steigt mit v', () => {
    const a = mapFlatToSeat(0, 0, 'backrest')
    const b = mapFlatToSeat(0, 200, 'backrest')
    expect(b.y).toBeGreaterThan(a.y)
  })

  it('buildBentPieceGeometry liefert Mesh aus Rechteck', () => {
    const ring = sampleClosedContour(square(200, 0))
    expect(contourBounds(ring)?.w).toBeCloseTo(200, 0)
    const geom = buildBentPieceGeometry(ring, 'cushion')
    expect(geom).toBeTruthy()
    expect(geom!.attributes.position.count).toBeGreaterThan(3)
    geom!.dispose()
  })
})

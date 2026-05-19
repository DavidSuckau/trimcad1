import { describe, expect, it } from 'vitest'
import type { PatternPiece } from '../types/model'
import {
  alignPolygonGrainToPositiveY,
  buildNestingPartGeometry,
  buildWorldContourPolygon,
  getWorldGrainAngleDeg,
  normalizePolygonToCentroidOrigin,
  polygonBounds,
  rotatePolygon,
} from './nestingGeometry'

function rectPiece(): PatternPiece {
  return {
    id: 'p1',
    number: '1',
    name: 'Rect',
    cutLine: [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 50 } },
      { type: 'line', start: { x: 100, y: 50 }, end: { x: 0, y: 50 } },
      { type: 'line', start: { x: 0, y: 50 }, end: { x: 0, y: 0 } },
    ],
    seamLine: [],
    notches: [],
    drills: [],
    grainLine: { start: { x: 50, y: 5 }, end: { x: 50, y: 45 } },
    internalLines: [],
    internalCircles: [],
    layer: 'CUT',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    bomQuantity: 1,
  }
}

describe('nestingGeometry', () => {
  it('aligns grain to +Y (90°)', () => {
    const piece = rectPiece()
    piece.transform.rotation = 0
    const world = buildWorldContourPolygon(piece)
    const angle = getWorldGrainAngleDeg(piece)
    normalizePolygonToCentroidOrigin(alignPolygonGrainToPositiveY(world, angle))
    const grain = buildNestingPartGeometry(piece, 0, true)
    expect(grain).not.toBeNull()
    const g = grain!.grain0
    const gAngle = (Math.atan2(g.end.y - g.start.y, g.end.x - g.start.x) * 180) / Math.PI
    expect(Math.abs(gAngle - 90)).toBeLessThan(1)
  })

  it('180° rotation flips bounds height at same width', () => {
    const poly = [
      { x: -50, y: -25 },
      { x: 50, y: -25 },
      { x: 50, y: 25 },
      { x: -50, y: 25 },
    ]
    const r = rotatePolygon(poly, 180)
    const b0 = polygonBounds(poly)
    const b1 = polygonBounds(r)
    expect(Math.abs(b0.maxX - b0.minX - (b1.maxX - b1.minX))).toBeLessThan(0.01)
    expect(Math.abs(b0.maxY - b0.minY - (b1.maxY - b1.minY))).toBeLessThan(0.01)
  })
})

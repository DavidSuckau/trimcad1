import { describe, expect, it } from 'vitest'
import type { Curve, PatternPiece, SeamAssignment } from '../types/model'
import { seamAssignmentLengthMm } from './seamAssignmentLength'

function line(x1: number, y1: number, x2: number, y2: number): Curve {
  return { type: 'line', start: { x: x1, y: y1 }, end: { x: x2, y: y2 } }
}

function squarePiece(id: string, size: number): PatternPiece {
  const cutLine: Curve[] = [
    line(0, 0, size, 0),
    line(size, 0, size, size),
    line(size, size, 0, size),
    line(0, size, 0, 0),
  ]
  return {
    id,
    number: '001',
    name: 'Test',
    cutLine,
    seamLine: cutLine,
    seamAllowanceMm: 10,
    notches: [],
    drills: [],
    grainLine: null,
    internalLines: [line(10, 10, 90, 10)],
    internalCircles: [],
    layer: 'CUT',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
  }
}

describe('seamAssignmentLengthMm', () => {
  it('misst Kantenzuordnung über aufgelöste Master-Indizes', () => {
    const p = squarePiece('a', 100)
    const a: SeamAssignment = {
      id: 's1',
      pieceIdA: 'a',
      curveIndicesA: [0],
      clickedCurveA: 0,
      pieceIdB: 'b',
      curveIndicesB: [0],
      clickedCurveB: 0,
    }
    expect(seamAssignmentLengthMm(p, a)).toBeCloseTo(100, 3)
  })

  it('misst Einzelnaht auf interner Linie', () => {
    const p = squarePiece('a', 100)
    const a: SeamAssignment = {
      id: 's1',
      pieceIdA: 'a',
      curveIndicesA: [],
      clickedCurveA: 0,
      pieceIdB: 'a',
      curveIndicesB: [],
      clickedCurveB: 0,
      isInternalSingle: true,
    }
    expect(seamAssignmentLengthMm(p, a)).toBeCloseTo(80, 3)
  })
})

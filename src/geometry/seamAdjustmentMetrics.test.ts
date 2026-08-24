import { describe, expect, it } from 'vitest'
import type { PatternPiece, SeamAssignment } from '../types/model'
import { getSeamAssignmentDisplayMetrics } from './seamAdjustmentCheck'
import { buildNotchTargetArcPositionsFromSubLengths, getSubSegments } from './seamUtils'

function linePiece(id: string, length: number, notches: PatternPiece['notches']): PatternPiece {
  return {
    id,
    number: id,
    name: id,
    cutLine: [{ type: 'line', start: { x: 0, y: 0 }, end: { x: length, y: 0 } }],
    seamLine: [],
    notches,
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

const assignment: SeamAssignment = {
  id: 's1',
  pieceIdA: 'A',
  curveIndicesA: [0],
  clickedCurveA: 0,
  pieceIdB: 'B',
  curveIndicesB: [0],
  clickedCurveB: 0,
}

describe('buildNotchTargetArcPositionsFromSubLengths', () => {
  it('verteilt Teilstrecken exakt auf Zielkante', () => {
    const positions = buildNotchTargetArcPositionsFromSubLengths([25, 50, 25], 100, false)
    expect(positions).toEqual([25, 75])
  })
})

describe('getSeamAssignmentDisplayMetrics', () => {
  it('nutzt nur Kerben im Nahtbereich', () => {
    const pieceA = linePiece('A', 100, [
      { id: 'start', position: { x: 10, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6, role: 'nahtanfang' },
      { id: 'mid', position: { x: 50, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
      { id: 'end', position: { x: 90, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6, role: 'nahtende' },
    ])
    const pieceB = linePiece('B', 100, [
      { id: 'b1', position: { x: 40, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
    ])
    const withRange: SeamAssignment = {
      ...assignment,
      notchRangeA: { startNotchId: 'start', endNotchId: 'end' },
    }
    const metrics = getSeamAssignmentDisplayMetrics(withRange, pieceA, pieceB)
    expect(metrics?.lenA).toBeCloseTo(80, 1)
    expect(metrics?.notchCountA).toBe(1)
    expect(metrics?.notchCountB).toBe(1)
  })

  it('Subsegment-Längen stimmen mit getSubSegments überein', () => {
    const pieceA = linePiece('A', 100, [
      { id: 'a1', position: { x: 25, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
      { id: 'a2', position: { x: 75, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
    ])
    const pieceB = linePiece('B', 100, [
      { id: 'b1', position: { x: 40, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
      { id: 'b2', position: { x: 70, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
    ])
    const metrics = getSeamAssignmentDisplayMetrics(assignment, pieceA, pieceB)
    const subsA = getSubSegments(pieceA, [0])
    expect(metrics?.subDiffs?.[0].lenA).toBeCloseTo(subsA[0].length, 3)
  })

  it('Subsegment-Längen mit Notch-Range nutzen Range-Grenzen', () => {
    const pieceA = linePiece('A', 100, [
      { id: 'start', position: { x: 10, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6, role: 'nahtanfang' },
      { id: 'mid', position: { x: 50, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
      { id: 'end', position: { x: 90, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6, role: 'nahtende' },
    ])
    const subs = getSubSegments(pieceA, [0], undefined, { startNotchId: 'start', endNotchId: 'end' })
    expect(subs).toHaveLength(2)
    expect(subs[0].length).toBeCloseTo(40, 3)
    expect(subs[1].length).toBeCloseTo(40, 3)
  })
})

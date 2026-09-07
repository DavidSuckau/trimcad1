import { describe, expect, it, vi } from 'vitest'
import type { PatternPiece, SeamAssignment } from '../types/model'
import * as seamCheck from './seamAdjustmentCheck'
import { buildSeamPruefOverlayEntries } from './seamPruefOverlayModel'

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

describe('buildSeamPruefOverlayEntries', () => {
  it('nutzt Cache bei reiner Transform-Änderung', () => {
    const pieceA = linePiece('A', 100, [
      { id: 'a1', position: { x: 25, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
      { id: 'a2', position: { x: 75, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
    ])
    const pieceB = linePiece('B', 100, [
      { id: 'b1', position: { x: 40, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
      { id: 'b2', position: { x: 70, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
    ])
    const spy = vi.spyOn(seamCheck, 'getSeamAssignmentDisplayMetrics')
    const cache = new Map()
    const first = buildSeamPruefOverlayEntries([assignment], [pieceA, pieceB], cache)
    expect(first).toHaveLength(1)
    expect(spy).toHaveBeenCalledTimes(1)

    const movedA = {
      ...pieceA,
      transform: { ...pieceA.transform, x: 40, y: 10, rotation: 15 },
    }
    const second = buildSeamPruefOverlayEntries([assignment], [movedA, pieceB], cache)
    expect(second).toHaveLength(1)
    expect(second[0]).toBe(first[0])
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('rechnet neu wenn Kontur sich ändert', () => {
    const pieceA = linePiece('A', 100, [])
    const pieceB = linePiece('B', 100, [])
    const spy = vi.spyOn(seamCheck, 'getSeamAssignmentDisplayMetrics')
    const cache = new Map()
    buildSeamPruefOverlayEntries([assignment], [pieceA, pieceB], cache)
    expect(spy).toHaveBeenCalledTimes(1)

    const longerA = linePiece('A', 120, [])
    buildSeamPruefOverlayEntries([assignment], [longerA, pieceB], cache)
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })
})

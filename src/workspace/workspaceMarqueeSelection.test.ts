import { describe, expect, it } from 'vitest'
import { filterBatchTargets } from './workspaceMarqueeSelection'
import { buildCirclePolygonCutLine } from './workspaceGeometry'
import type { BatchSelectionTarget, PatternPiece } from '../types/model'

function minimalPiece(overrides: Partial<PatternPiece>): PatternPiece {
  const cutLine = buildCirclePolygonCutLine(50, 6)
  return {
    id: 'p1',
    number: '001',
    name: 'T',
    cutLine,
    seamLine: [],
    seamAllowanceMm: null,
    notches: [],
    drills: [],
    grainLine: null,
    internalLines: [],
    layer: 'CUT',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    fillInterior: true,
    material: '',
    bomQuantity: 1,
    ...overrides,
  }
}

describe('filterBatchTargets', () => {
  it('unterscheidet weiche und feste Eckpunkte (ohne Nahtzugabe)', () => {
    const piece = minimalPiece({ softVertices: [1, 3] })
    const targets: BatchSelectionTarget[] = [
      { kind: 'vertex', pieceId: 'p1', vertexIndex: 0 },
      { kind: 'vertex', pieceId: 'p1', vertexIndex: 1 },
      { kind: 'notch', pieceId: 'p1', notchId: 'n1' },
    ]
    expect(filterBatchTargets(targets, 'softVertices', [piece])).toEqual([
      { kind: 'vertex', pieceId: 'p1', vertexIndex: 1 },
    ])
    expect(filterBatchTargets(targets, 'hardVertices', [piece])).toEqual([
      { kind: 'vertex', pieceId: 'p1', vertexIndex: 0 },
    ])
  })
})

import { describe, expect, it } from 'vitest'
import { collectMarqueeTargets, filterBatchTargets } from './workspaceMarqueeSelection'
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
    internalCircles: [],
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

  it('filter pieces: nur komplette Teile', () => {
    const targets: BatchSelectionTarget[] = [
      { kind: 'piece', pieceId: 'a' },
      { kind: 'vertex', pieceId: 'b', vertexIndex: 0 },
    ]
    expect(filterBatchTargets(targets, 'pieces', [])).toEqual([{ kind: 'piece', pieceId: 'a' }])
  })
})

describe('collectMarqueeTargets', () => {
  it('liefert nur Teil-Ziel wenn die Schnittkontur-Bounding-Box vollständig im Fenster liegt', () => {
    const cutLine = [
      { type: 'line' as const, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { type: 'line' as const, start: { x: 10, y: 0 }, end: { x: 10, y: 10 } },
      { type: 'line' as const, start: { x: 10, y: 10 }, end: { x: 0, y: 10 } },
      { type: 'line' as const, start: { x: 0, y: 10 }, end: { x: 0, y: 0 } },
    ]
    const piece = minimalPiece({ id: 'sq', cutLine })
    const big = { minX: -1, minY: -1, maxX: 20, maxY: 20 }
    expect(collectMarqueeTargets([piece], big)).toEqual([{ kind: 'piece', pieceId: 'sq' }])
  })

  it('liefert Eckpunkte wenn das Fenster das Teil nicht vollständig umschließt', () => {
    const cutLine = [
      { type: 'line' as const, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { type: 'line' as const, start: { x: 10, y: 0 }, end: { x: 10, y: 10 } },
      { type: 'line' as const, start: { x: 10, y: 10 }, end: { x: 0, y: 10 } },
      { type: 'line' as const, start: { x: 0, y: 10 }, end: { x: 0, y: 0 } },
    ]
    const piece = minimalPiece({ id: 'sq', cutLine })
    const partial = { minX: 0, minY: 0, maxX: 5, maxY: 5 }
    const got = collectMarqueeTargets([piece], partial)
    expect(got.some((t) => t.kind === 'piece')).toBe(false)
    expect(got.filter((t) => t.kind === 'vertex').length).toBeGreaterThan(0)
  })
})

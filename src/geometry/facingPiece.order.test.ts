import { describe, expect, it } from 'vitest'
import type { PatternPiece } from '../types/model'
import { sortPiecesFacingBehind } from './facingPiece'

function stub(id: string, facing?: boolean): PatternPiece {
  return {
    id,
    number: id,
    name: id,
    cutLine: [],
    seamLine: [],
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
    ...(facing ? { kind: 'facing' as const, facingParentId: 'parent' } : {}),
  }
}

describe('sortPiecesFacingBehind', () => {
  it('legt Kaschierungen vor normalen Teilen (unten in der Zeichenreihenfolge)', () => {
    const a = stub('A')
    const f1 = stub('F1', true)
    const b = stub('B')
    const f2 = stub('F2', true)
    const sorted = sortPiecesFacingBehind([a, f1, b, f2])
    expect(sorted.map((p) => p.id)).toEqual(['F1', 'F2', 'A', 'B'])
  })

  it('lässt reine Stoffteil-Listen unverändert (gleiche Referenz)', () => {
    const list = [stub('A'), stub('B')]
    expect(sortPiecesFacingBehind(list)).toBe(list)
  })
})

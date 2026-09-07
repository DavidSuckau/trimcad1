import { describe, expect, it } from 'vitest'
import {
  FACING_PEEK_OFFSET_MM,
  facingPeekOffsetFromParent,
  movePieceJustBefore,
} from './facingPiece'
import type { PatternPiece } from '../types/model'

const stubPiece = (id: string): PatternPiece =>
  ({
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
    softVertices: [],
    fillInterior: true,
    material: '',
    bomQuantity: 1,
  }) as PatternPiece

describe('facingPeekOffsetFromParent', () => {
  it('versetzt 10 mm rechts und 10 mm nach oben (−y)', () => {
    const o = facingPeekOffsetFromParent(stubPiece('p'))
    expect(o).toEqual({ x: FACING_PEEK_OFFSET_MM, y: -FACING_PEEK_OFFSET_MM })
  })
})

describe('movePieceJustBefore', () => {
  it('legt Kind direkt vor die Mutter', () => {
    const a = stubPiece('a')
    const b = stubPiece('b')
    const c = stubPiece('c')
    const next = movePieceJustBefore([a, b, c], 'c', 'b')
    expect(next.map((p) => p.id)).toEqual(['a', 'c', 'b'])
  })
})

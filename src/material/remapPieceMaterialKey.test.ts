import { describe, expect, it } from 'vitest'
import type { PatternPiece } from '../types/model'
import { remapPieceMaterialKey } from './remapPieceMaterialKey'

function piece(id: string, material?: string): PatternPiece {
  return {
    id,
    number: id,
    name: id,
    cutLine: [],
    seamLine: [],
    seamAllowanceMm: null,
    notches: [],
    drills: [],
    grainLine: null,
    internalLines: [],
    internalCircles: [],
    layer: 'CUT',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    softVertices: [],
    softVerticesMaster: [],
    fillInterior: true,
    material,
  }
}

describe('remapPieceMaterialKey', () => {
  it('zieht Material-Key an allen betroffenen Teilen nach', () => {
    const pieces = [piece('a', 'M-1'), piece('b', 'M-2'), piece('c', ' M-1 ')]
    const next = remapPieceMaterialKey(pieces, 'M-1', 'M-9')
    expect(next[0].material).toBe('M-9')
    expect(next[1].material).toBe('M-2')
    expect(next[2].material).toBe('M-9')
  })

  it('ändert nichts bei leerem oder gleichem Key', () => {
    const pieces = [piece('a', 'M-1')]
    expect(remapPieceMaterialKey(pieces, '', 'M-9')).toBe(pieces)
    expect(remapPieceMaterialKey(pieces, 'M-1', 'M-1')).toBe(pieces)
  })
})

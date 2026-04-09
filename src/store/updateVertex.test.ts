import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import type { PatternPiece } from '../types/model'

function makeSquare(): PatternPiece {
  return {
    id: 'sq',
    number: '1',
    name: 'Quadrat',
    cutLine: [
      { type: 'line' as const, start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { type: 'line' as const, start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
      { type: 'line' as const, start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
      { type: 'line' as const, start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
    ],
    seamLine: [],
    internalLines: [],
    notches: [],
    drills: [],
    grainLine: null,
    layer: 'CUT',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
  }
}

describe('updateVertex', () => {
  beforeEach(() => {
    useStore.setState({
      workspace: {
        id: 'ws1',
        name: 'Test',
        pieces: [makeSquare()],
        view: { zoom: 1, panX: 0, panY: 0 },
        seamAssignments: [],
        notes: [],
        profileAssignments: [],
      },
    })
  })

  it('verschiebt Vertex 0 korrekt (Schließung bleibt erhalten)', () => {
    useStore.getState().updateVertex('sq', 0, { x: 10, y: 10 })
    const p = useStore.getState().workspace.pieces[0]
    expect(p.cutLine[0].start).toEqual({ x: 10, y: 10 })
    expect(p.cutLine[3].end).toEqual({ x: 10, y: 10 })
  })

  it('verschiebt inneren Vertex korrekt', () => {
    useStore.getState().updateVertex('sq', 1, { x: 120, y: 5 })
    const p = useStore.getState().workspace.pieces[0]
    expect(p.cutLine[0].end).toEqual({ x: 120, y: 5 })
    expect(p.cutLine[1].start).toEqual({ x: 120, y: 5 })
  })

  it('ignoriert unbekannte pieceId', () => {
    const before = useStore.getState().workspace.pieces[0].cutLine
    useStore.getState().updateVertex('unknown', 0, { x: 999, y: 999 })
    const after = useStore.getState().workspace.pieces[0].cutLine
    expect(after).toEqual(before)
  })

  it('ignoriert ungültigen vertexIndex', () => {
    const before = useStore.getState().workspace.pieces[0].cutLine
    useStore.getState().updateVertex('sq', -1, { x: 999, y: 999 })
    const after = useStore.getState().workspace.pieces[0].cutLine
    expect(after).toEqual(before)
  })
})

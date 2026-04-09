import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import type { PatternPiece } from '../types/model'

function makePiece(): PatternPiece {
  return {
    id: 'p1',
    number: '1',
    name: 'Test',
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

describe('applyMassstab', () => {
  const piece = makePiece()

  beforeEach(() => {
    useStore.setState({
      workspace: {
        id: 'ws1',
        name: 'Test',
        pieces: [piece],
        view: { zoom: 1, panX: 0, panY: 0 },
        seamAssignments: [],
        notes: [],
        profileAssignments: [],
      },
      massstabDialog: { pieceId: 'p1', curveIndices: [0], currentLengthMm: 100 },
    })
  })

  it('skaliert das Teil korrekt bei 200 mm Ziel', () => {
    useStore.getState().applyMassstab(200)
    const s = useStore.getState()
    const updated = s.workspace.pieces.find((p) => p.id === 'p1')!
    expect(updated).toBeDefined()
    const firstSeg = updated.cutLine[0]
    const dx = firstSeg.end.x - firstSeg.start.x
    expect(Math.abs(dx)).toBeCloseTo(200, 0)
    expect(s.massstabDialog).toBeNull()
  })

  it('zeigt Fehler bei ungültiger Ziel-Länge', () => {
    useStore.getState().applyMassstab(-5)
    const s = useStore.getState()
    expect(s.toastMessage).toContain('error:')
    expect(s.massstabDialog).not.toBeNull()
  })

  it('tut nichts ohne massstabDialog', () => {
    useStore.setState({ massstabDialog: null })
    useStore.getState().applyMassstab(200)
    const s = useStore.getState()
    expect(s.workspace.pieces[0].cutLine[0].end.x).toBe(100)
  })

  it('setzt tool auf select nach Erfolg', () => {
    useStore.setState({ tool: 'massstab' as never })
    useStore.getState().applyMassstab(200)
    expect(useStore.getState().tool).toBe('select')
  })
})

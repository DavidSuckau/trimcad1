import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import type { Workspace, Curve } from '../types/model'

const square = (size: number): Curve[] => [
  { type: 'line', start: { x: 0, y: 0 }, end: { x: size, y: 0 } },
  { type: 'line', start: { x: size, y: 0 }, end: { x: size, y: size } },
  { type: 'line', start: { x: size, y: size }, end: { x: 0, y: size } },
  { type: 'line', start: { x: 0, y: size }, end: { x: 0, y: 0 } },
]

describe('applyPieceSymmetry', () => {
  beforeEach(() => {
    const workspace: Workspace = {
      id: 'ws-sym',
      name: 'Test',
      pieces: [
        {
          id: 'p1',
          number: '001',
          name: 'Teil',
          cutLine: square(100),
          seamLine: [],
          seamAllowanceMm: null,
          notches: [],
          drills: [],
          grainLine: null,
          internalLines: [],
          layer: 'CUT',
          transform: { x: 0, y: 0, rotation: 0, mirrored: false },
          softVertices: [],
          fillInterior: true,
          material: '',
          bomQuantity: 1,
        },
      ],
      view: { zoom: 1, panX: 0, panY: 0 },
      seamAssignments: [],
    }
    useStore.setState({ workspace, selectedPieceIds: ['p1'], pieceSymmetryState: null })
  })

  it('wendet Symmetrie auf cutLine an', () => {
    useStore.getState().applyPieceSymmetry('p1', { x: 50, y: 0 }, { x: 50, y: 100 }, 'left')
    const p = useStore.getState().workspace.pieces[0]
    expect(p.cutLine.length).toBeGreaterThanOrEqual(3)
    expect(useStore.getState().pieceSymmetryState).toBeNull()
  })

  it('Seam-as-Master: Nahtlinie und abgeleitete Schnittkontur', () => {
    useStore.getState().updatePiece('p1', { seamAllowanceMm: 10 })
    const before = useStore.getState().workspace.pieces[0]
    expect(before.seamLine.length).toBeGreaterThanOrEqual(3)

    useStore.getState().applyPieceSymmetry('p1', { x: 50, y: -200 }, { x: 50, y: 200 }, 'right')
    const after = useStore.getState().workspace.pieces[0]
    expect(after.seamLine.length).toBeGreaterThanOrEqual(3)
    expect(after.cutLine.length).toBeGreaterThanOrEqual(3)
    expect(after.seamAllowanceMm).toBe(10)
  })
})

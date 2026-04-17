import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import type { Workspace } from '../types/model'

const square = [
  { type: 'line' as const, start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
  { type: 'line' as const, start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
  { type: 'line' as const, start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
  { type: 'line' as const, start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
]

describe('batchDeleteFiltered', () => {
  beforeEach(() => {
    const workspace: Workspace = {
      id: 'ws-batch-delete',
      name: 'Test',
      pieces: [
        {
          id: 'p1',
          number: '001',
          name: 'Teil',
          cutLine: square,
          seamLine: [],
          seamAllowanceMm: null,
          notches: [],
          drills: [],
          grainLine: null,
          internalLines: [],
          internalCircles: [],
          layer: 'CUT',
          transform: { x: 0, y: 0, rotation: 0, mirrored: false },
          softVertices: [1, 2],
          fillInterior: true,
          material: '',
          bomQuantity: 1,
        },
      ],
      view: { zoom: 1, panX: 0, panY: 0 },
      seamAssignments: [],
    }
    useStore.setState({ workspace, selectedPieceIds: ['p1'] })
  })

  it('ent-weicht bei Filter "softVertices" statt Geometrie zu löschen', () => {
    useStore.setState({
      batchSelectionFilter: 'softVertices',
      batchSelectionTargets: [{ kind: 'vertex', pieceId: 'p1', vertexIndex: 1 }],
    })

    const before = useStore.getState().workspace.pieces[0]
    expect(before.cutLine.length).toBe(4)
    expect(before.softVertices).toEqual([1, 2])

    useStore.getState().batchDeleteFiltered()

    const after = useStore.getState().workspace.pieces[0]
    expect(after.cutLine.length).toBe(4)
    expect(after.softVertices).toEqual([2])
  })
})

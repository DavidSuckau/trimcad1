import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import { masterSoftVertexIndexSet } from '../geometry/seamUtils'
import type { Workspace, Curve } from '../types/model'

const square = (size: number): Curve[] => [
  { type: 'line', start: { x: 0, y: 0 }, end: { x: size, y: 0 } },
  { type: 'line', start: { x: size, y: 0 }, end: { x: size, y: size } },
  { type: 'line', start: { x: size, y: size }, end: { x: 0, y: size } },
  { type: 'line', start: { x: 0, y: size }, end: { x: 0, y: 0 } },
]

describe('flipPieceAlongGrain', () => {
  beforeEach(() => {
    const workspace: Workspace = {
      id: 'ws-flip',
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
    useStore.setState({ workspace, selectedPieceIds: ['p1'] })
  })

  it('spiegelt cutLine ohne Nahtzugabe korrekt', () => {
    useStore.getState().flipPieceAlongGrain('p1')
    const p = useStore.getState().workspace.pieces[0]
    expect(p.cutLine.length).toBe(4)
    expect(p.seamLine.length).toBe(0)
  })

  it('spiegelt seamLine bei Nahtzugabe (seam-as-master)', () => {
    useStore.getState().updatePiece('p1', { seamAllowanceMm: 10 })
    const before = useStore.getState().workspace.pieces[0]
    expect(before.seamLine.length).toBeGreaterThanOrEqual(3)
    const seamLenBefore = before.seamLine.length
    const cutLenBefore = before.cutLine.length

    useStore.getState().flipPieceAlongGrain('p1')
    const after = useStore.getState().workspace.pieces[0]
    expect(after.seamLine.length).toBe(seamLenBefore)
    expect(after.cutLine.length).toBe(cutLenBefore)
    expect(after.seamAllowanceMm).toBe(10)
  })

  it('harte Vertices bleiben hart nach Spiegelung mit NZ', () => {
    useStore.getState().updatePiece('p1', { seamAllowanceMm: 10 })
    const before = useStore.getState().workspace.pieces[0]
    expect(before.softVertices).toEqual([])
    expect(before.softVerticesMaster ?? []).toEqual([])

    useStore.getState().flipPieceAlongGrain('p1')
    const after = useStore.getState().workspace.pieces[0]
    const soft = masterSoftVertexIndexSet(after)
    expect(soft.size).toBe(0)
  })

  it('Notches werden nach Spiegelung resynced', () => {
    useStore.getState().addNotch('p1', {
      id: 'n1',
      position: { x: 25, y: 0 },
      angle: -90,
      type: 'single',
      depth: 4,
      sNormalized: 0.0625,
    })
    const before = useStore.getState().workspace.pieces[0]
    expect(before.notches.length).toBe(1)

    useStore.getState().flipPieceAlongGrain('p1')
    const after = useStore.getState().workspace.pieces[0]
    expect(after.notches.length).toBe(1)
    expect(after.notches[0].position.x).toBeCloseTo(75, 0)
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import type { Workspace, Curve } from '../types/model'

function square(size: number): Curve[] {
  return [
    { type: 'line', start: { x: 0, y: 0 }, end: { x: size, y: 0 } },
    { type: 'line', start: { x: size, y: 0 }, end: { x: size, y: size } },
    { type: 'line', start: { x: size, y: size }, end: { x: 0, y: size } },
    { type: 'line', start: { x: 0, y: size }, end: { x: 0, y: 0 } },
  ]
}

describe('recomputeSeamLine', () => {
  beforeEach(() => {
    const workspace: Workspace = {
      id: 'ws-recompute-seam',
      name: 'Test',
      pieces: [],
      view: { zoom: 1, panX: 0, panY: 0 },
      seamAssignments: [],
    }
    useStore.setState({ workspace, selectedPieceIds: [] })
  })

  it('überschreibt bei Seam-as-Master die vorhandene seamLine nicht', () => {
    const seam = square(100)
    const cut = square(120)
    useStore.setState({
      workspace: {
        ...useStore.getState().workspace,
        pieces: [
          {
            id: 'p1',
            number: '001',
            name: 'Teil',
            cutLine: cut,
            seamLine: seam,
            seamAllowanceMm: 10,
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
          },
        ],
      },
    })

    const before = JSON.stringify(useStore.getState().workspace.pieces[0].seamLine)
    useStore.getState().recomputeSeamLine('p1')
    const after = JSON.stringify(useStore.getState().workspace.pieces[0].seamLine)
    expect(after).toBe(before)
  })

  it('berechnet bei Cut-as-Master die seamLine aus cutLine neu', () => {
    const cut = square(100)
    useStore.setState({
      workspace: {
        ...useStore.getState().workspace,
        pieces: [
          {
            id: 'p2',
            number: '002',
            name: 'Teil 2',
            cutLine: cut,
            // Cut-as-Master-Fall: keine gültige seamLine vorhanden.
            seamLine: [],
            seamAllowanceMm: 10,
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
          },
        ],
      },
    })

    const beforeLen = useStore.getState().workspace.pieces[0].seamLine.length
    useStore.getState().recomputeSeamLine('p2')
    const afterPiece = useStore.getState().workspace.pieces[0]
    const afterLen = afterPiece.seamLine.length
    expect(afterPiece.seamLine.length).toBeGreaterThanOrEqual(3)
    expect(afterLen).toBeGreaterThan(beforeLen)
  })
})

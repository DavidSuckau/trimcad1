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

function pieceById(pieceId: string) {
  return useStore.getState().workspace.pieces.find((p) => p.id === pieceId)!
}

describe('notch operations keep cutLine unchanged', () => {
  beforeEach(() => {
    const cut = square(100)
    const workspace: Workspace = {
      id: 'ws-notch-geometry',
      name: 'Test',
      pieces: [
        {
          id: 'p1',
          number: '001',
          name: 'Teil',
          cutLine: cut,
          seamLine: [],
          seamAllowanceMm: null,
          notches: [
            {
              id: 'n-anchored',
              position: { x: 100, y: 0 },
              angle: 0,
              type: 'single',
              depth: 4,
            },
            {
              id: 'n-free',
              position: { x: 70, y: 0 },
              angle: 0,
              type: 'single',
              depth: 4,
            },
          ],
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
      view: { zoom: 1, panX: 0, panY: 0 },
      seamAssignments: [],
    }
    useStore.setState({ workspace, selectedPieceIds: ['p1'] })
  })

  it('updateNotch verschiebt Kerbe ohne cutLine-Mutation', () => {
    const before = JSON.stringify(pieceById('p1').cutLine)
    useStore.getState().updateNotch('p1', 'n-anchored', { position: { x: 85, y: 0 }, angle: 180 })
    const piece = pieceById('p1')
    const notch = piece.notches.find((n) => n.id === 'n-anchored')!
    expect(JSON.stringify(piece.cutLine)).toBe(before)
    expect(notch.vertexIndex).toBeUndefined()
  })

  it('toggleNotchAnchor ist no-op (kein vertexIndex, keine cutLine-Mutation)', () => {
    const before = JSON.stringify(pieceById('p1'))
    useStore.getState().toggleNotchAnchor('p1', 'n-free')
    const after = JSON.stringify(pieceById('p1'))
    expect(after).toBe(before)
  })
})

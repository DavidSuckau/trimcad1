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

describe('insertPointOnCutLine (seam master)', () => {
  beforeEach(() => {
    const seamLine = square(100)
    const workspace: Workspace = {
      id: 'ws-seam-point',
      name: 'Test',
      pieces: [
        {
          id: 'p1',
          number: '001',
          name: 'Teil 001',
          cutLine: seamLine,
          seamLine,
          seamAllowanceMm: 10,
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

  it('fügt auch bei t nahe 0 robust auf der seamLine ein', () => {
    const { insertPointOnCutLine } = useStore.getState()
    insertPointOnCutLine('p1', 0, { x: 0, y: 0 }, 0)
    const p = useStore.getState().workspace.pieces.find((x) => x.id === 'p1')
    expect(p).toBeDefined()
    expect(p!.seamLine.length).toBe(5)
    const first = p!.seamLine[0]
    expect(first.type).toBe('line')
    if (first.type === 'line') {
      const len = Math.hypot(first.end.x - first.start.x, first.end.y - first.start.y)
      expect(len).toBeGreaterThan(0)
    }
  })
})

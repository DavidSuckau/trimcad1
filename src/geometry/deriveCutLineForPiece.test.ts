import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../store/useStore'
import { deriveCutLineForPiece } from './deriveCutLineForPiece'
import type { Workspace } from '../types/model'

const square = (size: number) => [
  { type: 'line' as const, start: { x: 0, y: 0 }, end: { x: size, y: 0 } },
  { type: 'line' as const, start: { x: size, y: 0 }, end: { x: size, y: size } },
  { type: 'line' as const, start: { x: size, y: size }, end: { x: 0, y: size } },
  { type: 'line' as const, start: { x: 0, y: size }, end: { x: 0, y: 0 } },
]

describe('deriveCutLineForPiece', () => {
  beforeEach(() => {
    const workspace: Workspace = {
      id: 'ws-dcl',
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

  it('leitet aus Nahtlinie dieselbe Schnittkontur ab wie im Store (uniforme NZ)', () => {
    useStore.getState().updatePiece('p1', { seamAllowanceMm: 10 })
    const p = useStore.getState().workspace.pieces[0]
    expect(p.seamLine.length).toBeGreaterThanOrEqual(3)
    const r = deriveCutLineForPiece(p, p.seamLine, p.seamAllowanceMm ?? 10)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.cutLine.length).toBe(p.cutLine.length)
    for (let i = 0; i < r.cutLine.length; i++) {
      expect(r.cutLine[i].type).toBe(p.cutLine[i].type)
    }
  })
})

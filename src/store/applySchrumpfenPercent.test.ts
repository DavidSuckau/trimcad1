import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import type { Curve, Workspace } from '../types/model'

const square = (size: number): Curve[] => [
  { type: 'line', start: { x: 0, y: 0 }, end: { x: size, y: 0 } },
  { type: 'line', start: { x: size, y: 0 }, end: { x: size, y: size } },
  { type: 'line', start: { x: size, y: size }, end: { x: 0, y: size } },
  { type: 'line', start: { x: 0, y: size }, end: { x: 0, y: 0 } },
]

describe('applySchrumpfenPercent', () => {
  beforeEach(() => {
    const workspace: Workspace = {
      id: 'ws-schr',
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
    useStore.setState({
      workspace,
      selectedPieceIds: ['p1'],
      schrumpfenDialogPieceId: 'p1',
      toastMessage: null,
    })
  })

  it('+2% vergrößert die Kontur um Faktor 1.02', () => {
    useStore.getState().applySchrumpfenPercent(2)
    const p = useStore.getState().workspace.pieces[0]!
    const w = p.cutLine[0]!.end.x - p.cutLine[0]!.start.x
    expect(w).toBeCloseTo(102, 5)
    expect(p.symmetryConstraint).toBeUndefined()
    expect(useStore.getState().schrumpfenDialogPieceId).toBeNull()
  })

  it('−2% verkleinert die Kontur um Faktor 0.98', () => {
    useStore.getState().applySchrumpfenPercent(-2)
    const p = useStore.getState().workspace.pieces[0]!
    const w = p.cutLine[0]!.end.x - p.cutLine[0]!.start.x
    expect(w).toBeCloseTo(98, 5)
  })

  it('lehnt −100% und kleiner ab', () => {
    useStore.getState().applySchrumpfenPercent(-100)
    const p = useStore.getState().workspace.pieces[0]!
    expect(p.cutLine[0]!.end.x - p.cutLine[0]!.start.x).toBeCloseTo(100, 5)
    expect(useStore.getState().toastMessage?.startsWith('error:')).toBe(true)
    expect(useStore.getState().schrumpfenDialogPieceId).toBe('p1')
  })
})

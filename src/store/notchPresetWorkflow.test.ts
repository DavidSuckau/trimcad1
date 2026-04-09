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

describe('Notch-Preset & Geometrie-Update', () => {
  beforeEach(() => {
    const cutLine = square(100)
    const workspace: Workspace = {
      id: 'ws-notch-preset',
      name: 'Test',
      pieces: [
        {
          id: 'p1',
          number: '001',
          name: 'Teil 001',
          cutLine,
          seamLine: [],
          notches: [
            {
              id: 'n1',
              position: { x: 50, y: 0 },
              angle: -90,
              type: 'single',
              depth: 4,
              width: 6,
            },
          ],
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
    useStore.setState({
      workspace,
      selectedPieceIds: ['p1'],
      activeNotchPresetIndex: 0,
      toastMessage: null,
    })
  })

  it('activeNotchPresetIndex Standard ist 0 und lässt sich setzen', () => {
    expect(useStore.getState().activeNotchPresetIndex).toBe(0)
    useStore.getState().setActiveNotchPresetIndex(3)
    expect(useStore.getState().activeNotchPresetIndex).toBe(3)
    useStore.getState().setActiveNotchPresetIndex(99)
    expect(useStore.getState().activeNotchPresetIndex).toBe(9)
    useStore.getState().setActiveNotchPresetIndex(-5)
    expect(useStore.getState().activeNotchPresetIndex).toBe(0)
  })

  it('updateNotch ändert Typ, Tiefe und Breite', () => {
    useStore.getState().updateNotch('p1', 'n1', { type: 'v', depth: 5, width: 8 })
    const n = useStore.getState().workspace.pieces[0].notches[0]
    expect(n.type).toBe('v')
    expect(n.depth).toBe(5)
    expect(n.width).toBe(8)
  })

  it('updateNotch lehnt zu kleine Tiefe/Breite ab', () => {
    useStore.getState().updateNotch('p1', 'n1', { depth: 0.1 })
    expect(useStore.getState().toastMessage?.startsWith('error:')).toBe(true)
    const n = useStore.getState().workspace.pieces[0].notches[0]
    expect(n.depth).toBe(4)
  })
})

import { describe, expect, it } from 'vitest'
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

function seedWorkspace() {
  const ws: Workspace = {
    id: 'ws-notch-role',
    name: 'test',
    view: { zoom: 1, panX: 0, panY: 0 },
    seamAssignments: [],
    pieces: [
      {
        id: 'p1',
        number: '1',
        name: 'Teil',
        cutLine: square(100),
        seamLine: [],
        notches: [{ id: 'n1', position: { x: 30, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 }],
        drills: [],
        grainLine: null,
        internalLines: [],
        internalCircles: [],
        layer: 'CUT',
        transform: { x: 0, y: 0, rotation: 0, mirrored: false },
      },
    ],
  }
  useStore.setState({ workspace: ws, toastMessage: null })
}

describe('notch roles', () => {
  it('persistiert gueltige Rollen am Notch', () => {
    seedWorkspace()
    useStore.getState().updateNotch('p1', 'n1', { role: 'beides' })
    const notch = useStore.getState().workspace.pieces[0].notches[0]
    expect(notch.role).toBe('beides')
  })

  it('weist ungueltige Rollen ab', () => {
    seedWorkspace()
    useStore.getState().updateNotch('p1', 'n1', { role: 'invalid' as never })
    const state = useStore.getState()
    expect(state.workspace.pieces[0].notches[0].role).toBeUndefined()
    expect(state.toastMessage).toContain('Ungültige Kerben-Rolle')
  })
})

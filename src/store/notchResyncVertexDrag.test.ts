import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import { getNotchPositionAndAngle } from '../geometry/notchOnCurve'
import type { Workspace, Curve } from '../types/model'

function square(size: number): Curve[] {
  return [
    { type: 'line', start: { x: 0, y: 0 }, end: { x: size, y: 0 } },
    { type: 'line', start: { x: size, y: 0 }, end: { x: size, y: size } },
    { type: 'line', start: { x: size, y: size }, end: { x: 0, y: size } },
    { type: 'line', start: { x: 0, y: size }, end: { x: 0, y: 0 } },
  ]
}

describe('Vertex-Drag: Notch-Resync bleibt stabil', () => {
  beforeEach(() => {
    const seam = square(100)
    const workspace: Workspace = {
      id: 'ws-notch-vertex',
      name: 'Test',
      pieces: [
        {
          id: 'p1',
          number: '001',
          name: 'Teil 001',
          // Für den Test reicht eine gültige Startkontur; bei updateVertex wird cutLine aus seamLine neu abgeleitet.
          cutLine: square(110),
          seamLine: seam,
          seamAllowanceMm: 10,
          notches: [
            { id: 'n1', position: { x: 20, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6, sNormalized: 0.05, arcLengthMm: 22 },
            { id: 'n2', position: { x: 60, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6, sNormalized: 0.15, arcLengthMm: 66 },
            { id: 'n3', position: { x: 100, y: 35 }, angle: 180, type: 'single', depth: 4, width: 6, sNormalized: 0.3375, arcLengthMm: 148.5 },
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
    useStore.setState({ workspace, selectedPieceIds: ['p1'] })
  })

  it('entfernt beim Eckpunkt-Aendern keine Notches', () => {
    const before = useStore.getState().workspace.pieces[0]
    const baseline = {
      notches: before.notches.map((n) => ({ ...n, position: { ...n.position } })),
      cutLine: before.cutLine.map((c) =>
        c.type === 'line'
          ? { type: 'line' as const, start: { ...c.start }, end: { ...c.end } }
          : { type: 'bezier' as const, start: { ...c.start }, end: { ...c.end }, cp1: { ...c.cp1 }, cp2: { ...c.cp2 } }
      ),
    }

    useStore.getState().updateVertex('p1', 1, { x: 125, y: -10 }, false, { notchResyncBaseline: baseline })

    const after = useStore.getState().workspace.pieces[0]
    expect(after.notches).toHaveLength(before.notches.length)
    expect(after.notches.map((n) => n.id).sort()).toEqual(before.notches.map((n) => n.id).sort())

    for (const n of after.notches) {
      const resolved = getNotchPositionAndAngle(n, after.cutLine, after.seamLine)
      expect(Number.isFinite(resolved.position.x)).toBe(true)
      expect(Number.isFinite(resolved.position.y)).toBe(true)
    }
  })

  it('bleibt ueber mehrere kritische Winkel waehrend eines Drags stabil', () => {
    const before = useStore.getState().workspace.pieces[0]
    const baseline = {
      notches: before.notches.map((n) => ({ ...n, position: { ...n.position } })),
      cutLine: before.cutLine.map((c) =>
        c.type === 'line'
          ? { type: 'line' as const, start: { ...c.start }, end: { ...c.end } }
          : { type: 'bezier' as const, start: { ...c.start }, end: { ...c.end }, cp1: { ...c.cp1 }, cp2: { ...c.cp2 } }
      ),
    }
    const dragPath = [
      { x: 130, y: -40 },
      { x: 80, y: -90 },
      { x: 30, y: -40 },
      { x: 140, y: 10 },
      { x: 95, y: -5 },
    ]

    for (const p of dragPath) {
      useStore.getState().updateVertex('p1', 1, p, false, { notchResyncBaseline: baseline })
      const piece = useStore.getState().workspace.pieces[0]
      expect(piece.notches).toHaveLength(before.notches.length)
      expect(piece.notches.map((n) => n.id).sort()).toEqual(before.notches.map((n) => n.id).sort())
      for (const n of piece.notches) {
        const resolved = getNotchPositionAndAngle(n, piece.cutLine, piece.seamLine)
        expect(Number.isFinite(resolved.position.x)).toBe(true)
        expect(Number.isFinite(resolved.position.y)).toBe(true)
        expect(Number.isFinite(resolved.angle)).toBe(true)
      }
    }
  })
})

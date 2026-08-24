import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import { masterSoftVertexIndexSet } from '../geometry/seamUtils'
import { deriveCutLineForPiece } from '../geometry/deriveCutLineForPiece'
import { getNotchPositionAndAngle } from '../geometry/notchOnCurve'
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

  it('bei abweichender cutLine (Naht trimmen): Spiegelung leitet cut nicht neu aus der Naht ab', () => {
    useStore.getState().updatePiece('p1', { seamAllowanceMm: 10 })
    const withSeam = useStore.getState().workspace.pieces[0]
    const tweakedCut = withSeam.cutLine.map((c, i) =>
      i === 0 && c.type === 'line'
        ? { ...c, end: { x: c.end.x + 2, y: c.end.y } }
        : c
    )
    useStore.setState((s) => ({
      workspace: {
        ...s.workspace,
        pieces: s.workspace.pieces.map((p) =>
          p.id === 'p1'
            ? { ...p, cutLine: tweakedCut, cutLineDeviatesFromSeamAllowanceOffset: true as const }
            : p
        ),
      },
    }))
    useStore.getState().flipPieceAlongGrain('p1')
    const after = useStore.getState().workspace.pieces[0]
    expect(after.cutLineDeviatesFromSeamAllowanceOffset).toBe(true)
    const pure = deriveCutLineForPiece(after, after.seamLine, after.seamAllowanceMm ?? 10)
    expect(pure.ok).toBe(true)
    if (!pure.ok) return
    expect(JSON.stringify(after.cutLine)).not.toBe(JSON.stringify(pure.cutLine))
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

  it('Notch nahe Ecke bleibt nach Flip auf der gespiegelten Kante (kein Sprung)', () => {
    useStore.getState().addNotch('p1', {
      id: 'n-corner',
      position: { x: 5, y: 0 },
      angle: -90,
      type: 'single',
      depth: 4,
      width: 6,
      sNormalized: 0.0125,
      arcLengthMm: 5,
    })
    const before = useStore.getState().workspace.pieces[0]
    const posBefore = before.notches[0].position
    useStore.getState().flipPieceAlongGrain('p1')
    const after = useStore.getState().workspace.pieces[0]
    const posAfter = after.notches[0].position
    expect(posAfter.x).toBeCloseTo(100 - posBefore.x, 3)
    expect(posAfter.y).toBeCloseTo(posBefore.y, 3)
  })

  it('Notch bleibt bei Flip mit Nahtzugabe stabil (zweifacher Flip ≈ Identität)', () => {
    useStore.getState().updatePiece('p1', { seamAllowanceMm: 10 })
    useStore.getState().addNotch('p1', {
      id: 'n-sa',
      position: { x: 30, y: -10 },
      angle: -90,
      type: 'single',
      depth: 4,
      width: 6,
    })
    const before = useStore.getState().workspace.pieces[0]
    const pos0 = getNotchPositionAndAngle(before.notches[0], before.cutLine).position
    useStore.getState().flipPieceAlongGrain('p1')
    useStore.getState().flipPieceAlongGrain('p1')
    const after = useStore.getState().workspace.pieces[0]
    const pos1 = getNotchPositionAndAngle(after.notches[0], after.cutLine).position
    expect(pos1.x).toBeCloseTo(pos0.x, 1)
    expect(pos1.y).toBeCloseTo(pos0.y, 1)
  })
})

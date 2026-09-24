import { describe, expect, it } from 'vitest'
import { beforeEach } from 'vitest'
import { useStore } from './useStore'
import { pieceLocalToWorld } from '../geometry/pieceTransform'
import { getPieceGrainLine } from '../geometry/grainArrowLayout'
import type { PatternPiece } from '../types/model'

function rectPiece(): PatternPiece {
  return {
    id: 'p1',
    number: '001',
    name: 'Test',
    cutLine: [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 60 } },
      { type: 'line', start: { x: 100, y: 60 }, end: { x: 0, y: 60 } },
      { type: 'line', start: { x: 0, y: 60 }, end: { x: 0, y: 0 } },
    ],
    seamLine: [],
    seamAllowanceMm: null,
    notches: [],
    drills: [],
    grainLine: { start: { x: 50, y: 10 }, end: { x: 50, y: 50 } },
    internalLines: [],
    internalCircles: [],
    layer: 'CUT',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    softVertices: [],
    softVerticesMaster: [],
    fillInterior: true,
  }
}

describe('rotatePiece90 keepGrainWorldFixed', () => {
  beforeEach(() => {
    useStore.setState({
      workspace: {
        id: 'ws',
        name: 't',
        pieces: [rectPiece()],
        seamAssignments: [],
        profileAssignments: [],
        view: { zoom: 1, panX: 0, panY: 0 },
      },
    })
  })

  it('lässt Laufrichtung in Weltkoordinaten stehen wenn Teil mit R gedreht wird', () => {
    const before = useStore.getState().workspace.pieces[0]
    const g0 = getPieceGrainLine(before)
    const wStart0 = pieceLocalToWorld(g0.start, before.transform)
    const wEnd0 = pieceLocalToWorld(g0.end, before.transform)

    useStore.getState().rotatePiece90('p1')

    const after = useStore.getState().workspace.pieces[0]
    expect(after.transform.rotation).toBe(90)
    const g1 = getPieceGrainLine(after)
    const wStart1 = pieceLocalToWorld(g1.start, after.transform)
    const wEnd1 = pieceLocalToWorld(g1.end, after.transform)
    expect(wStart1.x).toBeCloseTo(wStart0.x, 5)
    expect(wStart1.y).toBeCloseTo(wStart0.y, 5)
    expect(wEnd1.x).toBeCloseTo(wEnd0.x, 5)
    expect(wEnd1.y).toBeCloseTo(wEnd0.y, 5)
  })

  it('alignPieceToGrain dreht Laufrichtung mit dem Teil mit', () => {
    useStore.getState().setPieceRotation('p1', 45, { keepGrainWorldFixed: false })
    // Grain lokal vertikal; nach 45° Rotation zeigt sie schräg in der Welt
    useStore.getState().setGrainLine('p1', { start: { x: 50, y: 10 }, end: { x: 50, y: 50 } })
    useStore.getState().setPieceRotation('p1', 45, { keepGrainWorldFixed: false })

    const before = useStore.getState().workspace.pieces[0]
    const g0 = getPieceGrainLine(before)
    const wStart0 = pieceLocalToWorld(g0.start, before.transform)

    useStore.getState().alignPieceToGrain('p1')

    const after = useStore.getState().workspace.pieces[0]
    const g1 = getPieceGrainLine(after)
    const wStart1 = pieceLocalToWorld(g1.start, after.transform)
    // Mit keepGrainWorldFixed false: Grain-Endpunkte bewegen sich mit der Drehung
    expect(Math.hypot(wStart1.x - wStart0.x, wStart1.y - wStart0.y)).toBeGreaterThan(1)
  })
})

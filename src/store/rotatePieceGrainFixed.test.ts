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

describe('rotatePiece90 / alignPieceToGrain Laufrichtung', () => {
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

  it('R: Laufrichtungspfeil dreht mit dem Teil (lokale Grain bleibt)', () => {
    const before = useStore.getState().workspace.pieces[0]
    const g0 = getPieceGrainLine(before)

    useStore.getState().rotatePiece90('p1')

    const after = useStore.getState().workspace.pieces[0]
    expect(after.transform.rotation).toBe(90)
    const g1 = getPieceGrainLine(after)
    // Lokal unverändert → Pfeil dreht mit der Teil-Rotation in der Welt
    expect(g1.start.x).toBeCloseTo(g0.start.x, 5)
    expect(g1.start.y).toBeCloseTo(g0.start.y, 5)
    expect(g1.end.x).toBeCloseTo(g0.end.x, 5)
    expect(g1.end.y).toBeCloseTo(g0.end.y, 5)
    const wStart0 = pieceLocalToWorld(g0.start, before.transform)
    const wStart1 = pieceLocalToWorld(g1.start, after.transform)
    expect(Math.hypot(wStart1.x - wStart0.x, wStart1.y - wStart0.y)).toBeGreaterThan(1)
  })

  it('A: alignPieceToGrain richtet Teil an Laufrichtung aus', () => {
    useStore.getState().setPieceRotation('p1', 45)
    useStore.getState().setGrainLine('p1', { start: { x: 50, y: 10 }, end: { x: 50, y: 50 } })

    useStore.getState().alignPieceToGrain('p1')

    const after = useStore.getState().workspace.pieces[0]
    const g = getPieceGrainLine(after)
    const wStart = pieceLocalToWorld(g.start, after.transform)
    const wEnd = pieceLocalToWorld(g.end, after.transform)
    const worldAngleDeg = (Math.atan2(wEnd.y - wStart.y, wEnd.x - wStart.x) * 180) / Math.PI
    // Ziel in alignPieceToGrain: 90° (nach „oben“ in Welt)
    let delta = worldAngleDeg - 90
    while (delta > 180) delta -= 360
    while (delta < -180) delta += 360
    expect(Math.abs(delta)).toBeLessThan(1)
  })
})

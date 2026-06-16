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
describe('checkSeamAdjustment', () => {
  beforeEach(() => {
    const cutA = square(100)
    const cutB = square(100)
    const workspace: Workspace = {
      id: 'ws-seam-check',
      name: 'Test',
      pieces: [
        {
          id: 'A',
          number: '001',
          name: 'Teil A',
          cutLine: cutA,
          seamLine: [],
          notches: [
            { id: 'a1', position: { x: 25, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
            { id: 'a2', position: { x: 75, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
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
        {
          id: 'B',
          number: '002',
          name: 'Teil B',
          cutLine: cutB,
          seamLine: [],
          notches: [
            { id: 'b1', position: { x: 40, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
            { id: 'b2', position: { x: 70, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
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
      seamAssignments: [
        {
          id: 's-check',
          pieceIdA: 'A',
          curveIndicesA: [0],
          clickedCurveA: 0,
          pieceIdB: 'B',
          curveIndicesB: [0],
          clickedCurveB: 0,
        },
      ],
    }
    useStore.setState({ workspace, seamAdjustmentDialog: null, seamAdjustmentAcknowledged: {} })
  })

  it('öffnet Dialog bei Subsegment-Abweichung', () => {
    useStore.getState().checkSeamAdjustment()
    expect(useStore.getState().seamAdjustmentDialog).toBe('s-check')
  })

  it('fragt nach Bestätigung nicht erneut bei gleicher Abweichung', () => {
    useStore.getState().checkSeamAdjustment()
    useStore.getState().setSeamAdjustmentDialog(null)
    useStore.getState().checkSeamAdjustment()
    expect(useStore.getState().seamAdjustmentDialog).toBeNull()
  })

  it('fragt erneut nach wenn sich die Nahtgeometrie ändert', () => {
    useStore.getState().checkSeamAdjustment()
    useStore.getState().setSeamAdjustmentDialog(null)

    const st = useStore.getState()
    const pieceB = st.workspace.pieces.find((p) => p.id === 'B')!
    const movedNotch = pieceB.notches.map((n) =>
      n.id === 'b1' ? { ...n, position: { x: 30, y: 0 }, arcLengthMm: 30, sNormalized: 0.075 } : n
    )
    useStore.setState({
      workspace: {
        ...st.workspace,
        pieces: st.workspace.pieces.map((p) => (p.id === 'B' ? { ...p, notches: movedNotch } : p)),
      },
    })

    useStore.getState().checkSeamAdjustment()
    expect(useStore.getState().seamAdjustmentDialog).toBe('s-check')
  })
})

describe('adjustSeamNotches', () => {
  beforeEach(() => {
    const cutA = square(100)
    const cutB = square(100)
    const workspace: Workspace = {
      id: 'ws-seam-adjust',
      name: 'Test',
      pieces: [
        {
          id: 'A',
          number: '001',
          name: 'Teil A',
          cutLine: cutA,
          seamLine: [],
          notches: [
            // Referenz: 25 mm auf Segment 0.
            { id: 'a1', position: { x: 25, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6, sNormalized: 0.0625, arcLengthMm: 25 },
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
        {
          id: 'B',
          number: '002',
          name: 'Teil B',
          cutLine: cutB,
          seamLine: [],
          notches: [
            // Ziel: 40 mm auf Segment 0, soll auf 25 mm umgelegt werden.
            { id: 'b1', position: { x: 40, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6, sNormalized: 0.1, arcLengthMm: 40 },
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
      seamAssignments: [
        {
          id: 's1',
          pieceIdA: 'A',
          curveIndicesA: [0],
          clickedCurveA: 0,
          pieceIdB: 'B',
          curveIndicesB: [0],
          clickedCurveB: 0,
        },
      ],
    }
    useStore.setState({ workspace, seamAdjustmentDialog: 's1' })
  })

  it('materialisiert neue Cut-Ankerwerte und verschiebt Ziel-Notch wirklich', () => {
    useStore.getState().adjustSeamNotches('s1', 'A')
    const st = useStore.getState()
    const pieceB = st.workspace.pieces.find((p) => p.id === 'B')
    expect(pieceB).toBeDefined()
    const notch = pieceB!.notches.find((n) => n.id === 'b1')
    expect(notch).toBeDefined()
    const resolved = getNotchPositionAndAngle(notch!, pieceB!.cutLine, pieceB!.seamLine)

    expect(resolved.position.x).toBeCloseTo(25, 3)
    expect(resolved.position.y).toBeCloseTo(0, 3)
    expect(notch!.arcLengthMm).toBeCloseTo(25, 3)
    expect(notch!.sNormalized).toBeCloseTo(0.0625, 4)
    expect(notch!.vertexIndex).toBeUndefined()
    expect(st.seamAdjustmentDialog).toBeNull()
  })

  it('gleicht bei invertierter Richtung + Start-Offset stabil auf Referenzabstaende an', () => {
    const cutA = square(100)
    const cutB = square(100)
    const workspace: Workspace = {
      id: 'ws-seam-adjust-rev',
      name: 'Test',
      pieces: [
        {
          id: 'A',
          number: '001',
          name: 'Teil A',
          cutLine: cutA,
          seamLine: [],
          notches: [
            { id: 'a1', position: { x: 20, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6, sNormalized: 0.05, arcLengthMm: 20 },
            { id: 'a2', position: { x: 70, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6, sNormalized: 0.175, arcLengthMm: 70 },
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
        {
          id: 'B',
          number: '002',
          name: 'Teil B',
          cutLine: cutB,
          seamLine: [],
          notches: [
            // Absichtlich "verschoben" auf derselben Kante; Reihenfolge bleibt entlang B-Start.
            { id: 'b1', position: { x: 60, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6, sNormalized: 0.15, arcLengthMm: 60 },
            { id: 'b2', position: { x: 10, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6, sNormalized: 0.025, arcLengthMm: 10 },
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
      seamAssignments: [
        {
          id: 's2',
          pieceIdA: 'A',
          curveIndicesA: [0],
          clickedCurveA: 0,
          pieceIdB: 'B',
          curveIndicesB: [0],
          clickedCurveB: 0,
        },
      ],
    }
    useStore.setState({ workspace, seamAdjustmentDialog: 's2' })

    useStore.getState().adjustSeamNotches('s2', 'A')
    const st = useStore.getState()
    const pieceB = st.workspace.pieces.find((p) => p.id === 'B')!
    const b1 = pieceB.notches.find((n) => n.id === 'b1')!
    const b2 = pieceB.notches.find((n) => n.id === 'b2')!
    const p1 = getNotchPositionAndAngle(b1, pieceB.cutLine, pieceB.seamLine).position
    const p2 = getNotchPositionAndAngle(b2, pieceB.cutLine, pieceB.seamLine).position

    // Ziel: Notches liegen nach Angleich konsistent auf den Referenzabstaenden.
    expect(Math.min(p1.x, p2.x)).toBeCloseTo(20, 3)
    expect(Math.max(p1.x, p2.x)).toBeCloseTo(70, 3)
    expect(st.seamAdjustmentDialog).toBeNull()
  })
})

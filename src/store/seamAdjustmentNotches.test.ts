import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import { getNotchPositionAndAngle } from '../geometry/notchOnCurve'
import { evaluateSeamAdjustment } from '../geometry/seamAdjustmentCheck'
import { materializeNotchAtEdgeArcLength } from '../geometry/seamUtils'
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

  it('gleicht bei Nahtzugabe + Bézier exakt an und öffnet Dialog nicht erneut', () => {
    const seamLine: Curve[] = [
      { type: 'bezier', start: { x: 0, y: 0 }, cp1: { x: 30, y: 40 }, cp2: { x: 70, y: -40 }, end: { x: 100, y: 0 } },
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 50 } },
      { type: 'line', start: { x: 100, y: 50 }, end: { x: 0, y: 50 } },
      { type: 'line', start: { x: 0, y: 50 }, end: { x: 0, y: 0 } },
    ]
    const cutLine: Curve[] = [
      { type: 'bezier', start: { x: 0, y: -10 }, cp1: { x: 25, y: 50 }, cp2: { x: 75, y: -50 }, end: { x: 100, y: -10 } },
      { type: 'line', start: { x: 100, y: -10 }, end: { x: 110, y: 50 } },
      { type: 'line', start: { x: 110, y: 50 }, end: { x: -10, y: 50 } },
      { type: 'line', start: { x: -10, y: 50 }, end: { x: 0, y: -10 } },
    ]
    const base = {
      drills: [] as [],
      grainLine: null,
      internalLines: [] as [],
      internalCircles: [] as [],
      layer: 'CUT' as const,
      transform: { x: 0, y: 0, rotation: 0, mirrored: false },
      softVertices: [] as number[],
      fillInterior: true,
      material: '',
      bomQuantity: 1,
      seamAllowanceMm: 10,
      cutLine,
      seamLine,
    }
    const emptyA = { ...base, id: 'A', number: '001', name: 'Teil A', notches: [] as [] }
    const emptyB = { ...base, id: 'B', number: '002', name: 'Teil B', notches: [] as [] }
    const a1 = materializeNotchAtEdgeArcLength(
      { id: 'a1', position: { x: 0, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
      emptyA,
      [0],
      25,
    )!
    const a2 = materializeNotchAtEdgeArcLength(
      { id: 'a2', position: { x: 0, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
      emptyA,
      [0],
      70,
    )!
    const b1 = materializeNotchAtEdgeArcLength(
      { id: 'b1', position: { x: 0, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
      emptyB,
      [0],
      40,
    )!
    const b2 = materializeNotchAtEdgeArcLength(
      { id: 'b2', position: { x: 0, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
      emptyB,
      [0],
      55,
    )!
    const workspace: Workspace = {
      id: 'ws-seam-allow',
      name: 'Test',
      pieces: [
        { ...emptyA, notches: [a1, a2] },
        { ...emptyB, notches: [b1, b2] },
      ],
      view: { zoom: 1, panX: 0, panY: 0 },
      seamAssignments: [
        {
          id: 's3',
          pieceIdA: 'A',
          curveIndicesA: [0],
          clickedCurveA: 0,
          pieceIdB: 'B',
          curveIndicesB: [0],
          clickedCurveB: 0,
        },
      ],
    }
    useStore.setState({ workspace, seamAdjustmentDialog: 's3', seamAdjustmentAcknowledged: {} })

    useStore.getState().adjustSeamNotches('s3', 'A')
    const after = useStore.getState()
    expect(after.seamAdjustmentDialog).toBeNull()

    const pieceA = after.workspace.pieces.find((p) => p.id === 'A')!
    const pieceB = after.workspace.pieces.find((p) => p.id === 'B')!
    const assignment = after.workspace.seamAssignments[0]!
    const ev = evaluateSeamAdjustment(assignment, pieceA, pieceB)
    expect(ev?.needsDialog).toBe(false)
    expect(ev?.maxMismatchMm ?? 0).toBeLessThan(0.1)

    useStore.getState().checkSeamAdjustment()
    expect(useStore.getState().seamAdjustmentDialog).toBeNull()
  })

  it('bei Clipper-Offset (Bézier→viele Cut-Linien) bleiben Kerben auf der Kurve, nicht in der Ecke', () => {
    const bezierTop: Curve[] = [
      { type: 'bezier', start: { x: 0, y: 0 }, cp1: { x: 30, y: 50 }, cp2: { x: 70, y: 50 }, end: { x: 120, y: 0 } },
      { type: 'line', start: { x: 120, y: 0 }, end: { x: 120, y: 80 } },
      { type: 'line', start: { x: 120, y: 80 }, end: { x: 0, y: 80 } },
      { type: 'line', start: { x: 0, y: 80 }, end: { x: 0, y: 0 } },
    ]
    const workspace: Workspace = {
      id: 'ws-clipper-bezier',
      name: 'Test',
      pieces: [
        {
          id: 'A',
          number: '001',
          name: 'A',
          cutLine: bezierTop,
          seamLine: [],
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
        {
          id: 'B',
          number: '002',
          name: 'B',
          cutLine: bezierTop.map((c) =>
            c.type === 'line'
              ? { ...c, start: { ...c.start }, end: { ...c.end } }
              : { ...c, start: { ...c.start }, end: { ...c.end }, cp1: { ...c.cp1 }, cp2: { ...c.cp2 } }
          ),
          seamLine: [],
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
      seamAssignments: [
        {
          id: 's-bez',
          pieceIdA: 'A',
          curveIndicesA: [0],
          clickedCurveA: 0,
          pieceIdB: 'B',
          curveIndicesB: [0],
          clickedCurveB: 0,
        },
      ],
    }
    useStore.setState({ workspace, seamAdjustmentDialog: 's-bez', seamAdjustmentAcknowledged: {} })
    useStore.getState().updatePiece('A', { seamAllowanceMm: 8 })
    useStore.getState().updatePiece('B', { seamAllowanceMm: 8 })

    const pieceA0 = useStore.getState().workspace.pieces.find((p) => p.id === 'A')!
    const pieceB0 = useStore.getState().workspace.pieces.find((p) => p.id === 'B')!
    expect(pieceA0.cutLine.length).toBeGreaterThan(pieceA0.seamLine.length)

    const a1 = materializeNotchAtEdgeArcLength(
      { id: 'a1', position: { x: 0, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
      pieceA0,
      [0],
      30,
    )!
    const a2 = materializeNotchAtEdgeArcLength(
      { id: 'a2', position: { x: 0, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
      pieceA0,
      [0],
      80,
    )!
    const b1 = materializeNotchAtEdgeArcLength(
      { id: 'b1', position: { x: 0, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
      pieceB0,
      [0],
      45,
    )!
    const b2 = materializeNotchAtEdgeArcLength(
      { id: 'b2', position: { x: 0, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
      pieceB0,
      [0],
      60,
    )!

    useStore.setState((s) => ({
      workspace: {
        ...s.workspace,
        pieces: s.workspace.pieces.map((p) =>
          p.id === 'A' ? { ...p, notches: [a1, a2] } : p.id === 'B' ? { ...p, notches: [b1, b2] } : p
        ),
      },
      seamAdjustmentDialog: 's-bez',
    }))

    const beforeB = useStore.getState().workspace.pieces.find((p) => p.id === 'B')!
    const posBefore = beforeB.notches.map((n) => getNotchPositionAndAngle(n, beforeB.cutLine).position)
    expect(Math.hypot(posBefore[0].x - posBefore[1].x, posBefore[0].y - posBefore[1].y)).toBeGreaterThan(10)

    useStore.getState().adjustSeamNotches('s-bez', 'A')
    const after = useStore.getState()
    const pieceA = after.workspace.pieces.find((p) => p.id === 'A')!
    const pieceB = after.workspace.pieces.find((p) => p.id === 'B')!
    const posAfter = pieceB.notches.map((n) => getNotchPositionAndAngle(n, pieceB.cutLine).position)
    expect(Math.hypot(posAfter[0].x - posAfter[1].x, posAfter[0].y - posAfter[1].y)).toBeGreaterThan(10)

    const ev = evaluateSeamAdjustment(after.workspace.seamAssignments[0]!, pieceA, pieceB)
    expect(ev?.needsDialog).toBe(false)
    expect(ev?.maxMismatchMm ?? 0).toBeLessThan(0.5)
  })

  it('gleicht Gerade↔Kurve mit NZ an (Normalen-Mapping)', () => {
    // Leichte Bézier (~100 mm), damit Gesamtlängen vergleichbar bleiben (sonst canAdjust=false).
    const seamLine: Curve[] = [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 50 } },
      { type: 'line', start: { x: 100, y: 50 }, end: { x: 0, y: 50 } },
      { type: 'line', start: { x: 0, y: 50 }, end: { x: 0, y: 0 } },
    ]
    const seamCurve: Curve[] = [
      { type: 'bezier', start: { x: 0, y: 0 }, cp1: { x: 33, y: 1 }, cp2: { x: 66, y: -1 }, end: { x: 100, y: 0 } },
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 50 } },
      { type: 'line', start: { x: 100, y: 50 }, end: { x: 0, y: 50 } },
      { type: 'line', start: { x: 0, y: 50 }, end: { x: 0, y: 0 } },
    ]
    const base = {
      drills: [] as [],
      grainLine: null,
      internalLines: [] as [],
      internalCircles: [] as [],
      layer: 'CUT' as const,
      transform: { x: 0, y: 0, rotation: 0, mirrored: false },
      softVertices: [] as number[],
      fillInterior: true,
      material: '',
      bomQuantity: 1,
      seamAllowanceMm: 10 as number | null,
      cutLine: seamLine,
      seamLine: [] as Curve[],
    }
    const workspace: Workspace = {
      id: 'ws-line-curve',
      name: 'Test',
      pieces: [
        { ...base, id: 'A', number: '001', name: 'Gerade', notches: [], cutLine: seamLine },
        { ...base, id: 'B', number: '002', name: 'Kurve', notches: [], cutLine: seamCurve },
      ],
      view: { zoom: 1, panX: 0, panY: 0 },
      seamAssignments: [
        {
          id: 's-lc',
          pieceIdA: 'A',
          curveIndicesA: [0],
          clickedCurveA: 0,
          pieceIdB: 'B',
          curveIndicesB: [0],
          clickedCurveB: 0,
        },
      ],
    }
    useStore.setState({ workspace, seamAdjustmentDialog: 's-lc', seamAdjustmentAcknowledged: {} })
    useStore.getState().updatePiece('A', { seamAllowanceMm: 10 })
    useStore.getState().updatePiece('B', { seamAllowanceMm: 10 })

    const pieceA0 = useStore.getState().workspace.pieces.find((p) => p.id === 'A')!
    const pieceB0 = useStore.getState().workspace.pieces.find((p) => p.id === 'B')!
    const a1 = materializeNotchAtEdgeArcLength(
      { id: 'a1', position: { x: 0, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
      pieceA0,
      [0],
      25,
    )!
    const a2 = materializeNotchAtEdgeArcLength(
      { id: 'a2', position: { x: 0, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
      pieceA0,
      [0],
      75,
    )!
    const b1 = materializeNotchAtEdgeArcLength(
      { id: 'b1', position: { x: 0, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
      pieceB0,
      [0],
      40,
    )!
    const b2 = materializeNotchAtEdgeArcLength(
      { id: 'b2', position: { x: 0, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
      pieceB0,
      [0],
      70,
    )!
    useStore.setState((s) => ({
      workspace: {
        ...s.workspace,
        pieces: s.workspace.pieces.map((p) =>
          p.id === 'A' ? { ...p, notches: [a1, a2] } : p.id === 'B' ? { ...p, notches: [b1, b2] } : p
        ),
      },
      seamAdjustmentDialog: 's-lc',
    }))

    useStore.getState().adjustSeamNotches('s-lc', 'A')
    const after = useStore.getState()
    const pieceA = after.workspace.pieces.find((p) => p.id === 'A')!
    const pieceB = after.workspace.pieces.find((p) => p.id === 'B')!
    const ev = evaluateSeamAdjustment(after.workspace.seamAssignments[0]!, pieceA, pieceB)
    expect(ev?.canAdjust).toBe(true)
    // Gerade↔Kurve mit NZ: Restfehler durch Cut↔Master-Abbildung möglich; <0.5 mm reicht fürs Angleichen.
    expect(ev?.maxMismatchMm ?? 0).toBeLessThan(0.5)
  })
})

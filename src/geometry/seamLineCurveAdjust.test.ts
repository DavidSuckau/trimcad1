import { describe, expect, it } from 'vitest'
import { useStore } from '../store/useStore'
import { evaluateSeamAdjustment } from './seamAdjustmentCheck'
import {
  getNotchesOnEdge,
  materializeNotchAtEdgeArcLength,
  edgeLengthInNotchRange,
} from './seamUtils'
import { deriveCutLineForPiece } from './deriveCutLineForPiece'
import type { Curve, PatternPiece, Workspace } from '../types/model'

function rectSeam(): Curve[] {
  return [
    { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 60 } },
    { type: 'line', start: { x: 100, y: 60 }, end: { x: 0, y: 60 } },
    { type: 'line', start: { x: 0, y: 60 }, end: { x: 0, y: 0 } },
  ]
}

/** Leichte Bézier (~100 mm), damit Gesamtlängen vergleichbar bleiben. */
function curveTopSeam(): Curve[] {
  return [
    { type: 'bezier', start: { x: 0, y: 0 }, cp1: { x: 33, y: 1 }, cp2: { x: 66, y: -1 }, end: { x: 100, y: 0 } },
    { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 60 } },
    { type: 'line', start: { x: 100, y: 60 }, end: { x: 0, y: 60 } },
    { type: 'line', start: { x: 0, y: 60 }, end: { x: 0, y: 0 } },
  ]
}

function withSa(id: string, name: string, seam: Curve[], sa: number): PatternPiece {
  const draft: PatternPiece = {
    id,
    number: id,
    name,
    cutLine: seam,
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
    seamAllowanceMm: sa,
  }
  const derived = deriveCutLineForPiece(draft, seam, sa)
  if (!derived.ok) throw new Error(derived.message)
  return { ...draft, seamLine: seam, cutLine: derived.cutLine }
}

describe('Nahtangleich Gerade↔Kurve (Kernfeature)', () => {
  it('materialize→getNotchesOnEdge Roundtrip auf Kurve+NZ < 0.05 mm', () => {
    const piece = withSa('B', 'Kurve', curveTopSeam(), 10)
    for (const target of [20, 35, 50, 65, 80]) {
      const n = materializeNotchAtEdgeArcLength(
        { id: `n${target}`, position: { x: 0, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
        piece,
        [0],
        target,
      )!
      const got = getNotchesOnEdge({ ...piece, notches: [n] }, [0])[0]!
      expect(Math.abs(got.arcLength - target)).toBeLessThan(0.05)
    }
  })

  it('Gerade→Kurve: nach Angleich Subsegmente < 0.1 mm (Dialog zu)', () => {
    const linePiece = withSa('A', 'Gerade', rectSeam(), 10)
    const curvePiece = withSa('B', 'Kurve', curveTopSeam(), 10)
    const lenA = edgeLengthInNotchRange(linePiece, [0], null)
    const lenB = edgeLengthInNotchRange(curvePiece, [0], null)
    // Gesamtlängen müssen nah genug sein, sonst canAdjust=false
    expect(Math.abs(lenA - lenB)).toBeLessThan(0.1)

    const a1 = materializeNotchAtEdgeArcLength(
      { id: 'a1', position: { x: 0, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
      linePiece,
      [0],
      25,
    )!
    const a2 = materializeNotchAtEdgeArcLength(
      { id: 'a2', position: { x: 0, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
      linePiece,
      [0],
      75,
    )!
    const b1 = materializeNotchAtEdgeArcLength(
      { id: 'b1', position: { x: 0, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
      curvePiece,
      [0],
      40,
    )!
    const b2 = materializeNotchAtEdgeArcLength(
      { id: 'b2', position: { x: 0, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
      curvePiece,
      [0],
      70,
    )!

    const workspace: Workspace = {
      id: 'ws',
      name: 'T',
      pieces: [
        { ...linePiece, notches: [a1, a2] },
        { ...curvePiece, notches: [b1, b2] },
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
    useStore.setState({ workspace, seamAdjustmentDialog: 's1', seamAdjustmentAcknowledged: {} })

    const before = evaluateSeamAdjustment(workspace.seamAssignments[0]!, workspace.pieces[0]!, workspace.pieces[1]!)
    expect(before?.canAdjust).toBe(true)
    expect(before?.needsDialog).toBe(true)

    // User wählt das Kurven-Teil zum Anpassen (Referenz = Gerade = A)
    useStore.getState().adjustSeamNotches('s1', 'A')
    const after = useStore.getState()
    const pieceA = after.workspace.pieces.find((p) => p.id === 'A')!
    const pieceB = after.workspace.pieces.find((p) => p.id === 'B')!
    const ev = evaluateSeamAdjustment(after.workspace.seamAssignments[0]!, pieceA, pieceB)

    expect(ev?.needsDialog).toBe(false)
    expect(ev?.canAdjust).toBe(false)
    expect(ev?.maxMismatchMm ?? 99).toBeLessThan(0.5)
  })
})

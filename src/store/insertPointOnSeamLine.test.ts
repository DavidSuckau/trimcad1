import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import { edgeTotalLength, masterSoftVertexIndexSet, resolvedSeamAssignmentCurveIndices } from '../geometry/seamUtils'
import { deriveCutLineFromSeamWithValidation } from '../geometry/offset'
import { applySeamAssignmentCutTrim } from '../geometry/seamAssignmentCutTrim'
import type { Workspace, Curve, PatternPiece } from '../types/model'

function square(size: number): Curve[] {
  return [
    { type: 'line', start: { x: 0, y: 0 }, end: { x: size, y: 0 } },
    { type: 'line', start: { x: size, y: 0 }, end: { x: size, y: size } },
    { type: 'line', start: { x: size, y: size }, end: { x: 0, y: size } },
    { type: 'line', start: { x: 0, y: size }, end: { x: 0, y: 0 } },
  ]
}

describe('insertPointOnCutLine (seam master)', () => {
  beforeEach(() => {
    const seamLine = square(100)
    const workspace: Workspace = {
      id: 'ws-seam-point',
      name: 'Test',
      pieces: [
        {
          id: 'p1',
          number: '001',
          name: 'Teil 001',
          cutLine: seamLine,
          seamLine,
          seamAllowanceMm: 10,
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

  it('fügt auch bei t nahe 0 robust auf der seamLine ein', () => {
    const { insertPointOnCutLine } = useStore.getState()
    insertPointOnCutLine('p1', 0, { x: 0, y: 0 }, 0)
    const p = useStore.getState().workspace.pieces.find((x) => x.id === 'p1')
    expect(p).toBeDefined()
    expect(p!.seamLine.length).toBe(5)
    const first = p!.seamLine[0]
    expect(first.type).toBe('line')
    if (first.type === 'line') {
      const len = Math.hypot(first.end.x - first.start.x, first.end.y - first.start.y)
      expect(len).toBeGreaterThan(0)
    }
  })

  it('nach Einfügen ist nur der neue Eckpunkt weich (keine Massen-Umfärbung der Ecken)', () => {
    const { insertPointOnCutLine } = useStore.getState()
    insertPointOnCutLine('p1', 0, { x: 50, y: 0 }, 0.5)
    const p = useStore.getState().workspace.pieces.find((x) => x.id === 'p1')!
    expect(p.seamLine.length).toBe(5)
    const softOnMaster = masterSoftVertexIndexSet(p)
    expect(softOnMaster.size).toBe(1)
    expect(softOnMaster.has(1)).toBe(true)
    expect(p.softVerticesMaster?.includes(1)).toBe(true)
  })

  it('remappt seamAssignment-Indices korrekt bei Insert auf seamLine Master', () => {
    useStore.setState({
      workspace: {
        id: 'ws-seam-assign-insert',
        name: 'Test',
        pieces: [
          {
            id: 'p1',
            number: '001',
            name: 'Teil 001',
            cutLine: square(100),
            seamLine: square(100),
            seamAllowanceMm: 10,
            notches: [
              {
                id: 'n1',
                position: { x: 100, y: 0 },
                angle: 0,
                type: 'single',
                depth: 4,
                sNormalized: 0.25,
              },
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
            id: 'p2',
            number: '002',
            name: 'Teil 002',
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
        seamAssignments: [
          {
            id: 'a1',
            pieceIdA: 'p1',
            curveIndicesA: [0, 1],
            clickedCurveA: 0,
            pieceIdB: 'p2',
            curveIndicesB: [0, 1],
            clickedCurveB: 0,
          },
        ],
      },
      selectedPieceIds: ['p1'],
    })

    const { insertPointOnCutLine } = useStore.getState()
    const before = useStore.getState().workspace
    const p1Before = before.pieces.find((x) => x.id === 'p1')!
    const aBefore = before.seamAssignments.find((a) => a.id === 'a1')!
    const resolvedBefore = resolvedSeamAssignmentCurveIndices(p1Before, aBefore.curveIndicesA)
    expect(resolvedBefore).toEqual([0, 1])

    const expectedLen = edgeTotalLength(p1Before, resolvedBefore)

    insertPointOnCutLine('p1', 0, { x: 50, y: 0 }, 0.5)

    const after = useStore.getState().workspace
    const p1After = after.pieces.find((x) => x.id === 'p1')!
    const aAfter = after.seamAssignments.find((a) => a.id === 'a1')!
    const resolvedAfter = resolvedSeamAssignmentCurveIndices(p1After, aAfter.curveIndicesA)

    expect(aAfter.curveIndicesA).toEqual([0, 1, 2])
    expect(aAfter.curveIndicesB).toEqual([0, 1])
    expect(resolvedAfter).toEqual([0, 1, 2])
    expect(edgeTotalLength(p1After, resolvedAfter)).toBeCloseTo(expectedLen, 6)

    const notchAfter = p1After.notches.find((n) => n.id === 'n1')!
    expect(notchAfter.vertexIndex).toBeUndefined()
    expect(notchAfter.sNormalized).toBeDefined()
  })

  it('behält die abgeschnittene Nahtecke, wenn danach ein Punkt auf die Naht gesetzt wird', () => {
    const sa = 10
    const sharpSeam: Curve[] = [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 80 } },
      { type: 'line', start: { x: 100, y: 80 }, end: { x: 36, y: 80 } },
      { type: 'line', start: { x: 36, y: 80 }, end: { x: 0, y: 0 } },
    ]
    const squareSeam: Curve[] = [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 80 } },
      { type: 'line', start: { x: 100, y: 80 }, end: { x: 0, y: 80 } },
      { type: 'line', start: { x: 0, y: 80 }, end: { x: 0, y: 0 } },
    ]
    const withCut = (id: string, seam: Curve[]): PatternPiece => {
      const derived = deriveCutLineFromSeamWithValidation(seam, sa)
      if (!derived.ok) throw new Error(derived.message)
      return {
        id,
        number: id,
        name: id,
        cutLine: derived.cutLine,
        seamLine: seam,
        seamAllowanceMm: sa,
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
      }
    }
    const trimmed = applySeamAssignmentCutTrim(withCut('sharp', sharpSeam), withCut('square', squareSeam), [0], [0], {
      measureDirA: 1,
      measureDirB: 1,
    })
    expect(trimmed).not.toBeNull()
    const leftOf = (piece: PatternPiece) => {
      let left = Infinity
      for (const c of piece.cutLine) {
        if (c.type !== 'line') continue
        if (Math.abs(c.start.y - -sa) < 0.6 && Math.abs(c.end.y - -sa) < 0.6 && Math.abs(c.end.y - c.start.y) < 0.4) {
          left = Math.min(left, c.start.x, c.end.x)
        }
      }
      return left
    }
    const leftBefore = leftOf(trimmed!.pieceA)
    expect(leftBefore).toBeCloseTo(-sa, 0)

    useStore.setState({
      workspace: {
        id: 'ws-corner-survives-point',
        name: 'Test',
        pieces: [trimmed!.pieceA, trimmed!.pieceB],
        view: { zoom: 1, panX: 0, panY: 0 },
        seamAssignments: [
          {
            id: 'a1',
            pieceIdA: 'sharp',
            curveIndicesA: [0],
            clickedCurveA: 0,
            measureDirA: 1,
            pieceIdB: 'square',
            curveIndicesB: [0],
            clickedCurveB: 0,
            measureDirB: 1,
          },
        ],
        autoAdjustSeamAssignmentCorners: true,
      },
      selectedPieceIds: ['sharp'],
    })

    const inserted = useStore.getState().insertPointOnCutLine('sharp', 0, { x: 50, y: 0 }, 0.5)
    expect(inserted).toBe(true)
    const sharp = useStore.getState().workspace.pieces.find((p) => p.id === 'sharp')!
    expect(sharp.seamLine.length).toBe(5)
    expect(leftOf(sharp)).toBeCloseTo(-sa, 0)
    expect(leftOf(sharp)).toBeGreaterThan(leftBefore - 1)
  })

})

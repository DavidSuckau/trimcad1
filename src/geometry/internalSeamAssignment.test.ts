import { describe, expect, it } from 'vitest'
import type { PatternPiece, SeamAssignment } from '../types/model'
import {
  getInternalSeamAssignmentCurves,
  hitInternalLineForSeamAssignment,
  internalSeamAssignmentLengthMm,
  isInternalSeamAssignment,
} from './internalSeamAssignment'
import { buildNaehplanRows } from '../bom/naehplan'

function pieceWithInternalLine(): PatternPiece {
  return {
    id: 'p1',
    number: '1',
    name: 'Vorder',
    cutLine: [
      { type: 'line', start: { x: 0, y: 10 }, end: { x: 200, y: 10 } },
      { type: 'line', start: { x: 200, y: 10 }, end: { x: 200, y: 110 } },
      { type: 'line', start: { x: 200, y: 110 }, end: { x: 0, y: 110 } },
      { type: 'line', start: { x: 0, y: 110 }, end: { x: 0, y: 10 } },
    ],
    seamLine: [],
    notches: [],
    drills: [],
    internalLines: [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 50 } },
    ],
    internalCircles: [],
    grainLine: null,
    layer: 'default',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
  }
}

describe('internalSeamAssignment', () => {
  it('detects internal single assignment', () => {
    const a: SeamAssignment = {
      id: 's1',
      pieceIdA: 'p1',
      curveIndicesA: [0, 1],
      clickedCurveA: 0,
      pieceIdB: 'p1',
      curveIndicesB: [],
      clickedCurveB: 0,
      isInternalSingle: true,
    }
    expect(isInternalSeamAssignment(a)).toBe(true)
  })

  it('hits internal line near path', () => {
    const p = pieceWithInternalLine()
    const hit = hitInternalLineForSeamAssignment({ x: 50, y: 2 }, p, 10)
    expect(hit).not.toBeNull()
    expect(hit!.curveIndex).toBe(0)
    expect(getInternalSeamAssignmentCurves(p, {
      id: 's1',
      pieceIdA: 'p1',
      curveIndicesA: hit!.curveIndices,
      clickedCurveA: hit!.curveIndex,
      pieceIdB: 'p1',
      curveIndicesB: [],
      clickedCurveB: 0,
      isInternalSingle: true,
    }).length).toBeGreaterThan(0)
    expect(hit!.curveIndices).toEqual([0])
    expect(internalSeamAssignmentLengthMm(p, {
      id: 's1',
      pieceIdA: 'p1',
      curveIndicesA: [0, 1],
      clickedCurveA: 0,
      pieceIdB: 'p1',
      curveIndicesB: [],
      clickedCurveB: 0,
      isInternalSingle: true,
    })).toBeCloseTo(100, 0)
    expect(internalSeamAssignmentLengthMm(p, {
      id: 's2',
      pieceIdA: 'p1',
      curveIndicesA: [0, 1],
      clickedCurveA: 1,
      pieceIdB: 'p1',
      curveIndicesB: [],
      clickedCurveB: 0,
      isInternalSingle: true,
    })).toBeCloseTo(50, 0)
  })

  it('appears in Nähplan as internal line row', () => {
    const p = pieceWithInternalLine()
    const rows = buildNaehplanRows({
      id: 'w1',
      name: 'Test',
      pieces: [p],
      view: { zoom: 1, panX: 0, panY: 0 },
      seamAssignments: [
        {
          id: 's1',
          pieceIdA: 'p1',
          curveIndicesA: [0],
          clickedCurveA: 0,
          pieceIdB: 'p1',
          curveIndicesB: [],
          clickedCurveB: 0,
          isInternalSingle: true,
          seamKind: 'saum',
          orderNumber: 3,
        },
      ],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].line).toContain('interner Linie')
    expect(rows[0].line).toContain('Saumnaht')
  })
})

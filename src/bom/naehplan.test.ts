import { describe, expect, it } from 'vitest'
import { buildNaehplanRows } from './naehplan'
import type { PatternPiece, Workspace } from '../types/model'

function minimalPiece(id: string, number: string, name: string): PatternPiece {
  return {
    id,
    number,
    name,
    cutLine: [],
    seamLine: [],
    notches: [],
    drills: [],
    grainLine: null,
    internalLines: [],
    internalCircles: [],
    layer: 'CUT',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
  }
}

describe('buildNaehplanRows', () => {
  it('sortiert nach orderNumber und nummeriert fortlaufend', () => {
    const p1 = minimalPiece('a', '001', 'Vorne')
    const p2 = minimalPiece('b', '002', 'Hinten')
    const ws: Workspace = {
      id: 'w',
      name: 'Test',
      pieces: [p1, p2],
      view: { zoom: 1, panX: 0, panY: 0 },
      seamAssignments: [
        {
          id: 's2',
          pieceIdA: 'a',
          curveIndicesA: [0],
          clickedCurveA: 0,
          pieceIdB: 'b',
          curveIndicesB: [0],
          clickedCurveB: 0,
          orderNumber: 2,
          seamKind: 'saum',
        },
        {
          id: 's1',
          pieceIdA: 'a',
          curveIndicesA: [1],
          clickedCurveA: 1,
          pieceIdB: 'b',
          curveIndicesB: [1],
          clickedCurveB: 1,
          orderNumber: 1,
          seamKind: 'schluessel',
        },
      ],
    }
    const rows = buildNaehplanRows(ws)
    expect(rows).toHaveLength(2)
    expect(rows[0].line).toMatch(/1\..*Schliessnaht \/ Standardnaht.*Teil 001 an Teil 002/)
    expect(rows[1].line).toMatch(/2\..*Saumnaht.*Teil 001 an Teil 002/)
  })

  it('ignoriert Zuordnungen mit fehlendem Teil', () => {
    const p1 = minimalPiece('a', '001', 'Vorne')
    const ws: Workspace = {
      id: 'w',
      name: 'Test',
      pieces: [p1],
      view: { zoom: 1, panX: 0, panY: 0 },
      seamAssignments: [
        {
          id: 's1',
          pieceIdA: 'a',
          curveIndicesA: [0],
          clickedCurveA: 0,
          pieceIdB: 'missing',
          curveIndicesB: [0],
          clickedCurveB: 0,
          orderNumber: 1,
        },
      ],
    }
    expect(buildNaehplanRows(ws)).toHaveLength(0)
  })
})

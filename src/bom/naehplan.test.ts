import { describe, expect, it } from 'vitest'
import {
  buildNaehplanRows,
  buildNaehplanSeamKindTotals,
  buildProfilnahtRows,
  profilnahtTotalLengthMm,
} from './naehplan'
import type { PatternPiece, ProfileAssignment, Workspace } from '../types/model'

function line(x1: number, y1: number, x2: number, y2: number) {
  return { type: 'line' as const, start: { x: x1, y: y1 }, end: { x: x2, y: y2 } }
}

function minimalPiece(id: string, number: string, name: string): PatternPiece {
  const square = [line(0, 0, 100, 0), line(100, 0, 100, 100), line(100, 100, 0, 100), line(0, 100, 0, 0)]
  return {
    id,
    number,
    name,
    cutLine: square,
    seamLine: square,
    seamAllowanceMm: 10,
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
    expect(rows[0].line).toMatch(/1\..*Schliessnaht \/ Standardnaht.*Teil 001 an Teil 002.*mm/)
    expect(rows[1].line).toMatch(/2\..*Saumnaht.*Teil 001 an Teil 002.*mm/)
    const totals = buildNaehplanSeamKindTotals(ws)
    expect(totals).toHaveLength(2)
    expect(totals[0].kindLabel).toContain('Schliessnaht')
    expect(totals[1].kindLabel).toContain('Saumnaht')
  })

  it('kombiniert interne Naht mit Profil im Nähplan bei with_seam', () => {
    const p1 = minimalPiece('a', '001', 'Vorne')
    p1.internalLines = [line(0, 10, 100, 10)]
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
          pieceIdB: 'a',
          curveIndicesB: [],
          clickedCurveB: 0,
          isInternalSingle: true,
          seamKind: 'deko',
          orderNumber: 1,
        },
      ],
      profileAssignments: [
        {
          id: 'pr1',
          pieceId: 'a',
          edgeIndex: 0,
          onInternalLine: true,
          internalLineAttachment: 'with_seam',
          profileName: 'Bund',
          profileKey: 'A',
        },
      ],
    }
    const rows = buildNaehplanRows(ws)
    expect(rows).toHaveLength(1)
    expect(rows[0].line).toMatch(/Dekorative Naht.*auf interner Linie inkl\. Profil Bund \(A\)/)
    expect(buildProfilnahtRows(ws)).toHaveLength(0)
    const totals = buildNaehplanSeamKindTotals(ws)
    expect(totals).toHaveLength(1)
    expect(totals[0].kindKey).toBe('deko')
    expect(totals[0].totalLengthMm).toBeCloseTo(100, 1)
  })

  it('listet Profilnähte separat', () => {
    const p1 = minimalPiece('a', '001', 'Vorne')
    const pa: ProfileAssignment = {
      id: 'pr1',
      pieceId: 'a',
      edgeIndex: 0,
      profileKey: 'A',
      profileName: 'Bundprofil',
    }
    const ws: Workspace = {
      id: 'w',
      name: 'Test',
      pieces: [p1],
      view: { zoom: 1, panX: 0, panY: 0 },
      seamAssignments: [],
      profileAssignments: [pa],
    }
    const rows = buildProfilnahtRows(ws)
    expect(rows).toHaveLength(1)
    expect(rows[0].line).toMatch(/Profilnaht.*Bundprofil.*Teil 001/)
    expect(profilnahtTotalLengthMm(ws)).toBe(rows[0].lengthMm)
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

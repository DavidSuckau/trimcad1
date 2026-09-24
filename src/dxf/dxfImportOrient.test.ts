import { describe, it, expect } from 'vitest'
import type { PatternPiece } from '../types/model'
import {
  commonPivotOfPieces,
  rotateImportedPieceGeometry180,
  rotateImportedPiecesGeometry180,
} from './dxfImportOrient'
import { importDxfFromString } from './dxfImporter'

function rectPiece(id: string, x0: number, y0: number, w: number, h: number): PatternPiece {
  return {
    id,
    number: id,
    name: id,
    cutLine: [
      { type: 'line', start: { x: x0, y: y0 }, end: { x: x0 + w, y: y0 } },
      { type: 'line', start: { x: x0 + w, y: y0 }, end: { x: x0 + w, y: y0 + h } },
      { type: 'line', start: { x: x0 + w, y: y0 + h }, end: { x: x0, y: y0 + h } },
      { type: 'line', start: { x: x0, y: y0 + h }, end: { x: x0, y: y0 } },
    ],
    seamLine: [],
    seamAllowanceMm: null,
    notches: [],
    drills: [{ id: `d-${id}`, center: { x: x0 + 5, y: y0 + 5 }, radius: 2 }],
    grainLine: { start: { x: x0 + w / 2, y: y0 + 5 }, end: { x: x0 + w / 2, y: y0 + h - 5 } },
    internalLines: [],
    internalCircles: [],
    layer: 'CUT',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    softVertices: [],
    softVerticesMaster: [],
    fillInterior: true,
  }
}

describe('rotateImportedPieceGeometry180', () => {
  it('dreht Geometrie um 180° um den Teilmittelpunkt (BBox bleibt)', () => {
    const p = rotateImportedPieceGeometry180(rectPiece('p1', 0, 0, 100, 40))
    expect(p.cutLine[0].start.x).toBeCloseTo(100, 5)
    expect(p.cutLine[0].start.y).toBeCloseTo(40, 5)
    expect(p.drills[0].center.x).toBeCloseTo(95, 5)
    expect(p.drills[0].center.y).toBeCloseTo(35, 5)
  })
})

describe('rotateImportedPiecesGeometry180 (gemeinsamer Pivot)', () => {
  it('hält angrenzende Teile aneinander (gemeinsame Kante bleibt gemeinsam)', () => {
    // Links 0..50, rechts 50..100 — gemeinsame Kante x=50
    const left = rectPiece('L', 0, 0, 50, 40)
    const right = rectPiece('R', 50, 0, 50, 40)
    const [L, R] = rotateImportedPiecesGeometry180([left, right])

    const leftEdgeX = L.cutLine.flatMap((c) => [c.start.x, c.end.x]).filter((x) => Math.abs(x - 50) < 1e-6 || true)
    // Nach globaler 180° um (50, 20): linkes Teil landet rechts, rechtes links —
    // die ehemalige gemeinsame Kante x=50 bleibt bei x=50 und gehört zu beiden.
    const Lxs = new Set(
      L.cutLine.flatMap((c) => [c.start.x, c.end.x]).map((x) => Math.round(x * 1e6) / 1e6),
    )
    const Rxs = new Set(
      R.cutLine.flatMap((c) => [c.start.x, c.end.x]).map((x) => Math.round(x * 1e6) / 1e6),
    )
    expect(Lxs.has(50)).toBe(true)
    expect(Rxs.has(50)).toBe(true)

    // Drill links war (5,5) → global 180 um (50,20) → (95,35) — bleibt auf dem (jetzt rechts liegenden) Teil
    expect(L.drills[0].center.x).toBeCloseTo(95, 5)
    expect(L.drills[0].center.y).toBeCloseTo(35, 5)
    // Drill rechts war (55,5) → (45,35)
    expect(R.drills[0].center.x).toBeCloseTo(45, 5)
    expect(R.drills[0].center.y).toBeCloseTo(35, 5)

    void leftEdgeX
  })

  it('commonPivotOfPieces mittig über alle Teile', () => {
    const pivot = commonPivotOfPieces([rectPiece('a', 0, 0, 50, 40), rectPiece('b', 50, 0, 50, 40)])
    expect(pivot?.cx).toBeCloseTo(50, 5)
    expect(pivot?.cy).toBeCloseTo(20, 5)
  })
})

describe('importDxfFromString Orientierung', () => {
  it('legt importierte Rechteck-Kontur nach 180°-Korrektur an', () => {
    const dxf = `0
SECTION
2
HEADER
9
$ACADVER
1
AC1009
9
$INSUNITS
70
5
0
ENDSEC
0
SECTION
2
ENTITIES
0
POLYLINE
8
CUT
70
1
0
VERTEX
8
CUT
10
0
20
0
0
VERTEX
8
CUT
10
20
20
0
0
VERTEX
8
CUT
10
20
20
10
0
VERTEX
8
CUT
10
0
20
10
0
SEQEND
0
ENDSEC
0
EOF
`
    const r = importDxfFromString(dxf)
    expect(r.error).toBeUndefined()
    expect(r.pieces.length).toBe(1)
    const c0 = r.pieces[0].cutLine[0]
    // Nach 180° um (10,5): (0,0) → (20,10)
    expect(c0.start.x).toBeCloseTo(20, 5)
    expect(c0.start.y).toBeCloseTo(10, 5)
  })
})

import { describe, it, expect } from 'vitest'
import type { PatternPiece } from '../types/model'
import { rotateImportedPieceGeometry180 } from './dxfImportOrient'
import { importDxfFromString } from './dxfImporter'

function rectPiece(): PatternPiece {
  return {
    id: 'p1',
    number: '001',
    name: 'Test',
    cutLine: [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 40 } },
      { type: 'line', start: { x: 100, y: 40 }, end: { x: 0, y: 40 } },
      { type: 'line', start: { x: 0, y: 40 }, end: { x: 0, y: 0 } },
    ],
    seamLine: [],
    seamAllowanceMm: null,
    notches: [
      {
        id: 'n1',
        position: { x: 50, y: 0 },
        angle: 90,
        type: 'v',
        depth: 4,
        width: 6,
      },
    ],
    drills: [{ id: 'd1', center: { x: 10, y: 5 }, radius: 2 }],
    grainLine: { start: { x: 50, y: 5 }, end: { x: 50, y: 35 } },
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
    const p = rotateImportedPieceGeometry180(rectPiece())
    // BBox weiterhin 0..100 × 0..40
    expect(p.cutLine[0].start.x).toBeCloseTo(100, 5)
    expect(p.cutLine[0].start.y).toBeCloseTo(40, 5)
    // Drill war (10,5) → (90,35)
    expect(p.drills[0].center.x).toBeCloseTo(90, 5)
    expect(p.drills[0].center.y).toBeCloseTo(35, 5)
    // Kerbe war unten Mitte → oben Mitte
    expect(p.notches[0].position.x).toBeCloseTo(50, 1)
    expect(p.notches[0].position.y).toBeCloseTo(40, 1)
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

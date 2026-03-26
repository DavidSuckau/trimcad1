import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { importDxfFromString, parseExtraCutLayers } from './dxfImporter'

const _dir = dirname(fileURLToPath(import.meta.url))

const DXF_HEADER = `0
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
`

const DXF_FOOTER = `0
ENDSEC
0
EOF
`

/** Geschlossenes Rechteck 0,0–10,10 auf angegebenem Layer (POLYLINE, flag 70=1). */
function closedRectPolyline(layer: string): string {
  return `0
POLYLINE
8
${layer}
66
1
70
1
0
VERTEX
8
${layer}
10
0
20
0
0
VERTEX
8
${layer}
10
10
20
0
0
VERTEX
8
${layer}
10
10
20
10
0
VERTEX
8
${layer}
10
0
20
10
0
SEQEND
`
}

describe('importDxfFromString', () => {
  it('importiert test-minimal.dxf mit einer Kontur', () => {
    const content = readFileSync(join(_dir, '../../test-minimal.dxf'), 'utf-8')
    const r = importDxfFromString(content)
    expect(r.error).toBeUndefined()
    expect(r.pieces.length).toBe(1)
    expect(r.pieces[0].cutLine.length).toBeGreaterThan(2)
  })

  it('lehnt Binär-DXF ab', () => {
    const r = importDxfFromString('AutoCAD Binary DXF\r\n\0')
    expect(r.pieces.length).toBe(0)
    expect(r.error).toMatch(/Binär/i)
  })

  it('liefert Fehler ohne Schnittkontur', () => {
    const r = importDxfFromString(DXF_HEADER + DXF_FOOTER)
    expect(r.pieces.length).toBe(0)
    expect(r.error).toBeDefined()
  })

  it('erkennt zusätzlichen Schnitt-Layer aus den Einstellungen', () => {
    const dxf = DXF_HEADER + closedRectPolyline('MUSTER') + DXF_FOOTER
    const no = importDxfFromString(dxf)
    expect(no.pieces.length).toBe(0)

    const yes = importDxfFromString(dxf, { extraCutLayers: parseExtraCutLayers('MUSTER') })
    expect(yes.pieces.length).toBe(1)
  })

  it('ordnet freistehende Notch-LINE und Bohrung dem Teil zu', () => {
    const dxf =
      DXF_HEADER +
      closedRectPolyline('CUT') +
      `0
LINE
8
4
10
5
20
5
11
5
21
8
0
CIRCLE
8
13
10
2
20
2
40
1
` +
      DXF_FOOTER
    const r = importDxfFromString(dxf)
    expect(r.pieces.length).toBe(1)
    expect(r.pieces[0].notches.length).toBeGreaterThanOrEqual(1)
    expect(r.pieces[0].drills.length).toBe(1)
    expect(r.pieces[0].drills[0].radius).toBeGreaterThan(0)
  })

  it('meldet ignorierte SPLINE-Entities in warnings', () => {
    const dxf =
      DXF_HEADER +
      closedRectPolyline('CUT') +
      `0
SPLINE
8
0
` +
      DXF_FOOTER
    const r = importDxfFromString(dxf)
    expect(r.warnings?.some((w) => w.includes('SPLINE'))).toBe(true)
    expect(r.pieces.length).toBe(1)
  })

  it('parst LWPOLYLINE mit Bulge zu ausreichend vielen Stützpunkten', () => {
    const dxf =
      DXF_HEADER +
      `0
LWPOLYLINE
8
CUT
90
3
70
1
10
0
20
0
42
0.5
10
10
20
0
42
0
10
10
20
10
` +
      DXF_FOOTER
    const r = importDxfFromString(dxf)
    expect(r.pieces.length).toBe(1)
    expect(r.pieces[0].cutLine.length).toBeGreaterThan(4)
  })
})

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

/** Geschlossenes Rechteck (ox,oy)–(ox+10,oy+10), gleiche Struktur wie `closedRectPolyline`. */
function closedRectPolylineOffset(layer: string, ox: number, oy: number): string {
  const x0 = ox
  const y0 = oy
  const x1 = ox + 10
  const y1 = oy + 10
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
${x0}
20
${y0}
0
VERTEX
8
${layer}
10
${x1}
20
${y0}
0
VERTEX
8
${layer}
10
${x1}
20
${y1}
0
VERTEX
8
${layer}
10
${x0}
20
${y1}
0
SEQEND
`
}

/** Rechteck 0..10 mm mit V-Kerbe an der unteren Kante (kurze Segmente, Spitze bei (5,2)). */
function closedRectWithVNotchPolyline(layer: string): string {
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
4
20
0
0
VERTEX
8
${layer}
10
5
20
2
0
VERTEX
8
${layer}
10
6
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
    const dxf = DXF_HEADER + closedRectPolyline('HATCH') + DXF_FOOTER
    const no = importDxfFromString(dxf)
    expect(no.pieces.length).toBe(0)

    const yes = importDxfFromString(dxf, { extraCutLayers: parseExtraCutLayers('HATCH') })
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

  it('importiert SPLINE grob als Stützpunktkette', () => {
    const dxf =
      DXF_HEADER +
      closedRectPolyline('CUT') +
      `0
SPLINE
8
0
10
1
20
1
10
5
20
5
` +
      DXF_FOOTER
    const r = importDxfFromString(dxf)
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

  it('INSERT findet Block auch wenn ENTITIES vor BLOCKS in der Datei steht', () => {
    const dxf = `0
SECTION
2
HEADER
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
INSERT
8
0
2
P1
10
0
20
0
41
1
42
1
0
ENDSEC
0
SECTION
2
BLOCKS
0
BLOCK
8
0
2
P1
70
0
10
0
20
0
0
POLYLINE
8
CUT
66
1
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
100
20
0
0
VERTEX
8
CUT
10
100
20
100
0
VERTEX
8
CUT
10
0
20
100
0
SEQEND
0
ENDBLK
0
ENDSEC
0
EOF
`
    const r = importDxfFromString(dxf)
    expect(r.error).toBeUndefined()
    expect(r.pieces.length).toBe(1)
  })

  it('erkennt V-Kerbe in der Polyligne und erzeugt Notch-Objekte', () => {
    const dxf = DXF_HEADER + closedRectWithVNotchPolyline('CUT') + DXF_FOOTER
    const r = importDxfFromString(dxf)
    expect(r.pieces.length).toBe(1)
    expect(r.pieces[0].notches.length).toBeGreaterThanOrEqual(1)
    expect(r.pieces[0].notches[0].type).toBe('v')
  })

  it('ohne V-Kerben-Erkennung bleiben Kerben nur als Polylinien-Vertices', () => {
    const dxf = DXF_HEADER + closedRectWithVNotchPolyline('CUT') + DXF_FOOTER
    const r = importDxfFromString(dxf, { detectVNotchesInPolyline: false })
    expect(r.pieces.length).toBe(1)
    expect(r.pieces[0].notches.length).toBe(0)
    expect(r.pieces[0].cutLine.length).toBeGreaterThan(4)
  })

  it('optional Nahtlinie aus Schnittkontur (Import-Einstellungen)', () => {
    const dxf = DXF_HEADER + closedRectPolyline('CUT') + DXF_FOOTER
    const r = importDxfFromString(dxf, {
      createSeamLineOnImport: true,
      importSeamAllowanceMm: 2,
    })
    expect(r.pieces.length).toBe(1)
    expect(r.pieces[0].seamAllowanceMm).toBe(2)
    expect(r.pieces[0].seamLine.length).toBeGreaterThanOrEqual(3)
    expect(r.pieces[0].cutLine.length).toBeGreaterThanOrEqual(3)
  })

  it('dedupliziert identische Schnittkonturen im Modellraum', () => {
    const dxf = DXF_HEADER + closedRectPolyline('CUT') + closedRectPolyline('CUT') + DXF_FOOTER
    const r = importDxfFromString(dxf)
    expect(r.pieces.length).toBe(1)
    expect(r.warnings?.some((w) => /doppelte Schnittkontur/i.test(w))).toBe(true)
  })

  it('dedupliziert nahezu identische Modellraum-Konturen (leichte Verschiebung)', () => {
    const dxf =
      DXF_HEADER + closedRectPolyline('CUT') + closedRectPolylineOffset('CUT', 0.25, 0.25) + DXF_FOOTER
    const r = importDxfFromString(dxf)
    expect(r.pieces.length).toBe(1)
    expect(r.warnings?.some((w) => /nahezu identische Schnittkontur/i.test(w))).toBe(true)
  })

  it('dedupliziert nicht zwei getrennte gleich große Teile mit großem Abstand', () => {
    const dxf =
      DXF_HEADER + closedRectPolyline('CUT') + closedRectPolylineOffset('CUT', 80, 0) + DXF_FOOTER
    const r = importDxfFromString(dxf)
    expect(r.pieces.length).toBe(2)
    expect((r.warnings ?? []).some((w) => /nahezu identische Schnittkontur/i.test(w))).toBe(false)
  })

  it('dedupliziert Block- und Modellraum-Kontur bei gleicher Geometrie', () => {
    const dxf = `0
SECTION
2
HEADER
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
INSERT
8
0
2
P1
10
0
20
0
41
1
42
1
0
POLYLINE
8
CUT
66
1
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
10
20
0
0
VERTEX
8
CUT
10
10
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
SECTION
2
BLOCKS
0
BLOCK
8
0
2
P1
70
0
10
0
20
0
0
POLYLINE
8
CUT
66
1
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
10
20
0
0
VERTEX
8
CUT
10
10
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
ENDBLK
0
ENDSEC
0
EOF
`
    const r = importDxfFromString(dxf)
    expect(r.error).toBeUndefined()
    expect(r.pieces.length).toBe(1)
    expect(r.warnings?.some((w) => /doppelte Schnittkontur/i.test(w))).toBe(true)
  })

  it('dedupliziert Block und minimal verschobenen Modellraum (Near-Match)', () => {
    const dxf = `0
SECTION
2
HEADER
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
INSERT
8
0
2
P1
10
0
20
0
41
1
42
1
0
POLYLINE
8
CUT
66
1
70
1
0
VERTEX
8
CUT
10
0.2
20
0.2
0
VERTEX
8
CUT
10
10.2
20
0.2
0
VERTEX
8
CUT
10
10.2
20
10.2
0
VERTEX
8
CUT
10
0.2
20
10.2
0
SEQEND
0
ENDSEC
0
SECTION
2
BLOCKS
0
BLOCK
8
0
2
P1
70
0
10
0
20
0
0
POLYLINE
8
CUT
66
1
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
10
20
0
0
VERTEX
8
CUT
10
10
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
ENDBLK
0
ENDSEC
0
EOF
`
    const r = importDxfFromString(dxf)
    expect(r.error).toBeUndefined()
    expect(r.pieces.length).toBe(1)
    expect(r.warnings?.some((w) => /nahezu identische Schnittkontur/i.test(w))).toBe(true)
  })

  it('erkennt Schnitt auf Layer 0 nur mit extraCutLayers', () => {
    const dxf = DXF_HEADER + closedRectPolyline('0') + DXF_FOOTER
    expect(importDxfFromString(dxf).pieces.length).toBe(0)
    const with0 = importDxfFromString(dxf, { extraCutLayers: parseExtraCutLayers('0') })
    expect(with0.pieces.length).toBe(1)
  })

  it('ordnet innere Kontur dem äußeren Teil als interne Linie zu (kein zweites Teil)', () => {
    const outer = closedRectPolylineOffset('CUT', 0, 0)
    const inner = `0
POLYLINE
8
CUT
66
1
70
1
0
VERTEX
8
CUT
10
2
20
2
0
VERTEX
8
CUT
10
8
20
2
0
VERTEX
8
CUT
10
8
20
8
0
VERTEX
8
CUT
10
2
20
8
0
SEQEND
`
    const dxf = DXF_HEADER + outer + inner + DXF_FOOTER
    const r = importDxfFromString(dxf)
    expect(r.pieces.length).toBe(1)
    expect(r.pieces[0].internalLines.length).toBeGreaterThan(0)
    expect(r.warnings?.some((w) => /innere Kontur/i.test(w))).toBe(true)
  })

  it('importiert Kreis auf Layer 8 innerhalb der Schnittkontur als internen Kreis', () => {
    const dxf =
      DXF_HEADER +
      closedRectPolyline('CUT') +
      `0
CIRCLE
8
8
10
5
20
5
40
1.5
` +
      DXF_FOOTER
    const r = importDxfFromString(dxf)
    expect(r.pieces.length).toBe(1)
    expect(r.pieces[0].internalCircles.length).toBe(1)
    expect(r.pieces[0].internalCircles[0].radius).toBeCloseTo(1.5, 3)
  })

  it('liest ASTM POINT-Kerbe mit Tiefe/Breite/Winkel', () => {
    const dxf =
      DXF_HEADER +
      closedRectPolyline('CUT') +
      `0
POINT
8
4
10
5
20
0
30
4
39
6
50
90
` +
      DXF_FOOTER
    const r = importDxfFromString(dxf)
    expect(r.pieces.length).toBe(1)
    expect(r.pieces[0].notches.length).toBeGreaterThanOrEqual(1)
    const n = r.pieces[0].notches.find((x) => x.depth >= 3.5)
    expect(n).toBeDefined()
    expect(n?.width).toBeGreaterThanOrEqual(5)
  })
})

import { describe, it, expect } from 'vitest'
import { importDxfFromString } from './dxfImporter'
import { importDxfOpenContoursFromString } from './dxfOpenContourImporter'
import { cutLineFormsClosedLoop } from '../geometry/curveToPath'

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

/** Offene Polylinie (70=0), drei Eckpunkte ohne Schließen zur ersten Ecke. */
function openPolylineOnLayer(layer: string): string {
  return `0
POLYLINE
8
${layer}
66
1
70
0
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
8
0
SEQEND
`
}

/** Geschlossenes Rechteck auf CUT (wie Standard-Tests). */
function closedRectPolylineCut(): string {
  return `0
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
`
}

describe('importDxfOpenContoursFromString', () => {
  it('importiert offene Schnitt-Polyline als Vorlagen-Teil', () => {
    const dxf = DXF_HEADER + openPolylineOnLayer('CUT') + DXF_FOOTER
    const r = importDxfOpenContoursFromString(dxf)
    expect(r.error).toBeUndefined()
    expect(r.pieces).toHaveLength(1)
    expect(r.pieces[0].cutLine.length).toBeGreaterThanOrEqual(1)
    expect(r.pieces[0].layer).toBe('CUT_VORLAGE')
    expect(r.pieces[0].fillInterior).toBe(false)
    expect(r.pieces[0].seamLine).toEqual([])
    expect(cutLineFormsClosedLoop(r.pieces[0].cutLine)).toBe(false)
  })

  it('liefert Fehler wenn nur geschlossene Konturen vorhanden', () => {
    const dxf = DXF_HEADER + closedRectPolylineCut() + DXF_FOOTER
    const r = importDxfOpenContoursFromString(dxf)
    expect(r.pieces).toHaveLength(0)
    expect(r.error).toMatch(/offenen|geschlossene/i)
  })

  it('Standard-Import ignoriert dieselbe offene Polylinie', () => {
    const dxf = DXF_HEADER + openPolylineOnLayer('CUT') + DXF_FOOTER
    const r = importDxfFromString(dxf)
    expect(r.pieces).toHaveLength(0)
    expect(r.error).toBeDefined()
  })
})

import type { Workspace, PatternPiece } from '../types/model'
import {
  EOL, fmt,
  curveToPolylinePoints, workspaceExtents,
  dxfPolyline, dxfCircle, dxfLine, dxfText,
  dxfNotchGeometry,
  sanitizeBlockName, makeExportFilename, downloadBlob,
} from './dxfShared'

/**
 * AAMA-DXF Writer – Apparel-Industriestandard.
 *
 * Format:    DXF R12 (AC1009), Einheiten mm
 * Struktur:  HEADER -> BLOCKS (1 Block pro Piece) -> ENTITIES (INSERT pro Block) -> EOF
 *
 * Layer-Konvention (AAMA):
 *   CUT      = Aussenkontour (Schnittlinie, aeussere Kante mit Nahtzugabe)
 *   SEAM     = Nahtlinie (innere Linie, wo tatsaechlich genaehrt wird)
 *              -> Gerber erkennt den Abstand CUT↔SEAM als Nahtzugabe
 *   NOTCH    = Kerben als LINE/POLYLINE-Geometrie (nicht POINT!)
 *   DRILL    = Bohrloecher als CIRCLE
 *   GRAIN    = Fadenlauf als LINE
 *   TEXT     = Beschriftung
 *   INTERNAL = Interne Linien (Abnaeher, Taschenmarkierungen etc.)
 *
 * Wichtig:
 *   - Boundary (CUT) ist die SAUBERE cutLine OHNE eingebettete Notch-Cutouts.
 *     Notches werden als separate Entities auf dem NOTCH-Layer exportiert.
 *   - Gerber AccuMark erkennt die Nahtzugabe am Vorhandensein von CUT + SEAM.
 *
 * Kompatibel mit: Gerber AccuMark, Lectra, Optitex, Tukatech, Audaces
 * Dateiendung: .aam
 */

const AAMA_LAYERS = {
  CUT: 'CUT',
  SEAM: 'SEAM',
  NOTCH: 'NOTCH',
  DRILL: 'DRILL',
  GRAIN: 'GRAIN',
  TEXT: 'TEXT',
  INTERNAL: 'INTERNAL',
} as const

function pieceBlockName(piece: PatternPiece, index: number): string {
  const raw = piece.name || piece.number || `Piece_${index}`
  return sanitizeBlockName(raw)
}

function buildBlockContent(piece: PatternPiece, scale: number): string {
  const out: string[] = []

  // CUT layer: saubere Aussenkontour (cutLine) OHNE Notch-Cutouts
  const cutPts = curveToPolylinePoints(piece.cutLine)
  const scaledCutPts = cutPts.map((p) => ({ x: p.x * scale, y: p.y * scale }))
  out.push(dxfPolyline(AAMA_LAYERS.CUT, scaledCutPts, true))

  // SEAM layer: Nahtlinie (wo genaehrt wird).
  // Der Abstand zwischen CUT und SEAM IST die Nahtzugabe –
  // Gerber/Lectra erkennen das automatisch.
  if (piece.seamLine.length > 0) {
    const seamPts = curveToPolylinePoints(piece.seamLine)
    const scaledSeamPts = seamPts.map((p) => ({ x: p.x * scale, y: p.y * scale }))
    out.push(dxfPolyline(AAMA_LAYERS.SEAM, scaledSeamPts, true))
  }

  // NOTCH layer: Kerben als echte Geometrie (LINE fuer Slit, 2x LINE fuer V, POLYLINE fuer Castle)
  for (const notch of piece.notches) {
    out.push(dxfNotchGeometry(AAMA_LAYERS.NOTCH, notch, scale))
  }

  // DRILL layer: Bohrloecher als CIRCLE
  for (const drill of piece.drills) {
    out.push(dxfCircle(AAMA_LAYERS.DRILL, drill.center.x * scale, drill.center.y * scale, drill.radius * scale))
  }

  // GRAIN layer: Fadenlauf als LINE
  if (piece.grainLine) {
    out.push(dxfLine(
      AAMA_LAYERS.GRAIN,
      piece.grainLine.start.x * scale, piece.grainLine.start.y * scale,
      piece.grainLine.end.x * scale, piece.grainLine.end.y * scale,
    ))
  }

  // INTERNAL layer: Interne Linien (Abnaeher, Markierungen)
  if (piece.internalLines.length > 0) {
    const intPts = curveToPolylinePoints(piece.internalLines)
    const scaledIntPts = intPts.map((p) => ({ x: p.x * scale, y: p.y * scale }))
    out.push(dxfPolyline(AAMA_LAYERS.INTERNAL, scaledIntPts, false))
  }

  // TEXT layer: Teilename/Nummer
  const label = piece.name || piece.number || ''
  if (label) {
    const firstCut = scaledCutPts[0]
    if (firstCut) {
      out.push(dxfText(AAMA_LAYERS.TEXT, firstCut.x, firstCut.y + 10, label))
    }
  }

  return out.join('')
}

export function exportWorkspaceToAamaDxf(workspace: Workspace, scale = 1): string {
  const out: string[] = []
  const ext = workspaceExtents(workspace, scale)

  // HEADER
  out.push('0' + EOL + 'SECTION' + EOL + '2' + EOL + 'HEADER' + EOL)
  out.push('9' + EOL + '$ACADVER' + EOL + '1' + EOL + 'AC1009' + EOL)
  out.push('9' + EOL + '$INSUNITS' + EOL + '70' + EOL + '5' + EOL)
  if (ext) {
    out.push('9' + EOL + '$EXTMIN' + EOL + '10' + EOL + fmt(ext.minX) + EOL + '20' + EOL + fmt(ext.minY) + EOL + '30' + EOL + '0' + EOL)
    out.push('9' + EOL + '$EXTMAX' + EOL + '10' + EOL + fmt(ext.maxX) + EOL + '20' + EOL + fmt(ext.maxY) + EOL + '30' + EOL + '0' + EOL)
  }
  out.push('0' + EOL + 'ENDSEC' + EOL)

  // BLOCKS – ein Block pro Schnittteil (Geometrie in lokalen Koordinaten)
  out.push('0' + EOL + 'SECTION' + EOL + '2' + EOL + 'BLOCKS' + EOL)
  const blockNames: string[] = []

  for (let i = 0; i < workspace.pieces.length; i++) {
    const piece = workspace.pieces[i]
    const bName = pieceBlockName(piece, i)
    blockNames.push(bName)

    out.push('0' + EOL + 'BLOCK' + EOL + '8' + EOL + '0' + EOL + '2' + EOL + bName + EOL
      + '70' + EOL + '0' + EOL + '10' + EOL + '0' + EOL + '20' + EOL + '0' + EOL)

    out.push(buildBlockContent(piece, scale))

    out.push('0' + EOL + 'ENDBLK' + EOL)
  }

  out.push('0' + EOL + 'ENDSEC' + EOL)

  // ENTITIES – INSERT pro Block mit Piece-Transform
  out.push('0' + EOL + 'SECTION' + EOL + '2' + EOL + 'ENTITIES' + EOL)

  for (let i = 0; i < workspace.pieces.length; i++) {
    const piece = workspace.pieces[i]
    const t = piece.transform
    out.push('0' + EOL + 'INSERT' + EOL + '8' + EOL + '0' + EOL + '2' + EOL + blockNames[i] + EOL
      + '10' + EOL + fmt(t.x * scale) + EOL + '20' + EOL + fmt(t.y * scale) + EOL
      + '41' + EOL + (t.mirrored ? '-1' : '1') + EOL
      + '42' + EOL + '1' + EOL
      + '50' + EOL + fmt(t.rotation) + EOL)
  }

  out.push('0' + EOL + 'ENDSEC' + EOL + '0' + EOL + 'EOF' + EOL)
  return out.join('')
}

export function downloadAamaDxf(workspace: Workspace, scale = 1, filename?: string): void {
  if (!filename) filename = makeExportFilename('aam')
  const content = exportWorkspaceToAamaDxf(workspace, scale)
  downloadBlob(content, filename)
}

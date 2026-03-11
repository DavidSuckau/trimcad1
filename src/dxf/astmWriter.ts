import type { Workspace, PatternPiece, NotchType } from '../types/model'
import {
  EOL, fmt,
  curveToPolylinePoints,
  getExportContour, workspaceExtents,
  dxfPolyline, dxfPoint, dxfCircle, dxfLine, dxfText,
  sanitizeBlockName, makeExportFilename, downloadBlob,
} from './dxfShared'

/**
 * ASTM D6673-10 DXF Writer – Gerber-kompatibel.
 *
 * Format:    DXF R12 (AC1009), 7-bit ASCII
 * Struktur:  Minimaler HEADER -> BLOCKS (1 Block pro Piece) -> ENTITIES (INSERT pro Block) -> EOF
 *            Kein TABLES-Abschnitt, keine $MODEL_SPACE/$PAPER_SPACE Bloecke (Gerber-Parser).
 *
 * Layer (nummeriert nach ASTM D6673-10):
 *   1  = Piece Boundary (Aussenkontour)
 *   4  = Notches (V-Notch, Slit-Notch)
 *   7  = Grain Line
 *   8  = Internal Lines
 *  13  = Drill Holes
 *  14  = Sew Lines (Nahtlinie)
 *  15  = Annotation Text
 *  80  = T-Notch
 *  81  = Castle-Notch
 *  82  = Check-Notch (V-foermig)
 *  83  = U-Notch
 */

const ASTM_LAYER = {
  BOUNDARY: '1',
  TURN_POINTS: '2',
  CURVE_POINTS: '3',
  NOTCH: '4',
  GRADE_REF: '5',
  MIRROR: '6',
  GRAIN: '7',
  INTERNAL: '8',
  STRIPE_REF: '9',
  PLAID_REF: '10',
  INTERNAL_CUTOUT: '11',
  DRILL: '13',
  SEW: '14',
  TEXT: '15',
  T_NOTCH: '80',
  CASTLE_NOTCH: '81',
  CHECK_NOTCH: '82',
  U_NOTCH: '83',
} as const

function notchLayer(type: NotchType): string {
  switch (type) {
    case 'v': return ASTM_LAYER.CHECK_NOTCH
    case 'double': return ASTM_LAYER.CASTLE_NOTCH
    case 'single':
    default: return ASTM_LAYER.NOTCH
  }
}

function pieceBlockName(piece: PatternPiece, index: number): string {
  const raw = piece.name || piece.number || `Piece_${index}`
  return sanitizeBlockName(raw)
}

/**
 * Strip non-7-bit-ASCII characters (Gerber requirement).
 */
function toAscii(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, '_')
}

function buildBlockContent(piece: PatternPiece, scale: number): string {
  const out: string[] = []

  // Layer 1: Piece boundary (cut line with notch cutouts)
  const cutContour = getExportContour(piece)
  const cutPts = curveToPolylinePoints(cutContour)
  const scaledCutPts = cutPts.map((p) => ({ x: p.x * scale, y: p.y * scale }))
  out.push(dxfPolyline(ASTM_LAYER.BOUNDARY, scaledCutPts, true))

  // Layer 14: Sew line (seam line)
  if (piece.seamLine.length > 0) {
    const seamPts = curveToPolylinePoints(piece.seamLine)
    const scaledSeamPts = seamPts.map((p) => ({ x: p.x * scale, y: p.y * scale }))
    out.push(dxfPolyline(ASTM_LAYER.SEW, scaledSeamPts, true))
  }

  // Layer 4/80-83: Notches (layer depends on notch type)
  for (const notch of piece.notches) {
    const layer = notchLayer(notch.type)
    out.push(dxfPoint(layer, notch.position.x * scale, notch.position.y * scale))
  }

  // Layer 13: Drill holes
  for (const drill of piece.drills) {
    out.push(dxfCircle(ASTM_LAYER.DRILL, drill.center.x * scale, drill.center.y * scale, drill.radius * scale))
  }

  // Layer 7: Grain line
  if (piece.grainLine) {
    out.push(dxfLine(
      ASTM_LAYER.GRAIN,
      piece.grainLine.start.x * scale, piece.grainLine.start.y * scale,
      piece.grainLine.end.x * scale, piece.grainLine.end.y * scale,
    ))
  }

  // Layer 8: Internal lines
  if (piece.internalLines.length > 0) {
    const intPts = curveToPolylinePoints(piece.internalLines)
    const scaledIntPts = intPts.map((p) => ({ x: p.x * scale, y: p.y * scale }))
    out.push(dxfPolyline(ASTM_LAYER.INTERNAL, scaledIntPts, false))
  }

  // Layer 15: Annotation text (piece name/number)
  const label = toAscii(piece.name || piece.number || '')
  if (label) {
    const firstCut = scaledCutPts[0]
    if (firstCut) {
      out.push(dxfText(ASTM_LAYER.TEXT, firstCut.x, firstCut.y + 10, label))
    }
  }

  return out.join('')
}

export function exportWorkspaceToAstmDxf(workspace: Workspace, scale = 1): string {
  const out: string[] = []
  const ext = workspaceExtents(workspace, scale)

  // Minimal HEADER – Gerber-kompatibel (kein TABLES, kein $MODEL_SPACE/$PAPER_SPACE)
  out.push('0' + EOL + 'SECTION' + EOL + '2' + EOL + 'HEADER' + EOL)
  out.push('9' + EOL + '$ACADVER' + EOL + '1' + EOL + 'AC1009' + EOL)
  out.push('9' + EOL + '$INSUNITS' + EOL + '70' + EOL + '5' + EOL)
  if (ext) {
    out.push('9' + EOL + '$EXTMIN' + EOL + '10' + EOL + fmt(ext.minX) + EOL + '20' + EOL + fmt(ext.minY) + EOL + '30' + EOL + '0' + EOL)
    out.push('9' + EOL + '$EXTMAX' + EOL + '10' + EOL + fmt(ext.maxX) + EOL + '20' + EOL + fmt(ext.maxY) + EOL + '30' + EOL + '0' + EOL)
  }
  out.push('0' + EOL + 'ENDSEC' + EOL)

  // BLOCKS – one block per pattern piece, no $MODEL_SPACE/$PAPER_SPACE
  out.push('0' + EOL + 'SECTION' + EOL + '2' + EOL + 'BLOCKS' + EOL)
  const blockNames: string[] = []

  for (let i = 0; i < workspace.pieces.length; i++) {
    const piece = workspace.pieces[i]
    const bName = pieceBlockName(piece, i)
    blockNames.push(bName)

    out.push('0' + EOL + 'BLOCK' + EOL + '8' + EOL + '0' + EOL + '2' + EOL + toAscii(bName) + EOL
      + '70' + EOL + '0' + EOL + '10' + EOL + '0' + EOL + '20' + EOL + '0' + EOL)

    out.push(buildBlockContent(piece, scale))

    out.push('0' + EOL + 'ENDBLK' + EOL)
  }

  out.push('0' + EOL + 'ENDSEC' + EOL)

  // ENTITIES – INSERT per block
  out.push('0' + EOL + 'SECTION' + EOL + '2' + EOL + 'ENTITIES' + EOL)

  for (let i = 0; i < workspace.pieces.length; i++) {
    const piece = workspace.pieces[i]
    const t = piece.transform
    out.push('0' + EOL + 'INSERT' + EOL + '8' + EOL + '0' + EOL + '2' + EOL + toAscii(blockNames[i]) + EOL
      + '10' + EOL + fmt(t.x * scale) + EOL + '20' + EOL + fmt(t.y * scale) + EOL
      + '41' + EOL + (t.mirrored ? '-1' : '1') + EOL
      + '42' + EOL + '1' + EOL
      + '50' + EOL + fmt(t.rotation) + EOL)
  }

  out.push('0' + EOL + 'ENDSEC' + EOL + '0' + EOL + 'EOF' + EOL)
  return out.join('')
}

export function downloadAstmDxf(workspace: Workspace, scale = 1, filename?: string): void {
  if (!filename) filename = makeExportFilename('dxf')
  const content = exportWorkspaceToAstmDxf(workspace, scale)
  downloadBlob(content, filename)
}

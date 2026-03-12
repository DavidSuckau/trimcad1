import type { Workspace, PatternPiece, NotchType } from '../types/model'
import { getNotchPositionAndAngleOnCutLine } from '../geometry/notchOnCurve'
import { offsetCurvesInwardForSeam } from '../geometry/offset'
import {
  EOL, fmt,
  curveToPolylinePoints, workspaceExtents,
  dxfPolyline, dxfCircle, dxfLine, dxfText,
  dxfNotchSlit, dxfNotchV, dxfNotchCastle,
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
 *   1  = Piece Boundary (Aussenkontour / Schnittlinie mit Nahtzugabe)
 *   4  = Notches – Slit-Notch (I-foermig, senkrecht zur Kante)
 *   7  = Grain Line (Fadenlauf)
 *   8  = Internal Lines (Abnaeher, Markierungen)
 *  13  = Drill Holes (Bohrloecher)
 *  14  = Sew Lines (Nahtlinie – wo genaehrt wird)
 *        -> Gerber erkennt den Abstand Layer 1 ↔ Layer 14 als Nahtzugabe
 *  15  = Annotation Text (Teilename/Nummer)
 *  80  = T-Notch (T-foermig)
 *  81  = Castle-Notch (rechteckig, U-foermig)
 *  82  = Check-Notch (V-foermig)
 *  83  = U-Notch (U-foermig, halbrund)
 *
 * Wichtig:
 *   - Boundary (Layer 1) ist die SAUBERE cutLine OHNE eingebettete Notch-Cutouts.
 *   - Notches werden als eigene Geometrie (LINE/POLYLINE) auf Layer 4/80-83 exportiert.
 *   - Gerber erkennt die Nahtzugabe an Layer 1 (cut) + Layer 14 (sew).
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

/**
 * ASTM weist verschiedenen Notch-Typen eigene Layer zu.
 * Die Geometrie ist ebenfalls typ-spezifisch (Slit, V, Castle).
 * Position und Winkel kommen von getNotchPositionAndAngleOnCutLine (projiziert auf die Kontur).
 */
function emitNotch(
  notch: PatternPiece['notches'][number],
  piece: PatternPiece,
  scale: number,
): string {
  const { position, angle } = getNotchPositionAndAngleOnCutLine(notch, piece.cutLine, piece.seamLine)
  const resolvedNotch = { ...notch, position, angle }
  const type: NotchType = notch.type
  switch (type) {
    case 'v':
      return dxfNotchV(ASTM_LAYER.CHECK_NOTCH, resolvedNotch, scale)
    case 'double':
      return dxfNotchCastle(ASTM_LAYER.CASTLE_NOTCH, resolvedNotch, scale)
    case 'single':
    default:
      return dxfNotchSlit(ASTM_LAYER.NOTCH, resolvedNotch, scale)
  }
}

function pieceBlockName(piece: PatternPiece, index: number): string {
  const raw = piece.name || piece.number || `Piece_${index}`
  return sanitizeBlockName(raw)
}

function toAscii(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, '_')
}

function buildBlockContent(piece: PatternPiece, scale: number): string {
  const out: string[] = []

  // Layer 1: Piece boundary – saubere cutLine OHNE Notch-Cutouts
  const cutPts = curveToPolylinePoints(piece.cutLine)
  const scaledCutPts = cutPts.map((p) => ({ x: p.x * scale, y: p.y * scale }))
  out.push(dxfPolyline(ASTM_LAYER.BOUNDARY, scaledCutPts, true))

  // Layer 14: Sew line (Nahtlinie).
  // Der Abstand zwischen Layer 1 und Layer 14 IST die Nahtzugabe.
  // Fallback: wenn seamAllowanceMm gesetzt aber seamLine leer, hier berechnen.
  const seamCurves =
    piece.seamLine.length > 0
      ? piece.seamLine
      : piece.seamAllowanceMm != null && piece.cutLine.length >= 3
        ? offsetCurvesInwardForSeam(piece.cutLine, piece.seamAllowanceMm)
        : []
  if (seamCurves.length > 0) {
    const seamPts = curveToPolylinePoints(seamCurves)
    const scaledSeamPts = seamPts.map((p) => ({ x: p.x * scale, y: p.y * scale }))
    out.push(dxfPolyline(ASTM_LAYER.SEW, scaledSeamPts, true))
  }

  // Layer 4/80-83: Notches mit korrekter Position/Winkel (projiziert auf cutLine)
  for (const notch of piece.notches) {
    out.push(emitNotch(notch, piece, scale))
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

  // Layer 15: Annotation text
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

  // Minimaler HEADER – Gerber-kompatibel (kein TABLES, kein $MODEL_SPACE/$PAPER_SPACE)
  out.push('0' + EOL + 'SECTION' + EOL + '2' + EOL + 'HEADER' + EOL)
  out.push('9' + EOL + '$ACADVER' + EOL + '1' + EOL + 'AC1009' + EOL)
  out.push('9' + EOL + '$INSUNITS' + EOL + '70' + EOL + '5' + EOL)
  if (ext) {
    out.push('9' + EOL + '$EXTMIN' + EOL + '10' + EOL + fmt(ext.minX) + EOL + '20' + EOL + fmt(ext.minY) + EOL + '30' + EOL + '0' + EOL)
    out.push('9' + EOL + '$EXTMAX' + EOL + '10' + EOL + fmt(ext.maxX) + EOL + '20' + EOL + fmt(ext.maxY) + EOL + '30' + EOL + '0' + EOL)
  }
  out.push('0' + EOL + 'ENDSEC' + EOL)

  // BLOCKS – ein Block pro Schnittteil, keine $MODEL_SPACE/$PAPER_SPACE
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

  // ENTITIES – INSERT pro Block
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

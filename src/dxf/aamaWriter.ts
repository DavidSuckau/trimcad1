import type { Workspace, PatternPiece } from '../types/model'
import {
  EOL, fmt,
  curveToPolylinePoints, transformPoints,
  getExportContour, workspaceExtents,
  dxfPolyline, dxfPoint, dxfCircle, dxfLine, dxfText,
  sanitizeBlockName, makeExportFilename, downloadBlob,
} from './dxfShared'

/**
 * AAMA-DXF Writer – Apparel-Industriestandard.
 *
 * Format:    DXF R12 (AC1009), Einheiten mm
 * Struktur:  HEADER -> BLOCKS (1 Block pro Piece) -> ENTITIES (INSERT pro Block) -> EOF
 * Layer:     Benannte Layer (CUT, SEAM, NOTCH, DRILL, GRAIN, TEXT, INTERNAL)
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

  const cutContour = getExportContour(piece)
  const cutPts = curveToPolylinePoints(cutContour)
  const scaledCutPts = cutPts.map((p) => ({ x: p.x * scale, y: p.y * scale }))
  out.push(dxfPolyline(AAMA_LAYERS.CUT, scaledCutPts, true))

  if (piece.seamLine.length > 0) {
    const seamPts = curveToPolylinePoints(piece.seamLine)
    const scaledSeamPts = seamPts.map((p) => ({ x: p.x * scale, y: p.y * scale }))
    out.push(dxfPolyline(AAMA_LAYERS.SEAM, scaledSeamPts, true))
  }

  for (const notch of piece.notches) {
    out.push(dxfPoint(AAMA_LAYERS.NOTCH, notch.position.x * scale, notch.position.y * scale))
  }

  for (const drill of piece.drills) {
    out.push(dxfCircle(AAMA_LAYERS.DRILL, drill.center.x * scale, drill.center.y * scale, drill.radius * scale))
  }

  if (piece.grainLine) {
    out.push(dxfLine(
      AAMA_LAYERS.GRAIN,
      piece.grainLine.start.x * scale, piece.grainLine.start.y * scale,
      piece.grainLine.end.x * scale, piece.grainLine.end.y * scale,
    ))
  }

  if (piece.internalLines.length > 0) {
    const intPts = curveToPolylinePoints(piece.internalLines)
    const scaledIntPts = intPts.map((p) => ({ x: p.x * scale, y: p.y * scale }))
    out.push(dxfPolyline(AAMA_LAYERS.INTERNAL, scaledIntPts, false))
  }

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

  // BLOCKS – one block per piece (geometry in piece-local coordinates)
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

  // ENTITIES – INSERT per block, applying piece transform
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

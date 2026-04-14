import type { Workspace, PatternPiece, Notch } from '../types/model'
import { getNotchPositionAndAngleOnCutLine } from '../geometry/notchOnCurve'
import { offsetCurvesInwardForSeam } from '../geometry/offset'
import {
  EOL, fmt,
  curveToPolylinePoints, workspaceExtents,
  closeContour, projectPointOntoClosedPolyline,
  dxfPolyline, dxfCircle, dxfLine, dxfText,
  sanitizeBlockName, makeExportFilename, downloadBlob,
  type Pt,
} from './dxfShared'

/** Modellkoordinaten mm → DXF-Zoll: `coord_inch = coord_mm * dxfExportScale / MM_PER_INCH`. */
const MM_PER_INCH = 25.4

/**
 * ASTM-DXF für Gerber AccuMark: DXF R12 (AC1009), Einheiten Inch ($INSUNITS=1).
 *
 * Struktur: HEADER → BLOCKS (1 Block pro Teil) → ENTITIES (INSERT) → EOF
 *
 * Kerben (Gerber-Erkennung):
 *   - genau eine LINE pro Kerbe, identisch auf Layer 5 und 7 (Duplikat)
 *   - Endpunkt auf der exportierten Kontur-POLYLINE (Projektion)
 *   - V- und Castle-Kerben: jeweils eine LINE (keine V-Zwei-Linien, keine POLYLINE)
 *
 * Layer: 1 Kontur, 14 Naht (optional), 5+7 Kerben, 13 Bohrung, 8 intern, 15 Text.
 * Fadenlauf wird in diesem Export nicht ausgegeben (Layer 7 nur Kerb-Duplikat).
 */

const ASTM_LAYER = {
  BOUNDARY: '1',
  INTERNAL: '8',
  DRILL: '13',
  SEW: '14',
  TEXT: '15',
} as const

/** Gerber AccuMark: Notch-Layer (Minimum 5 oder 7; Best Practice: beide). */
const GERBER_NOTCH_PRIMARY = '5'
const GERBER_NOTCH_DUP = '7'

const NOTCH_DEPTH_MIN_IN = 0.1
const NOTCH_DEPTH_MAX_IN = 0.4

function notchDepthInchClamped(depthMm: number, inchScale: number): number {
  const d = depthMm * inchScale
  return Math.min(NOTCH_DEPTH_MAX_IN, Math.max(NOTCH_DEPTH_MIN_IN, d))
}

/**
 * Eine Kerbe als zwei identische LINEs (Layer 5 + 7). Alle Koordinaten in Inch.
 * Alle Kerbtypen: eine kurze Linie vom Konturpunkt nach innen (wie Slit); keine V-Zwei-Linien.
 */
function emitGerberNotchLine(
  notch: Notch,
  piece: PatternPiece,
  inchScale: number,
  boundaryRingInch: Pt[],
): string {
  if (boundaryRingInch.length < 2) return ''

  const { position, angle } = getNotchPositionAndAngleOnCutLine(notch, piece.cutLine, piece.seamLine)
  const pModel = { x: position.x * inchScale, y: position.y * inchScale }
  const snapped = projectPointOntoClosedPolyline(boundaryRingInch, pModel)
  const rad = (angle * Math.PI) / 180
  const depthIn = notchDepthInchClamped(notch.depth, inchScale)
  const x1 = snapped.x
  const y1 = snapped.y
  const x2 = x1 + depthIn * Math.cos(rad)
  const y2 = y1 + depthIn * Math.sin(rad)

  return dxfLine(GERBER_NOTCH_PRIMARY, x1, y1, x2, y2)
    + dxfLine(GERBER_NOTCH_DUP, x1, y1, x2, y2)
}

function pieceBlockName(piece: PatternPiece, index: number): string {
  const raw = piece.name || piece.number || `Piece_${index}`
  return sanitizeBlockName(raw)
}

function toAscii(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, '_')
}

function buildBlockContent(piece: PatternPiece, inchScale: number): string {
  const out: string[] = []

  const cutPts = curveToPolylinePoints(piece.cutLine)
  const scaledCutPts = cutPts.map((p) => ({ x: p.x * inchScale, y: p.y * inchScale }))
  const boundaryRing =
    scaledCutPts.length >= 2 ? closeContour([...scaledCutPts]) : []

  out.push(dxfPolyline(ASTM_LAYER.BOUNDARY, scaledCutPts, true))

  const seamCurves =
    piece.seamLine.length > 0
      ? piece.seamLine
      : piece.seamAllowanceMm != null && piece.cutLine.length >= 3
        ? offsetCurvesInwardForSeam(piece.cutLine, piece.seamAllowanceMm)
        : []
  if (seamCurves.length > 0) {
    const seamPts = curveToPolylinePoints(seamCurves)
    const scaledSeamPts = seamPts.map((p) => ({ x: p.x * inchScale, y: p.y * inchScale }))
    out.push(dxfPolyline(ASTM_LAYER.SEW, scaledSeamPts, true))
  }

  for (const notch of piece.notches) {
    out.push(emitGerberNotchLine(notch, piece, inchScale, boundaryRing))
  }

  for (const drill of piece.drills) {
    out.push(dxfCircle(
      ASTM_LAYER.DRILL,
      drill.center.x * inchScale,
      drill.center.y * inchScale,
      drill.radius * inchScale,
    ))
  }

  if (piece.internalLines.length > 0) {
    const intPts = curveToPolylinePoints(piece.internalLines)
    const scaledIntPts = intPts.map((p) => ({ x: p.x * inchScale, y: p.y * inchScale }))
    out.push(dxfPolyline(ASTM_LAYER.INTERNAL, scaledIntPts, false))
  }

  const label = toAscii(piece.name || piece.number || '')
  if (label) {
    const firstCut = scaledCutPts[0]
    if (firstCut) {
      const textHeightInch = 5 * inchScale
      const labelOffsetInch = 10 * inchScale
      out.push(dxfText(ASTM_LAYER.TEXT, firstCut.x, firstCut.y + labelOffsetInch, label, textHeightInch))
    }
  }

  return out.join('')
}

/**
 * @param dxfExportScale – Multiplikator auf mm-Modellkoordinaten (wie in den Einstellungen); Ausgabe in Inch.
 */
export function exportWorkspaceToAstmDxf(workspace: Workspace, dxfExportScale = 1): string {
  const inchScale = dxfExportScale / MM_PER_INCH
  const out: string[] = []
  const ext = workspaceExtents(workspace, inchScale)

  out.push('0' + EOL + 'SECTION' + EOL + '2' + EOL + 'HEADER' + EOL)
  out.push('9' + EOL + '$ACADVER' + EOL + '1' + EOL + 'AC1009' + EOL)
  out.push('9' + EOL + '$INSUNITS' + EOL + '70' + EOL + '1' + EOL)
  if (ext) {
    out.push('9' + EOL + '$EXTMIN' + EOL + '10' + EOL + fmt(ext.minX) + EOL + '20' + EOL + fmt(ext.minY) + EOL + '30' + EOL + '0' + EOL)
    out.push('9' + EOL + '$EXTMAX' + EOL + '10' + EOL + fmt(ext.maxX) + EOL + '20' + EOL + fmt(ext.maxY) + EOL + '30' + EOL + '0' + EOL)
  }
  out.push('0' + EOL + 'ENDSEC' + EOL)

  out.push('0' + EOL + 'SECTION' + EOL + '2' + EOL + 'BLOCKS' + EOL)
  const blockNames: string[] = []

  for (let i = 0; i < workspace.pieces.length; i++) {
    const piece = workspace.pieces[i]
    const bName = pieceBlockName(piece, i)
    blockNames.push(bName)

    out.push('0' + EOL + 'BLOCK' + EOL + '8' + EOL + '0' + EOL + '2' + EOL + toAscii(bName) + EOL
      + '70' + EOL + '0' + EOL + '10' + EOL + '0' + EOL + '20' + EOL + '0' + EOL)

    out.push(buildBlockContent(piece, inchScale))

    out.push('0' + EOL + 'ENDBLK' + EOL)
  }

  out.push('0' + EOL + 'ENDSEC' + EOL)

  out.push('0' + EOL + 'SECTION' + EOL + '2' + EOL + 'ENTITIES' + EOL)

  for (let i = 0; i < workspace.pieces.length; i++) {
    const piece = workspace.pieces[i]
    const t = piece.transform
    out.push('0' + EOL + 'INSERT' + EOL + '8' + EOL + '0' + EOL + '2' + EOL + toAscii(blockNames[i]) + EOL
      + '10' + EOL + fmt(t.x * inchScale) + EOL + '20' + EOL + fmt(t.y * inchScale) + EOL
      + '41' + EOL + (t.mirrored ? '-1' : '1') + EOL
      + '42' + EOL + '1' + EOL
      + '50' + EOL + fmt(t.rotation) + EOL)
  }

  out.push('0' + EOL + 'ENDSEC' + EOL + '0' + EOL + 'EOF' + EOL)
  return out.join('')
}

export function downloadAstmDxf(workspace: Workspace, dxfExportScale = 1, filename?: string): void {
  if (!filename) filename = makeExportFilename('dxf')
  const content = exportWorkspaceToAstmDxf(workspace, dxfExportScale)
  downloadBlob(content, filename)
}

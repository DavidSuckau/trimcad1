import type { Notch, PatternPiece, Workspace } from '../types/model'
import { getNotchPositionAndAngle } from '../geometry/notchOnCurve'
import {
  getNotchPositionAndAngleOnInternalLine,
  isNotchOnInternalLine,
} from '../geometry/notchOnInternalLine'
import {
  EOL, fmt,
  curveToPolylinePoints, applyTransform, closeContour,
  getExportContour, workspaceExtents,
  makeExportFilename, downloadBlob,
  type Pt,
} from './dxfShared'

/**
 * DXF R12 ASCII Writer – textilkompatibel (Zuend/Gerber/Lectra/Bullmer).
 * Spezifikation: docs/DXF-MASTER-SPEZIFIKATION.txt
 *
 * Format:    AC1009 (AutoCAD R12 ASCII)
 * Einheiten: $INSUNITS = 5 (Millimeter)
 * Entities:  Nur POLYLINE + VERTEX + SEQEND
 * Layer:     CUT = Schnittkontur, NOTCH = alle Kerben (Schnitt und intern)
 */

const NOTCH_LAYER = 'NOTCH'

function resolvedNotch(piece: PatternPiece, notch: Notch): Notch {
  if (isNotchOnInternalLine(notch)) {
    const onLine = getNotchPositionAndAngleOnInternalLine(notch, piece.internalLines)
    if (!onLine) return notch
    return { ...notch, position: onLine.position, angle: onLine.angle }
  }
  const onCut = getNotchPositionAndAngle(notch, piece.cutLine, piece.seamLine)
  return { ...notch, position: onCut.position, angle: onCut.angle }
}

/** Kerben-Geometrie in Teilkoordinaten, offen, eine Polylinie pro Kerbe. */
function notchLocalPoints(notch: Notch): Pt[] {
  const rad = (notch.angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const w2 = (notch.width ?? 6) / 2
  const d = notch.depth
  const p = notch.position
  if (notch.type === 'v') {
    return [
      { x: p.x - w2 * sin, y: p.y + w2 * cos },
      { x: p.x + d * cos, y: p.y + d * sin },
      { x: p.x + w2 * sin, y: p.y - w2 * cos },
    ]
  }
  if (notch.type === 'double') {
    return [
      { x: p.x - w2 * sin, y: p.y + w2 * cos },
      { x: p.x - w2 * sin + d * cos, y: p.y + w2 * cos + d * sin },
      { x: p.x + w2 * sin + d * cos, y: p.y - w2 * cos + d * sin },
      { x: p.x + w2 * sin, y: p.y - w2 * cos },
    ]
  }
  return [
    { x: p.x, y: p.y },
    { x: p.x + d * cos, y: p.y + d * sin },
  ]
}

function dxfPolyline(layer: string, points: Pt[], t: { x: number; y: number; rotation: number; mirrored: boolean }, closed: boolean, scale: number): string {
  if (points.length < 2) return ''
  let pts = points.map((p) => {
    const tp = applyTransform(p.x, p.y, t)
    return { x: tp.x * scale, y: tp.y * scale }
  })
  if (closed) pts = closeContour(pts)

  const lines: string[] = []
  lines.push('0' + EOL + 'POLYLINE' + EOL + '8' + EOL + layer + EOL + '66' + EOL + '1' + EOL + '70' + EOL + '0' + EOL)
  for (const p of pts) {
    lines.push('0' + EOL + 'VERTEX' + EOL + '8' + EOL + layer + EOL + '10' + EOL + fmt(p.x) + EOL + '20' + EOL + fmt(p.y) + EOL)
  }
  lines.push('0' + EOL + 'SEQEND' + EOL)
  return lines.join('')
}

export function exportWorkspaceToDxfR12(workspace: Workspace, scale = 1): string {
  const out: string[] = []
  const ext = workspaceExtents(workspace, scale)

  out.push('0' + EOL + 'SECTION' + EOL + '2' + EOL + 'HEADER' + EOL)
  out.push('9' + EOL + '$ACADVER' + EOL + '1' + EOL + 'AC1009' + EOL)
  out.push('9' + EOL + '$INSUNITS' + EOL + '70' + EOL + '5' + EOL)
  if (ext) {
    out.push('9' + EOL + '$EXTMIN' + EOL + '10' + EOL + fmt(ext.minX) + EOL + '20' + EOL + fmt(ext.minY) + EOL + '30' + EOL + '0' + EOL)
    out.push('9' + EOL + '$EXTMAX' + EOL + '10' + EOL + fmt(ext.maxX) + EOL + '20' + EOL + fmt(ext.maxY) + EOL + '30' + EOL + '0' + EOL)
  }
  out.push('0' + EOL + 'ENDSEC' + EOL)

  out.push('0' + EOL + 'SECTION' + EOL + '2' + EOL + 'ENTITIES' + EOL)

  for (const piece of workspace.pieces) {
    const contour = getExportContour(piece)
    const pts = curveToPolylinePoints(contour)
    out.push(dxfPolyline('CUT', pts, piece.transform, true, scale))
    for (const notch of piece.notches) {
      const local = notchLocalPoints(resolvedNotch(piece, notch))
      out.push(dxfPolyline(NOTCH_LAYER, local, piece.transform, false, scale))
    }
  }

  out.push('0' + EOL + 'ENDSEC' + EOL + '0' + EOL + 'EOF' + EOL)
  return out.join('')
}

export function downloadDxf(workspace: Workspace, scale = 1, filename?: string): void {
  if (!filename) filename = makeExportFilename('dxf')
  const content = exportWorkspaceToDxfR12(workspace, scale)
  downloadBlob(content, filename)
}

import type { Workspace } from '../types/model'
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
 */

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
  }

  out.push('0' + EOL + 'ENDSEC' + EOL + '0' + EOL + 'EOF' + EOL)
  return out.join('')
}

export function downloadDxf(workspace: Workspace, scale = 1, filename?: string): void {
  if (!filename) filename = makeExportFilename('dxf')
  const content = exportWorkspaceToDxfR12(workspace, scale)
  downloadBlob(content, filename)
}

import type { Workspace, PatternPiece, Curve, BezierCurve } from '../types/model'
import { cutLineWithNotchCutouts } from '../geometry/notchOnCurve'
import { bezierAt, curveSegmentArcLength } from '../geometry/curveToPath'

/**
 * DXF R12 ASCII Writer – textilkompatibel (Zuend/Gerber/Lectra/Bullmer).
 * Spezifikation: docs/DXF-MASTER-SPEZIFIKATION.txt
 *
 * Format:    AC1009 (AutoCAD R12 ASCII)
 * Einheiten: $INSUNITS = 5 (Millimeter)
 * Entities:  Nur POLYLINE + VERTEX + SEQEND
 */

const EOL = '\r\n'
const BEZIER_SEGMENT_MM = 6
const DUPLICATE_THRESHOLD_MM = 0.01

type Pt = { x: number; y: number }

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(6)
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function isDuplicate(a: Pt, b: Pt): boolean {
  return dist(a, b) < DUPLICATE_THRESHOLD_MM
}

function tessellateBezier(b: BezierCurve): Pt[] {
  const arcLen = curveSegmentArcLength(b, 0, 1)
  const n = Math.max(2, Math.ceil(arcLen / BEZIER_SEGMENT_MM))
  const pts: Pt[] = []
  for (let i = 0; i <= n; i++) {
    pts.push(bezierAt(b, i / n))
  }
  return pts
}

function curveToPolylinePoints(curves: Curve[]): Pt[] {
  const raw: Pt[] = []
  for (const c of curves) {
    if (c.type === 'line') {
      if (raw.length === 0 || !isDuplicate(raw[raw.length - 1], c.start)) {
        raw.push({ x: c.start.x, y: c.start.y })
      }
      raw.push({ x: c.end.x, y: c.end.y })
    } else {
      const pts = tessellateBezier(c)
      for (const p of pts) {
        if (raw.length === 0 || !isDuplicate(raw[raw.length - 1], p)) {
          raw.push(p)
        }
      }
    }
  }
  return removeDuplicates(raw)
}

function removeDuplicates(pts: Pt[]): Pt[] {
  if (pts.length <= 1) return pts
  const result = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    if (!isDuplicate(result[result.length - 1], pts[i])) {
      result.push(pts[i])
    }
  }
  return result
}

function closeContour(pts: Pt[]): Pt[] {
  if (pts.length < 2) return pts
  const first = pts[0]
  const last = pts[pts.length - 1]
  if (isDuplicate(first, last)) {
    pts[pts.length - 1] = { x: first.x, y: first.y }
  } else {
    pts.push({ x: first.x, y: first.y })
  }
  return pts
}

function applyTransform(x: number, y: number, t: PatternPiece['transform']): Pt {
  let xx = x
  let yy = y
  if (t.mirrored) xx = -xx
  const rad = (t.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return {
    x: xx * cos - yy * sin + t.x,
    y: xx * sin + yy * cos + t.y,
  }
}

function getExportContour(piece: PatternPiece): Curve[] {
  return cutLineWithNotchCutouts(piece.cutLine, piece.notches, piece.seamLine)
}

function workspaceExtents(workspace: Workspace, scale: number): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let hasAny = false

  for (const piece of workspace.pieces) {
    const pt = (x: number, y: number) => {
      const tp = applyTransform(x, y, piece.transform)
      return { x: tp.x * scale, y: tp.y * scale }
    }
    for (const p of curveToPolylinePoints(getExportContour(piece))) {
      const { x, y } = pt(p.x, p.y)
      minX = Math.min(minX, x); minY = Math.min(minY, y)
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
      hasAny = true
    }
  }

  if (!hasAny) return null
  return { minX, minY, maxX, maxY }
}

/* ------------------------------------------------------------------ */
/*  DXF-Bausteine                                                      */
/* ------------------------------------------------------------------ */

function dxfPolyline(layer: string, points: Pt[], t: PatternPiece['transform'], closed: boolean, scale: number): string {
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

/* ------------------------------------------------------------------ */
/*  Haupt-Export                                                       */
/* ------------------------------------------------------------------ */

export function exportWorkspaceToDxfR12(workspace: Workspace, scale = 1): string {
  const out: string[] = []
  const ext = workspaceExtents(workspace, scale)

  // HEADER – AC1009, $INSUNITS = 5 (mm)
  out.push('0' + EOL + 'SECTION' + EOL + '2' + EOL + 'HEADER' + EOL)
  out.push('9' + EOL + '$ACADVER' + EOL + '1' + EOL + 'AC1009' + EOL)
  out.push('9' + EOL + '$INSUNITS' + EOL + '70' + EOL + '5' + EOL)
  if (ext) {
    out.push('9' + EOL + '$EXTMIN' + EOL + '10' + EOL + fmt(ext.minX) + EOL + '20' + EOL + fmt(ext.minY) + EOL + '30' + EOL + '0' + EOL)
    out.push('9' + EOL + '$EXTMAX' + EOL + '10' + EOL + fmt(ext.maxX) + EOL + '20' + EOL + fmt(ext.maxY) + EOL + '30' + EOL + '0' + EOL)
  }
  out.push('0' + EOL + 'ENDSEC' + EOL)

  // ENTITIES – pro Piece: EINE geschlossene POLYLINE (Nahtlinie mit Notch-Kerben)
  out.push('0' + EOL + 'SECTION' + EOL + '2' + EOL + 'ENTITIES' + EOL)

  for (const piece of workspace.pieces) {
    const contour = getExportContour(piece)
    const pts = curveToPolylinePoints(contour)
    out.push(dxfPolyline('CUT', pts, piece.transform, true, scale))
  }

  out.push('0' + EOL + 'ENDSEC' + EOL + '0' + EOL + 'EOF' + EOL)
  return out.join('')
}

let _dxfExportCounter = 0

export function downloadDxf(workspace: Workspace, scale = 1, filename?: string): void {
  if (!filename) {
    _dxfExportCounter++
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    filename = `${y}_${m}_${d}_${_dxfExportCounter}.dxf`
  }
  const content = exportWorkspaceToDxfR12(workspace, scale)
  const blob = new Blob([content], { type: 'application/dxf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

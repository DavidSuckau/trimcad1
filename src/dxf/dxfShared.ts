import type { Workspace, PatternPiece, Curve, BezierCurve, Notch } from '../types/model'
import { cutLineWithNotchCutouts } from '../geometry/notchOnCurve'
import { bezierAt, curveSegmentArcLength } from '../geometry/curveToPath'

export const EOL = '\r\n'
export const BEZIER_SEGMENT_MM = 6
export const DUPLICATE_THRESHOLD_MM = 0.01

export type Pt = { x: number; y: number }

export function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(6)
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function isDuplicate(a: Pt, b: Pt): boolean {
  return dist(a, b) < DUPLICATE_THRESHOLD_MM
}

export function tessellateBezier(b: BezierCurve): Pt[] {
  const arcLen = curveSegmentArcLength(b, 0, 1)
  const n = Math.max(2, Math.ceil(arcLen / BEZIER_SEGMENT_MM))
  const pts: Pt[] = []
  for (let i = 0; i <= n; i++) {
    pts.push(bezierAt(b, i / n))
  }
  return pts
}

export function removeDuplicates(pts: Pt[]): Pt[] {
  if (pts.length <= 1) return pts
  const result = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    if (!isDuplicate(result[result.length - 1], pts[i])) {
      result.push(pts[i])
    }
  }
  return result
}

export function curveToPolylinePoints(curves: Curve[]): Pt[] {
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

export function closeContour(pts: Pt[]): Pt[] {
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

/** Nächstliegender Punkt auf dem Segment a–b zu p (alle Koordinaten in derselben Einheit). */
export function closestPointOnSegment(a: Pt, b: Pt, p: Pt): Pt {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const apx = p.x - a.x
  const apy = p.y - a.y
  const ab2 = abx * abx + aby * aby
  if (ab2 < 1e-18) return { x: a.x, y: a.y }
  let t = (apx * abx + apy * aby) / ab2
  t = Math.max(0, Math.min(1, t))
  return { x: a.x + t * abx, y: a.y + t * aby }
}

/**
 * Projektion auf geschlossene Polylinie (wie nach closeContour: erster Vertex == letzter).
 * Segmente: (0,1) … (n-2, n-1).
 */
export function projectPointOntoClosedPolyline(ptsClosed: Pt[], p: Pt): Pt {
  if (ptsClosed.length < 2) return p
  let best = ptsClosed[0]
  let bestD = Infinity
  for (let i = 0; i < ptsClosed.length - 1; i++) {
    const q = closestPointOnSegment(ptsClosed[i], ptsClosed[i + 1], p)
    const d = dist(p, q)
    if (d < bestD) {
      bestD = d
      best = q
    }
  }
  return best
}

/** Wie `projectPointOntoClosedPolyline`, liefert zusätzlich Segmentindex und Parameter t ∈ [0,1] auf dem Segment. */
export function projectPointOntoClosedPolylineWithSegment(
  ptsClosed: Pt[],
  p: Pt,
): { closest: Pt; segIndex: number; t: number } {
  if (ptsClosed.length < 2) return { closest: p, segIndex: 0, t: 0 }
  let best = ptsClosed[0]
  let bestD = Infinity
  let bestI = 0
  let bestT = 0
  for (let i = 0; i < ptsClosed.length - 1; i++) {
    const a = ptsClosed[i]
    const b = ptsClosed[i + 1]
    const q = closestPointOnSegment(a, b, p)
    const d = dist(p, q)
    if (d < bestD) {
      bestD = d
      best = q
      bestI = i
      const abx = b.x - a.x
      const aby = b.y - a.y
      const ab2 = abx * abx + aby * aby
      bestT = ab2 < 1e-18 ? 0 : ((q.x - a.x) * abx + (q.y - a.y) * aby) / ab2
    }
  }
  return { closest: best, segIndex: bestI, t: bestT }
}

export function applyTransform(x: number, y: number, t: PatternPiece['transform']): Pt {
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

export function getExportContour(piece: PatternPiece): Curve[] {
  return cutLineWithNotchCutouts(piece.cutLine, piece.notches, piece.seamLine)
}

export function workspaceExtents(workspace: Workspace, scale: number): { minX: number; minY: number; maxX: number; maxY: number } | null {
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

/** DXF POLYLINE entity with VERTEX list and SEQEND. */
export function dxfPolyline(layer: string, points: Pt[], closed: boolean): string {
  if (points.length < 2) return ''
  let pts = [...points]
  if (closed) pts = closeContour(pts)

  const lines: string[] = []
  lines.push('0' + EOL + 'POLYLINE' + EOL + '8' + EOL + layer + EOL + '66' + EOL + '1' + EOL + '70' + EOL + '0' + EOL)
  for (const p of pts) {
    lines.push('0' + EOL + 'VERTEX' + EOL + '8' + EOL + layer + EOL + '10' + EOL + fmt(p.x) + EOL + '20' + EOL + fmt(p.y) + EOL)
  }
  lines.push('0' + EOL + 'SEQEND' + EOL)
  return lines.join('')
}

/** DXF POINT entity. */
export function dxfPoint(layer: string, x: number, y: number): string {
  return '0' + EOL + 'POINT' + EOL + '8' + EOL + layer + EOL + '10' + EOL + fmt(x) + EOL + '20' + EOL + fmt(y) + EOL
}

/**
 * ASTM D6673 / ePattern: Kerbe als POINT auf Layer 4 — Gruppe 30 Tiefe, 39 Breite an der Kante, 50 Winkel (Grad, CCW von +X).
 */
export function dxfAstmNotchPoint(
  x: number,
  y: number,
  depthFileUnits: number,
  widthFileUnits: number,
  angleDegFromPositiveX: number,
): string {
  return '0' + EOL + 'POINT' + EOL + '8' + EOL + '4' + EOL
    + '10' + EOL + fmt(x) + EOL + '20' + EOL + fmt(y) + EOL
    + '30' + EOL + fmt(depthFileUnits) + EOL
    + '39' + EOL + fmt(widthFileUnits) + EOL
    + '50' + EOL + fmt(angleDegFromPositiveX) + EOL
}

/** DXF CIRCLE entity. */
export function dxfCircle(layer: string, cx: number, cy: number, r: number): string {
  return '0' + EOL + 'CIRCLE' + EOL + '8' + EOL + layer + EOL + '10' + EOL + fmt(cx) + EOL + '20' + EOL + fmt(cy) + EOL + '40' + EOL + fmt(r) + EOL
}

/** DXF LINE entity. */
export function dxfLine(layer: string, x1: number, y1: number, x2: number, y2: number): string {
  return '0' + EOL + 'LINE' + EOL + '8' + EOL + layer + EOL
    + '10' + EOL + fmt(x1) + EOL + '20' + EOL + fmt(y1) + EOL
    + '11' + EOL + fmt(x2) + EOL + '21' + EOL + fmt(y2) + EOL
}

/** DXF TEXT entity (single-line, height 5mm default). */
export function dxfText(layer: string, x: number, y: number, text: string, height = 5): string {
  return '0' + EOL + 'TEXT' + EOL + '8' + EOL + layer + EOL
    + '10' + EOL + fmt(x) + EOL + '20' + EOL + fmt(y) + EOL
    + '40' + EOL + fmt(height) + EOL + '1' + EOL + text + EOL
}

/** Transform + scale a list of points for a given piece. */
export function transformPoints(pts: Pt[], t: PatternPiece['transform'], scale: number): Pt[] {
  return pts.map((p) => {
    const tp = applyTransform(p.x, p.y, t)
    return { x: tp.x * scale, y: tp.y * scale }
  })
}

/** Generate a timestamped filename. */
let _exportCounter = 0
export function makeExportFilename(ext: string): string {
  _exportCounter++
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}_${m}_${d}_${_exportCounter}.${ext}`
}

/** Trigger browser download of a string as file. */
export function downloadBlob(content: string, filename: string, mimeType = 'application/dxf'): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Sanitize a string for 7-bit ASCII DXF block names.
 * Replaces non-ASCII and whitespace with underscores.
 */
export function sanitizeBlockName(name: string): string {
  return name.replace(/[^A-Za-z0-9_\-]/g, '_').replace(/^(\d)/, '_$1')
}

/* ------------------------------------------------------------------ */
/*  Notch geometry for AAMA/ASTM export                                */
/* ------------------------------------------------------------------ */

/**
 * Slit notch (single): one LINE perpendicular to boundary, inward.
 * Returns a DXF LINE entity from the boundary point to the tip.
 */
export function dxfNotchSlit(layer: string, notch: Notch, scale: number): string {
  const rad = (notch.angle * Math.PI) / 180
  const x1 = notch.position.x * scale
  const y1 = notch.position.y * scale
  const x2 = (notch.position.x + notch.depth * Math.cos(rad)) * scale
  const y2 = (notch.position.y + notch.depth * Math.sin(rad)) * scale
  return dxfLine(layer, x1, y1, x2, y2)
}

/**
 * V-notch: two LINEs from base-left and base-right to a shared tip.
 * Width is measured along the boundary, depth perpendicular inward.
 */
export function dxfNotchV(layer: string, notch: Notch, scale: number): string {
  const rad = (notch.angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const w2 = (notch.width ?? 6) / 2

  const tipX = (notch.position.x + notch.depth * cos) * scale
  const tipY = (notch.position.y + notch.depth * sin) * scale
  const leftX = (notch.position.x - w2 * sin) * scale
  const leftY = (notch.position.y + w2 * cos) * scale
  const rightX = (notch.position.x + w2 * sin) * scale
  const rightY = (notch.position.y - w2 * cos) * scale

  return dxfLine(layer, leftX, leftY, tipX, tipY)
    + dxfLine(layer, rightX, rightY, tipX, tipY)
}

/**
 * Castle/double notch: a rectangular U-shape (open POLYLINE).
 * Opens at the boundary edge, extends inward.
 */
export function dxfNotchCastle(layer: string, notch: Notch, scale: number): string {
  const rad = (notch.angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const w2 = (notch.width ?? 6) / 2
  const d = notch.depth

  const pts: Pt[] = [
    { x: (notch.position.x - w2 * sin) * scale, y: (notch.position.y + w2 * cos) * scale },
    { x: (notch.position.x - w2 * sin + d * cos) * scale, y: (notch.position.y + w2 * cos + d * sin) * scale },
    { x: (notch.position.x + w2 * sin + d * cos) * scale, y: (notch.position.y - w2 * cos + d * sin) * scale },
    { x: (notch.position.x + w2 * sin) * scale, y: (notch.position.y - w2 * cos) * scale },
  ]
  return dxfPolyline(layer, pts, false)
}

/**
 * Export a notch as the correct DXF geometry for its type.
 */
export function dxfNotchGeometry(layer: string, notch: Notch, scale: number): string {
  switch (notch.type) {
    case 'v':
      return dxfNotchV(layer, notch, scale)
    case 'double':
      return dxfNotchCastle(layer, notch, scale)
    case 'single':
    default:
      return dxfNotchSlit(layer, notch, scale)
  }
}

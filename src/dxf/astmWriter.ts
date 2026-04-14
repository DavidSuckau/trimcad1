import type { Workspace, PatternPiece, Notch } from '../types/model'
import { getNotchPositionAndAngleOnCutLine } from '../geometry/notchOnCurve'
import { offsetCurvesInwardForSeam } from '../geometry/offset'
import { isPointInPolygon } from '../geometry/pointInPolygon'
import {
  EOL, fmt,
  applyTransform,
  curveToPolylinePoints, workspaceExtents,
  closeContour, dist,
  projectPointOntoClosedPolylineWithSegment,
  dxfPolyline, dxfCircle, dxfLine, dxfText,
  makeExportFilename, downloadBlob,
  type Pt,
} from './dxfShared'

/** Modellkoordinaten mm → DXF-Zoll: `coord_inch = coord_mm * dxfExportScale / MM_PER_INCH`. */
const MM_PER_INCH = 25.4

/**
 * ASTM-DXF für Gerber AccuMark: DXF R12 (AC1009), Einheiten Inch ($INSUNITS=1).
 *
 * - **Keine BLOCKS/INSERT:** Geometrie liegt flach in ENTITIES (Gerber erkennt Kerben in Blöcken oft nicht).
 * - Kerben: je eine LINE auf Layer 5 und 7 (Duplikat); Innenrichtung aus dem **Kontursegment** nach Snap.
 * - Naht: Polylinie auf gleiche Stützpunktanzahl wie die Schnittkontur (besseres Cut↔Seam-Pairing).
 *
 * Fadenlauf wird nicht exportiert (Layer 7 nur Kerb-Duplikat).
 */

const ASTM_LAYER = {
  BOUNDARY: '1',
  INTERNAL: '8',
  DRILL: '13',
  SEW: '14',
  TEXT: '15',
} as const

const GERBER_NOTCH_PRIMARY = '5'
const GERBER_NOTCH_DUP = '7'

const NOTCH_DEPTH_MIN_IN = 0.1
const NOTCH_DEPTH_MAX_IN = 0.4

/** Lokales mm → Welt-Zoll (INSERT-Transformation eingerechnet). */
function localMmToWorldInch(p: Pt, transform: PatternPiece['transform'], inchScale: number): Pt {
  const w = applyTransform(p.x, p.y, transform)
  return { x: w.x * inchScale, y: w.y * inchScale }
}

function notchDepthInchClamped(depthMm: number, inchScale: number): number {
  const d = depthMm * inchScale
  return Math.min(NOTCH_DEPTH_MAX_IN, Math.max(NOTCH_DEPTH_MIN_IN, d))
}

function perimeterClosed(ptsClosed: Pt[]): number {
  let len = 0
  for (let i = 0; i < ptsClosed.length - 1; i++) {
    len += dist(ptsClosed[i], ptsClosed[i + 1])
  }
  return len
}

function pointAtArcLengthOnClosedPolyline(ptsClosed: Pt[], s: number): Pt {
  const total = perimeterClosed(ptsClosed)
  if (total < 1e-12) return { ...ptsClosed[0] }
  let t = s % total
  if (t < 0) t += total
  let acc = 0
  for (let i = 0; i < ptsClosed.length - 1; i++) {
    const a = ptsClosed[i]
    const b = ptsClosed[i + 1]
    const segLen = dist(a, b)
    if (acc + segLen >= t - 1e-9) {
      const u = segLen < 1e-12 ? 0 : (t - acc) / segLen
      return { x: a.x + u * (b.x - a.x), y: a.y + u * (b.y - a.y) }
    }
    acc += segLen
  }
  return { ...ptsClosed[0] }
}

/** Gleichmäßig `n` Stützpunkte auf dem geschlossenen Umfang (open input → intern geschlossen). */
function resampleClosedPolylineUniform(ptsOpen: Pt[], n: number): Pt[] {
  if (n < 2 || ptsOpen.length < 2) return [...ptsOpen]
  const closed = closeContour([...ptsOpen])
  const total = perimeterClosed(closed)
  if (total < 1e-12) return [...ptsOpen]
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const s = (i / n) * total
    out.push(pointAtArcLengthOnClosedPolyline(closed, s))
  }
  return out
}

/**
 * Einheitsnormale ins Polygoninnere (Testpunkt leicht von Kantenmitte aus).
 * `polygonOpen`: geschlossener Lauf ohne abschließenden Doppelpunkt.
 */
function inwardNormalDegFromEdgeTowardInterior(a: Pt, b: Pt, polygonOpen: Pt[]): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-12) return 0
  const nx1 = -dy / len
  const ny1 = dx / len
  const nx2 = dy / len
  const ny2 = -dx / len
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const eps = Math.max(0.002, len * 1e-4)
  const test1 = { x: mid.x + nx1 * eps, y: mid.y + ny1 * eps }
  const test2 = { x: mid.x + nx2 * eps, y: mid.y + ny2 * eps }
  const in1 = polygonOpen.length >= 3 && isPointInPolygon(test1, polygonOpen)
  const in2 = polygonOpen.length >= 3 && isPointInPolygon(test2, polygonOpen)
  if (in1 && !in2) return (Math.atan2(ny1, nx1) * 180) / Math.PI
  if (in2 && !in1) return (Math.atan2(ny2, nx2) * 180) / Math.PI
  const cx = polygonOpen.reduce((s, p) => s + p.x, 0) / Math.max(1, polygonOpen.length)
  const cy = polygonOpen.reduce((s, p) => s + p.y, 0) / Math.max(1, polygonOpen.length)
  const cdx = cx - mid.x
  const cdy = cy - mid.y
  const dot1 = nx1 * cdx + ny1 * cdy
  const dot2 = nx2 * cdx + ny2 * cdy
  return dot1 >= dot2 ? (Math.atan2(ny1, nx1) * 180) / Math.PI : (Math.atan2(ny2, nx2) * 180) / Math.PI
}

function emitGerberNotchLine(
  notch: Notch,
  piece: PatternPiece,
  inchScale: number,
  boundaryRingWorldInch: Pt[],
  polygonOpenWorldInch: Pt[],
): string {
  if (boundaryRingWorldInch.length < 2 || polygonOpenWorldInch.length < 3) return ''

  const { position } = getNotchPositionAndAngleOnCutLine(notch, piece.cutLine, piece.seamLine)
  const anchorWorld = localMmToWorldInch(position, piece.transform, inchScale)
  const { closest: snapped, segIndex } = projectPointOntoClosedPolylineWithSegment(
    boundaryRingWorldInch,
    anchorWorld,
  )
  const a = boundaryRingWorldInch[segIndex]
  const b = boundaryRingWorldInch[segIndex + 1]
  const angleDeg = inwardNormalDegFromEdgeTowardInterior(a, b, polygonOpenWorldInch)
  const rad = (angleDeg * Math.PI) / 180
  const depthIn = notchDepthInchClamped(notch.depth, inchScale)
  const x1 = snapped.x
  const y1 = snapped.y
  const x2 = x1 + depthIn * Math.cos(rad)
  const y2 = y1 + depthIn * Math.sin(rad)

  return dxfLine(GERBER_NOTCH_PRIMARY, x1, y1, x2, y2)
    + dxfLine(GERBER_NOTCH_DUP, x1, y1, x2, y2)
}

function toAscii(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, '_')
}

function buildPieceFlatEntities(piece: PatternPiece, inchScale: number): string {
  const out: string[] = []
  const t = piece.transform

  const cutPtsMm = curveToPolylinePoints(piece.cutLine)
  const cutPtsWorldInch = cutPtsMm.map((p) => localMmToWorldInch(p, t, inchScale))
  const boundaryRing =
    cutPtsWorldInch.length >= 2 ? closeContour([...cutPtsWorldInch]) : []
  const polygonOpen =
    cutPtsWorldInch.length >= 3 ? cutPtsWorldInch.map((p) => ({ ...p })) : []

  out.push(dxfPolyline(ASTM_LAYER.BOUNDARY, cutPtsWorldInch, true))

  const seamCurves =
    piece.seamLine.length > 0
      ? piece.seamLine
      : piece.seamAllowanceMm != null && piece.cutLine.length >= 3
        ? offsetCurvesInwardForSeam(piece.cutLine, piece.seamAllowanceMm)
        : []
  if (seamCurves.length > 0) {
    const seamPtsMm = curveToPolylinePoints(seamCurves)
    const n = Math.max(2, cutPtsMm.length)
    const seamResampledMm = resampleClosedPolylineUniform(seamPtsMm, n)
    const seamPtsWorldInch = seamResampledMm.map((p) => localMmToWorldInch(p, t, inchScale))
    out.push(dxfPolyline(ASTM_LAYER.SEW, seamPtsWorldInch, true))
  }

  for (const notch of piece.notches) {
    out.push(emitGerberNotchLine(notch, piece, inchScale, boundaryRing, polygonOpen))
  }

  for (const drill of piece.drills) {
    const c = localMmToWorldInch(drill.center, t, inchScale)
    out.push(dxfCircle(ASTM_LAYER.DRILL, c.x, c.y, drill.radius * inchScale))
  }

  if (piece.internalLines.length > 0) {
    const intPts = curveToPolylinePoints(piece.internalLines)
    const scaledIntPts = intPts.map((p) => localMmToWorldInch(p, t, inchScale))
    out.push(dxfPolyline(ASTM_LAYER.INTERNAL, scaledIntPts, false))
  }

  const label = toAscii(piece.name || piece.number || '')
  if (label && cutPtsWorldInch[0]) {
    const firstCut = cutPtsWorldInch[0]
    const textHeightInch = 5 * inchScale
    const labelOffsetInch = 10 * inchScale
    out.push(dxfText(ASTM_LAYER.TEXT, firstCut.x, firstCut.y + labelOffsetInch, label, textHeightInch))
  }

  return out.join('')
}

/**
 * @param dxfExportScale – Multiplikator auf mm-Modellkoordinaten; Ausgabe in Inch.
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
  out.push('0' + EOL + 'ENDSEC' + EOL)

  out.push('0' + EOL + 'SECTION' + EOL + '2' + EOL + 'ENTITIES' + EOL)

  for (const piece of workspace.pieces) {
    out.push(buildPieceFlatEntities(piece, inchScale))
  }

  out.push('0' + EOL + 'ENDSEC' + EOL + '0' + EOL + 'EOF' + EOL)
  return out.join('')
}

export function downloadAstmDxf(workspace: Workspace, dxfExportScale = 1, filename?: string): void {
  if (!filename) filename = makeExportFilename('dxf')
  const content = exportWorkspaceToAstmDxf(workspace, dxfExportScale)
  downloadBlob(content, filename)
}

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
  sanitizeBlockName, makeExportFilename, downloadBlob,
  type Pt,
} from './dxfShared'

/**
 * ASTM-DXF für Gerber AccuMark: DXF R12 (AC1009).
 *
 * - **Einheiten:** Millimeter (`$INSUNITS` = 4), Koordinaten wie im Modell × `dxfExportScale`
 *   (gleiche Logik wie AAMA – vermeidet Zoll/mm-Verwirrung beim Import).
 * - **BLOCK + INSERT:** Kontur, Naht, Bohrung, intern, Text pro Teil (AccuMark erwartet das oft so).
 * - **Kerben:** zusätzliche LINE auf Layer 5 und 7 in **ENTITIES** im **Weltkoordinatensystem**
 *   (Transformation eingerechnet), damit sie nicht „versteckt“ im Block liegen.
 * - Naht: gleiche Stützpunktanzahl wie Schnittkontur (Resampling).
 *
 * Fadenlauf wird nicht exportiert.
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

/** Gerber: kurze Kerbe ~0,1–0,4 inch ≈ 2,54–10,16 mm (Modell). */
const NOTCH_DEPTH_MIN_MM = 2.54
const NOTCH_DEPTH_MAX_MM = 10.16

function pieceBlockName(piece: PatternPiece, index: number): string {
  const raw = piece.name || piece.number || `Piece_${index}`
  return sanitizeBlockName(raw)
}

function toAscii(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, '_')
}

/** Modell-mm → Datei-Koordinaten (Welt): `applyTransform` × fileScale. */
function localMmToWorldFile(p: Pt, transform: PatternPiece['transform'], fileScale: number): Pt {
  const w = applyTransform(p.x, p.y, transform)
  return { x: w.x * fileScale, y: w.y * fileScale }
}

function notchDepthFileMmClamped(depthMm: number, fileScale: number): number {
  const d = Math.min(NOTCH_DEPTH_MAX_MM, Math.max(NOTCH_DEPTH_MIN_MM, depthMm))
  return d * fileScale
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
  const eps = Math.max(0.05, len * 1e-4)
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

function emitGerberNotchLinesWorld(
  notch: Notch,
  piece: PatternPiece,
  fileScale: number,
  boundaryRingFile: Pt[],
  polygonOpenFile: Pt[],
): string {
  if (boundaryRingFile.length < 2 || polygonOpenFile.length < 3) return ''

  const { position } = getNotchPositionAndAngleOnCutLine(notch, piece.cutLine, piece.seamLine)
  const anchorFile = localMmToWorldFile(position, piece.transform, fileScale)
  const { closest: snapped, segIndex } = projectPointOntoClosedPolylineWithSegment(
    boundaryRingFile,
    anchorFile,
  )
  const a = boundaryRingFile[segIndex]
  const b = boundaryRingFile[segIndex + 1]
  const angleDeg = inwardNormalDegFromEdgeTowardInterior(a, b, polygonOpenFile)
  const rad = (angleDeg * Math.PI) / 180
  const depthF = notchDepthFileMmClamped(notch.depth, fileScale)
  const x1 = snapped.x
  const y1 = snapped.y
  const x2 = x1 + depthF * Math.cos(rad)
  const y2 = y1 + depthF * Math.sin(rad)

  return dxfLine(GERBER_NOTCH_PRIMARY, x1, y1, x2, y2)
    + dxfLine(GERBER_NOTCH_DUP, x1, y1, x2, y2)
}

/**
 * Block-Inhalt: lokale mm × fileScale — ohne Kerben (die folgen in ENTITIES).
 */
function buildBlockContentNoNotches(piece: PatternPiece, fileScale: number): string {
  const out: string[] = []

  const cutPts = curveToPolylinePoints(piece.cutLine)
  const scaledCutPts = cutPts.map((p) => ({ x: p.x * fileScale, y: p.y * fileScale }))
  out.push(dxfPolyline(ASTM_LAYER.BOUNDARY, scaledCutPts, true))

  const seamCurves =
    piece.seamLine.length > 0
      ? piece.seamLine
      : piece.seamAllowanceMm != null && piece.cutLine.length >= 3
        ? offsetCurvesInwardForSeam(piece.cutLine, piece.seamAllowanceMm)
        : []
  if (seamCurves.length > 0) {
    const seamPts = curveToPolylinePoints(seamCurves)
    const n = Math.max(2, cutPts.length)
    const seamResampled = resampleClosedPolylineUniform(seamPts, n)
    const scaledSeamPts = seamResampled.map((p) => ({ x: p.x * fileScale, y: p.y * fileScale }))
    out.push(dxfPolyline(ASTM_LAYER.SEW, scaledSeamPts, true))
  }

  for (const drill of piece.drills) {
    out.push(dxfCircle(
      ASTM_LAYER.DRILL,
      drill.center.x * fileScale,
      drill.center.y * fileScale,
      drill.radius * fileScale,
    ))
  }

  if (piece.internalLines.length > 0) {
    const intPts = curveToPolylinePoints(piece.internalLines)
    const scaledIntPts = intPts.map((p) => ({ x: p.x * fileScale, y: p.y * fileScale }))
    out.push(dxfPolyline(ASTM_LAYER.INTERNAL, scaledIntPts, false))
  }

  const label = toAscii(piece.name || piece.number || '')
  if (label && scaledCutPts[0]) {
    const firstCut = scaledCutPts[0]
    out.push(dxfText(ASTM_LAYER.TEXT, firstCut.x, firstCut.y + 10 * fileScale, label, 5 * fileScale))
  }

  return out.join('')
}

/**
 * Kerben für ein Teil: Welt-Dateikoordinaten (nach INSERT-Logik), für ENTITIES nach den Blöcken.
 */
function notchEntitiesWorld(piece: PatternPiece, fileScale: number): string {
  const cutPts = curveToPolylinePoints(piece.cutLine)
  const cutFile = cutPts.map((p) => localMmToWorldFile(p, piece.transform, fileScale))
  const boundaryRing = cutFile.length >= 2 ? closeContour([...cutFile]) : []
  const polygonOpen = cutFile.length >= 3 ? cutFile.map((p) => ({ ...p })) : []
  let s = ''
  for (const notch of piece.notches) {
    s += emitGerberNotchLinesWorld(notch, piece, fileScale, boundaryRing, polygonOpen)
  }
  return s
}

/**
 * @param dxfExportScale – wie AAMA: Multiplikator auf mm-Koordinaten im Modell.
 */
export function exportWorkspaceToAstmDxf(workspace: Workspace, dxfExportScale = 1): string {
  const s = dxfExportScale
  const out: string[] = []
  const ext = workspaceExtents(workspace, s)

  out.push('0' + EOL + 'SECTION' + EOL + '2' + EOL + 'HEADER' + EOL)
  out.push('9' + EOL + '$ACADVER' + EOL + '1' + EOL + 'AC1009' + EOL)
  out.push('9' + EOL + '$INSUNITS' + EOL + '70' + EOL + '4' + EOL)
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

    out.push(buildBlockContentNoNotches(piece, s))

    out.push('0' + EOL + 'ENDBLK' + EOL)
  }

  out.push('0' + EOL + 'ENDSEC' + EOL)

  out.push('0' + EOL + 'SECTION' + EOL + '2' + EOL + 'ENTITIES' + EOL)

  for (let i = 0; i < workspace.pieces.length; i++) {
    const piece = workspace.pieces[i]
    const t = piece.transform
    out.push('0' + EOL + 'INSERT' + EOL + '8' + EOL + '0' + EOL + '2' + EOL + toAscii(blockNames[i]) + EOL
      + '10' + EOL + fmt(t.x * s) + EOL + '20' + EOL + fmt(t.y * s) + EOL
      + '41' + EOL + (t.mirrored ? '-1' : '1') + EOL
      + '42' + EOL + '1' + EOL
      + '50' + EOL + fmt(t.rotation) + EOL)
  }

  for (const piece of workspace.pieces) {
    out.push(notchEntitiesWorld(piece, s))
  }

  out.push('0' + EOL + 'ENDSEC' + EOL + '0' + EOL + 'EOF' + EOL)
  return out.join('')
}

export function downloadAstmDxf(workspace: Workspace, dxfExportScale = 1, filename?: string): void {
  if (!filename) filename = makeExportFilename('dxf')
  const content = exportWorkspaceToAstmDxf(workspace, dxfExportScale)
  downloadBlob(content, filename)
}

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
 * **Header und Skalierung** sind an `aamaWriter.ts` angeglichen (`$INSUNITS` = 5, `dxfExportScale` × mm),
 * damit AccuMark dieselbe Datei-„Sprache“ wie beim bewährten AAMA-Export sieht und Teile wieder importiert.
 *
 * Abweichungen zu AAMA: numerische ASTM-Layer (1, 14, …), kein Fadenlauf.
 *
 * **Kerben:** LINE auf Layer 5+7 nur in **ENTITIES** (Weltkoordinaten nach INSERT-Logik) —
 * AccuMark erkennt Kerben in Block-Definitionen häufig nicht; Kontur bleibt im BLOCK wie AAMA.
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

const NOTCH_DEPTH_MIN_MM = 2.54
const NOTCH_DEPTH_MAX_MM = 10.16

function pieceBlockName(piece: PatternPiece, index: number): string {
  const raw = piece.name || piece.number || `Piece_${index}`
  return sanitizeBlockName(raw)
}

function toAscii(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, '_')
}

function notchDepthFileMmClamped(depthMm: number, fileScale: number): number {
  const d = Math.min(NOTCH_DEPTH_MAX_MM, Math.max(NOTCH_DEPTH_MIN_MM, depthMm))
  return d * fileScale
}

/** Modell-mm → Datei-Welt (wie workspaceExtents / INSERT zusammengesetzt). */
function localMmToWorldFile(p: Pt, transform: PatternPiece['transform'], fileScale: number): Pt {
  const w = applyTransform(p.x, p.y, transform)
  return { x: w.x * fileScale, y: w.y * fileScale }
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

/**
 * Kerben nur für ENTITIES: Welt-Dateikoordinaten, damit AccuMark die LINEs als Kerben werten kann.
 * Liegen nicht im BLOCK (dort werden sie oft ignoriert).
 */
function emitGerberNotchLinesWorld(
  notch: Notch,
  piece: PatternPiece,
  fileScale: number,
  boundaryRingWorld: Pt[],
  polygonOpenWorld: Pt[],
): string {
  if (boundaryRingWorld.length < 2 || polygonOpenWorld.length < 3) return ''

  const { position } = getNotchPositionAndAngleOnCutLine(notch, piece.cutLine, piece.seamLine)
  const anchorWorld = localMmToWorldFile(position, piece.transform, fileScale)
  let { closest: snapped, segIndex } = projectPointOntoClosedPolylineWithSegment(
    boundaryRingWorld,
    anchorWorld,
  )
  const tol = Math.max(0.002, fileScale * 1e-4)
  let nearestV = snapped
  let nearestD = Infinity
  for (let i = 0; i < boundaryRingWorld.length - 1; i++) {
    const v = boundaryRingWorld[i]
    const d = dist(snapped, v)
    if (d < nearestD) {
      nearestD = d
      nearestV = v
    }
  }
  if (nearestD <= tol) snapped = nearestV
  const a = boundaryRingWorld[segIndex]
  const b = boundaryRingWorld[segIndex + 1]
  const angleDeg = inwardNormalDegFromEdgeTowardInterior(a, b, polygonOpenWorld)
  const rad = (angleDeg * Math.PI) / 180
  const depthF = notchDepthFileMmClamped(notch.depth, fileScale)
  const x1 = snapped.x
  const y1 = snapped.y
  const x2 = x1 + depthF * Math.cos(rad)
  const y2 = y1 + depthF * Math.sin(rad)

  return dxfLine(GERBER_NOTCH_PRIMARY, x1, y1, x2, y2)
    + dxfLine(GERBER_NOTCH_DUP, x1, y1, x2, y2)
}

function notchEntitiesWorld(piece: PatternPiece, fileScale: number): string {
  const cutPts = curveToPolylinePoints(piece.cutLine)
  const cutWorld = cutPts.map((p) => localMmToWorldFile(p, piece.transform, fileScale))
  const boundaryRing = cutWorld.length >= 2 ? closeContour([...cutWorld]) : []
  const polygonOpen = cutWorld.length >= 3 ? cutWorld.map((p) => ({ ...p })) : []
  let s = ''
  for (const notch of piece.notches) {
    s += emitGerberNotchLinesWorld(notch, piece, fileScale, boundaryRing, polygonOpen)
  }
  return s
}

function buildBlockContent(piece: PatternPiece, fileScale: number): string {
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
    const scaledSeamPts = seamPts.map((p) => ({ x: p.x * fileScale, y: p.y * fileScale }))
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

  const label = piece.name || piece.number || ''
  if (label && scaledCutPts[0]) {
    const firstCut = scaledCutPts[0]
    out.push(dxfText(ASTM_LAYER.TEXT, firstCut.x, firstCut.y + 10, toAscii(label)))
  }

  return out.join('')
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
  out.push('9' + EOL + '$INSUNITS' + EOL + '70' + EOL + '5' + EOL)
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

    out.push('0' + EOL + 'BLOCK' + EOL + '8' + EOL + '0' + EOL + '2' + EOL + bName + EOL
      + '70' + EOL + '0' + EOL + '10' + EOL + '0' + EOL + '20' + EOL + '0' + EOL)

    out.push(buildBlockContent(piece, s))

    out.push('0' + EOL + 'ENDBLK' + EOL)
  }

  out.push('0' + EOL + 'ENDSEC' + EOL)

  out.push('0' + EOL + 'SECTION' + EOL + '2' + EOL + 'ENTITIES' + EOL)

  for (let i = 0; i < workspace.pieces.length; i++) {
    const piece = workspace.pieces[i]
    const t = piece.transform
    out.push('0' + EOL + 'INSERT' + EOL + '8' + EOL + '0' + EOL + '2' + EOL + blockNames[i] + EOL
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

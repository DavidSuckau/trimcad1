import type { Workspace, PatternPiece, Notch } from '../types/model'
import {
  getNotchPositionAndAngleOnCutLine,
  notchCutoutPoints,
  resolveNotchCutLineAnchor,
} from '../geometry/notchOnCurve'
import { offsetCurvesInwardForSeam } from '../geometry/offset'
import { isPointInPolygon } from '../geometry/pointInPolygon'
import {
  EOL, fmt,
  curveToPolylinePoints, workspaceExtents,
  closeContour, dist,
  projectPointOntoClosedPolylineWithSegment,
  dxfPolyline, dxfCircle, dxfLine, dxfPoint, dxfAstmNotchPoint, dxfText,
  sanitizeBlockName, makeExportFilename, downloadBlob,
  type Pt,
} from './dxfShared'

/**
 * ASTM-DXF für Gerber AccuMark – an typischem AccuMark-DXF ausgerichtet (Beispiel-Export):
 *
 * - BLOCK-Flag **70 = 64** (wie Gerber-Referenzdatei).
 * - Schnitt **Layer 1** + identische Kopie **Layer 84**; Naht **14** + Kopie **87**.
 * - Hilfs-**POINT** auf **Layer 2** an Kontur- und Naht-Vertices sowie Kerben-Enden.
 * - Kerbe: **LINE Layer 4** (+ 7 + 5): Strich = eine Linie; **V / Doppel** = zwei Linien zur Spitze
 *   (wie `notchCutoutPoints`), optional **POINT Layer 4** mit 30/39/50 nur bei Strich-Kerbe.
 * - Schnitt/Naht-POLYLINE: **glatte** `cutLine` / `seamLine` **ohne** Kerb-Vertices — sonst mappt Gerber
 *   V-Kerben nur auf die Außenkontur. Kerb-Geometrie nur über LINEs (4/7/5) + Hilfs-POINTs.
 *
 * Hinweis: AccuMark-Versionen unterscheiden sich; früher wurden Kerben testweise nur in ENTITIES
 * ausgegeben — die aktuelle Struktur folgt dem internen Gerber-Beispiel (alles im Block).
 *
 * Header/Skalierung wie AAMA (`$INSUNITS` = 5, Koordinaten = Modell-mm × `dxfExportScale`).
 */

const ASTM_LAYER = {
  BOUNDARY: '1',
  BOUNDARY_DUP: '84',
  POINT_AUX: '2',
  INTERNAL: '8',
  DRILL: '13',
  SEW: '14',
  SEW_DUP: '87',
  TEXT: '15',
} as const

/** ASTM D6673: Notches (Slit / V-Notch) — AccuMark/DCU erwartet Kerben typischerweise hier. */
const ASTM_NOTCH_LAYER = '4'
const GERBER_NOTCH_PRIMARY = '5'
const GERBER_NOTCH_DUP = '7'

const NOTCH_DEPTH_MIN_MM = 2.54
const NOTCH_DEPTH_MAX_MM = 10.16

/** BLOCK-Definition: Bit wie in Gerber-Beispieldatei (70 = 64). */
const BLOCK_DEF_FLAG_GERBER = '64'

/** Vertex-Snap: Mindestabstand in Datei-Einheiten; zusätzlich skaliert mit `fileScale`. */
const SNAP_TOLERANCE_MIN_FILE = 0.002
const SNAP_TOLERANCE_FILE_PER_SCALE = 1e-4

/** Abstand für Punkt-in-Polygon-Test zur Kante (Normalenwahl). */
const NORMAL_TEST_EPS_MIN = 0.05
const NORMAL_TEST_EPS_EDGE_RATIO = 1e-4

const BLOCK_LABEL_OFFSET_Y = 10

const BLOCK_TEXT_HEIGHT_MM = 5

const BLOCK_MIN_VERTICES = 2

/** Shoelace-Fläche; Vorzeichen = Umlauf (CCW positiv bei mathematischer y-Achse nach oben). */
function signedPolygonAreaOpen(pts: Pt[]): number {
  const n = pts.length
  if (n < 3) return 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    sum += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return sum / 2
}

function pieceBlockName(piece: PatternPiece, index: number): string {
  const raw = piece.name || piece.number || `Piece_${index}`
  return sanitizeBlockName(raw)
}

/** DXF 7-bit + einfache Umlaut-Umschrift (lesbarer als nur `_`). */
function dxfSafeLabel(s: string): string {
  return s
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .replace(/[^\x20-\x7E]/g, '_')
}

function notchDepthFileMmClamped(depthMm: number, fileScale: number): number {
  const d = Math.min(NOTCH_DEPTH_MAX_MM, Math.max(NOTCH_DEPTH_MIN_MM, depthMm))
  return d * fileScale
}

function isFinitePt(p: Pt): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y)
}

/**
 * Innen-Normale zur Kante a→b: zuerst Punkt-in-Polygon auf beide Normalen,
 * bei Gleichstand Vorzeichen der Polygonfläche (CCW → linke Normale).
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
  const eps = Math.max(NORMAL_TEST_EPS_MIN, len * NORMAL_TEST_EPS_EDGE_RATIO)
  const test1 = { x: mid.x + nx1 * eps, y: mid.y + ny1 * eps }
  const test2 = { x: mid.x + nx2 * eps, y: mid.y + ny2 * eps }
  const in1 = polygonOpen.length >= 3 && isPointInPolygon(test1, polygonOpen)
  const in2 = polygonOpen.length >= 3 && isPointInPolygon(test2, polygonOpen)
  if (in1 && !in2) return (Math.atan2(ny1, nx1) * 180) / Math.PI
  if (in2 && !in1) return (Math.atan2(ny2, nx2) * 180) / Math.PI

  const area = signedPolygonAreaOpen(polygonOpen)
  if (Math.abs(area) > 1e-12) {
    return area > 0
      ? (Math.atan2(ny1, nx1) * 180) / Math.PI
      : (Math.atan2(ny2, nx2) * 180) / Math.PI
  }

  const cx = polygonOpen.reduce((s, p) => s + p.x, 0) / Math.max(1, polygonOpen.length)
  const cy = polygonOpen.reduce((s, p) => s + p.y, 0) / Math.max(1, polygonOpen.length)
  const cdx = cx - mid.x
  const cdy = cy - mid.y
  const dot1 = nx1 * cdx + ny1 * cdy
  const dot2 = nx2 * cdx + ny2 * cdy
  return dot1 >= dot2 ? (Math.atan2(ny1, nx1) * 180) / Math.PI : (Math.atan2(ny2, nx2) * 180) / Math.PI
}

/** Dieselbe Geometrie auf 4 / 7 / 5 (ASTM + Gerber-Beispiel). */
function emitNotchLineTriple(x1: number, y1: number, x2: number, y2: number): string {
  return dxfLine(ASTM_NOTCH_LAYER, x1, y1, x2, y2)
    + dxfLine(GERBER_NOTCH_DUP, x1, y1, x2, y2)
    + dxfLine(GERBER_NOTCH_PRIMARY, x1, y1, x2, y2)
}

function emitGerberNotchPackLocal(
  notch: Notch,
  piece: PatternPiece,
  fileScale: number,
  boundaryRingLocal: Pt[],
  polygonOpenLocal: Pt[],
): string {
  if (boundaryRingLocal.length < 2 || polygonOpenLocal.length < 3) return ''

  const { position, angle } = getNotchPositionAndAngleOnCutLine(notch, piece.cutLine, piece.seamLine)
  if (!isFinitePt(position)) return ''

  const anchor = resolveNotchCutLineAnchor(notch, piece.cutLine)
  const widthMm = notch.width ?? 6
  const depthMmClamped = Math.min(NOTCH_DEPTH_MAX_MM, Math.max(NOTCH_DEPTH_MIN_MM, notch.depth))

  if (notch.type !== 'single') {
    const geom = notchCutoutPoints(
      position,
      angle,
      depthMmClamped,
      widthMm,
      piece.cutLine,
      anchor,
      notch.type,
    )
    if (!geom || geom.kind !== 'v') return ''

    const lx = geom.left.x * fileScale
    const ly = geom.left.y * fileScale
    const rx = geom.right.x * fileScale
    const ry = geom.right.y * fileScale
    const tx = geom.tip.x * fileScale
    const ty = geom.tip.y * fileScale
    if (![lx, ly, rx, ry, tx, ty].every(Number.isFinite)) return ''

    const parts = [
      emitNotchLineTriple(lx, ly, tx, ty),
      emitNotchLineTriple(rx, ry, tx, ty),
      dxfPoint(ASTM_LAYER.POINT_AUX, lx, ly),
      dxfPoint(ASTM_LAYER.POINT_AUX, rx, ry),
      dxfPoint(ASTM_LAYER.POINT_AUX, tx, ty),
    ]
    return parts.join('')
  }

  const anchorLocal = { x: position.x * fileScale, y: position.y * fileScale }
  const { closest: initialClosest, segIndex } = projectPointOntoClosedPolylineWithSegment(
    boundaryRingLocal,
    anchorLocal,
  )
  let snapped = initialClosest
  const tol = Math.max(SNAP_TOLERANCE_MIN_FILE, fileScale * SNAP_TOLERANCE_FILE_PER_SCALE)
  let nearestV = snapped
  let nearestD = Infinity
  for (let i = 0; i < boundaryRingLocal.length - 1; i++) {
    const v = boundaryRingLocal[i]
    const d = dist(snapped, v)
    if (d < nearestD) {
      nearestD = d
      nearestV = v
    }
  }
  if (nearestD <= tol) snapped = nearestV

  const a = boundaryRingLocal[segIndex]
  const b = boundaryRingLocal[segIndex + 1]
  const angleDeg = inwardNormalDegFromEdgeTowardInterior(a, b, polygonOpenLocal)
  const rad = (angleDeg * Math.PI) / 180
  const depthF = notchDepthFileMmClamped(notch.depth, fileScale)
  const x1 = snapped.x
  const y1 = snapped.y
  const x2 = x1 + depthF * Math.cos(rad)
  const y2 = y1 + depthF * Math.sin(rad)

  if (![x1, y1, x2, y2].every(Number.isFinite)) return ''

  const angleDegFromX = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI
  const widthF = Math.max(0, widthMm * fileScale)

  const parts = [
    emitNotchLineTriple(x1, y1, x2, y2),
    dxfAstmNotchPoint(x1, y1, depthF, widthF, angleDegFromX),
    dxfPoint(ASTM_LAYER.POINT_AUX, x1, y1),
    dxfPoint(ASTM_LAYER.POINT_AUX, x2, y2),
  ]
  return parts.join('')
}

function emitPointsAlongPolylineOpen(pts: Pt[], layer: string): string {
  if (pts.length < 1) return ''
  const chunks: string[] = []
  for (const p of pts) {
    chunks.push(dxfPoint(layer, p.x, p.y))
  }
  return chunks.join('')
}

function buildBlockContent(piece: PatternPiece, fileScale: number): string {
  const out: string[] = []

  const cutPts = curveToPolylinePoints(piece.cutLine)
  if (cutPts.length < BLOCK_MIN_VERTICES) {
    return ''
  }

  const scaledCutPts = cutPts.map((p) => ({ x: p.x * fileScale, y: p.y * fileScale }))
  const boundaryRing =
    scaledCutPts.length >= 2 ? closeContour([...scaledCutPts]) : []
  const polygonOpen =
    scaledCutPts.length >= 3 ? scaledCutPts.map((p) => ({ ...p })) : []

  out.push(dxfPolyline(ASTM_LAYER.BOUNDARY, scaledCutPts, true))
  out.push(dxfPolyline(ASTM_LAYER.BOUNDARY_DUP, scaledCutPts, true))
  out.push(emitPointsAlongPolylineOpen(scaledCutPts, ASTM_LAYER.POINT_AUX))

  const seamCurves =
    piece.seamLine.length >= 3
      ? piece.seamLine
      : piece.seamAllowanceMm != null && piece.cutLine.length >= 3
        ? offsetCurvesInwardForSeam(piece.cutLine, piece.seamAllowanceMm)
        : []
  if (seamCurves.length > 0) {
    const seamPts = curveToPolylinePoints(seamCurves)
    const scaledSeamPts = seamPts.map((p) => ({ x: p.x * fileScale, y: p.y * fileScale }))
    out.push(dxfPolyline(ASTM_LAYER.SEW, scaledSeamPts, true))
    out.push(dxfPolyline(ASTM_LAYER.SEW_DUP, scaledSeamPts, true))
    out.push(emitPointsAlongPolylineOpen(scaledSeamPts, ASTM_LAYER.POINT_AUX))
  }

  for (const notch of piece.notches) {
    out.push(emitGerberNotchPackLocal(notch, piece, fileScale, boundaryRing, polygonOpen))
  }

  for (const drill of piece.drills) {
    const cx = drill.center.x * fileScale
    const cy = drill.center.y * fileScale
    const r = drill.radius * fileScale
    if (![cx, cy, r].every(Number.isFinite)) continue
    out.push(dxfCircle(ASTM_LAYER.DRILL, cx, cy, r))
  }

  if (piece.internalLines.length > 0) {
    const intPts = curveToPolylinePoints(piece.internalLines)
    const scaledIntPts = intPts.map((p) => ({ x: p.x * fileScale, y: p.y * fileScale }))
    out.push(dxfPolyline(ASTM_LAYER.INTERNAL, scaledIntPts, false))
  }
  for (const ic of piece.internalCircles) {
    const cx = ic.center.x * fileScale
    const cy = ic.center.y * fileScale
    const r = ic.radius * fileScale
    if (![cx, cy, r].every(Number.isFinite)) continue
    out.push(dxfCircle(ASTM_LAYER.INTERNAL, cx, cy, r))
  }

  const label = piece.name || piece.number || ''
  if (label && scaledCutPts[0]) {
    const firstCut = scaledCutPts[0]
    out.push(
      dxfText(
        ASTM_LAYER.TEXT,
        firstCut.x,
        firstCut.y + BLOCK_LABEL_OFFSET_Y,
        dxfSafeLabel(label),
        BLOCK_TEXT_HEIGHT_MM,
      ),
    )
  }

  return out.join('')
}

/**
 * @param dxfExportScale – wie AAMA: Multiplikator auf mm-Koordinaten im Modell.
 */
export function exportWorkspaceToAstmDxf(workspace: Workspace, dxfExportScale = 1): string {
  const s = dxfExportScale
  if (!Number.isFinite(s) || s <= 0) {
    return ''
  }

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
      + '70' + EOL + BLOCK_DEF_FLAG_GERBER + EOL + '10' + EOL + '0' + EOL + '20' + EOL + '0' + EOL)

    out.push(buildBlockContent(piece, s))

    out.push('0' + EOL + 'ENDBLK' + EOL)
  }

  out.push('0' + EOL + 'ENDSEC' + EOL)

  out.push('0' + EOL + 'SECTION' + EOL + '2' + EOL + 'ENTITIES' + EOL)

  for (let i = 0; i < workspace.pieces.length; i++) {
    const piece = workspace.pieces[i]
    const t = piece.transform
    const ix = Number.isFinite(t.x * s) ? t.x * s : 0
    const iy = Number.isFinite(t.y * s) ? t.y * s : 0
    const rot = Number.isFinite(t.rotation) ? t.rotation : 0
    out.push('0' + EOL + 'INSERT' + EOL + '8' + EOL + '0' + EOL + '2' + EOL + blockNames[i] + EOL
      + '10' + EOL + fmt(ix) + EOL + '20' + EOL + fmt(iy) + EOL
      + '41' + EOL + (t.mirrored ? '-1' : '1') + EOL
      + '42' + EOL + '1' + EOL
      + '50' + EOL + fmt(rot) + EOL)
  }

  out.push('0' + EOL + 'ENDSEC' + EOL + '0' + EOL + 'EOF' + EOL)
  return out.join('')
}

export function downloadAstmDxf(workspace: Workspace, dxfExportScale = 1, filename?: string): void {
  if (!filename) filename = makeExportFilename('dxf')
  const content = exportWorkspaceToAstmDxf(workspace, dxfExportScale)
  downloadBlob(content, filename)
}

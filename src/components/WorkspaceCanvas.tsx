import { useRef, useCallback, useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store/useStore'
import type { NotchSetting } from '../store/useStore'
import {
  closedPathD,
  curveToPathD,
  bezierAt,
  bezierDerivativeAt,
  curveSegmentArcLength,
  curvesBounds,
  outwardNormalAngleAt,
  signedAreaCurves,
  pointAtPathLength,
  pathLengthAt,
  totalPathLength,
} from '../geometry/curveToPath'
import { nearestCurveIndexAndPoint } from '../geometry/nearestOnCurve'
import { offsetSegmentPoints } from '../geometry/offset'
import {
  getNotchPositionAndAngle,
  getNotchPositionAndAngleOnCutLine,
  getNotchPositionAndAngleOnSeamLine,
  getNotchCurveIndexAndT,
  notchTriangleCorners,
  notchCutoutPoints,
  type NotchCutoutGeom,
  cutLineWithNotchCutouts,
  seamLineWithNotchCutouts,
} from '../geometry/notchOnCurve'
import { isNotchSpacingValid } from '../geometry/notchMinSpacing'
import { isPointInClosedCurves, isPointInPolygon } from '../geometry/pointInPolygon'
import {
  getCornerRange,
  countNotchesOnEdge,
  getSubSegments,
  getSeamEdgeCurves,
  getCurvesForSeamEdge,
  resolvedSeamAssignmentCurveIndices,
  edgeTotalLength,
  bestSeamSubSegmentPairing,
  masterSoftVertexIndexSet,
} from '../geometry/seamUtils'
import { useSeamLineForVertexEditing, useSeamLineForPointCurveEditing } from '../geometry/vertexMaster'
import { getCutLineContourMeasurements } from '../geometry/contourMeasurements'
import { enumerateEdges, getAllowanceForCurveIndex } from '../geometry/edgeEnumeration'
import { getPiecePivotLocal } from '../geometry/pieceTransform'
import { collectMarqueeTargets, filterBatchTargets, batchTargetKey } from '../workspace/workspaceMarqueeSelection'
import { boundsForPieceCutLineWorld } from '../workspace/workspaceOverviewBounds'
import { getPieceGrainLine, getGrainArrowLayout } from '../geometry/grainArrowLayout'
import type { PatternPiece, Point, Line, Curve, SeamAssignment, BatchSelectionFilter, NotchType as ModelNotchType } from '../types/model'
import { SEAM_ASSIGNMENT_KIND_LABELS } from '../types/model'
/** Rasterabstand in mm (Arbeitsfläche maßstabsgetreu in mm) */
const GRID_SIZE = 10

/**
 * Kontur-/Bearbeitungspunkte: Größe in „Bildschirm-SVG-Einheiten“ (nach view.zoom im Parent).
 * r * (1/zoom) hält die sichtbare Größe beim Zoomen etwa konstant.
 */
const POINT_SCREEN_R = 2.45
const POINT_SCREEN_STROKE = 0.8
const POINT_SCREEN_RECT = 4.9
/** Digitalisieren: etwas größer, gleiches Zoom-Verhalten */
const DIGITIZE_NODE_R = 3.1
const DIGITIZE_NODE_R_NEAR = 5.2
const DIGITIZE_HANDLE_R = 2.35
const DIGITIZE_HANDLE_REFLECT_R = 1.9

/** Hintergrundbild: feste Transparenz, kein eigener Schieberegler mehr. */
const WORKSPACE_IMAGE_OPACITY = 0.42
const IMAGE_CORNER_HIT_MM = 12

/** Snapshot für Kerben-Resync erst beim Loslassen (Seam-Master + Nahtzugabe). */
function cloneVertexDragCutLine(curves: Curve[]): Curve[] {
  return curves.map((c) =>
    c.type === 'line'
      ? { type: 'line', start: { ...c.start }, end: { ...c.end } }
      : { type: 'bezier', start: { ...c.start }, end: { ...c.end }, cp1: { ...c.cp1 }, cp2: { ...c.cp2 } }
  )
}

function cloneVertexDragNotches(notches: PatternPiece['notches']): PatternPiece['notches'] {
  return notches.map((n) => ({ ...n, position: { ...n.position } }))
}

/** Einstellungs-Preset → Modell-Notch; bei „keine“ wird nichts gesetzt. */
function modelNotchFieldsFromPreset(p: NotchSetting): { type: ModelNotchType; depth: number; width: number } | null {
  if (p.type === 'keine') return null
  return {
    type: p.type === 'kerbe' ? 'v' : 'single',
    depth: Math.max(0.5, p.depthMm || 4),
    width: Math.max(0.5, p.widthMm || 6),
  }
}

/** SVG-Pfade für Kerben-Darstellung (V oder Strich = eine Linie). */
function notchCutoutSvgPaths(geom: NotchCutoutGeom): { fillD: string; edgesD: string } {
  if (geom.kind === 'line') {
    const { start, end } = geom
    return {
      fillD: '',
      edgesD: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
    }
  }
  const { left, tip, right } = geom
  return {
    fillD: `M ${left.x} ${left.y} L ${tip.x} ${tip.y} L ${right.x} ${right.y} Z`,
    edgesD: `M ${left.x} ${left.y} L ${tip.x} ${tip.y} L ${right.x} ${right.y}`,
  }
}

function distancePointToSegmentSq(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const wx = p.x - a.x
  const wy = p.y - a.y
  const len2 = vx * vx + vy * vy
  if (len2 < 1e-18) return wx * wx + wy * wy
  let t = (wx * vx + wy * vy) / len2
  t = Math.max(0, Math.min(1, t))
  const nx = a.x + t * vx - p.x
  const ny = a.y + t * vy - p.y
  return nx * nx + ny * ny
}

/** Distanz Punkt → Kerbe (Cut); `cutPosCenter` für Fallback. */
function distanceToNotchCutoutGeom(
  local: Point,
  geom: NotchCutoutGeom,
  cutPosCenter: Point
): number {
  if (geom.kind === 'line') {
    const dSeg = Math.sqrt(distancePointToSegmentSq(local, geom.start, geom.end))
    const dAnchor = Math.hypot(local.x - cutPosCenter.x, local.y - cutPosCenter.y)
    return Math.min(dSeg, dAnchor)
  }
  const tri = [geom.left, geom.tip, geom.right]
  if (isPointInPolygon(local, tri)) return 0
  return Math.min(
    Math.hypot(local.x - cutPosCenter.x, local.y - cutPosCenter.y),
    ...tri.map((pt) => Math.hypot(local.x - pt.x, local.y - pt.y))
  )
}

function findMatchingNotchPresetIndex(notch: { type: ModelNotchType; depth: number; width?: number }, settings: NotchSetting[]): number | null {
  const w = notch.width ?? 6
  for (let i = 0; i < settings.length; i++) {
    const f = modelNotchFieldsFromPreset(settings[i])
    if (!f) continue
    if (
      f.type === notch.type &&
      Math.abs(f.depth - notch.depth) < 0.02 &&
      Math.abs(f.width - w) < 0.02
    ) {
      return i
    }
  }
  return null
}

function workspaceImageLayout(session: {
  imagePosition: Point
  imageSizePx: { width: number; height: number } | null
  renderMmPerPixel: number
}): {
  cx: number
  cy: number
  w: number
  h: number
  left: number
  right: number
  top: number
  bottom: number
} | null {
  if (!session.imageSizePx) return null
  const imageSizePx = session.imageSizePx
  const w = imageSizePx.width * session.renderMmPerPixel
  const h = imageSizePx.height * session.renderMmPerPixel
  const cx = session.imagePosition.x
  const cy = session.imagePosition.y
  return {
    cx,
    cy,
    w,
    h,
    left: cx - w / 2,
    right: cx + w / 2,
    top: cy - h / 2,
    bottom: cy + h / 2,
  }
}

/** Vertex-Position auf der bearbeitbaren Kontur — gleiche Logik wie Hover (s. useSeamLineForVertexEditing). */
function getMasterContourVertexLocal(piece: PatternPiece, vertexIndex: number): Point | null {
  const useSeamForVertices = useSeamLineForVertexEditing(piece)
  const curves = useSeamForVertices ? piece.seamLine : piece.cutLine
  if (!curves.length || vertexIndex < 0 || vertexIndex >= curves.length) return null
  return vertexIndex === 0 ? { ...curves[0].start } : { ...curves[vertexIndex - 1].end }
}

function isWorldInsideWorkspaceImage(
  world: Point,
  session: { imagePosition: Point; imageSizePx: { width: number; height: number } | null; renderMmPerPixel: number }
): boolean {
  const lay = workspaceImageLayout(session)
  if (!lay) return false
  const { left, right, top, bottom } = lay
  return world.x >= left && world.x <= right && world.y >= top && world.y <= bottom
}

/** t vom Vertex weghalten, damit ein verschobener Notch nicht exakt auf einen Eckpunkt fällt. */
const NOTCH_MOVE_T_MIN = 0.05
const NOTCH_MOVE_T_MAX = 0.95
const POINT_INSERT_HIT_MM = 15

function pointOnCurveAt(c: Curve, t: number): Point {
  if (c.type === 'line') {
    return { x: c.start.x + t * (c.end.x - c.start.x), y: c.start.y + t * (c.end.y - c.start.y) }
  }
  return bezierAt(c, t)
}

function pointAtDistanceOnRay(start: Point, current: Point, distanceMm: number): Point {
  const dx = current.x - start.x
  const dy = current.y - start.y
  const len = Math.hypot(dx, dy)
  if (len <= 1e-6) return { x: start.x + distanceMm, y: start.y }
  const s = distanceMm / len
  return { x: start.x + dx * s, y: start.y + dy * s }
}

function nearestPointForMasterPointEditing(piece: PatternPiece, local: Point, hitMm: number) {
  const seamPc = useSeamLineForPointCurveEditing(piece)
  const master = seamPc ? piece.seamLine : piece.cutLine
  if (master.length === 0) return null
  // Nahtzugabe: Maus oft auf der äußeren cutLine; Abstand zur seamLine ≈ Nahtzugabe → Trefferradius anpassen.
  const hitMaster =
    seamPc && piece.seamAllowanceMm != null ? Math.max(hitMm, piece.seamAllowanceMm + 6) : hitMm
  const hitCut =
    seamPc && piece.seamAllowanceMm != null ? Math.max(hitMm, piece.seamAllowanceMm + 6) : hitMm
  const nearestMaster = nearestCurveIndexAndPoint(local, master)
  if (nearestMaster && nearestMaster.distance <= hitMaster) return nearestMaster
  const seamMasterActive = master === piece.seamLine && piece.cutLine.length > 0
  if (!seamMasterActive) return null
  const nearestCut = nearestCurveIndexAndPoint(local, piece.cutLine)
  if (!nearestCut || nearestCut.distance > hitCut) return null
  return nearestCurveIndexAndPoint(nearestCut.point, master)
}

function snapLineTo45Deg(start: Point, current: Point): Point {
  const dx = current.x - start.x
  const dy = current.y - start.y
  const len = Math.hypot(dx, dy)
  if (len <= 1e-6) return current
  const angle = Math.atan2(dy, dx)
  const step = Math.PI / 4
  const snappedAngle = Math.round(angle / step) * step
  return {
    x: start.x + Math.cos(snappedAngle) * len,
    y: start.y + Math.sin(snappedAngle) * len,
  }
}

function worldToPieceLocal(
  world: Point,
  piece: PatternPiece
): Point {
  const { x: tx, y: ty, rotation, mirrored } = piece.transform
  const dx = world.x - tx
  const dy = world.y - ty
  const rad = (-rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  let lx = dx * cos - dy * sin
  let ly = dx * sin + dy * cos
  if (mirrored) lx = -lx
  return { x: lx, y: ly }
}

function pieceLocalToWorld(local: Point, piece: PatternPiece): Point {
  const { x: tx, y: ty, rotation, mirrored } = piece.transform
  let lx = local.x
  let ly = local.y
  if (mirrored) lx = -lx
  const rad = (rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return {
    x: tx + lx * cos - ly * sin,
    y: ty + lx * sin + ly * cos,
  }
}

/** Weltposition eines Eckpunkts auf der bearbeitbaren Kontur (immer Master-Vertices, ohne Ansichts-Projektion). */
function getVertexWorldForBatchHighlight(piece: PatternPiece, vi: number): Point | null {
  const useSeamMaster = useSeamLineForVertexEditing(piece)
  const curvesForVertices = useSeamMaster ? piece.seamLine : piece.cutLine
  if (!curvesForVertices.length || vi < 0 || vi >= curvesForVertices.length) return null
  const vertexPos = vi === 0 ? curvesForVertices[0].start : curvesForVertices[vi - 1].end
  return pieceLocalToWorld(vertexPos, piece)
}

/** Abstand Punkt → Strecke [a,b] in mm; t = Projektion auf die Strecke, auf [0,1] geklemmt. */
function distPointToSegmentMm(p: Point, a: Point, b: Point): { d: number; t: number } {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const apx = p.x - a.x
  const apy = p.y - a.y
  const lenSq = abx * abx + aby * aby
  if (lenSq < 1e-18) return { d: Math.hypot(apx, apy), t: 0 }
  let t = (apx * abx + apy * aby) / lenSq
  t = Math.max(0, Math.min(1, t))
  const cx = a.x + t * abx
  const cy = a.y + t * aby
  return { d: Math.hypot(p.x - cx, p.y - cy), t }
}

function minDistToTriangleEdgesMm(p: Point, t1: Point, t2: Point, t3: Point): number {
  return Math.min(
    distPointToSegmentMm(p, t1, t2).d,
    distPointToSegmentMm(p, t2, t3).d,
    distPointToSegmentMm(p, t3, t1).d
  )
}

/** Halbe Trefferbreite senkrecht zur Achse (mm) — schmal, folgt der Pfeilrichtung (kein AABB-Rechteck). */
const GRAIN_HIT_SHAFT_HALF_MM = 5
const GRAIN_HIT_TICK_HALF_MM = 4
const GRAIN_HIT_HEAD_MM = 4.5

/** Prüft, ob ein Punkt (Teilkoordinaten) im Klick-/Hover-Bereich des Laufrichtungspfeils liegt. */
function isPointInGrainArrowArea(local: Point, piece: PatternPiece): boolean {
  const g = getGrainArrowLayout(piece)
  if (!g) return false
  const { line, tickStart, tickEnd, endTip, baseLeft, baseRight } = g
  const shaft = distPointToSegmentMm(local, line.start, line.end)
  if (shaft.d <= GRAIN_HIT_SHAFT_HALF_MM) return true
  const tick = distPointToSegmentMm(local, tickStart, tickEnd)
  if (tick.d <= GRAIN_HIT_TICK_HALF_MM) return true
  if (isPointInPolygon(local, [endTip, baseLeft, baseRight])) return true
  if (minDistToTriangleEdgesMm(local, endTip, baseLeft, baseRight) <= GRAIN_HIT_HEAD_MM) return true
  return false
}

/** Verschiebt die Laufrichtungslinie parallel; skaliert den Vektor so, dass beide Enden in der Bounding-Box der Kontur bleiben. */
function clampGrainLineParallelTranslation(
  line: Line,
  dx: number,
  dy: number,
  b: { minX: number; maxX: number; minY: number; maxY: number }
): Line {
  const inBox = (x: number, y: number) =>
    x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY
  const ax = line.start.x + dx
  const ay = line.start.y + dy
  const bx = line.end.x + dx
  const by = line.end.y + dy
  if (inBox(ax, ay) && inBox(bx, by)) {
    return { start: { x: ax, y: ay }, end: { x: bx, y: by } }
  }
  let lo = 0
  let hi = 1
  for (let i = 0; i < 28; i++) {
    const m = (lo + hi) / 2
    const sx = line.start.x + dx * m
    const sy = line.start.y + dy * m
    const ex = line.end.x + dx * m
    const ey = line.end.y + dy * m
    if (inBox(sx, sy) && inBox(ex, ey)) lo = m
    else hi = m
  }
  const s = lo
  return {
    start: { x: line.start.x + dx * s, y: line.start.y + dy * s },
    end: { x: line.end.x + dx * s, y: line.end.y + dy * s },
  }
}

/** Kürzeste Winkel-Differenz in Grad (−180 … 180). */
function smallestAngleDiffDeg(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180
}

/** Tangentenrichtung der Schnittkontur bei (curveIndex, t) in Grad (Richtung wachsender Parameter). */
function contourTangentAngleDeg(curves: Curve[], curveIndex: number, t: number): number {
  const c = curves[curveIndex]
  if (!c) return 0
  if (c.type === 'line') {
    return (Math.atan2(c.end.y - c.start.y, c.end.x - c.start.x) * 180) / Math.PI
  }
  const d = bezierDerivativeAt(c, t)
  if (Math.hypot(d.x, d.y) < 1e-12) return 0
  return (Math.atan2(d.y, d.x) * 180) / Math.PI
}

/**
 * Laufrichtungslinie parallel zur Kontur-Tangente; wählt die der bisherigen Ausrichtung nähere der beiden
 * entgegengesetzten Richtungen (0° / 180°).
 */
function alignGrainLineToContourTangent(line: Line, tangentDeg: number): Line {
  const curDeg =
    (Math.atan2(line.end.y - line.start.y, line.end.x - line.start.x) * 180) / Math.PI
  const opt0 = tangentDeg
  const opt1 = tangentDeg + 180
  const use1 = Math.abs(smallestAngleDiffDeg(curDeg, opt1)) < Math.abs(smallestAngleDiffDeg(curDeg, opt0))
  const dirDeg = use1 ? opt1 : opt0
  const rad = (dirDeg * Math.PI) / 180
  const ux = Math.cos(rad)
  const uy = Math.sin(rad)
  const mx = (line.start.x + line.end.x) / 2
  const my = (line.start.y + line.end.y) / 2
  let L = Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y)
  if (L < 1e-6) L = 20
  const half = L / 2
  return {
    start: { x: mx - ux * half, y: my - uy * half },
    end: { x: mx + ux * half, y: my + uy * half },
  }
}

/** Streckt oder staucht die Strecke vom Mittelpunkt aus, bis beide Enden in der AABB liegen. */
function clampLineSegmentInAabb(
  line: Line,
  b: { minX: number; maxX: number; minY: number; maxY: number }
): Line {
  const inBox = (x: number, y: number) =>
    x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY
  const mx = (line.start.x + line.end.x) / 2
  const my = (line.start.y + line.end.y) / 2
  const vx = line.end.x - line.start.x
  const vy = line.end.y - line.start.y
  const L = Math.hypot(vx, vy) || 1
  const ux = vx / L
  const uy = vy / L
  const half = L / 2
  let lo = 0
  let hi = 1
  for (let i = 0; i < 28; i++) {
    const m = (lo + hi) / 2
    const h = half * m
    const s = { x: mx - ux * h, y: my - uy * h }
    const e = { x: mx + ux * h, y: my + uy * h }
    if (inBox(s.x, s.y) && inBox(e.x, e.y)) lo = m
    else hi = m
  }
  const h = half * lo
  return {
    start: { x: mx - ux * h, y: my - uy * h },
    end: { x: mx + ux * h, y: my + uy * h },
  }
}

/** Max. Abstand Maus→Kontur (mm), damit die Laufrichtung an die Kante „snappt“. */
const GRAIN_SNAP_TO_EDGE_MM = 14

/** Prüft ob ein lokaler Punkt innerhalb des sichtbaren Bereichs eines Teils liegt (inkl. Nahtzugabe)
 *  oder nah genug an der Konturlinie (cutLine/seamLine) ist. */
const CONTOUR_HIT_MM = 3
function isPointInsidePiece(local: Point, piece: PatternPiece): boolean {
  if (piece.seamLine.length >= 3 && isPointInClosedCurves(local, piece.seamLine)) return true
  if (piece.cutLine.length >= 3 && isPointInClosedCurves(local, piece.cutLine)) return true
  if (piece.cutLine.length > 0) {
    const nr = nearestCurveIndexAndPoint(local, piece.cutLine)
    if (nr && nr.distance <= CONTOUR_HIT_MM) return true
  }
  if (piece.seamLine.length > 0) {
    const nr = nearestCurveIndexAndPoint(local, piece.seamLine)
    if (nr && nr.distance <= CONTOUR_HIT_MM) return true
  }
  return false
}

/** Mittelpunkt eines Kurvensegments (Linie: Mitte; Bézier: Punkt bei t=0.5). */
function curveMidpoint(c: Curve): Point {
  if (c.type === 'line') {
    return { x: (c.start.x + c.end.x) / 2, y: (c.start.y + c.end.y) / 2 }
  }
  return bezierAt(c, 0.5)
}

/** Projektion von p auf die Strecke [a, b]; Ergebnis bleibt auf der Linie. */
function _projectOntoSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-12) return { ...a }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return { x: a.x + t * dx, y: a.y + t * dy }
}
void _projectOntoSegment

/** Snap-Distanz für Linial (mm); Eckpunkte, normale Punkte, Kurvenpunkte */
const RULER_SNAP_DISTANCE = 18

/** Nächsten Punkt (Ecke, Vertex, Kontrollpunkt) in Weltkoordinaten finden; wenn innerhalb SNAP_DISTANCE, sonst world. */
function snapRulerToNearestPoint(world: Point, pieces: PatternPiece[]): Point {
  let best = world
  let bestDistSq = RULER_SNAP_DISTANCE * RULER_SNAP_DISTANCE
  for (const piece of pieces) {
    const n = piece.cutLine.length
    for (let i = 0; i < n; i++) {
      const v = i === 0 ? piece.cutLine[0].start : piece.cutLine[i - 1].end
      const w = pieceLocalToWorld(v, piece)
      const d = (world.x - w.x) ** 2 + (world.y - w.y) ** 2
      if (d < bestDistSq) {
        bestDistSq = d
        best = w
      }
    }
    for (const c of piece.cutLine) {
      if (c.type !== 'bezier') continue
      for (const key of ['cp1', 'cp2'] as const) {
        const w = pieceLocalToWorld(c[key], piece)
        const d = (world.x - w.x) ** 2 + (world.y - w.y) ** 2
        if (d < bestDistSq) {
          bestDistSq = d
          best = w
        }
      }
    }
  }
  return best
}

const VIEWBOX_WIDTH = 800
const VIEWBOX_HEIGHT = 600

/** Treffer-/Hover-Distanz (mm) für Nahtzuordnung: Klick oder Zeiger auf Konturlinie (Kante von Punkt zu Punkt) */
const SEAM_HIT_MM = 18

/** Eckpunkt ziehen/löschen: max. Abstand Maus→Ecke (mm). Klein = Klick muss näher am Eckpunkt sitzen. */
const VERTEX_DRAG_HIT_MM = 5
/** Gleiches bei Naht als Master-Kontur (Nahtpolylinie ggf. dichter). */
const VERTEX_DRAG_HIT_SEAM_MM = 8
/** Bézier-Mitte („Kurvenpunkt“) greifen: etwas großzügiger als Ecke, damit beides unterscheidbar bleibt. */
const POINT_ON_CURVE_DRAG_HIT_MM = 10
/** Hover für Entf-Löschen / Hervorhebung Ecke – an Klick-Toleranz angeglichen. */
const VERTEX_HOVER_DELETE_MM = 5
/** Kerbe: gleiche Toleranz wie Hover zum Verschieben/Löschen. */
const PIVOT_SNAP_NOTCH_MM = 6

type DeletableHoverTarget =
  | { pieceId: string; kind: 'vertex'; vertexIndex: number }
  | { pieceId: string; kind: 'pointOnCurve'; curveIndex: number }

/**
 * Gleiche Priorität wie Pointer-Down (select/point/curvepoint): bei gleichem Abstand gewinnt
 * der Kurvenpunkt (Bézier-Mitte) vor der Ecke, damit Entf/Löschen dieselbe geometrische
 * Stelle trifft wie Ziehen/Klicken.
 */
function mergeDeletableHoverVertexVsCurve(
  bestVertex: { dist: number; value: DeletableHoverTarget | null },
  bestCurve: { dist: number; value: DeletableHoverTarget | null }
): { dist: number; value: DeletableHoverTarget | null } {
  if (bestCurve.value == null && bestVertex.value == null) {
    return { dist: VERTEX_HOVER_DELETE_MM + 1, value: null }
  }
  if (bestCurve.value == null) return bestVertex
  if (bestVertex.value == null) return bestCurve
  if (bestCurve.dist <= bestVertex.dist) return bestCurve
  return bestVertex
}

/**
 * Nächstgelegene Kerbe, Ecke oder Bézier-Mitte unter dem Mauszeiger (Drehpunkt für Alt+D).
 * Entspricht der Hover-Logik für „Punkte anzeigen“, ohne dass diese Option aktiv sein muss.
 */
function findPivotSnapTargetAtWorld(world: Point, pieces: PatternPiece[]): { pieceId: string; pivotLocal: Point } | null {
  const HOVER_DELETE_HIT = VERTEX_HOVER_DELETE_MM
  const NOTCH_HOVER_HIT = PIVOT_SNAP_NOTCH_MM

  let bestVertexOnly: { dist: number; value: DeletableHoverTarget | null } = {
    dist: VERTEX_HOVER_DELETE_MM + 1,
    value: null,
  }
  let bestCurveOnly: { dist: number; value: DeletableHoverTarget | null } = {
    dist: VERTEX_HOVER_DELETE_MM + 1,
    value: null,
  }

  for (const p of pieces) {
    if (!p || p.cutLine.length === 0) continue
    const local = worldToPieceLocal(world, p)
    const useSeamMaster = useSeamLineForVertexEditing(p)
    const curvesForHover = useSeamMaster ? p.seamLine : p.cutLine
    for (let vi = 0; vi < curvesForHover.length; vi++) {
      if (curvesForHover.length <= 3) continue
      const vertexPos = vi === 0 ? curvesForHover[0].start : curvesForHover[vi - 1].end
      const d = Math.hypot(local.x - vertexPos.x, local.y - vertexPos.y)
      if (d < bestVertexOnly.dist)
        bestVertexOnly = { dist: d, value: { pieceId: p.id, kind: 'vertex', vertexIndex: vi } }
    }
    const curvesPcHover = useSeamLineForPointCurveEditing(p) ? p.seamLine : p.cutLine
    for (let ci = 0; ci < curvesPcHover.length; ci++) {
      const c = curvesPcHover[ci]
      if (c.type !== 'bezier') continue
      const pt = bezierAt(c, 0.5)
      const d = Math.hypot(local.x - pt.x, local.y - pt.y)
      if (d < bestCurveOnly.dist)
        bestCurveOnly = { dist: d, value: { pieceId: p.id, kind: 'pointOnCurve', curveIndex: ci } }
    }
  }

  const bestVertex = mergeDeletableHoverVertexVsCurve(bestVertexOnly, bestCurveOnly)

  let bestNotch: { dist: number; pieceId: string; notchId: string } = {
    dist: NOTCH_HOVER_HIT + 1,
    pieceId: '',
    notchId: '',
  }
  for (const p of pieces) {
    const local = worldToPieceLocal(world, p)
    for (const notch of p.notches) {
      const depth = notch.depth
      const width = notch.width ?? 6
      const cutPos = getNotchPositionAndAngleOnCutLine(notch, p.cutLine, p.seamLine)
      const cutParam = getNotchCurveIndexAndT(notch, p.cutLine, p.seamLine)
      const cutPts = notchCutoutPoints(cutPos.position, cutPos.angle, depth, width, p.cutLine, cutParam, notch.type)
      let d = bestNotch.dist + 1
      if (cutPts) {
        d = distanceToNotchCutoutGeom(local, cutPts, cutPos.position)
      } else {
        const { position } = getNotchPositionAndAngle(notch, p.cutLine, p.seamLine)
        d = Math.hypot(local.x - position.x, local.y - position.y)
      }
      if (d < bestNotch.dist) bestNotch = { dist: d, pieceId: p.id, notchId: notch.id }
      if (p.seamLine.length >= 3) {
        const seamPos = getNotchPositionAndAngleOnSeamLine(notch, p.cutLine, p.seamLine)
        if (seamPos) {
          const seamPts = notchCutoutPoints(seamPos.position, seamPos.angle, depth, width, p.seamLine, undefined, notch.type)
          if (seamPts) {
            const dSeam = distanceToNotchCutoutGeom(local, seamPts, seamPos.position)
            if (dSeam < bestNotch.dist) bestNotch = { dist: dSeam, pieceId: p.id, notchId: notch.id }
          } else {
            const dSeam = Math.hypot(local.x - seamPos.position.x, local.y - seamPos.position.y)
            if (dSeam < bestNotch.dist) bestNotch = { dist: dSeam, pieceId: p.id, notchId: notch.id }
          }
        }
      }
    }
  }

  const vertexInRange = bestVertex.value != null && bestVertex.dist <= HOVER_DELETE_HIT
  const notchInRange = bestNotch.dist <= NOTCH_HOVER_HIT

  let pickNotch: boolean
  if (vertexInRange && notchInRange) pickNotch = bestNotch.dist < bestVertex.dist
  else if (notchInRange) pickNotch = true
  else if (vertexInRange) pickNotch = false
  else return null

  if (pickNotch) {
    const piece = pieces.find((x) => x.id === bestNotch.pieceId)
    const notch = piece?.notches.find((n) => n.id === bestNotch.notchId)
    if (!piece || !notch) return null
    const { position } = getNotchPositionAndAngle(notch, piece.cutLine, piece.seamLine)
    return { pieceId: piece.id, pivotLocal: { ...position } }
  }

  const v = bestVertex.value!
  const piece = pieces.find((x) => x.id === v.pieceId)
  if (!piece) return null
  if (v.kind === 'vertex' && v.vertexIndex != null) {
    const p = getMasterContourVertexLocal(piece, v.vertexIndex)
    if (!p) return null
    return { pieceId: piece.id, pivotLocal: p }
  }
  if (v.kind === 'pointOnCurve' && v.curveIndex != null) {
    const curvesPv = useSeamLineForPointCurveEditing(piece) ? piece.seamLine : piece.cutLine
    const c = curvesPv[v.curveIndex]
    if (c?.type !== 'bezier') return null
    return { pieceId: piece.id, pivotLocal: bezierAt(c, 0.5) }
  }
  return null
}

/** Prüft ob ein Klick auf der Innenseite der Kante liegt (Richtung Stück-Inneres).
 *  Nur Klicks von der Innenseite werden für die Nahtzuordnung akzeptiert. */
function isClickOnInnerSideOfEdge(
  local: Point,
  nearest: { point: Point; curveIndex: number; t?: number },
  cutLine: Curve[]
): boolean {
  const dx = local.x - nearest.point.x
  const dy = local.y - nearest.point.y
  if (Math.hypot(dx, dy) < 0.01) return true // direkt auf der Linie → akzeptieren
  const angleDeg = outwardNormalAngleAt(cutLine, nearest.curveIndex, nearest.t ?? 0.5)
  const rad = (angleDeg * Math.PI) / 180
  const ox = Math.cos(rad)
  const oy = Math.sin(rad)
  const dot = dx * ox + dy * oy
  return dot <= 0 // Innenseite = entgegen der Außennormale
}

/** Eckpunkte (rot), eingefügte Punkte (blau), Kurvenpunkte (grün) */
const COLOR_ECKPUNKT: [string, string] = ['#ef5350', '#b71c1c']
const COLOR_SOFT_PUNKT: [string, string] = ['#42a5f5', '#1565c0']
/** Punkt auf der Kurve (ziehen = Kurve glatt verschieben, keine Ecke) */
const COLOR_PUNKT_AUF_KURVE: [string, string] = ['#66bb6a', '#2e7d32']

/** Farbe für Notch-Kerben – gleiche Farbe wie die Außenkontur. */
const NOTCH_STROKE = '#000'

/** Distanz in mm entlang des Segments von t bis zum nächsten Eckpunkt oder nächsten Notch (falls auf diesem Segment). Immer entlang der Kurve (Bogenlänge). */
function distanceToNextVertexOrNotch(
  curve: Curve,
  t: number,
  notchesOnSegment: number[]
): number {
  const notchesAhead = notchesOnSegment.filter((tN) => tN > t && tN <= 1)
  const endT = notchesAhead.length > 0 ? Math.min(...notchesAhead) : 1
  return curveSegmentArcLength(curve, Math.max(0, t), Math.min(1, endT))
}

/** Distanz in mm entlang des Segments vom vorherigen Eckpunkt bzw. letzten Notch bis t. Immer entlang der Kurve (Bogenlänge). */
function distanceToPrevVertexOrNotch(
  curve: Curve,
  t: number,
  notchesOnSegment: number[]
): number {
  const notchesBehind = notchesOnSegment.filter((tN) => tN >= 0 && tN < t)
  const startT = notchesBehind.length > 0 ? Math.max(...notchesBehind) : 0
  return curveSegmentArcLength(curve, Math.max(0, startT), Math.min(1, t))
}

/** Client-Koordinaten → Weltkoordinaten (wie im transformierten <g>). */
function getScreenPoint(
  clientX: number,
  clientY: number,
  container: HTMLElement,
  view: { zoom: number; panX: number; panY: number },
  svgEl: SVGElement | null
): Point {
  const rect = container.getBoundingClientRect()
  let svgUserX: number
  let svgUserY: number
  if (svgEl) {
    const svgRect = svgEl.getBoundingClientRect()
    const scale = Math.min(svgRect.width / VIEWBOX_WIDTH, svgRect.height / VIEWBOX_HEIGHT)
    const offsetX = (svgRect.width - VIEWBOX_WIDTH * scale) / 2
    const offsetY = (svgRect.height - VIEWBOX_HEIGHT * scale) / 2
    svgUserX = (clientX - svgRect.left - offsetX) / scale
    svgUserY = (clientY - svgRect.top - offsetY) / scale
  } else {
    svgUserX = clientX - rect.left
    svgUserY = clientY - rect.top
  }
  const x = (svgUserX - view.panX) / view.zoom
  const y = (svgUserY - view.panY) / view.zoom
  return { x, y }
}

/** Weltkoordinaten (mm) → Browser-Client (px), invers zu getScreenPoint. */
function worldToClientPoint(
  world: Point,
  container: HTMLElement,
  view: { zoom: number; panX: number; panY: number },
  svgEl: SVGElement | null
): { x: number; y: number } {
  const svgUserX = world.x * view.zoom + view.panX
  const svgUserY = world.y * view.zoom + view.panY
  if (svgEl) {
    const svgRect = svgEl.getBoundingClientRect()
    const scale = Math.min(svgRect.width / VIEWBOX_WIDTH, svgRect.height / VIEWBOX_HEIGHT)
    const offsetX = (svgRect.width - VIEWBOX_WIDTH * scale) / 2
    const offsetY = (svgRect.height - VIEWBOX_HEIGHT * scale) / 2
    return {
      x: svgRect.left + offsetX + svgUserX * scale,
      y: svgRect.top + offsetY + svgUserY * scale,
    }
  }
  const rect = container.getBoundingClientRect()
  return { x: rect.left + svgUserX, y: rect.top + svgUserY }
}

function PieceGroup({
  piece,
  isSelected,
  isHovered,
  hoveredSegmentCurveIndex,
  hoveredSegmentOnSeam = false,
  onPointerDown,
  onGrainArrowEnter,
  onGrainArrowLeave,
  onGrainArrowMove,
  onGrainArrowClick,
  notchIdBeingDragged,
  hoveredNotchId,
  cutSeamSwapped,
  showGrain,
  showNotches,
  showDrills,
  showInternalLines,
  showPieceNames,
  showPoints,
  showContourMeasurements,
  hoveredInternalLineCurveIndex,
  onContextMenu,
  viewZoom,
}: {
  piece: PatternPiece
  isSelected: boolean
  isHovered: boolean
  hoveredSegmentCurveIndex: number | null
  /** Kurvenpunkt-Werkzeug: Segment-Index bezieht sich auf Naht statt Schnittkontur */
  hoveredSegmentOnSeam?: boolean
  onPointerDown: (e: React.PointerEvent) => void
  onGrainArrowEnter?: (e: React.PointerEvent) => void
  onGrainArrowLeave?: () => void
  onGrainArrowMove?: (e: React.PointerEvent) => void
  onGrainArrowClick?: (e: React.MouseEvent) => void
  notchIdBeingDragged?: string | null
  hoveredNotchId?: string | null
  cutSeamSwapped?: boolean
  showGrain?: boolean
  showNotches?: boolean
  showDrills?: boolean
  showInternalLines?: boolean
  showPieceNames?: boolean
  showPoints?: boolean
  showContourMeasurements?: boolean
  hoveredInternalLineCurveIndex?: number | null
  onContextMenu?: (e: React.MouseEvent) => void
  /** view.zoom – für Punkt-Marker, die auf dem Bildschirm gleich groß bleiben sollen */
  viewZoom: number
}) {
  const { cutLine, seamLine, notches, drills, internalLines, transform } = piece
  const ptPs = 1 / Math.max(viewZoom, 1e-6)
  const tx = `translate(${transform.x},${transform.y}) rotate(${transform.rotation}) scale(${transform.mirrored ? -1 : 1},1)`
  const notchesForCutouts = notchIdBeingDragged ? notches.filter((n) => n.id !== notchIdBeingDragged) : notches
  const mergedCutLine = cutLineWithNotchCutouts(cutLine, notchesForCutouts, seamLine)
  const cutPath = closedPathD(mergedCutLine)
  const mergedSeamLine = seamLineWithNotchCutouts(cutLine, notchesForCutouts, seamLine)
  const seamPath = closedPathD(mergedSeamLine)
  const fillHellgelb = '#fef9c3'
  const useInteriorFill = piece.fillInterior !== false
  const interiorFill = useInteriorFill ? fillHellgelb : 'none'
  const interiorFillOpacity = useInteriorFill ? 0.82 : undefined
  const hasSeam = !!(seamPath && seamLine.length >= 3)
  const solidIsCut = !hasSeam || !!cutSeamSwapped
  const solidPath = solidIsCut ? cutPath : seamPath
  const dashedPath = solidIsCut ? seamPath : cutPath

  return (
    <g
      transform={tx}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
    >
      {hasSeam && dashedPath && (
        <path
          d={dashedPath}
          fill={interiorFill}
          fillOpacity={interiorFillOpacity}
          stroke="#888"
          strokeWidth={0.5}
          pointerEvents="none"
        />
      )}
      {solidPath && (
        <path
          d={solidPath}
          fill={interiorFill}
          fillOpacity={interiorFillOpacity}
          stroke={isHovered ? '#e53935' : '#000'}
          strokeWidth={isHovered ? 0.8 : 0.5}
          pointerEvents="none"
        />
      )}
      {hoveredSegmentCurveIndex != null &&
        (hoveredSegmentOnSeam ? seamLine[hoveredSegmentCurveIndex] : cutLine[hoveredSegmentCurveIndex]) && (
        <path
          d={curveToPathD([
            (hoveredSegmentOnSeam ? seamLine : cutLine)[hoveredSegmentCurveIndex],
          ])}
          fill="none"
          stroke="#1565c0"
          strokeWidth={1.8}
          strokeLinecap="round"
          opacity={0.95}
          pointerEvents="none"
        />
      )}
      {cutLine.length === 0 && (
        <circle
          cx={0}
          cy={0}
          r={2.2 * ptPs}
          fill="none"
          stroke="#ccc"
          strokeWidth={0.55 * ptPs}
          pointerEvents="none"
        />
      )}
      {showInternalLines !== false && internalLines.map((curve, i) => {
        const isHovered = hoveredInternalLineCurveIndex === i
        return (
          <path
            key={`internal-${i}`}
            d={curveToPathD([curve])}
            fill="none"
            stroke={isHovered ? '#e53935' : '#1565c0'}
            strokeWidth={isHovered ? 1.2 : 0.6}
            strokeDasharray="4 3"
            pointerEvents="none"
          />
        )
      })}
      {showNotches !== false && notches.map((n) => {
        if (notchIdBeingDragged === n.id) return null
        const depth = n.depth
        const width = n.width ?? 6
        const cutPos = getNotchPositionAndAngleOnCutLine(n, cutLine, seamLine)
        const cutParam = getNotchCurveIndexAndT(n, cutLine, seamLine)
        const cutPts = notchCutoutPoints(cutPos.position, cutPos.angle, depth, width, cutLine, cutParam, n.type)
        if (!cutPts) return null
        const { fillD: cutFillD, edgesD: cutEdgesD } = notchCutoutSvgPaths(cutPts)
        const cutIsLine = cutPts.kind === 'line'
        const seamPos = getNotchPositionAndAngleOnSeamLine(n, cutLine, seamLine)
        let seamFillD: string | null = null
        let seamEdgesD: string | null = null
        if (seamPos && seamLine.length > 0) {
          const seamPts = notchCutoutPoints(seamPos.position, seamPos.angle, depth, width, seamLine, undefined, n.type)
          if (seamPts) {
            const seamPaths = notchCutoutSvgPaths(seamPts)
            seamFillD = seamPaths.fillD || null
            seamEdgesD = seamPaths.edgesD
          }
        }
        const isHovered = hoveredNotchId === n.id
        const stroke = isHovered ? '#1565c0' : NOTCH_STROKE
        const strokeW = isHovered ? 0.7 : 0.4
        const circleR = isHovered ? 1 : 0.8
        return (
          <g key={n.id} pointerEvents="none">
            {cutFillD ? <path d={cutFillD} fill="#fff" stroke="none" /> : null}
            <path
              d={cutEdgesD}
              fill="none"
              stroke={stroke}
              strokeWidth={cutIsLine ? Math.max(strokeW, 0.55) : strokeW}
              strokeLinejoin="round"
              strokeLinecap={cutIsLine ? 'round' : 'butt'}
            />
            <circle
              cx={cutPos.position.x}
              cy={cutPos.position.y}
              r={circleR}
              fill="none"
              stroke={stroke}
              strokeWidth={isHovered ? 0.5 : 0.3}
            />
            {seamFillD ? <path d={seamFillD} fill="#fff" stroke="none" /> : null}
            {seamEdgesD ? (
              <path
                d={seamEdgesD}
                fill="none"
                stroke={stroke}
                strokeWidth={cutIsLine ? Math.max(strokeW, 0.55) : strokeW}
                strokeLinejoin="round"
                strokeLinecap={cutIsLine ? 'round' : 'butt'}
              />
            ) : null}
          </g>
        )
      })}
      {showDrills !== false && drills.map((d) => (
        <circle
          key={d.id}
          cx={d.center.x}
          cy={d.center.y}
          r={d.radius}
          fill="none"
          stroke="#000"
          strokeWidth={0.5}
          pointerEvents="none"
        />
      ))}
      {showGrain !== false && cutLine.length >= 3 && (() => {
        const g = getGrainArrowLayout(piece)
        if (!g) return null
        const { line, tickStart, tickEnd, triangleD } = g
        const midX = (line.start.x + line.end.x) / 2
        const midY = (line.start.y + line.end.y) / 2
        const angle = Math.atan2(line.end.y - line.start.y, line.end.x - line.start.x)
        const hasGrainHandlers =
          onGrainArrowEnter != null &&
          onGrainArrowLeave != null &&
          onGrainArrowMove != null &&
          onGrainArrowClick != null
        return (
          <>
            <g
              pointerEvents={hasGrainHandlers ? 'all' : 'none'}
              onPointerEnter={onGrainArrowEnter}
              onPointerLeave={onGrainArrowLeave}
              onPointerMove={onGrainArrowMove}
              onClick={(e) => {
                e.stopPropagation()
                onGrainArrowClick?.(e)
              }}
              style={hasGrainHandlers ? { cursor: isSelected ? 'grab' : 'pointer' } : undefined}
            >
              <line
                x1={line.start.x}
                y1={line.start.y}
                x2={line.end.x}
                y2={line.end.y}
                stroke="#333"
                strokeWidth={0.35}
                strokeDasharray="5 3"
                pointerEvents="none"
              />
              <line
                x1={tickStart.x}
                y1={tickStart.y}
                x2={tickEnd.x}
                y2={tickEnd.y}
                stroke="#333"
                strokeWidth={0.35}
                pointerEvents="none"
              />
              <path
                d={triangleD}
                fill="none"
                stroke="#333"
                strokeWidth={0.35}
                pointerEvents="none"
              />
              {hasGrainHandlers && (
                <>
                  {/* Trefferzonen entlang der Pfeilachse (kein achsparalleles Rechteck bei schrägem Pfeil). */}
                  <line
                    x1={line.start.x}
                    y1={line.start.y}
                    x2={line.end.x}
                    y2={line.end.y}
                    stroke="transparent"
                    strokeWidth={2 * GRAIN_HIT_SHAFT_HALF_MM}
                    pointerEvents="stroke"
                  />
                  <line
                    x1={tickStart.x}
                    y1={tickStart.y}
                    x2={tickEnd.x}
                    y2={tickEnd.y}
                    stroke="transparent"
                    strokeWidth={2 * GRAIN_HIT_TICK_HALF_MM}
                    pointerEvents="stroke"
                  />
                  <path
                    d={triangleD}
                    fill="rgba(0,0,0,0)"
                    stroke="rgba(0,0,0,0)"
                    strokeWidth={2 * GRAIN_HIT_HEAD_MM}
                    strokeLinejoin="miter"
                    pointerEvents="all"
                  />
                </>
              )}
            </g>
            {showPoints && (
              <>
                <circle
                  cx={line.start.x}
                  cy={line.start.y}
                  r={4.2 * ptPs}
                  fill="#1565c0"
                  stroke="#fff"
                  strokeWidth={1 * ptPs}
                  pointerEvents="none"
                />
                <circle
                  cx={line.end.x}
                  cy={line.end.y}
                  r={4.2 * ptPs}
                  fill="#1565c0"
                  stroke="#fff"
                  strokeWidth={1 * ptPs}
                  pointerEvents="none"
                />
              </>
            )}
            {showPieceNames !== false && (() => {
              // Text parallel zur Laufrichtungslinie (wie auf der Linie geschrieben); leicht seitlich versetzt, damit er die Striche nicht überdeckt.
              const perpX = -Math.sin(angle)
              const perpY = Math.cos(angle)
              const offMm = 3.5
              const tx = midX + perpX * offMm
              const ty = midY + perpY * offMm
              let rotDeg = (angle * 180) / Math.PI
              if (Math.cos(angle) < 0) rotDeg += 180
              return (
                <text
                  x={tx}
                  y={ty}
                  transform={`rotate(${rotDeg}, ${tx}, ${ty})`}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#333"
                  fontSize={3.8}
                  fontFamily="sans-serif"
                  fontWeight="600"
                  pointerEvents="none"
                >
                  {piece.name}
                </text>
              )
            })()}
          </>
        )
      })()}
      {showContourMeasurements !== false && cutLine.length >= 3 && (() => {
        const meas = getCutLineContourMeasurements(piece)
        if (meas.length === 0) return null
        return (
          <g pointerEvents="none" style={{ pointerEvents: 'none' }}>
            {meas.map((m, idx) => {
              const rad = (m.tangentDeg * Math.PI) / 180
              let rotDeg = m.tangentDeg
              if (Math.cos(rad) < 0) rotDeg += 180
              const perpX = -Math.sin(rad)
              const perpY = Math.cos(rad)
              const offMm = 4.5
              const tx = m.midpoint.x + perpX * offMm
              const ty = m.midpoint.y + perpY * offMm
              const n = m.lengthMm
              const label = n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)
              return (
                <text
                  key={`cm-${piece.id}-${idx}`}
                  x={tx}
                  y={ty}
                  transform={`rotate(${rotDeg}, ${tx}, ${ty})`}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={3.4}
                  fontFamily="sans-serif"
                  fontWeight={600}
                  fill="#5d4037"
                  stroke="#fff"
                  strokeWidth={0.22}
                  paintOrder="stroke fill"
                  pointerEvents="none"
                  style={{ pointerEvents: 'none' }}
                >
                  {label} mm
                </text>
              )
            })}
          </g>
        )
      })()}
      {showContourMeasurements !== false && piece.edgeSeamAllowances && piece.edgeSeamAllowances.length > 0 && piece.seamLine.length >= 3 && (() => {
        const edges = enumerateEdges(piece)
        const masterCurves = piece.seamLine
        const overrideMap = new Map<number, number>()
        for (const o of piece.edgeSeamAllowances) overrideMap.set(o.edgeIndex, o.allowanceMm)
        return (
          <g pointerEvents="none" style={{ pointerEvents: 'none' }}>
            {edges.map((edge) => {
              const mm = overrideMap.get(edge.edgeIndex)
              if (mm == null) return null
              const cis = edge.curveIndices
              if (cis.length === 0) return null
              const midIdx = cis[Math.floor(cis.length / 2)]
              const seg = masterCurves[midIdx]
              if (!seg) return null
              const mx = (seg.start.x + seg.end.x) / 2
              const my = (seg.start.y + seg.end.y) / 2
              const dx = seg.end.x - seg.start.x
              const dy = seg.end.y - seg.start.y
              const len = Math.hypot(dx, dy) || 1
              const offMm = 7
              const nx = -dy / len * offMm
              const ny = dx / len * offMm
              return (
                <text
                  key={`esa-${piece.id}-${edge.edgeIndex}`}
                  x={mx + nx}
                  y={my + ny}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={3}
                  fontFamily="sans-serif"
                  fontWeight={700}
                  fill="#1a6fb5"
                  stroke="#fff"
                  strokeWidth={0.2}
                  paintOrder="stroke fill"
                  pointerEvents="none"
                  style={{ pointerEvents: 'none' }}
                >
                  {mm} mm
                </text>
              )
            })}
          </g>
        )
      })()}
      {isSelected && (
        <rect
          x={-2}
          y={-2}
          width={4}
          height={4}
          fill="none"
          stroke="#000"
          strokeWidth={0.5}
          strokeDasharray="2 2"
          pointerEvents="none"
        />
      )}
      {isSelected && cutLine.length >= 3 && (() => {
        const pivot = getPiecePivotLocal(piece)
        const handleY = pivot.y - 25
        return (
          <>
            <g style={{ cursor: 'grab' }} pointerEvents="all">
              <title>Drehpunkt: ziehen, Doppelklick zurücksetzen · Alt+D auf Ecke, Kerbe oder Bézier-Mitte (ohne „Punkte anzeigen“)</title>
              <circle cx={pivot.x} cy={pivot.y} r={16 * ptPs} fill="transparent" />
              <circle
                cx={pivot.x}
                cy={pivot.y}
                r={4.2 * ptPs}
                fill="#333"
                stroke="#fff"
                strokeWidth={1 * ptPs}
                pointerEvents="none"
              />
              <line
                x1={pivot.x - 6 * ptPs}
                y1={pivot.y}
                x2={pivot.x + 6 * ptPs}
                y2={pivot.y}
                stroke="#333"
                strokeWidth={0.8 * ptPs}
                pointerEvents="none"
              />
              <line
                x1={pivot.x}
                y1={pivot.y - 6 * ptPs}
                x2={pivot.x}
                y2={pivot.y + 6 * ptPs}
                stroke="#333"
                strokeWidth={0.8 * ptPs}
                pointerEvents="none"
              />
            </g>
            <g style={{ cursor: 'grab' }}>
              <title>Drehgriff: Ziehen zum Drehen des Teils</title>
              <circle
                cx={pivot.x}
                cy={handleY}
                r={10 * ptPs}
                fill="#e3f2fd"
                stroke="#1565c0"
                strokeWidth={1.2 * ptPs}
              />
              <path
                d={`M ${pivot.x + 5 * ptPs} ${handleY} A ${5 * ptPs} ${5 * ptPs} 0 0 1 ${pivot.x - 5 * ptPs} ${handleY}`}
                fill="none"
                stroke="#1565c0"
                strokeWidth={1.1 * ptPs}
                strokeLinecap="round"
              />
              <path
                d={`M ${pivot.x - 5 * ptPs} ${handleY} L ${pivot.x - 6 * ptPs} ${handleY + 1.2 * ptPs} L ${pivot.x - 4.2 * ptPs} ${handleY + 0.4 * ptPs} Z`}
                fill="#1565c0"
              />
            </g>
          </>
        )
      })()}
    </g>
  )
}

export function WorkspaceCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const {
    workspace,
    selectedPieceIds,
    tool,
    showGrid,
    showPoints,
    showGrain,
    showNotches,
    showDrills,
    showInternalLines,
    showPieceNames,
    showContourMeasurements,
    showWorkspaceNotes,
    rulerMode,
    rulerLine,
    setView,
    setRulerLine,
    pendingNahtzugabeClick,
    setPendingNahtzugabeClick,
    setNahtzugabeDialogPieceId,
    edgeSeamPickingActive,
    setEdgeSeamPickingActive,
    nahtzuordnungMode,
    setNahtzuordnungMode,
    pendingNahtzuordnungFirst,
    setPendingNahtzuordnungFirst,
    addSeamAssignment,
    removeSeamAssignment,
    selectPiece,
    movePiece,
    addCurveToCutLine,
    addInternalLine,
    addInternalLines,
    updatePiece,
    removeInternalLine,
    offsetSegment,
    addNotch,
    removeNotch,
    removeNotchAnchor: _removeNotchAnchor,
    toggleNotchAnchor,
    updateNotch,
    addDrill,
    addPiece,
    setTool,
    insertPointOnCutLine,
    updateVertex,
    replaceSegmentWithBezier,
    movePointOnCurve,
    removeVertex,
    convertBezierSegmentToLine,
    setVertexSoft,
    flipPieceAlongGrain,
    rotatePiece90,
    setPieceRotation,
    setPiecePivot,
    setGrainLine,
    alignPieceToGrain,
    toastMessage,
    setToastMessage,
    checkSeamAdjustment,
    snapSeamEdgeToMatch,
    recomputeSeamLine,
    digitizeState,
    addDigitizeNode,
    updateDigitizeDrag,
    finishDigitizeDrag,
    cancelDigitize,
    finishDigitize,
    startDigitize,
    imageDigitizeSession,
    workspaceImageSelected,
    setWorkspaceImageSelected,
    setImageRenderMmPerPixel,
    cancelImageSession,
    setImagePosition,
    setShowHelpModal,
    deletePiece,
    setPiecePropertiesDialogPieceId,
    setEdgeSeamAllowance,
    setWorkspaceImageLocked,
    exitAllModes,
    notchSettings,
    activeNotchPresetIndex,
    setMassstabDialog,
    setSeamAssignmentMetaDialogId,
    seamAssignmentMetaDialogId,
    batchSelectionFilter,
    batchSelectionTargets,
    batchUiHighlightByTargetId,
    setBatchSelectionFilter,
    setBatchSelectionTargets,
    clearBatchSelection,
    setBatchUiHighlightForFiltered,
    clearBatchUiHighlight,
    batchSetVerticesSoft,
    batchDeleteFiltered,
    addWorkspaceNote,
    updateWorkspaceNote,
    removeWorkspaceNote,
    addProfileAssignment,
    setProfileDialogAssignmentId,
  } = useStore()
  const { pieces, view, notes: workspaceNotesList } = workspace
  const seamAssignments = workspace.seamAssignments ?? []
  const profileAssignments = workspace.profileAssignments ?? []
  const [grainFlipHover, setGrainFlipHover] = useState<{
    pieceId: string
    clientX: number
    clientY: number
  } | null>(null)
  const [grainContextMenu, setGrainContextMenu] = useState<{
    pieceId: string
    clientX: number
    clientY: number
  } | null>(null)
  const [pieceContextMenu, setPieceContextMenu] = useState<{
    pieceId: string
    clientX: number
    clientY: number
  } | null>(null)
  const [dragging, setDragging] = useState<
    | { kind: 'pan'; startClient: Point; startPan: Point }
    | { kind: 'piece'; pieceId: string; start: Point }
    | { kind: 'rotate'; pieceId: string; startRotation: number; startWorldAngle: number }
    | { kind: 'pivot'; pieceId: string }
    | { kind: 'grainPoint'; pieceId: string; which: 'start' | 'end' }
    /** Ganzen Laufrichtungspfeil parallel verschieben (Schaft/Pfeil, nicht Endpunkte einzeln). */
    | { kind: 'grainLine'; pieceId: string; startLocal: Point; lineAtPointerDown: Line }
    | {
        kind: 'vertex'
        pieceId: string
        vertexIndex: number
        startLocal: Point
        seamDrag?: { startLocal: Point; cutVertexIndex: number }
        /** Nahtzugabe + Seam-Master: Kerben während Ziehen nicht pro Frame auf Cut projizieren. */
        notchStabilize?: { notches: PatternPiece['notches']; cutLine: Curve[]; seamLine: Curve[] }
      }
    | { kind: 'controlpoint'; pieceId: string; curveIndex: number; pointKey: 'cp1' | 'cp2'; seamDrag?: { startLocal: Point; cutCurveIndex: number; cutPointKey: 'cp1' | 'cp2' } }
    | { kind: 'pointOnCurve'; pieceId: string; curveIndex: number; t: number; seamDrag?: { startLocal: Point; cutCurveIndex: number; cutT: number } }
    | { kind: 'rectangle'; start: Point; current: Point }
    /** Fensterauswahl im Select-Tool (leerer Bereich). */
    | { kind: 'selectionMarquee'; start: Point; current: Point }
    | { kind: 'line'; pieceId: string; start: Point; current: Point }
    | { kind: 'notch'; pieceId: string; position: Point; current: Point; curveIndex: number; t: number; useSeamLine?: boolean }
    | { kind: 'notchMove'; pieceId: string; notchId: string }
    | { kind: 'drill'; pieceId: string; center: Point; current: Point }
    | { kind: 'internalCircle'; pieceId: string; center: Point; current: Point }
    | { kind: 'ruler'; start: Point; current: Point }
    | { kind: 'image-move'; startWorld: Point; startImagePos: Point }
    | {
        kind: 'image-resize'
        center: Point
        ux: number
        uy: number
        d0: number
        render0: number
      }
    | { kind: 'digitizeDrag' }
    | { kind: 'workspaceNote'; noteId: string; pieceId: string }
    | null
  >(null)
  const [workspaceNoteEditor, setWorkspaceNoteEditor] = useState<{
    noteId: string
    clientX: number
    clientY: number
  } | null>(null)
  const workspaceNoteEditorRef = useRef<HTMLDivElement | null>(null)
  const [hoveredPieceId, setHoveredPieceId] = useState<string | null>(null)
  const [cutSeamSwappedSet, setCutSeamSwappedSet] = useState<Set<string>>(new Set())
  const filteredBatchTargets = useMemo(
    () => filterBatchTargets(batchSelectionTargets, batchSelectionFilter, pieces),
    [batchSelectionTargets, batchSelectionFilter, pieces]
  )
  const [hoveredDeletablePoint, setHoveredDeletablePoint] = useState<
    | { pieceId: string; kind: 'vertex'; vertexIndex: number }
    | { pieceId: string; kind: 'pointOnCurve'; curveIndex: number }
    | null
  >(null)
  const [hoveredDeletableNotch, setHoveredDeletableNotch] = useState<{ pieceId: string; notchId: string } | null>(null)
  /** Kerbe bearbeiten (Typ/Breite/Tiefe); unabhängig vom Hover, damit das Panel bedienbar bleibt. */
  const [notchEditTarget, setNotchEditTarget] = useState<{ pieceId: string; notchId: string } | null>(null)
  const [notchPreview, setNotchPreview] = useState<{
    pieceId: string
    position: Point
    angle: number
    curveIndex: number
    t: number
    distanceMmLeft: number
    distanceMmRight: number
    storePos: Point
    storeAngle: number
  } | null>(null)
  const [pointPreview, setPointPreview] = useState<{ pieceId: string; point: Point } | null>(null)
  const [hoveredSegment, setHoveredSegment] = useState<{ pieceId: string; curveIndex: number } | null>(null)
  const [hoveredSegmentPos, setHoveredSegmentPos] = useState<{ clientX: number; clientY: number } | null>(null)
  const [segmentMenuMm, setSegmentMenuMm] = useState('5')
  const [segmentMenuPinned, setSegmentMenuPinned] = useState(false)
  const [pinnedSegment, setPinnedSegment] = useState<{ pieceId: string; curveIndex: number } | null>(null)
  const [pinnedSegmentPos, setPinnedSegmentPos] = useState<{ clientX: number; clientY: number } | null>(null)
  const [pointerOverSegmentMenu, setPointerOverSegmentMenu] = useState(false)
  const [frozenSegment, setFrozenSegment] = useState<{ pieceId: string; curveIndex: number } | null>(null)
  const [frozenSegmentPos, setFrozenSegmentPos] = useState<{ clientX: number; clientY: number } | null>(null)
  const lastSegmentRef = useRef<{ pieceId: string; curveIndex: number } | null>(null)
  const lastSegmentPosRef = useRef<{ clientX: number; clientY: number } | null>(null)
  const [hoveredSeamForNahtzuordnung, setHoveredSeamForNahtzuordnung] = useState<{
    pieceId: string
    curveIndices: number[]
  } | null>(null)
  const [hoveredSeamAssignmentId, setHoveredSeamAssignmentId] = useState<string | null>(null)
  const [hoveredProfileEdge, setHoveredProfileEdge] = useState<{
    pieceId: string
    edgeIndex: number
    curveIndices: number[]
  } | null>(null)
  const [hoveredEdgePicking, setHoveredEdgePicking] = useState<{
    pieceId: string
    edgeIndex: number
    curveIndices: number[]
  } | null>(null)
  const [edgeAllowancePopover, setEdgeAllowancePopover] = useState<{
    pieceId: string
    edgeIndex: number
    currentMm: number
    clientX: number
    clientY: number
  } | null>(null)
  const [hoveredCurvepointSegment, setHoveredCurvepointSegment] = useState<{ pieceId: string; curveIndex: number } | null>(null)
  const [hoveredInternalLine, setHoveredInternalLine] = useState<{ pieceId: string; curveIndex: number } | null>(null)
  const [digitizeMouseWorld, setDigitizeMouseWorld] = useState<Point | null>(null)
  const [digitizeNearFirst, setDigitizeNearFirst] = useState(false)
  const [lineLengthEditor, setLineLengthEditor] = useState<{
    mode: 'draw' | 'hoverInternal'
    pieceId: string
    curveIndex?: number
    start: Point
    current: Point
    value: string
  } | null>(null)
  const lineLengthInputRef = useRef<HTMLInputElement | null>(null)
  const lastPointerClientRef = useRef({ x: 0, y: 0 })
  const [hoveredWorkspaceImage, setHoveredWorkspaceImage] = useState(false)
  const [workspaceImageQuickMenu, setWorkspaceImageQuickMenu] = useState<{ clientX: number; clientY: number } | null>(
    null
  )

  // Nur beim Öffnen fokussieren + alles markieren – nicht bei jedem Tastendruck (value-Updates),
  // sonst würde select() die Eingabe bei jeder Ziffer überschreiben.
  useEffect(() => {
    if (!lineLengthEditor) return
    lineLengthInputRef.current?.focus()
    lineLengthInputRef.current?.select()
  }, [lineLengthEditor?.mode, lineLengthEditor?.pieceId, lineLengthEditor?.curveIndex])

  const segmentMenuVisible =
    (hoveredSegment != null && hoveredSegmentPos != null) ||
    (segmentMenuPinned && pinnedSegment != null && pinnedSegmentPos != null) ||
    (pointerOverSegmentMenu && frozenSegment != null && frozenSegmentPos != null)
  const segmentForMenu = hoveredSegment ?? pinnedSegment ?? frozenSegment
  const segmentPosForMenu = hoveredSegmentPos ?? pinnedSegmentPos ?? frozenSegmentPos
  const effectiveSegmentForHighlight =
    segmentMenuPinned && pinnedSegment ? pinnedSegment : (hoveredSegment ?? frozenSegment ?? hoveredCurvepointSegment)

  const closeSegmentMenu = useCallback(() => {
    setHoveredSegment(null)
    setHoveredSegmentPos(null)
    setSegmentMenuPinned(false)
    setPinnedSegment(null)
    setPinnedSegmentPos(null)
    setPointerOverSegmentMenu(false)
    setFrozenSegment(null)
    setFrozenSegmentPos(null)
  }, [])

  useEffect(() => {
    if (tool !== 'kante') closeSegmentMenu()
  }, [tool, closeSegmentMenu])

  useEffect(() => {
    if (tool !== 'select') setNotchEditTarget(null)
  }, [tool])

  useEffect(() => {
    if (!toastMessage) return
    const timer = setTimeout(() => setToastMessage(null), 4000)
    return () => clearTimeout(timer)
  }, [toastMessage, setToastMessage])

  const prevDraggingRef = useRef(dragging)
  useEffect(() => {
    const wasDragging = prevDraggingRef.current
    prevDraggingRef.current = dragging
    if (wasDragging && !dragging) {
      checkSeamAdjustment()
    }
  }, [dragging, checkSeamAdjustment])

  const toWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      if (!containerRef.current) return { x: 0, y: 0 }
      return getScreenPoint(clientX, clientY, containerRef.current, view, svgRef.current)
    },
    [view]
  )

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!containerRef.current) return
      /** UI-Leiste Fensterauswahl: nicht als Canvas-Klick/Marquee behandeln (sonst blockiert preventDefault das Dropdown). */
      if (e.target instanceof Element && e.target.closest('.batch-selection-bar')) {
        return
      }
      /** Mittelklick: nur globaler Abbruch, kein Ziehen/Keine Punkte ändern (Propagation kommt i. d. R. nicht bis hier). */
      if (e.button === 1) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      e.preventDefault()
      closeSegmentMenu()
      setWorkspaceImageQuickMenu(null)
      const world = toWorld(e.clientX, e.clientY)
      if (tool === 'pan') {
        setDragging({
          kind: 'pan',
          startClient: { x: e.clientX, y: e.clientY },
          startPan: { x: view.panX, y: view.panY },
        })
        ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
        return
      }
      if (tool === 'massstab') {
        if (selectedPieceIds.length !== 1) {
          setToastMessage('error:Bitte genau ein Teil auswählen.')
          return
        }
        const pieceId0 = selectedPieceIds[0]
        const p = pieces.find((x) => x.id === pieceId0)
        if (!p || !p.cutLine?.length) return
        const hasSeam = p.seamLine.length >= 3
        const curvesForHit = hasSeam ? p.seamLine : p.cutLine
        const local = worldToPieceLocal(world, p)
        const nearest = nearestCurveIndexAndPoint(local, curvesForHit)
        if (!nearest || nearest.distance >= SEAM_HIT_MM) return
        if (hasSeam) {
          const distToCut = nearestCurveIndexAndPoint(local, p.cutLine)?.distance ?? Infinity
          if (nearest.distance >= distToCut) return
          const segHit = curvesForHit[nearest.curveIndex]
          const midHit = segHit ? curveMidpoint(segHit) : nearest.point
          const nr = nearestCurveIndexAndPoint(midHit, p.cutLine)
          if (!nr) return
          const seamMm = p.seamAllowanceMm ?? 10
          if (nr.distance > seamMm * 2.5) return
        }
        const nearestCut = nearestCurveIndexAndPoint(local, p.cutLine)
        if (!nearestCut || !isClickOnInnerSideOfEdge(local, nearestCut, p.cutLine)) return
        const curveIndexForRange = hasSeam ? nearest.curveIndex : nearestCut.curveIndex
        const range = getCornerRange(p, curveIndexForRange)
        const resolved = resolvedSeamAssignmentCurveIndices(p, range)
        const currentLengthMm = edgeTotalLength(p, resolved)
        setMassstabDialog({ pieceId: p.id, curveIndices: resolved, currentLengthMm })
        return
      }
      if (rulerMode) {
        setRulerLine(null)
        const start = snapRulerToNearestPoint(world, pieces)
        setDragging({ kind: 'ruler', start, current: start })
        ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
        return
      }
      if (nahtzuordnungMode === 'first' || nahtzuordnungMode === 'second') {
        // Nahtzuordnung: Klick immer auf seamLine (wenn vorhanden), sonst cutLine. cutLine-Indices für Logik.
        let best: { pieceId: string; curveIndex: number; distance: number; piece: PatternPiece } | null = null
        for (const p of pieces) {
          if (!p.cutLine || p.cutLine.length === 0) continue
          // Master-Kontur für SeamAssignment-Indices: seamLine nur wenn Nahtzugabe aktiv (seamAllowanceMm != null),
          // ansonsten sind Indizes auf cutLine-Basis.
          const curvesForHit = getCurvesForSeamEdge(p)
          const hasSeam = curvesForHit === p.seamLine
          const local = worldToPieceLocal(world, p)
          const nearest = nearestCurveIndexAndPoint(local, curvesForHit)
          if (!nearest || nearest.distance >= SEAM_HIT_MM) continue
          if (hasSeam) {
            const distToCut = nearestCurveIndexAndPoint(local, p.cutLine)?.distance ?? Infinity
            if (nearest.distance >= distToCut) continue
          }
          const nearestCut = nearestCurveIndexAndPoint(local, p.cutLine)
          if (!nearestCut || !isClickOnInnerSideOfEdge(local, nearestCut, p.cutLine)) continue
          let cutCurveIndex: number
          if (hasSeam) {
            const segHit = curvesForHit[nearest.curveIndex]
            const midHit = segHit ? curveMidpoint(segHit) : nearest.point
            const nr = nearestCurveIndexAndPoint(midHit, p.cutLine)
            if (!nr) continue
            const seamMm = p.seamAllowanceMm!
            if (nr.distance > seamMm * 2.5) continue
            // Master-Kontur = seamLine; getCornerRange / SeamAssignment erwarten seam-Indices, nicht Cut-Polylinien-Index.
            cutCurveIndex = nearest.curveIndex
          } else {
            cutCurveIndex = nearestCut.curveIndex
          }
          if (!best || nearest.distance < best.distance) {
            best = { pieceId: p.id, curveIndex: cutCurveIndex, distance: nearest.distance, piece: p }
          }
        }
        if (best) {
          const range = getCornerRange(best.piece, best.curveIndex)
          if (nahtzuordnungMode === 'first') {
            setPendingNahtzuordnungFirst({ pieceId: best.pieceId, curveIndices: range, clickedCurve: best.curveIndex })
            setNahtzuordnungMode('second')
          } else if (pendingNahtzuordnungFirst && best.pieceId !== pendingNahtzuordnungFirst.pieceId) {
            addSeamAssignment(
              pendingNahtzuordnungFirst.pieceId,
              pendingNahtzuordnungFirst.curveIndices,
              pendingNahtzuordnungFirst.clickedCurve,
              best.pieceId,
              range,
              best.curveIndex
            )
          }
          return
        }
      }
      if (edgeSeamPickingActive && !edgeAllowancePopover && hoveredEdgePicking) {
        const piece = pieces.find((p) => p.id === hoveredEdgePicking.pieceId)
        if (piece) {
          const currentMm = getAllowanceForCurveIndex(piece, hoveredEdgePicking.curveIndices[0])
          setEdgeAllowancePopover({
            pieceId: piece.id,
            edgeIndex: hoveredEdgePicking.edgeIndex,
            currentMm,
            clientX: e.clientX,
            clientY: e.clientY,
          })
        }
        return
      }
      if (edgeSeamPickingActive && edgeAllowancePopover) {
        return
      }
      if (tool === 'profil' && hoveredProfileEdge) {
        const existing = profileAssignments.find(
          (pa) => pa.pieceId === hoveredProfileEdge.pieceId && pa.edgeIndex === hoveredProfileEdge.edgeIndex
        )
        if (existing) {
          setProfileDialogAssignmentId(existing.id)
        } else {
          const usedKeys = new Set(profileAssignments.map((pa) => pa.profileKey))
          let nextKey = 'A'
          for (let c = 65; c <= 90; c++) {
            if (!usedKeys.has(String.fromCharCode(c))) { nextKey = String.fromCharCode(c); break }
          }
          const newId = addProfileAssignment({
            pieceId: hoveredProfileEdge.pieceId,
            edgeIndex: hoveredProfileEdge.edgeIndex,
            profileName: '',
            profileKey: nextKey,
          })
          setProfileDialogAssignmentId(newId)
        }
        return
      }
      if (pendingNahtzugabeClick) {
        for (let i = pieces.length - 1; i >= 0; i--) {
          const p = pieces[i]
          const local = worldToPieceLocal(world, p)
          if (isPointInsidePiece(local, p)) {
            setNahtzugabeDialogPieceId(p.id)
            setPendingNahtzugabeClick(false)
            ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
            return
          }
        }
        setPendingNahtzugabeClick(false)
        return
      }

      if (showWorkspaceNotes) {
        const notes = workspace.notes ?? []
        /** Pixel-Treffer (wie Icon-Größe auf dem Bildschirm), unabhängig vom Zoom. */
        const NOTE_HIT_PX = 24
        const containerEl = containerRef.current
        for (let i = notes.length - 1; i >= 0; i--) {
          const n = notes[i]
          const piece = pieces.find((p) => p.id === n.pieceId)
          if (!piece) continue
          const worldPos = pieceLocalToWorld(n.position, piece)
          const c = worldToClientPoint(worldPos, containerEl, view, svgRef.current)
          if (Math.hypot(e.clientX - c.x, e.clientY - c.y) <= NOTE_HIT_PX) {
            setWorkspaceNoteEditor({ noteId: n.id, clientX: e.clientX, clientY: e.clientY })
            setDragging({
              kind: 'workspaceNote',
              noteId: n.id,
              pieceId: n.pieceId,
            })
            ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
            return
          }
        }
      }

      const VERTEX_HIT = VERTEX_DRAG_HIT_MM
      const VERTEX_HIT_SEAM = VERTEX_DRAG_HIT_SEAM_MM
      const POINT_ON_CURVE_HIT = POINT_ON_CURVE_DRAG_HIT_MM
      // Treffer: Seam-as-Master = Eckpunkte auf Innenkontur (seamLine); sonst cut/seam je nach Ansicht.
      if (showPoints && (tool === 'select' || tool === 'point' || tool === 'curvepoint') && selectedPieceIds.length > 0) {
        let bestPointOnCurve: { dist: number; pieceId: string; curveIndex: number; t: number } | null = null
        let bestVertex: { dist: number; pieceId: string; vertexIndex: number; hitRadius: number } | null = null
        let bestNotchClick: { dist: number; pieceId: string; notchId: string } | null = null
        const piecesForClick =
          selectedPieceIds.length > 0 ? pieces.filter((p) => selectedPieceIds.includes(p.id)) : pieces
        for (const p of piecesForClick) {
          const useSeamMaster = p != null && useSeamLineForVertexEditing(p)
          const curvesForVertices = useSeamMaster ? p!.seamLine : p?.cutLine ?? []
          if (!p || curvesForVertices.length === 0) continue
          const local = worldToPieceLocal(world, p)
          const vertexHitR = useSeamMaster ? VERTEX_HIT_SEAM : VERTEX_HIT
          const curvesForPointCurve = useSeamLineForPointCurveEditing(p) ? p.seamLine : p.cutLine
          // Kurvenpunkte (Bézier-Mitte): bei Nahtzugabe auf Nahtlinie, sonst Schnittkontur
          for (let ci = 0; ci < curvesForPointCurve.length; ci++) {
            const c = curvesForPointCurve[ci]
            if (c.type !== 'bezier') continue
            const ptOnCurve = bezierAt(c, 0.5)
            const d = Math.hypot(local.x - ptOnCurve.x, local.y - ptOnCurve.y)
            if (d < POINT_ON_CURVE_HIT && (!bestPointOnCurve || d < bestPointOnCurve.dist)) {
              bestPointOnCurve = { dist: d, pieceId: p.id, curveIndex: ci, t: 0.5 }
            }
          }
          // Eckpunkte – Seam-Master: direkt auf seamLine; sonst cut/seam je nach Ansicht
          const n = curvesForVertices.length
          for (let vi = 0; vi < n; vi++) {
            const vertexPos = vi === 0 ? curvesForVertices[0].start : curvesForVertices[vi - 1].end
            const d = Math.hypot(local.x - vertexPos.x, local.y - vertexPos.y)
            if (d < vertexHitR && (!bestVertex || d < bestVertex.dist)) {
              bestVertex = { dist: d, pieceId: p.id, vertexIndex: vi, hitRadius: vertexHitR }
            }
          }
        }
        if (tool === 'select') {
          for (const p of piecesForClick) {
            const local = worldToPieceLocal(world, p)
            for (const notch of p.notches) {
              const depth = notch.depth
              const width = notch.width ?? 6
              const cutPos = getNotchPositionAndAngleOnCutLine(notch, p.cutLine, p.seamLine)
              const cutParam = getNotchCurveIndexAndT(notch, p.cutLine, p.seamLine)
              const cutPts = notchCutoutPoints(cutPos.position, cutPos.angle, depth, width, p.cutLine, cutParam, notch.type)
              let d = Infinity
              if (cutPts) {
                d = distanceToNotchCutoutGeom(local, cutPts, cutPos.position)
              } else {
                const { position } = getNotchPositionAndAngle(notch, p.cutLine, p.seamLine)
                d = Math.hypot(local.x - position.x, local.y - position.y)
              }
              if (d <= NOTCH_CLICK_HIT && (!bestNotchClick || d < bestNotchClick.dist)) {
                bestNotchClick = { dist: d, pieceId: p.id, notchId: notch.id }
              }
              if (p.seamLine.length >= 3) {
                const seamPos = getNotchPositionAndAngleOnSeamLine(notch, p.cutLine, p.seamLine)
                if (seamPos) {
                  const seamPts = notchCutoutPoints(seamPos.position, seamPos.angle, depth, width, p.seamLine, undefined, notch.type)
                  if (seamPts) {
                    const dSeam = distanceToNotchCutoutGeom(local, seamPts, seamPos.position)
                    if (dSeam <= NOTCH_CLICK_HIT && (!bestNotchClick || dSeam < bestNotchClick.dist)) {
                      bestNotchClick = { dist: dSeam, pieceId: p.id, notchId: notch.id }
                    }
                  } else {
                    const dSeam = Math.hypot(local.x - seamPos.position.x, local.y - seamPos.position.y)
                    if (dSeam <= NOTCH_CLICK_HIT && (!bestNotchClick || dSeam < bestNotchClick.dist)) {
                      bestNotchClick = { dist: dSeam, pieceId: p.id, notchId: notch.id }
                    }
                  }
                }
              }
            }
          }
        }
        const minVertexDist = bestVertex?.dist ?? Infinity
        const minPointOnCurveDist = bestPointOnCurve?.dist ?? Infinity
        const minNotchDist = bestNotchClick?.dist ?? Infinity
        const useNotch =
          bestNotchClick &&
          minNotchDist < minVertexDist &&
          minNotchDist < minPointOnCurveDist
        if (useNotch && bestNotchClick && tool === 'select') {
          setDragging({
            kind: 'notchMove',
            pieceId: bestNotchClick.pieceId,
            notchId: bestNotchClick.notchId,
          })
          ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
          return
        }
        // Punkt-/Kurvenpunkt-Werkzeug: kein Eck- oder Bézier-Mittelpunkt-Ziehen (sonst wird nie eingefügt/umgewandelt).
        const usePointOnCurve =
          tool === 'select' &&
          bestPointOnCurve &&
          (!bestVertex || bestPointOnCurve.dist <= bestVertex.dist)
        const useVertex =
          tool === 'select' &&
          bestVertex &&
          (!bestPointOnCurve || bestVertex.dist < bestPointOnCurve.dist)
        if (usePointOnCurve && bestPointOnCurve) {
          setDragging({ kind: 'pointOnCurve', pieceId: bestPointOnCurve.pieceId, curveIndex: bestPointOnCurve.curveIndex, t: bestPointOnCurve.t })
          ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
          return
        }
        if (useVertex && bestVertex) {
          if (bestVertex.dist <= bestVertex.hitRadius) {
            const p = pieces.find((x) => x.id === bestVertex.pieceId)
            const useSeamMaster = p != null && useSeamLineForVertexEditing(p)
            const curves = useSeamMaster ? p!.seamLine : p!.cutLine
            const startLocal = bestVertex.vertexIndex === 0
              ? curves[0].start
              : curves[bestVertex.vertexIndex - 1].end
            const notchStabilize =
              p!.seamAllowanceMm != null && useSeamLineForVertexEditing(p!)
                ? { notches: cloneVertexDragNotches(p!.notches), cutLine: cloneVertexDragCutLine(p!.cutLine), seamLine: p!.seamLine.map(c => c.type === 'line' ? { ...c, start: { ...c.start }, end: { ...c.end } } : { ...c, start: { ...c.start }, end: { ...c.end }, cp1: { ...c.cp1 }, cp2: { ...c.cp2 } }) }
                : undefined
            setDragging({
              kind: 'vertex',
              pieceId: bestVertex.pieceId,
              vertexIndex: bestVertex.vertexIndex,
              startLocal: { ...startLocal },
              ...(notchStabilize ? { notchStabilize } : {}),
            })
            ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
            return
          }
        }
      }
      if (tool === 'curvepoint' && selectedPieceIds.length === 1) {
        const pieceId = selectedPieceIds[0]
        const piece = pieces.find((x) => x.id === pieceId)
        if (piece) {
        const masterPc = useSeamLineForPointCurveEditing(piece) ? piece.seamLine : piece.cutLine
        if (masterPc.length > 0) {
          const local = worldToPieceLocal(world, piece)
          const nearest = nearestPointForMasterPointEditing(piece, local, POINT_INSERT_HIT_MM)
          if (nearest) {
            const curve = masterPc[nearest.curveIndex]
            if (curve.type === 'line') {
              const seg = masterPc[nearest.curveIndex]
              if (seg?.type === 'line') {
                const { start, end } = seg
                const dx = end.x - start.x
                const dy = end.y - start.y
                const cp1 = { x: start.x + dx / 3, y: start.y + dy / 3 }
                const cp2 = { x: start.x + (2 * dx) / 3, y: start.y + (2 * dy) / 3 }
                replaceSegmentWithBezier(pieceId, nearest.curveIndex, cp1, cp2)
              }
            } else if (curve.type === 'bezier' && nearest.t != null && nearest.t > 1e-6 && nearest.t < 1 - 1e-6) {
              const bez = masterPc[nearest.curveIndex]
              if (bez?.type === 'bezier') {
                const pt = nearest.point
                insertPointOnCutLine(pieceId, nearest.curveIndex, pt, nearest.t)
              }
            }
            ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
            return
          }
        }
        }
        return
      }
      if (tool === 'point' && selectedPieceIds.length === 1) {
        const pieceId = selectedPieceIds[0]
        const piece = pieces.find((x) => x.id === pieceId)
        if (piece) {
        const masterPt = useSeamLineForPointCurveEditing(piece) ? piece.seamLine : piece.cutLine
        if (masterPt.length > 0) {
          const local = worldToPieceLocal(world, piece)
          const nearest = nearestPointForMasterPointEditing(piece, local, POINT_INSERT_HIT_MM)
          if (nearest) {
            const curve = masterPt[nearest.curveIndex]
            let inserted = false
            if (curve.type === 'line') {
              inserted = insertPointOnCutLine(pieceId, nearest.curveIndex, nearest.point, nearest.t)
            } else if (
              curve.type === 'bezier' &&
              nearest.t != null &&
              nearest.t > 1e-6 &&
              nearest.t < 1 - 1e-6
            ) {
              inserted = insertPointOnCutLine(pieceId, nearest.curveIndex, nearest.point, nearest.t)
            }
            if (inserted) setPointPreview(null)
            ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
            return
          }
        }
        }
        return
      }
      if (tool === 'select') {
        if (hoveredDeletableNotch && e.altKey) {
          e.preventDefault()
          setNotchEditTarget({
            pieceId: hoveredDeletableNotch.pieceId,
            notchId: hoveredDeletableNotch.notchId,
          })
          return
        }
        if (hoveredDeletableNotch) {
          setDragging({
            kind: 'notchMove',
            pieceId: hoveredDeletableNotch.pieceId,
            notchId: hoveredDeletableNotch.notchId,
          })
          ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
          return
        }
        const ROTATION_HANDLE_OFFSET = 25
        const ROTATION_HANDLE_HIT = 18
        const PIVOT_HIT = 20
        for (let i = pieces.length - 1; i >= 0; i--) {
          const p = pieces[i]
          if (!selectedPieceIds.includes(p.id) || p.cutLine.length < 3) continue
          const pivot = getPiecePivotLocal(p)
          const handleLocal = { x: pivot.x, y: pivot.y - ROTATION_HANDLE_OFFSET }
          const handleWorld = pieceLocalToWorld(handleLocal, p)
          const dist = Math.hypot(world.x - handleWorld.x, world.y - handleWorld.y)
          if (dist < ROTATION_HANDLE_HIT) {
            const worldCenter = pieceLocalToWorld(pivot, p)
            const startWorldAngle = (Math.atan2(world.y - worldCenter.y, world.x - worldCenter.x) * 180) / Math.PI
            setDragging({
              kind: 'rotate',
              pieceId: p.id,
              startRotation: p.transform.rotation,
              startWorldAngle,
            })
            ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
            return
          }
        }
        for (let i = pieces.length - 1; i >= 0; i--) {
          const p = pieces[i]
          if (!selectedPieceIds.includes(p.id) || p.cutLine.length < 3) continue
          const pivot = getPiecePivotLocal(p)
          const pivotWorld = pieceLocalToWorld(pivot, p)
          const pivotDist = Math.hypot(world.x - pivotWorld.x, world.y - pivotWorld.y)
          if (pivotDist < PIVOT_HIT) {
            if (e.detail === 2) {
              setPiecePivot(p.id, null)
              return
            }
            setDragging({ kind: 'pivot', pieceId: p.id })
            containerRef.current?.setPointerCapture?.(e.pointerId)
            return
          }
        }
        const GRAIN_POINT_HIT = 14
        for (let i = pieces.length - 1; i >= 0; i--) {
          const p = pieces[i]
          if (!selectedPieceIds.includes(p.id) || p.cutLine.length < 3) continue
          const grain = getPieceGrainLine(p)
          const startWorld = pieceLocalToWorld(grain.start, p)
          const endWorld = pieceLocalToWorld(grain.end, p)
          const dStart = Math.hypot(world.x - startWorld.x, world.y - startWorld.y)
          const dEnd = Math.hypot(world.x - endWorld.x, world.y - endWorld.y)
          if (dStart < GRAIN_POINT_HIT) {
            setDragging({ kind: 'grainPoint', pieceId: p.id, which: 'start' })
            containerRef.current?.setPointerCapture?.(e.pointerId)
            return
          }
          if (dEnd < GRAIN_POINT_HIT) {
            setDragging({ kind: 'grainPoint', pieceId: p.id, which: 'end' })
            containerRef.current?.setPointerCapture?.(e.pointerId)
            return
          }
        }
        const GRAIN_SHAFT_HIT = GRAIN_POINT_HIT
        for (let i = pieces.length - 1; i >= 0; i--) {
          const p = pieces[i]
          if (!selectedPieceIds.includes(p.id) || p.cutLine.length < 3) continue
          if (tool !== 'select' || showGrain === false) continue
          const local = worldToPieceLocal(world, p)
          if (!isPointInGrainArrowArea(local, p)) continue
          const grain = getPieceGrainLine(p)
          const startW = pieceLocalToWorld(grain.start, p)
          const endW = pieceLocalToWorld(grain.end, p)
          const dStart = Math.hypot(world.x - startW.x, world.y - startW.y)
          const dEnd = Math.hypot(world.x - endW.x, world.y - endW.y)
          if (dStart < GRAIN_SHAFT_HIT || dEnd < GRAIN_SHAFT_HIT) continue
          setDragging({
            kind: 'grainLine',
            pieceId: p.id,
            startLocal: { ...local },
            lineAtPointerDown: { start: { ...grain.start }, end: { ...grain.end } },
          })
          containerRef.current?.setPointerCapture?.(e.pointerId)
          return
        }
        for (let i = pieces.length - 1; i >= 0; i--) {
          const p = pieces[i]
          const local = worldToPieceLocal(world, p)
          if (isPointInsidePiece(local, p)) {
            if (isPointInGrainArrowArea(local, p)) return
            selectPiece(p.id, e.shiftKey)
            setDragging({ kind: 'piece', pieceId: p.id, start: world })
            ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
            return
          }
          if (p.cutLine.length > 0) {
            const first = p.cutLine[0]
            const sx = first.type === 'line' ? first.start.x : first.start.x
            const sy = first.type === 'line' ? first.start.y : first.start.y
            const dist = Math.hypot(local.x - sx, local.y - sy)
            if (dist < 20) {
              selectPiece(p.id, e.shiftKey)
              setDragging({ kind: 'piece', pieceId: p.id, start: world })
              ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
              return
            }
          }
          if (Math.abs(local.x) < 30 && Math.abs(local.y) < 30) {
            selectPiece(p.id, e.shiftKey)
            setDragging({ kind: 'piece', pieceId: p.id, start: world })
            ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
            return
          }
        }
        if (imageDigitizeSession?.imageDataUrl && imageDigitizeSession.imageSizePx) {
          const session = imageDigitizeSession
          const lay = workspaceImageLayout(session)
          if (session.locked) {
            if (lay && isWorldInsideWorkspaceImage(world, session)) {
              selectPiece(null)
              setWorkspaceImageSelected(true)
              ;(e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId)
              return
            }
          } else {
            if (!lay) return
          const corners: { x: number; y: number }[] = [
            { x: lay.left, y: lay.top },
            { x: lay.right, y: lay.top },
            { x: lay.left, y: lay.bottom },
            { x: lay.right, y: lay.bottom },
          ]
          for (const c of corners) {
            const d = Math.hypot(world.x - c.x, world.y - c.y)
            if (d <= IMAGE_CORNER_HIT_MM) {
              const ux = c.x - lay.cx
              const uy = c.y - lay.cy
              const d0 = Math.hypot(ux, uy) || 1
              selectPiece(null)
              setWorkspaceImageSelected(true)
              setDragging({
                kind: 'image-resize',
                center: { x: lay.cx, y: lay.cy },
                ux: ux / d0,
                uy: uy / d0,
                d0,
                render0: session.renderMmPerPixel,
              })
              ;(e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId)
              return
            }
          }
          if (isWorldInsideWorkspaceImage(world, session)) {
            selectPiece(null)
            setWorkspaceImageSelected(true)
            setDragging({
              kind: 'image-move',
              startWorld: world,
              startImagePos: { ...session.imagePosition },
            })
            ;(e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId)
            return
          }
          }
        }
        setWorkspaceImageSelected(false)
        setDragging({ kind: 'selectionMarquee', start: world, current: world })
        ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
        return
      }
      if ((tool === 'line' || tool === 'internalLine') && selectedPieceIds.length === 1) {
        const pieceId = selectedPieceIds[0]
        const piece = pieces.find((x) => x.id === pieceId)
        if (!piece) return
        const local = worldToPieceLocal(world, piece)
        setDragging({ kind: 'line', pieceId, start: local, current: local })
        ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
        return
      }
      if (tool === 'notch' && selectedPieceIds.length === 1) {
        const pieceId = selectedPieceIds[0]
        const piece = pieces.find((x) => x.id === pieceId)
        if (!piece) {
          selectPiece(null)
          setTool('select')
          return
        }
        const local = worldToPieceLocal(world, piece)
        const maxSnapDistance = 20
        const hasSeam = piece.seamLine.length >= 3
        const solidIsCut = !hasSeam || cutSeamSwappedSet.has(pieceId)
        const useSeam = hasSeam && !solidIsCut
        const curves = useSeam ? piece.seamLine : piece.cutLine
        if (curves.length === 0) {
          selectPiece(null)
          setTool('select')
          return
        }
        const nearest = nearestCurveIndexAndPoint(local, curves)
        if (!nearest || nearest.distance > maxSnapDistance) {
          selectPiece(null)
          setTool('select')
          return
        }
        const position = nearest.point
        const t = nearest.t ?? 0
        setNotchPreview(null)
        setDragging({
          kind: 'notch',
          pieceId,
          position,
          current: position,
          curveIndex: nearest.curveIndex,
          t,
          useSeamLine: useSeam,
        })
        ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
        return
      }
      if (tool === 'drill' && selectedPieceIds.length === 1) {
        const pieceId = selectedPieceIds[0]
        const piece = pieces.find((x) => x.id === pieceId)
        if (!piece) return
        const local = worldToPieceLocal(world, piece)
        setDragging({ kind: 'drill', pieceId, center: local, current: local })
        ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
        return
      }
      if (tool === 'internalCircle' && selectedPieceIds.length === 1) {
        const pieceId = selectedPieceIds[0]
        const piece = pieces.find((x) => x.id === pieceId)
        if (!piece) return
        const local = worldToPieceLocal(world, piece)
        setDragging({ kind: 'internalCircle', pieceId, center: local, current: local })
        ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
        return
      }
      if (tool === 'rectangle') {
        setDragging({ kind: 'rectangle', start: world, current: world })
        ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
        return
      }
      if (tool === 'note') {
        if (!showWorkspaceNotes) {
          setTool('select')
          return
        }
        let placed: { pieceId: string; local: Point } | null = null
        for (let pi = pieces.length - 1; pi >= 0; pi--) {
          const p = pieces[pi]
          if (p.cutLine.length < 3) continue
          const local = worldToPieceLocal(world, p)
          if (isPointInsidePiece(local, p)) {
            placed = { pieceId: p.id, local }
            break
          }
        }
        if (!placed) {
          setToastMessage('error:Notiz ins Innere eines Schnittteils setzen.')
          return
        }
        const id = addWorkspaceNote(placed.pieceId, placed.local)
        setWorkspaceNoteEditor({ noteId: id, clientX: e.clientX, clientY: e.clientY })
        setTool('select')
        return
      }
      if (tool === 'digitize' && digitizeState) {
        const CLOSE_HIT = 8
        const nodes = digitizeState.nodes
        if (nodes.length >= 3) {
          const first = nodes[0].point
          const dist = Math.hypot(world.x - first.x, world.y - first.y)
          if (dist < CLOSE_HIT) {
            finishDigitize()
            return
          }
        }
        addDigitizeNode(world)
        if (e.ctrlKey || e.metaKey) {
          setDragging({ kind: 'digitizeDrag' })
          ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
        }
        return
      }
      // Klick ins leere Feld: keine Funktion mehr, Auswahl und Tool zurücksetzen
      setWorkspaceImageSelected(false)
      selectPiece(null)
      setTool('select')
    },
    [
      tool,
      view.panX,
      view.panY,
      pieces,
      selectedPieceIds,
      imageDigitizeSession,
      workspaceImageSelected,
      showPoints,
      showGrain,
      rulerMode,
      pendingNahtzugabeClick,
      setPendingNahtzugabeClick,
      setNahtzugabeDialogPieceId,
      nahtzuordnungMode,
      setNahtzuordnungMode,
      setPendingNahtzuordnungFirst,
      pendingNahtzuordnungFirst,
      addSeamAssignment,
      toWorld,
      setView,
      selectPiece,
      setWorkspaceImageSelected,
      movePiece,
      addCurveToCutLine,
      addNotch,
      addDrill,
      addPiece,
      setTool,
      setDragging,
      insertPointOnCutLine,
      replaceSegmentWithBezier,
      hoveredDeletableNotch,
      closeSegmentMenu,
      cutSeamSwappedSet,
      digitizeState,
      addDigitizeNode,
      finishDigitize,
      setImagePosition,
      setMassstabDialog,
      workspace,
      view.zoom,
      showWorkspaceNotes,
      addWorkspaceNote,
      setToastMessage,
      hoveredProfileEdge,
      profileAssignments,
      addProfileAssignment,
      setProfileDialogAssignmentId,
    ]
  )

  const HOVER_DELETE_HIT = VERTEX_HOVER_DELETE_MM
  /** Hover/Klick auf Notch – bei Überlappung mit Eckpunkt gewinnt der nähere. */
  const NOTCH_HOVER_HIT = 6
  const NOTCH_CLICK_HIT = 6

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragging?.kind === 'workspaceNote') {
        const world = toWorld(e.clientX, e.clientY)
        const piece = pieces.find((p) => p.id === dragging.pieceId)
        if (!piece) return
        const local = worldToPieceLocal(world, piece)
        updateWorkspaceNote(dragging.noteId, { position: local })
        return
      }

      if (dragging?.kind === 'image-move') {
        const world = toWorld(e.clientX, e.clientY)
        const dx = world.x - dragging.startWorld.x
        const dy = world.y - dragging.startWorld.y
        const nextPos = { x: dragging.startImagePos.x + dx, y: dragging.startImagePos.y + dy }
        setImagePosition(nextPos)
        return
      }

      if (dragging?.kind === 'image-resize') {
        const world = toWorld(e.clientX, e.clientY)
        const dx = world.x - dragging.center.x
        const dy = world.y - dragging.center.y
        const t = dx * dragging.ux + dy * dragging.uy
        const factor = Math.max(0.12, t / dragging.d0)
        setImageRenderMmPerPixel(dragging.render0 * factor)
        return
      }

      if (tool === 'digitize' && digitizeState && !dragging) {
        const world = toWorld(e.clientX, e.clientY)
        setDigitizeMouseWorld(world)
        if (digitizeState.nodes.length >= 3) {
          const first = digitizeState.nodes[0].point
          setDigitizeNearFirst(Math.hypot(world.x - first.x, world.y - first.y) < 8)
        } else {
          setDigitizeNearFirst(false)
        }
      }
      if (tool === 'digitize' && digitizeState?.isDragging) {
        const world = toWorld(e.clientX, e.clientY)
        updateDigitizeDrag(world)
        setDigitizeMouseWorld(world)
        return
      }
      if (dragging?.kind === 'digitizeDrag') {
        const world = toWorld(e.clientX, e.clientY)
        updateDigitizeDrag(world)
        setDigitizeMouseWorld(world)
        return
      }
      if (!dragging) {
        const worldImg = toWorld(e.clientX, e.clientY)
        lastPointerClientRef.current = { x: e.clientX, y: e.clientY }
        let imgHover = false
        if (imageDigitizeSession?.imageDataUrl && imageDigitizeSession.imageSizePx) {
          if (isWorldInsideWorkspaceImage(worldImg, imageDigitizeSession)) {
            imgHover = true
            for (const p of pieces) {
              if (p.cutLine.length >= 3 && isPointInsidePiece(worldToPieceLocal(worldImg, p), p)) {
                imgHover = false
                break
              }
            }
          }
        }
        setHoveredWorkspaceImage(imgHover)
        if (nahtzuordnungMode === 'first' || nahtzuordnungMode === 'second') {
          const world = toWorld(e.clientX, e.clientY)
          let best: { pieceId: string; curveIndex: number; distance: number; piece: PatternPiece } | null = null
          for (const p of pieces) {
            if (!p.cutLine?.length) continue
            const hasSeam = p.seamLine.length >= 3
            const curvesForHit = hasSeam ? p.seamLine : p.cutLine
            const local = worldToPieceLocal(world, p)
            const nearest = nearestCurveIndexAndPoint(local, curvesForHit)
            if (!nearest || nearest.distance >= SEAM_HIT_MM) continue
            if (hasSeam) {
              const distToCut = nearestCurveIndexAndPoint(local, p.cutLine)?.distance ?? Infinity
              if (nearest.distance >= distToCut) continue
            }
            const nearestCut = nearestCurveIndexAndPoint(local, p.cutLine)
            if (!nearestCut || !isClickOnInnerSideOfEdge(local, nearestCut, p.cutLine)) continue
            let cutCurveIndex: number
            if (hasSeam) {
              // Bei Nahtzugabe: curveIndex direkt von seamLine (Master-Kontur) – getCornerRange nutzt diese ebenfalls
              cutCurveIndex = nearest.curveIndex
            } else {
              cutCurveIndex = nearestCut.curveIndex
            }
            if (!best || nearest.distance < best.distance) {
              best = { pieceId: p.id, curveIndex: cutCurveIndex, distance: nearest.distance, piece: p }
            }
          }
          if (best) {
            const range = getCornerRange(best.piece, best.curveIndex)
            setHoveredSeamForNahtzuordnung({ pieceId: best.pieceId, curveIndices: range })
          } else {
            setHoveredSeamForNahtzuordnung(null)
          }
        } else {
          setHoveredSeamForNahtzuordnung(null)
        }
        if (edgeSeamPickingActive && !edgeAllowancePopover) {
          const world = toWorld(e.clientX, e.clientY)
          let bestEdge: { pieceId: string; edgeIndex: number; curveIndices: number[]; distance: number } | null = null
          for (const p of pieces) {
            if (p.seamAllowanceMm == null || p.seamLine.length < 3) continue
            const local = worldToPieceLocal(world, p)
            const nearest = nearestCurveIndexAndPoint(local, p.seamLine)
            if (!nearest || nearest.distance >= SEAM_HIT_MM) continue
            const edges = enumerateEdges(p)
            for (const edge of edges) {
              if (edge.curveIndices.includes(nearest.curveIndex)) {
                if (!bestEdge || nearest.distance < bestEdge.distance) {
                  bestEdge = { pieceId: p.id, edgeIndex: edge.edgeIndex, curveIndices: edge.curveIndices, distance: nearest.distance }
                }
                break
              }
            }
          }
          setHoveredEdgePicking(bestEdge)
        } else if (!edgeSeamPickingActive) {
          setHoveredEdgePicking(null)
        }
        if (tool === 'profil') {
          const world = toWorld(e.clientX, e.clientY)
          let bestEdge: { pieceId: string; edgeIndex: number; curveIndices: number[]; distance: number } | null = null
          for (const p of pieces) {
            const masterK = getCurvesForSeamEdge(p)
            if (masterK.length < 3) continue
            const local = worldToPieceLocal(world, p)
            const nearest = nearestCurveIndexAndPoint(local, masterK)
            if (!nearest || nearest.distance >= SEAM_HIT_MM) continue
            const edges = enumerateEdges(p)
            for (const edge of edges) {
              if (edge.curveIndices.includes(nearest.curveIndex)) {
                if (!bestEdge || nearest.distance < bestEdge.distance) {
                  bestEdge = { pieceId: p.id, edgeIndex: edge.edgeIndex, curveIndices: edge.curveIndices, distance: nearest.distance }
                }
                break
              }
            }
          }
          setHoveredProfileEdge(bestEdge)
        } else {
          setHoveredProfileEdge(null)
        }
        if (showPoints && (tool === 'select' || tool === 'point' || tool === 'curvepoint') && selectedPieceIds.length > 0) {
          const world = toWorld(e.clientX, e.clientY)
          const piecesForHover = pieces.filter((p) => selectedPieceIds.includes(p.id))
          const piecesForNotchHover =
            piecesForHover.some((p) => p.notches.length > 0) ? piecesForHover : pieces
          let bestVertexOnly: { dist: number; value: DeletableHoverTarget | null } = {
            dist: VERTEX_HOVER_DELETE_MM + 1,
            value: null,
          }
          let bestCurveOnly: { dist: number; value: DeletableHoverTarget | null } = {
            dist: VERTEX_HOVER_DELETE_MM + 1,
            value: null,
          }
          for (const p of piecesForHover) {
            if (!p || p.cutLine.length === 0) continue
            const local = worldToPieceLocal(world, p)
            const useSeamMaster = useSeamLineForVertexEditing(p)
            const curvesForHover = useSeamMaster ? p.seamLine : p.cutLine
            for (let vi = 0; vi < curvesForHover.length; vi++) {
              if (curvesForHover.length <= 3) continue
              const vertexPos = vi === 0 ? curvesForHover[0].start : curvesForHover[vi - 1].end
              const d = Math.hypot(local.x - vertexPos.x, local.y - vertexPos.y)
              if (d < bestVertexOnly.dist)
                bestVertexOnly = { dist: d, value: { pieceId: p.id, kind: 'vertex', vertexIndex: vi } }
            }
            const curvesPcHover = useSeamLineForPointCurveEditing(p) ? p.seamLine : p.cutLine
            for (let ci = 0; ci < curvesPcHover.length; ci++) {
              const c = curvesPcHover[ci]
              if (c.type !== 'bezier') continue
              const pt = bezierAt(c, 0.5)
              const d = Math.hypot(local.x - pt.x, local.y - pt.y)
              if (d < bestCurveOnly.dist)
                bestCurveOnly = { dist: d, value: { pieceId: p.id, kind: 'pointOnCurve', curveIndex: ci } }
            }
          }
          const bestVertex = mergeDeletableHoverVertexVsCurve(bestVertexOnly, bestCurveOnly)
          let bestNotch: { dist: number; pieceId: string; notchId: string } = {
            dist: NOTCH_HOVER_HIT + 1,
            pieceId: '',
            notchId: '',
          }
          for (const p of piecesForNotchHover) {
            const local = worldToPieceLocal(world, p)
            for (const notch of p.notches) {
              const depth = notch.depth
              const width = notch.width ?? 6
              const cutPos = getNotchPositionAndAngleOnCutLine(notch, p.cutLine, p.seamLine)
              const cutParam = getNotchCurveIndexAndT(notch, p.cutLine, p.seamLine)
              const cutPts = notchCutoutPoints(cutPos.position, cutPos.angle, depth, width, p.cutLine, cutParam, notch.type)
              let d = bestNotch.dist + 1
              if (cutPts) {
                d = distanceToNotchCutoutGeom(local, cutPts, cutPos.position)
              } else {
                const { position } = getNotchPositionAndAngle(notch, p.cutLine, p.seamLine)
                d = Math.hypot(local.x - position.x, local.y - position.y)
              }
              if (d < bestNotch.dist) bestNotch = { dist: d, pieceId: p.id, notchId: notch.id }
              if (p.seamLine.length >= 3) {
                const seamPos = getNotchPositionAndAngleOnSeamLine(notch, p.cutLine, p.seamLine)
                if (seamPos) {
                  const seamPts = notchCutoutPoints(seamPos.position, seamPos.angle, depth, width, p.seamLine, undefined, notch.type)
                  if (seamPts) {
                    const dSeam = distanceToNotchCutoutGeom(local, seamPts, seamPos.position)
                    if (dSeam < bestNotch.dist) bestNotch = { dist: dSeam, pieceId: p.id, notchId: notch.id }
                  } else {
                    const dSeam = Math.hypot(local.x - seamPos.position.x, local.y - seamPos.position.y)
                    if (dSeam < bestNotch.dist) bestNotch = { dist: dSeam, pieceId: p.id, notchId: notch.id }
                  }
                }
              }
            }
          }
          const vertexInRange = bestVertex.value != null && bestVertex.dist <= HOVER_DELETE_HIT
          const notchInRange = bestNotch.dist <= NOTCH_HOVER_HIT
          if (vertexInRange && notchInRange) {
            if (bestNotch.dist < bestVertex.dist) {
              setHoveredDeletableNotch({ pieceId: bestNotch.pieceId, notchId: bestNotch.notchId })
              setHoveredDeletablePoint(null)
              setHoveredInternalLine(null)
              setNotchPreview(null)
              setHoveredPieceId(null)
              return
            }
          } else if (notchInRange) {
            setHoveredDeletableNotch({ pieceId: bestNotch.pieceId, notchId: bestNotch.notchId })
            setHoveredDeletablePoint(null)
            setHoveredInternalLine(null)
            setNotchPreview(null)
            setHoveredPieceId(null)
            return
          }
          if (vertexInRange) {
            setHoveredDeletablePoint(bestVertex.value)
            setHoveredDeletableNotch(null)
            setHoveredInternalLine(null)
            setHoveredPieceId(null)
            return
          }
          const INTERNAL_LINE_HOVER_HIT = 10
          let bestInternalLine: { dist: number; pieceId: string; curveIndex: number } | null = null
          for (const p of piecesForHover) {
            if (p.internalLines.length === 0) continue
            const local = worldToPieceLocal(world, p)
            const r = nearestCurveIndexAndPoint(local, p.internalLines)
            if (r && r.distance < INTERNAL_LINE_HOVER_HIT && (!bestInternalLine || r.distance < bestInternalLine.dist)) {
              bestInternalLine = { dist: r.distance, pieceId: p.id, curveIndex: r.curveIndex }
            }
          }
          if (bestInternalLine) {
            setHoveredInternalLine({ pieceId: bestInternalLine.pieceId, curveIndex: bestInternalLine.curveIndex })
          } else {
            setHoveredInternalLine(null)
          }
          setHoveredDeletablePoint(null)
          setHoveredDeletableNotch(null)
        } else {
          setHoveredDeletablePoint(null)
          const worldForNotch = toWorld(e.clientX, e.clientY)
          const selectedPiecesForNotch = selectedPieceIds.length > 0
            ? pieces.filter((p) => selectedPieceIds.includes(p.id))
            : []
          const piecesForNotchHover =
            selectedPiecesForNotch.some((p) => p.notches.length > 0) ? selectedPiecesForNotch : pieces
          let bestNotch: { dist: number; pieceId: string; notchId: string } = {
            dist: NOTCH_HOVER_HIT + 1,
            pieceId: '',
            notchId: '',
          }
          for (const p of piecesForNotchHover) {
            const local = worldToPieceLocal(worldForNotch, p)
            for (const notch of p.notches) {
              const depth = notch.depth
              const width = notch.width ?? 6
              const cutPos = getNotchPositionAndAngleOnCutLine(notch, p.cutLine, p.seamLine)
              const cutParam = getNotchCurveIndexAndT(notch, p.cutLine, p.seamLine)
              const cutPts = notchCutoutPoints(cutPos.position, cutPos.angle, depth, width, p.cutLine, cutParam, notch.type)
              let d = bestNotch.dist + 1
              if (cutPts) {
                d = distanceToNotchCutoutGeom(local, cutPts, cutPos.position)
              } else {
                const { position } = getNotchPositionAndAngle(notch, p.cutLine, p.seamLine)
                d = Math.hypot(local.x - position.x, local.y - position.y)
              }
              if (d < bestNotch.dist) bestNotch = { dist: d, pieceId: p.id, notchId: notch.id }
              if (p.seamLine.length >= 3) {
                const seamPos = getNotchPositionAndAngleOnSeamLine(notch, p.cutLine, p.seamLine)
                if (seamPos) {
                  const seamPts = notchCutoutPoints(seamPos.position, seamPos.angle, depth, width, p.seamLine, undefined, notch.type)
                  if (seamPts) {
                    const dSeam = distanceToNotchCutoutGeom(local, seamPts, seamPos.position)
                    if (dSeam < bestNotch.dist) bestNotch = { dist: dSeam, pieceId: p.id, notchId: notch.id }
                  } else {
                    const dSeam = Math.hypot(local.x - seamPos.position.x, local.y - seamPos.position.y)
                    if (dSeam < bestNotch.dist) bestNotch = { dist: dSeam, pieceId: p.id, notchId: notch.id }
                  }
                }
              }
            }
          }
          if (bestNotch.dist <= NOTCH_HOVER_HIT) {
            setHoveredDeletableNotch({ pieceId: bestNotch.pieceId, notchId: bestNotch.notchId })
            setHoveredDeletablePoint(null)
            setHoveredInternalLine(null)
            setNotchPreview(null)
            setHoveredPieceId(null)
          } else {
            setHoveredDeletableNotch(null)
            if (tool === 'select' || tool === 'point' || tool === 'curvepoint') {
              const INTERNAL_LINE_HOVER_HIT_ELSE = 10
              let bestInternalLine: { dist: number; pieceId: string; curveIndex: number } | null = null
              for (const p of piecesForNotchHover) {
                if (p.internalLines.length === 0) continue
                const local = worldToPieceLocal(worldForNotch, p)
                const r = nearestCurveIndexAndPoint(local, p.internalLines)
                if (r && r.distance < INTERNAL_LINE_HOVER_HIT_ELSE && (!bestInternalLine || r.distance < bestInternalLine.dist)) {
                  bestInternalLine = { dist: r.distance, pieceId: p.id, curveIndex: r.curveIndex }
                }
              }
              if (bestInternalLine) {
                setHoveredInternalLine({ pieceId: bestInternalLine.pieceId, curveIndex: bestInternalLine.curveIndex })
              } else {
                setHoveredInternalLine(null)
              }
            } else {
              setHoveredInternalLine(null)
            }
          }
        }
        if (tool === 'notch') {
          const world = toWorld(e.clientX, e.clientY)
          const piecesToCheck =
            selectedPieceIds.length === 1 ? pieces.filter((p) => p.id === selectedPieceIds[0]) : pieces
          let best: {
            distance: number
            piece: PatternPiece
            r: { curveIndex: number; point: Point; t: number }
            curves: Curve[]
          } | null = null
          for (const piece of piecesToCheck) {
            const hasSeam = piece.seamLine.length >= 3
            const solidIsCut = !hasSeam || cutSeamSwappedSet.has(piece.id)
            const curves = (hasSeam && !solidIsCut) ? piece.seamLine : piece.cutLine
            if (curves.length === 0) continue
            const local = worldToPieceLocal(world, piece)
            const r = nearestCurveIndexAndPoint(local, curves)
            if (!r || r.distance > 20) continue
            const t = r.t ?? 0
            if (!best || r.distance < best.distance) {
              best = { distance: r.distance, piece, r: { curveIndex: r.curveIndex, point: r.point, t }, curves }
            }
          }
          if (best) {
            setHoveredInternalLine(null)
            const { piece, r, curves } = best
            const outwardAngle = outwardNormalAngleAt(curves, r.curveIndex, r.t)
            const angle = outwardAngle + 180
            const notchesOnSegment = piece.notches
              .map((n) => {
                const pos =
                  curves === piece.seamLine && piece.seamLine.length > 0
                    ? (getNotchPositionAndAngleOnSeamLine(n, piece.cutLine, piece.seamLine)?.position ??
                       getNotchPositionAndAngle(n, piece.cutLine, piece.seamLine).position)
                    : getNotchPositionAndAngle(n, piece.cutLine, piece.seamLine).position
                const nr = nearestCurveIndexAndPoint(pos, curves)
                return nr && nr.curveIndex === r.curveIndex && nr.t != null ? nr.t : null
              })
              .filter((x): x is number => x != null)
            const curve = curves[r.curveIndex]
            const distanceMmLeft = distanceToPrevVertexOrNotch(curve, r.t, notchesOnSegment)
            const distanceMmRight = distanceToNextVertexOrNotch(curve, r.t, notchesOnSegment)
            setNotchPreview({
              pieceId: piece.id,
              position: r.point,
              angle,
              curveIndex: r.curveIndex,
              t: r.t,
              distanceMmLeft,
              distanceMmRight,
              storePos: r.point,
              storeAngle: angle,
            })
          } else {
            setNotchPreview(null)
            setHoveredInternalLine(null)
          }
          setHoveredPieceId(null)
          return
        }
        setNotchPreview(null)
        if (tool === 'kante') {
          const world = toWorld(e.clientX, e.clientY)
          const HOVER_SEGMENT_HIT = 12
          let bestSeg: { distance: number; pieceId: string; curveIndex: number } | null = null
          const piecesToCheck =
            selectedPieceIds.length > 0 ? pieces.filter((p) => selectedPieceIds.includes(p.id)) : pieces
          for (const p of piecesToCheck) {
            const masterK = useSeamLineForPointCurveEditing(p) ? p.seamLine : p.cutLine
            if (masterK.length === 0) continue
            const local = worldToPieceLocal(world, p)
            const r = nearestCurveIndexAndPoint(local, masterK)
            const curve = r ? masterK[r.curveIndex] : null
            if (
              r &&
              curve?.type === 'line' &&
              r.distance < HOVER_SEGMENT_HIT &&
              (!bestSeg || r.distance < bestSeg.distance)
            ) {
              bestSeg = { distance: r.distance, pieceId: p.id, curveIndex: r.curveIndex }
            }
          }
          if (bestSeg) {
            const seg = { pieceId: bestSeg.pieceId, curveIndex: bestSeg.curveIndex }
            const pos = { clientX: e.clientX, clientY: e.clientY }
            lastSegmentRef.current = seg
            lastSegmentPosRef.current = pos
            setHoveredSegment(seg)
            setHoveredSegmentPos(pos)
            setHoveredInternalLine(null)
            setHoveredPieceId(null)
            return
          }
          setHoveredSegment(null)
          setHoveredSegmentPos(null)
          setHoveredInternalLine(null)
        }
        if (tool === 'point' && selectedPieceIds.length === 1) {
          const world = toWorld(e.clientX, e.clientY)
          const pieceId = selectedPieceIds[0]
          const p = pieces.find((x) => x.id === pieceId)
          if (!p) {
            setPointPreview(null)
          } else {
          const masterPv = useSeamLineForPointCurveEditing(p) ? p.seamLine : p.cutLine
          if (masterPv.length > 0) {
            const local = worldToPieceLocal(world, p)
            const nearest = nearestPointForMasterPointEditing(p, local, POINT_INSERT_HIT_MM)
            if (nearest) {
              setPointPreview({ pieceId: p.id, point: nearest.point })
            } else {
              setPointPreview(null)
            }
          } else {
            setPointPreview(null)
          }
          }
        } else {
          setPointPreview(null)
        }
        if (tool === 'curvepoint' && selectedPieceIds.length === 1) {
          const world = toWorld(e.clientX, e.clientY)
          const pieceId = selectedPieceIds[0]
          const p = pieces.find((x) => x.id === pieceId)
          if (!p) {
            setHoveredCurvepointSegment(null)
          } else {
          const masterCv = useSeamLineForPointCurveEditing(p) ? p.seamLine : p.cutLine
          if (masterCv.length > 0) {
            const local = worldToPieceLocal(world, p)
            const r = nearestPointForMasterPointEditing(p, local, POINT_INSERT_HIT_MM)
            if (r && masterCv[r.curveIndex]?.type === 'line') {
              setHoveredCurvepointSegment({ pieceId: p.id, curveIndex: r.curveIndex })
            } else {
              setHoveredCurvepointSegment(null)
            }
          } else {
            setHoveredCurvepointSegment(null)
          }
          }
        } else {
          setHoveredCurvepointSegment(null)
        }
        if (tool === 'select' && nahtzuordnungMode !== 'first' && nahtzuordnungMode !== 'second') {
          const world = toWorld(e.clientX, e.clientY)
          for (let i = pieces.length - 1; i >= 0; i--) {
            const p = pieces[i]
            const local = worldToPieceLocal(world, p)
            if (isPointInsidePiece(local, p)) {
              setHoveredPieceId(p.id)
              return
            }
          }
        }
        if (tool !== 'kante') {
          setHoveredSegment(null)
          setHoveredSegmentPos(null)
        }
        setHoveredPieceId(null)
        return
      }
      if (dragging.kind === 'pan') {
        setView({
          panX: dragging.startPan.x + (e.clientX - dragging.startClient.x),
          panY: dragging.startPan.y + (e.clientY - dragging.startClient.y),
        })
      } else if (dragging.kind === 'piece') {
        const world = toWorld(e.clientX, e.clientY)
        const piece = pieces.find((p) => p.id === dragging.pieceId)
        if (!piece) return
        const dx = world.x - dragging.start.x
        const dy = world.y - dragging.start.y
        movePiece(dragging.pieceId, dx, dy)
        setDragging((d) => (d && d.kind === 'piece' ? { ...d, start: world } : d))
      } else if (dragging.kind === 'rotate') {
        const piece = pieces.find((p) => p.id === dragging.pieceId)
        if (!piece || piece.cutLine.length < 3) return
        const pivot = getPiecePivotLocal(piece)
        const worldCenter = pieceLocalToWorld(pivot, piece)
        const world = toWorld(e.clientX, e.clientY)
        const currentWorldAngle = (Math.atan2(world.y - worldCenter.y, world.x - worldCenter.x) * 180) / Math.PI
        const deltaAngle = currentWorldAngle - dragging.startWorldAngle
        setPieceRotation(dragging.pieceId, dragging.startRotation + deltaAngle)
      } else if (dragging.kind === 'pivot') {
        const piece = pieces.find((p) => p.id === dragging.pieceId)
        if (!piece || piece.cutLine.length < 3) return
        const bounds = curvesBounds(piece.cutLine)
        if (!bounds) return
        const world = toWorld(e.clientX, e.clientY)
        let local = worldToPieceLocal(world, piece)
        local = {
          x: Math.max(bounds.minX, Math.min(bounds.maxX, local.x)),
          y: Math.max(bounds.minY, Math.min(bounds.maxY, local.y)),
        }
        setPiecePivot(dragging.pieceId, local)
      } else if (dragging.kind === 'grainPoint') {
        const piece = pieces.find((p) => p.id === dragging.pieceId)
        if (!piece || piece.cutLine.length < 3) return
        const bounds = curvesBounds(piece.cutLine)
        if (!bounds) return
        const world = toWorld(e.clientX, e.clientY)
        let local = worldToPieceLocal(world, piece)
        local = {
          x: Math.max(bounds.minX, Math.min(bounds.maxX, local.x)),
          y: Math.max(bounds.minY, Math.min(bounds.maxY, local.y)),
        }
        const currentLine = piece.grainLine ?? getPieceGrainLine(piece)
        setGrainLine(dragging.pieceId, {
          ...currentLine,
          [dragging.which]: local,
        })
      } else if (dragging.kind === 'grainLine') {
        const piece = pieces.find((p) => p.id === dragging.pieceId)
        if (!piece || piece.cutLine.length < 3) return
        const bounds = curvesBounds(piece.cutLine)
        if (!bounds) return
        const world = toWorld(e.clientX, e.clientY)
        const local = worldToPieceLocal(world, piece)
        const dx = local.x - dragging.startLocal.x
        const dy = local.y - dragging.startLocal.y
        const newLine = clampGrainLineParallelTranslation(dragging.lineAtPointerDown, dx, dy, bounds)
        setGrainLine(dragging.pieceId, newLine)
      } else if (dragging.kind === 'rectangle') {
        const current = toWorld(e.clientX, e.clientY)
        setDragging((d) => (d && d.kind === 'rectangle' ? { ...d, current } : d))
      } else if (dragging.kind === 'selectionMarquee') {
        const current = toWorld(e.clientX, e.clientY)
        setDragging((d) => (d && d.kind === 'selectionMarquee' ? { ...d, current } : d))
      } else if (dragging.kind === 'vertex') {
        const piece = pieces.find((p) => p.id === dragging.pieceId)
        if (!piece) return
        const world = toWorld(e.clientX, e.clientY)
        let local = worldToPieceLocal(world, piece)
        if (e.altKey) {
          const SNAP_MM = 5
          const start = dragging.startLocal
          local = {
            x: start.x + Math.round((local.x - start.x) / SNAP_MM) * SNAP_MM,
            y: start.y + Math.round((local.y - start.y) / SNAP_MM) * SNAP_MM,
          }
        }
        updateVertex(
          dragging.pieceId,
          dragging.vertexIndex,
          local,
          false,
          dragging.notchStabilize ? { notchResyncBaseline: dragging.notchStabilize } : undefined
        )
        // Nahtzuordnung: bei Längendifferenz < 5 mm und Alt/⌘/Strg → exakt auf gleiche Kantenlänge wie Gegenstück (Store: snapSeamEdgeToMatch).
        if (e.altKey || e.metaKey || e.ctrlKey) {
          snapSeamEdgeToMatch(
            dragging.pieceId,
            dragging.vertexIndex,
            dragging.notchStabilize ? { notchResyncBaseline: dragging.notchStabilize } : undefined
          )
        }
      } else if (dragging.kind === 'pointOnCurve') {
        const piece = pieces.find((p) => p.id === dragging.pieceId)
        if (!piece) return
        const world = toWorld(e.clientX, e.clientY)
        const local = worldToPieceLocal(world, piece)
        const editSeamPc = useSeamLineForPointCurveEditing(piece)
        const hasSeam = piece.seamLine.length >= 3
        const showSeam = hasSeam && !cutSeamSwappedSet.has(piece.id)
        let target = local
        if (!editSeamPc && showSeam && piece.seamAllowanceMm != null && piece.seamAllowanceMm > 0) {
          const angleDeg = outwardNormalAngleAt(piece.cutLine, dragging.curveIndex, dragging.t)
          const rad = (angleDeg * Math.PI) / 180
          const dx = piece.seamAllowanceMm * Math.cos(rad)
          const dy = piece.seamAllowanceMm * Math.sin(rad)
          target = { x: local.x + dx, y: local.y + dy }
        }
        movePointOnCurve(dragging.pieceId, dragging.curveIndex, dragging.t, target)
      } else if (dragging.kind === 'line') {
        const piece = pieces.find((p) => p.id === dragging.pieceId)
        if (!piece) return
        const world = toWorld(e.clientX, e.clientY)
        let current = worldToPieceLocal(world, piece)
        if (e.altKey || e.metaKey) {
          current = snapLineTo45Deg(dragging.start, current)
        }
        setDragging((d) => (d && d.kind === 'line' ? { ...d, current } : d))
      } else if (dragging.kind === 'notch') {
        const piece = pieces.find((p) => p.id === dragging.pieceId)
        if (!piece) return
        const world = toWorld(e.clientX, e.clientY)
        const current = worldToPieceLocal(world, piece)
        setDragging((d) => (d && d.kind === 'notch' ? { ...d, current } : d))
      } else if (dragging.kind === 'notchMove') {
        const piece = pieces.find((p) => p.id === dragging.pieceId)
        if (!piece || piece.cutLine.length === 0) return
        const world = toWorld(e.clientX, e.clientY)
        const local = worldToPieceLocal(world, piece)
        const hasSeam = piece.seamLine.length >= 3
        const solidIsCut = !hasSeam || cutSeamSwappedSet.has(piece.id)
        const useSeam = hasSeam && !solidIsCut
        const curves = useSeam ? piece.seamLine : piece.cutLine
        const nearest = nearestCurveIndexAndPoint(local, curves)
        if (nearest && nearest.distance < 25) {
          // Commit richtet sich (bei `notchMove`) immer auf cutLine (storePos/storeAngle).
          // Damit Vorschau und Commit konsistent sind, projizieren wir daher auch die
          // Distanzlabels und die Preview-Pose auf die cutLine.
          const tOnCurves = nearest.t ?? 0
          const cutNearest = nearestCurveIndexAndPoint(nearest.point, piece.cutLine)
          const cutT = cutNearest?.t ?? tOnCurves
          const tNudged = cutT <= NOTCH_MOVE_T_MIN ? NOTCH_MOVE_T_MIN : cutT >= NOTCH_MOVE_T_MAX ? NOTCH_MOVE_T_MAX : cutT
          const cutCurveIndex = cutNearest?.curveIndex ?? nearest.curveIndex
          const curve = piece.cutLine[cutCurveIndex]

          let storePos: Point
          let storeAngle: number
          if (cutNearest) {
            storePos = pointOnCurveAt(piece.cutLine[cutNearest.curveIndex], tNudged)
            storeAngle = outwardNormalAngleAt(piece.cutLine, cutNearest.curveIndex, tNudged) + 180
          } else {
            // Fallback (sollte selten passieren): verwende cutLine-Indizierung wie vorhanden.
            storePos = pointOnCurveAt(piece.cutLine[cutCurveIndex], tNudged)
            storeAngle = outwardNormalAngleAt(piece.cutLine, cutCurveIndex, tNudged) + 180
          }

          const notchesOnSegment = piece.notches
            .map((n) => {
              if (n.id === dragging.notchId) return tNudged
              const { position: notchPos } = getNotchPositionAndAngle(n, piece.cutLine, piece.seamLine)
              const nr = nearestCurveIndexAndPoint(notchPos, piece.cutLine)
              return nr && nr.curveIndex === cutCurveIndex && nr.t != null ? nr.t : null
            })
            .filter((x): x is number => x != null)

          const distanceMmLeft = distanceToPrevVertexOrNotch(curve, tNudged, notchesOnSegment)
          const distanceMmRight = distanceToNextVertexOrNotch(curve, tNudged, notchesOnSegment)
          setNotchPreview({
            pieceId: dragging.pieceId,
            position: storePos,
            angle: storeAngle,
            curveIndex: cutCurveIndex,
            t: tNudged,
            distanceMmLeft,
            distanceMmRight,
            storePos,
            storeAngle,
          })
        } else {
          setNotchPreview(null)
        }
      } else if (dragging.kind === 'drill') {
        const piece = pieces.find((p) => p.id === dragging.pieceId)
        if (!piece) return
        const world = toWorld(e.clientX, e.clientY)
        const current = worldToPieceLocal(world, piece)
        setDragging((d) => (d && d.kind === 'drill' ? { ...d, current } : d))
      } else if (dragging.kind === 'internalCircle') {
        const piece = pieces.find((p) => p.id === dragging.pieceId)
        if (!piece) return
        const world = toWorld(e.clientX, e.clientY)
        const current = worldToPieceLocal(world, piece)
        setDragging((d) => (d && d.kind === 'internalCircle' ? { ...d, current } : d))
      } else if (dragging.kind === 'ruler') {
        const world = toWorld(e.clientX, e.clientY)
        const current = snapRulerToNearestPoint(world, pieces)
        setDragging((d) => (d && d.kind === 'ruler' ? { ...d, current } : d))
      }
    },
    [
      dragging,
      tool,
      toWorld,
      setView,
      movePiece,
      pieces,
      updateVertex,
      movePointOnCurve,
      updateNotch,
      toggleNotchAnchor,
      showPoints,
      selectedPieceIds,
      setNotchPreview,
      hoveredDeletableNotch,
      nahtzuordnungMode,
      cutSeamSwappedSet,
      digitizeState,
      updateDigitizeDrag,
      snapSeamEdgeToMatch,
      setPieceRotation,
      setPiecePivot,
      setGrainLine,
      setImagePosition,
      setImageRenderMmPerPixel,
      imageDigitizeSession,
      setHoveredWorkspaceImage,
      updateWorkspaceNote,
    ]
  )

  useEffect(() => {
    if (!workspaceNoteEditor) return
    let cancelled = false
    let onClose: ((ev: PointerEvent) => void) | null = null
    const t = window.setTimeout(() => {
      if (cancelled) return
      onClose = (ev: PointerEvent) => {
        if (workspaceNoteEditorRef.current?.contains(ev.target as Node)) return
        setWorkspaceNoteEditor(null)
      }
      document.addEventListener('pointerdown', onClose, true)
    }, 0)
    return () => {
      cancelled = true
      clearTimeout(t)
      if (onClose) document.removeEventListener('pointerdown', onClose, true)
    }
  }, [workspaceNoteEditor])

  useEffect(() => {
    if (!grainContextMenu) return
    const onClose = () => setGrainContextMenu(null)
    document.addEventListener('pointerdown', onClose)
    return () => document.removeEventListener('pointerdown', onClose)
  }, [grainContextMenu])

  useEffect(() => {
    if (!pieceContextMenu) return
    const onClose = () => setPieceContextMenu(null)
    document.addEventListener('pointerdown', onClose)
    return () => document.removeEventListener('pointerdown', onClose)
  }, [pieceContextMenu])

  useEffect(() => {
    if (!workspaceImageQuickMenu) return
    const onClose = () => setWorkspaceImageQuickMenu(null)
    document.addEventListener('pointerdown', onClose)
    return () => document.removeEventListener('pointerdown', onClose)
  }, [workspaceImageQuickMenu])

  /** Eckpunkt ziehen: Taste Alt/⌘/Strg drücken, wenn Nahtlänge schon < 5 mm daneben → sofort exakt angleichen (ohne erneute Mausbewegung). */
  useEffect(() => {
    if (!dragging || dragging.kind !== 'vertex') return
    const pieceId = dragging.pieceId
    const vertexIndex = dragging.vertexIndex
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.repeat) return
      if (ev.altKey || ev.metaKey || ev.ctrlKey) {
        snapSeamEdgeToMatch(
          pieceId,
          vertexIndex,
          dragging.notchStabilize ? { notchResyncBaseline: dragging.notchStabilize } : undefined
        )
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [dragging, snapSeamEdgeToMatch])

  /** Mittelklick (Mausrad): alle Modi abbrechen — überall außer in Eingabefeldern und auf Links (Neuer Tab). */
  const resetCanvasTransientState = useCallback(() => {
    setDragging(null)
    setLineLengthEditor(null)
    setWorkspaceImageQuickMenu(null)
    setGrainContextMenu(null)
    setPieceContextMenu(null)
    setGrainFlipHover(null)
    setNotchPreview(null)
    setPointPreview(null)
    setDigitizeMouseWorld(null)
    setDigitizeNearFirst(false)
    setHoveredSeamForNahtzuordnung(null)
    setHoveredPieceId(null)
    setHoveredDeletablePoint(null)
    setHoveredDeletableNotch(null)
    setHoveredInternalLine(null)
    setHoveredSeamAssignmentId(null)
    setHoveredCurvepointSegment(null)
    closeSegmentMenu()
    setWorkspaceNoteEditor(null)
    setNotchEditTarget(null)
  }, [closeSegmentMenu])

  useEffect(() => {
    const skipMiddle = (el: HTMLElement | null) => {
      if (!el) return true
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return true
      if (el.closest('a[href]')) return true
      return false
    }
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 1) return
      if (skipMiddle(e.target as HTMLElement | null)) return
      e.preventDefault()
      e.stopPropagation()
      exitAllModes()
      resetCanvasTransientState()
    }
    /** Ohne stopPropagation erreicht Mittelklick trotzdem ggf. noch SVG/React und startet Vertex-Drag. */
    const onAuxClick = (e: MouseEvent) => {
      if (e.button !== 1) return
      if (skipMiddle(e.target as HTMLElement | null)) return
      e.preventDefault()
      e.stopPropagation()
    }
    document.addEventListener('pointerdown', onPointerDown, { capture: true })
    document.addEventListener('auxclick', onAuxClick, { capture: true })
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, { capture: true })
      document.removeEventListener('auxclick', onAuxClick, { capture: true })
    }
  }, [exitAllModes, resetCanvasTransientState])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      if (workspaceNoteEditor && e.key === 'Escape') {
        e.preventDefault()
        setWorkspaceNoteEditor(null)
        return
      }
      if (seamAssignmentMetaDialogId && e.key === 'Escape') {
        e.preventDefault()
        setSeamAssignmentMetaDialogId(null)
        return
      }
      if (seamAssignmentMetaDialogId && e.key === ' ') {
        if (!target.closest('.nahtzugabe-dialog')) {
          e.preventDefault()
          return
        }
      }
      if (!inInput && lineLengthEditor && e.key === 'Escape') {
        e.preventDefault()
        if (lineLengthEditor.mode === 'draw') {
          setDragging(null)
          setTool('select')
        }
        setLineLengthEditor(null)
        return
      }
      if (!inInput && dragging?.kind === 'line' && tool === 'internalLine' && e.key === ' ') {
        e.preventDefault()
        const len = Math.hypot(
          dragging.current.x - dragging.start.x,
          dragging.current.y - dragging.start.y
        )
        setLineLengthEditor({
          mode: 'draw',
          pieceId: dragging.pieceId,
          start: dragging.start,
          current: dragging.current,
          value: len > 0 ? len.toFixed(1) : '100',
        })
        return
      }
      if (!inInput && hoveredSeamAssignmentId && e.key === ' ') {
        e.preventDefault()
        setSeamAssignmentMetaDialogId(hoveredSeamAssignmentId)
        return
      }
      if (!inInput && !dragging && hoveredInternalLine && !hoveredSeamAssignmentId && e.key === ' ') {
        const piece = pieces.find((p) => p.id === hoveredInternalLine.pieceId)
        const curve = piece?.internalLines[hoveredInternalLine.curveIndex]
        if (piece && curve) {
          e.preventDefault()
          const len = Math.hypot(curve.end.x - curve.start.x, curve.end.y - curve.start.y)
          setLineLengthEditor({
            mode: 'hoverInternal',
            pieceId: piece.id,
            curveIndex: hoveredInternalLine.curveIndex,
            start: curve.start,
            current: curve.end,
            value: len > 0 ? len.toFixed(1) : '100',
          })
          return
        }
      }
      if (!inInput && (e.key === 'F1' || e.key === '?')) {
        setShowHelpModal(true)
        e.preventDefault()
        return
      }
      const segmentActive = hoveredSegment ?? (segmentMenuPinned ? pinnedSegment : null)
      if (!inInput && workspaceImageQuickMenu && e.key === 'Escape') {
        e.preventDefault()
        setWorkspaceImageQuickMenu(null)
        return
      }
      if (!inInput && e.key === 'Escape' && (edgeSeamPickingActive || edgeAllowancePopover)) {
        e.preventDefault()
        setEdgeAllowancePopover(null)
        setHoveredEdgePicking(null)
        setEdgeSeamPickingActive(false)
        return
      }
      if (!inInput && e.key === 'Escape' && tool === 'profil') {
        e.preventDefault()
        setHoveredProfileEdge(null)
        setTool('select')
        return
      }
      if (!inInput && e.key === 'Escape') {
        if (notchEditTarget) {
          e.preventDefault()
          setNotchEditTarget(null)
          return
        }
        if (batchSelectionTargets.length > 0) {
          e.preventDefault()
          clearBatchSelection()
          return
        }
        if (tool === 'notch') {
          e.preventDefault()
          if (dragging?.kind === 'notch') {
            setDragging(null)
            return
          }
          setTool('select')
          return
        }
        if (tool === 'digitize' && digitizeState) {
          e.preventDefault()
          cancelDigitize()
          return
        }
        if (tool === 'note') {
          e.preventDefault()
          setTool('select')
          return
        }
        if (workspaceImageSelected) {
          e.preventDefault()
          setWorkspaceImageSelected(false)
          return
        }
      }
      if (grainContextMenu && !inInput && e.key === 'Escape') {
        e.preventDefault()
        setGrainContextMenu(null)
        return
      }
      if (pieceContextMenu && !inInput && e.key === 'Escape') {
        e.preventDefault()
        setPieceContextMenu(null)
        return
      }
      if (grainFlipHover && !grainContextMenu && !inInput && e.key === ' ') {
        e.preventDefault()
        setGrainContextMenu({ pieceId: grainFlipHover.pieceId, clientX: grainFlipHover.clientX, clientY: grainFlipHover.clientY })
        return
      }
      if (grainFlipHover && !grainContextMenu && !inInput && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault()
        setEdgeSeamPickingActive(true)
        return
      }
      if (
        !inInput &&
        !dragging &&
        !segmentActive &&
        hoveredWorkspaceImage &&
        imageDigitizeSession?.imageDataUrl &&
        imageDigitizeSession.imageSizePx &&
        e.key === ' '
      ) {
        e.preventDefault()
        setWorkspaceImageQuickMenu({
          clientX: lastPointerClientRef.current.x,
          clientY: lastPointerClientRef.current.y,
        })
        return
      }
      if (!inInput && hoveredDeletablePoint) {
        const hp = hoveredDeletablePoint
        if (hp.kind === 'vertex') {
          if (e.key === 'p' || e.key === 'P') {
            setVertexSoft(hp.pieceId, hp.vertexIndex, true)
            e.preventDefault()
            return
          }
          if (e.key === 'e' || e.key === 'E') {
            setVertexSoft(hp.pieceId, hp.vertexIndex, false)
            e.preventDefault()
            return
          }
          if (e.key === 'c' || e.key === 'C') {
            const piece = pieces.find((x) => x.id === hp.pieceId)
            if (piece) {
              const masterPc = useSeamLineForPointCurveEditing(piece) ? piece.seamLine : piece.cutLine
              const ci = hp.vertexIndex
              const curve = masterPc[ci]
              if (curve?.type === 'line') {
                const seg = curve
                const { start, end } = seg
                const dx = end.x - start.x
                const dy = end.y - start.y
                const cp1 = { x: start.x + dx / 3, y: start.y + dy / 3 }
                const cp2 = { x: start.x + (2 * dx) / 3, y: start.y + (2 * dy) / 3 }
                replaceSegmentWithBezier(hp.pieceId, ci, cp1, cp2)
              } else if (curve?.type === 'bezier') {
                setToastMessage('warn:Segment ist bereits eine Kurve.')
              }
            }
            e.preventDefault()
            return
          }
        } else if (hp.kind === 'pointOnCurve' && (e.key === 'e' || e.key === 'E')) {
          convertBezierSegmentToLine(hp.pieceId, hp.curveIndex)
          e.preventDefault()
          return
        }
      }
      if (segmentActive && !inInput) {
        const parseMm = (): number => {
          const n = parseFloat(segmentMenuMm)
          return Number.isFinite(n) ? n : 5
        }
        if (e.key === ' ') {
          e.preventDefault()
          if (segmentMenuPinned) {
            setSegmentMenuPinned(false)
            setPinnedSegment(null)
            setPinnedSegmentPos(null)
          } else if (hoveredSegment && hoveredSegmentPos) {
            setSegmentMenuPinned(true)
            setPinnedSegment(hoveredSegment)
            setPinnedSegmentPos(hoveredSegmentPos)
          }
          return
        }
        if (e.key === 'Escape') {
          closeSegmentMenu()
          e.preventDefault()
          return
        }
        if (e.key === 'o' || e.key === 'O') {
          const mm = parseMm()
          offsetSegment(segmentActive.pieceId, segmentActive.curveIndex, mm)
          closeSegmentMenu()
          e.preventDefault()
          return
        }
        if (e.key === 'p' || e.key === 'P') {
          const mm = parseMm()
          const p = pieces.find((x) => x.id === segmentActive.pieceId)
          if (p) {
            const masterSeg = useSeamLineForPointCurveEditing(p) ? p.seamLine : p.cutLine
            const pts = offsetSegmentPoints(masterSeg, segmentActive.curveIndex, mm)
            if (pts) addInternalLine(segmentActive.pieceId, { type: 'line', start: pts.start, end: pts.end })
          }
          closeSegmentMenu()
          e.preventDefault()
          return
        }
      }
      if (e.key === '5') {
        const targetId = hoveredPieceId ?? (selectedPieceIds.length === 1 ? selectedPieceIds[0] : null)
        if (!inInput && targetId) {
          setCutSeamSwappedSet((prev) => {
            const next = new Set(prev)
            if (next.has(targetId)) next.delete(targetId)
            else next.add(targetId)
            return next
          })
          e.preventDefault()
        }
        return
      }
      if (e.key === 'n' || e.key === 'N') {
        if (!inInput) {
          setTool('notch')
          e.preventDefault()
        }
        return
      }
      if (e.key === 'c' || e.key === 'C') {
        if (!inInput) {
          setTool('curvepoint')
          e.preventDefault()
        }
        return
      }
      // Alt+D = Drehpunkt (P bleibt für „Punkt“-Werkzeug). e.code wegen Mac-Option-Taste (Sonderzeichen).
      if (!inInput && tool === 'select' && e.altKey && e.code === 'KeyD') {
        const piecesForPivot =
          selectedPieceIds.length > 0 ? pieces.filter((p) => selectedPieceIds.includes(p.id)) : []
        const world = toWorld(lastPointerClientRef.current.x, lastPointerClientRef.current.y)
        const snapped =
          piecesForPivot.length > 0
            ? findPivotSnapTargetAtWorld(world, piecesForPivot)
            : null
        if (snapped && selectedPieceIds.includes(snapped.pieceId)) {
          setPiecePivot(snapped.pieceId, snapped.pivotLocal)
          setToastMessage('success:Drehpunkt hier gesetzt (Alt+D).')
        } else if (piecesForPivot.length === 0) {
          setToastMessage('error:Teil auswählen, dann Maus auf Ecke, Kerbe oder Bézier-Mitte — Alt+D.')
        } else {
          setToastMessage(
            'error:Maus näher an Ecke, Kerbe oder Bézier-Kurvenmitte (grüner Punkt), dann Alt+D.'
          )
        }
        e.preventDefault()
        return
      }
      if (e.key === 'p' || e.key === 'P') {
        if (!inInput) {
          setTool('point')
          e.preventDefault()
        }
        return
      }
      if (e.key === 'k' || e.key === 'K') {
        if (!inInput) {
          setTool('kante')
          e.preventDefault()
        }
        return
      }
      if (e.key === 'm' || e.key === 'M') {
        if (!inInput) {
          setTool('massstab')
          e.preventDefault()
        }
        return
      }
      if (e.key === 'd' || e.key === 'D') {
        if (!inInput && !e.altKey) {
          setTool('digitize')
          startDigitize()
          e.preventDefault()
        }
        return
      }
      if (e.key === 's' || e.key === 'S') {
        if (!inInput) {
          setPendingNahtzugabeClick(true)
          e.preventDefault()
        }
        return
      }
      if ((e.key === 'l' || e.key === 'L') && !inInput && !grainFlipHover) {
        e.preventDefault()
        setEdgeSeamPickingActive(true)
        return
      }
      if ((e.key === 'r' || e.key === 'R') && !inInput && selectedPieceIds.length > 0) {
        e.preventDefault()
        selectedPieceIds.forEach((id) => rotatePiece90(id))
        return
      }
      if ((e.key === 'a' || e.key === 'A') && !inInput && selectedPieceIds.length > 0) {
        e.preventDefault()
        selectedPieceIds.forEach((id) => alignPieceToGrain(id))
        return
      }
      if ((e.key === 'e' || e.key === 'E') && !inInput && tool === 'select' && hoveredDeletableNotch && !dragging) {
        e.preventDefault()
        setNotchEditTarget({
          pieceId: hoveredDeletableNotch.pieceId,
          notchId: hoveredDeletableNotch.notchId,
        })
        return
      }
      if ((e.key === 'f' || e.key === 'F') && !inInput && hoveredDeletableNotch) {
        e.preventDefault()
        toggleNotchAnchor(hoveredDeletableNotch.pieceId, hoveredDeletableNotch.notchId)
        return
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (!inInput && batchSelectionTargets.length > 0) {
        e.preventDefault()
        batchDeleteFiltered()
        return
      }
      if (workspaceImageSelected && imageDigitizeSession && !hoveredDeletablePoint) {
        e.preventDefault()
        cancelImageSession()
        return
      }
      if (hoveredSeamAssignmentId) {
        e.preventDefault()
        removeSeamAssignment(hoveredSeamAssignmentId)
        setHoveredSeamAssignmentId(null)
        return
      }
      if (hoveredDeletableNotch) {
        e.preventDefault()
        removeNotch(hoveredDeletableNotch.pieceId, hoveredDeletableNotch.notchId)
        setNotchEditTarget((prev) =>
          prev &&
          prev.pieceId === hoveredDeletableNotch!.pieceId &&
          prev.notchId === hoveredDeletableNotch!.notchId
            ? null
            : prev
        )
        setHoveredDeletableNotch(null)
        return
      }
      if (hoveredInternalLine) {
        e.preventDefault()
        removeInternalLine(hoveredInternalLine.pieceId, hoveredInternalLine.curveIndex)
        setHoveredInternalLine(null)
        return
      }
      if (!hoveredDeletablePoint) return
      e.preventDefault()
      if (hoveredDeletablePoint.kind === 'vertex') {
        const piece = pieces.find((x) => x.id === hoveredDeletablePoint.pieceId)
        const isSoft = piece ? masterSoftVertexIndexSet(piece).has(hoveredDeletablePoint.vertexIndex) : false
        if (isSoft) {
          // Weiche Punkte (blau) werden per Entf nur ent-weichtet (blau -> rot), nicht geometrisch gelöscht.
          setVertexSoft(hoveredDeletablePoint.pieceId, hoveredDeletablePoint.vertexIndex, false)
        } else {
          removeVertex(hoveredDeletablePoint.pieceId, hoveredDeletablePoint.vertexIndex)
        }
      } else {
        convertBezierSegmentToLine(hoveredDeletablePoint.pieceId, hoveredDeletablePoint.curveIndex)
      }
      setHoveredDeletablePoint(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [
    hoveredDeletablePoint,
    hoveredDeletableNotch,
    hoveredInternalLine,
    hoveredSeamAssignmentId,
    seamAssignmentMetaDialogId,
    setSeamAssignmentMetaDialogId,
    hoveredSegment,
    segmentMenuPinned,
    pinnedSegment,
    segmentMenuMm,
    pieces,
    selectedPieceIds,
    removeVertex,
    setVertexSoft,
    replaceSegmentWithBezier,
    convertBezierSegmentToLine,
    removeNotch,
    removeInternalLine,
    toggleNotchAnchor,
    removeSeamAssignment,
    setTool,
    offsetSegment,
    addInternalLine,
    addCurveToCutLine,
    dragging,
    lineLengthEditor,
    rotatePiece90,
    alignPieceToGrain,
    closeSegmentMenu,
    hoveredPieceId,
    setPendingNahtzugabeClick,
    grainFlipHover,
    grainContextMenu,
    pieceContextMenu,
    setPieceContextMenu,
    workspaceNoteEditor,
    digitizeState,
    cancelDigitize,
    startDigitize,
    setShowHelpModal,
    workspaceImageSelected,
    imageDigitizeSession,
    cancelImageSession,
    setWorkspaceImageSelected,
    hoveredWorkspaceImage,
    workspaceImageQuickMenu,
    setPiecePivot,
    setToastMessage,
    tool,
    setDragging,
    toWorld,
    batchSelectionTargets,
    clearBatchSelection,
    batchDeleteFiltered,
    notchEditTarget,
  ])

  const handlePointerUp = useCallback((_e?: React.PointerEvent) => {
    if (dragging?.kind === 'digitizeDrag') {
      finishDigitizeDrag()
      setDragging(null)
      return
    }
    if (dragging?.kind === 'image-move' || dragging?.kind === 'image-resize') {
      setDragging(null)
      return
    }
    if (dragging?.kind === 'ruler') {
      const end = snapRulerToNearestPoint(dragging.current, pieces)
      const len = Math.hypot(end.x - dragging.start.x, end.y - dragging.start.y)
      if (len >= 0.1) {
        setRulerLine({ start: dragging.start, end })
      }
      setDragging(null)
      return
    }
    if (dragging?.kind === 'selectionMarquee') {
      const { start, current } = dragging
      const minX = Math.min(start.x, current.x)
      const minY = Math.min(start.y, current.y)
      const maxX = Math.max(start.x, current.x)
      const maxY = Math.max(start.y, current.y)
      const w = maxX - minX
      const h = maxY - minY
      if (w < 1 || h < 1) {
        selectPiece(null)
        clearBatchSelection()
      } else {
        const targets = collectMarqueeTargets(pieces, { minX, minY, maxX, maxY })
        setBatchSelectionTargets(targets, Boolean(_e?.shiftKey))
        const merged = useStore.getState().batchSelectionTargets
        const uniqPieceIds = [...new Set(merged.map((t) => t.pieceId))]
        if (uniqPieceIds.length === 0) {
          selectPiece(null)
        } else {
          selectPiece(uniqPieceIds[0])
          for (let i = 1; i < uniqPieceIds.length; i++) {
            selectPiece(uniqPieceIds[i], true)
          }
        }
      }
      setDragging(null)
      return
    }
    if (dragging?.kind === 'rectangle') {
      const { start, current } = dragging
      const minX = Math.min(start.x, current.x)
      const minY = Math.min(start.y, current.y)
      const maxX = Math.max(start.x, current.x)
      const maxY = Math.max(start.y, current.y)
      const w = maxX - minX
      const h = maxY - minY
      if (w >= 1 && h >= 1) {
        const cutLine: import('../types/model').Curve[] = [
          { type: 'line', start: { x: 0, y: 0 }, end: { x: w, y: 0 } },
          { type: 'line', start: { x: w, y: 0 }, end: { x: w, y: h } },
          { type: 'line', start: { x: w, y: h }, end: { x: 0, y: h } },
          { type: 'line', start: { x: 0, y: h }, end: { x: 0, y: 0 } },
        ]
        addPiece({
          transform: { x: minX, y: minY, rotation: 0, mirrored: false },
          cutLine,
        })
        setTool('select')
      }
    } else if (dragging?.kind === 'line') {
      const { pieceId, start, current } = dragging
      if (lineLengthEditor && lineLengthEditor.pieceId === pieceId) return
      const piece = pieces.find((p) => p.id === pieceId)
      if (piece) {
        const len = Math.hypot(current.x - start.x, current.y - start.y)
        if (len >= 0.5) {
          if (tool === 'internalLine') {
            addInternalLine(pieceId, { type: 'line', start, end: current })
          } else {
            addCurveToCutLine(pieceId, { type: 'line', start, end: current })
          }
        }
        setTool('select')
      }
    } else if (dragging?.kind === 'notchMove') {
      if (notchPreview && notchPreview.pieceId === dragging.pieceId) {
        const movePiece = pieces.find((p) => p.id === dragging.pieceId)
        if (movePiece && movePiece.cutLine.length > 0) {
          const L = pathLengthAt(movePiece.cutLine, notchPreview.curveIndex, notchPreview.t)
          const total = totalPathLength(movePiece.cutLine)
          updateNotch(dragging.pieceId, dragging.notchId, {
            sNormalized: total > 0 ? L / total : undefined,
            arcLengthMm: total > 0 ? L : undefined,
            position: notchPreview.storePos,
            angle: notchPreview.storeAngle,
          })
        }
      }
      setNotchPreview(null)
      setDragging(null)
    } else if (dragging?.kind === 'notch') {
      const { pieceId, position, current, curveIndex, t, useSeamLine } = dragging
      const piece = pieces.find((p) => p.id === pieceId)
      if (piece) {
        const dx = current.x - position.x
        const dy = current.y - position.y
        const dragDist = Math.hypot(dx, dy)
        const DRAG_THRESHOLD = 2
        const presetIdx = Math.max(0, Math.min(notchSettings.length - 1, activeNotchPresetIndex))
        const notchPreset = notchSettings[presetIdx] ?? { type: 'strich' as const, widthMm: 2.5, depthMm: 2 }
        const modelFields = modelNotchFieldsFromPreset(notchPreset)
        if (!modelFields) {
          setDragging(null)
          setTool('notch')
          return
        }
        const { type: notchModelType, depth: defaultDepth, width: defaultWidth } = modelFields
        const isDrag = dragDist >= DRAG_THRESHOLD
        const curves = useSeamLine && piece.seamLine.length >= 3 ? piece.seamLine : piece.cutLine
        /** Strich-Kerbe: Tiefe immer senkrecht zur Schnittkontur (Innennormale), nie in Mausrichtung. */
        let angle: number
        if (notchModelType === 'single') {
          if (useSeamLine && piece.seamLine.length >= 3) {
            const cn = nearestCurveIndexAndPoint(position, piece.cutLine)
            if (cn) {
              const ct = cn.t ?? 0
              angle = outwardNormalAngleAt(piece.cutLine, cn.curveIndex, ct) + 180
            } else {
              angle = outwardNormalAngleAt(piece.cutLine, curveIndex, t) + 180
            }
          } else {
            angle = outwardNormalAngleAt(piece.cutLine, curveIndex, t) + 180
          }
        } else if (isDrag) {
          angle = (Math.atan2(dy, dx) * 180) / Math.PI
        } else {
          angle = outwardNormalAngleAt(curves, curveIndex, t) + 180
        }
        const id = 'n' + Math.random().toString(36).slice(2, 9)
        const rejectNotchSpacing = () => {
          setToastMessage(
            'error: Zwischen zwei Kerben müssen mindestens 4 mm Abstand liegen (entlang der Schnittkontur).'
          )
          setDragging(null)
          setTool('notch')
        }
        if (useSeamLine && piece.seamLine.length >= 3) {
          let notchPos = position
          let notchAngle = angle
          const cutNearest = nearestCurveIndexAndPoint(position, piece.cutLine)
          if (cutNearest) {
            notchPos = cutNearest.point
            if (!isDrag || notchModelType === 'single') {
              const ct = cutNearest.t ?? 0
              notchAngle = outwardNormalAngleAt(piece.cutLine, cutNearest.curveIndex, ct) + 180
            }
          }
          const nrOnCut = cutNearest ?? nearestCurveIndexAndPoint(notchPos, piece.cutLine)
          if (!nrOnCut || !isNotchSpacingValid(piece, nrOnCut.curveIndex, nrOnCut.t ?? 0)) {
            rejectNotchSpacing()
            return
          }
          addNotch(pieceId, {
            id,
            position: notchPos,
            angle: notchAngle,
            type: notchModelType,
            depth: defaultDepth,
            width: defaultWidth,
          })
        } else {
          if (!isNotchSpacingValid(piece, curveIndex, t)) {
            rejectNotchSpacing()
            return
          }
          const notchPos = nearestCurveIndexAndPoint(position, piece.cutLine)?.point ?? position
          const L = pathLengthAt(piece.cutLine, curveIndex, t)
          const total = totalPathLength(piece.cutLine)
          addNotch(pieceId, {
            id,
            position: notchPos,
            angle,
            type: notchModelType,
            depth: defaultDepth,
            width: defaultWidth,
            sNormalized: total > 0 ? L / total : undefined,
            arcLengthMm: total > 0 ? L : undefined,
          })
        }
      }
    } else if (dragging?.kind === 'drill') {
      const { pieceId, center, current } = dragging
      const piece = pieces.find((p) => p.id === pieceId)
      if (piece) {
        const radius = Math.hypot(current.x - center.x, current.y - center.y)
        const id = 'd' + Math.random().toString(36).slice(2, 9)
        addDrill(pieceId, { id, center, radius: radius >= 0.5 ? radius : 2 })
        setTool('select')
      }
    } else if (dragging?.kind === 'internalCircle') {
      const { pieceId, center, current } = dragging
      const piece = pieces.find((p) => p.id === pieceId)
      if (piece) {
        const r = Math.hypot(current.x - center.x, current.y - center.y)
        if (r >= 0.5) {
          const n = 24
          const curves: Curve[] = []
          for (let i = 0; i < n; i++) {
            const a0 = (i * 2 * Math.PI) / n
            const a1 = ((i + 1) * 2 * Math.PI) / n
            curves.push({
              type: 'line',
              start: { x: center.x + r * Math.cos(a0), y: center.y + r * Math.sin(a0) },
              end: { x: center.x + r * Math.cos(a1), y: center.y + r * Math.sin(a1) },
            })
          }
          addInternalLines(pieceId, curves)
        }
        setTool('select')
      }
    } else if (dragging?.kind === 'vertex') {
      if (_e && (_e.altKey || _e.metaKey || _e.ctrlKey)) {
        snapSeamEdgeToMatch(
          dragging.pieceId,
          dragging.vertexIndex,
          dragging.notchStabilize ? { notchResyncBaseline: dragging.notchStabilize } : undefined
        )
      }
      // Cut-as-Master: Nahtlinie aus Schnittkante nachziehen. Bei Seam-as-Master ist seamLine die
      // bearbeitete Kontur (updateVertex leitet cutLine schon ab) – recomputeSeamLine würde seam überschreiben.
      const draggedPiece = pieces.find((p) => p.id === dragging.pieceId)
      // Gleiche Master-Logik wie in der Vertex-Bearbeitung nutzen (verhindert seltene Divergenzfälle).
      const seamIsMaster = draggedPiece != null && useSeamLineForVertexEditing(draggedPiece)
      if (!seamIsMaster) {
        recomputeSeamLine(dragging.pieceId)
      }
    }
    if (_e && dragging?.kind === 'grainLine') {
      const pieceSnap = useStore.getState().workspace.pieces.find((p) => p.id === dragging.pieceId)
      if (pieceSnap && pieceSnap.cutLine.length >= 3) {
        const world = toWorld(_e.clientX, _e.clientY)
        const local = worldToPieceLocal(world, pieceSnap)
        const nr = nearestCurveIndexAndPoint(local, pieceSnap.cutLine)
        if (nr && nr.distance <= GRAIN_SNAP_TO_EDGE_MM) {
          const t = nr.t ?? 0
          const tangDeg = contourTangentAngleDeg(pieceSnap.cutLine, nr.curveIndex, t)
          const currentLine = pieceSnap.grainLine ?? getPieceGrainLine(pieceSnap)
          const aligned = alignGrainLineToContourTangent(currentLine, tangDeg)
          const bounds = curvesBounds(pieceSnap.cutLine)
          if (bounds) {
            setGrainLine(dragging.pieceId, clampLineSegmentInAabb(aligned, bounds))
          }
        }
      }
    }
    setDragging(null)
    setHoveredPieceId(null)
  }, [
    dragging,
    pieces,
    tool,
    addPiece,
    addCurveToCutLine,
    addInternalLine,
    addInternalLines,
    insertPointOnCutLine,
    addNotch,
    addDrill,
    updateNotch,
    notchPreview,
    setTool,
    setToastMessage,
    finishDigitizeDrag,
    recomputeSeamLine,
    snapSeamEdgeToMatch,
    lineLengthEditor,
    toWorld,
    setGrainLine,
    selectPiece,
    clearBatchSelection,
    setBatchSelectionTargets,
    notchSettings,
    activeNotchPresetIndex,
    cutSeamSwappedSet,
  ])
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      if (!containerRef.current || !svgRef.current) return
      const svgRect = svgRef.current.getBoundingClientRect()
      const scale = Math.min(svgRect.width / VIEWBOX_WIDTH, svgRect.height / VIEWBOX_HEIGHT)
      const offsetX = (svgRect.width - VIEWBOX_WIDTH * scale) / 2
      const offsetY = (svgRect.height - VIEWBOX_HEIGHT * scale) / 2
      const svgUserX = (e.clientX - svgRect.left - offsetX) / scale
      const svgUserY = (e.clientY - svgRect.top - offsetY) / scale
      const worldX = (svgUserX - view.panX) / view.zoom
      const worldY = (svgUserY - view.panY) / view.zoom
      const factor = e.deltaY > 0 ? 0.9 : 1.1
      const newZoom = Math.max(0.1, Math.min(10, view.zoom * factor))
      setView({
        zoom: newZoom,
        panX: svgUserX - worldX * newZoom,
        panY: svgUserY - worldY * newZoom,
      })
    },
    [view.zoom, view.panX, view.panY, setView]
  )

  return (
    <div
      ref={containerRef}
      className="workspace-canvas"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => {
        handlePointerUp()
        setHoveredDeletablePoint(null)
        setHoveredDeletableNotch(null)
        setNotchPreview(null)
        setPointPreview(null)
        setHoveredSeamForNahtzuordnung(null)
        setHoveredSeamAssignmentId(null)
      }}
      onWheel={handleWheel}
      style={{
        touchAction: 'none',
        cursor:
          rulerMode
            ? 'crosshair'
            : tool === 'pan'
              ? 'grab'
              : tool === 'rectangle' ||
                  tool === 'point' ||
                  tool === 'curvepoint' ||
                  tool === 'line' ||
                  tool === 'internalLine' ||
                  tool === 'internalCircle' ||
                  tool === 'digitize' ||
                  tool === 'massstab' ||
                  tool === 'note'
                ? 'crosshair'
                : 'default',
      }}
    >
      <div className="workspace-version">Aktuell V. 0.0.5</div>
      {notchEditTarget &&
        tool === 'select' &&
        (() => {
          const editPiece = pieces.find((p) => p.id === notchEditTarget.pieceId)
          const editNotch = editPiece?.notches.find((n) => n.id === notchEditTarget.notchId)
          if (!editPiece || !editNotch) return null
          const matchedPreset = findMatchingNotchPresetIndex(editNotch, notchSettings)
          return (
            <div
              className="notch-properties-bar"
              style={{
                position: 'fixed',
                bottom: 12,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 10001,
                isolation: 'isolate',
                pointerEvents: 'auto',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                background: 'rgba(255,255,255,0.98)',
                border: '1px solid #1565c0',
                borderRadius: 8,
                boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
                maxWidth: 'min(96vw, 640px)',
                fontSize: 13,
                fontFamily: 'system-ui, sans-serif',
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            >
              <span style={{ fontWeight: 600, color: '#1565c0' }}>Kerbe bearbeiten</span>
              <span style={{ fontSize: 11, color: '#666' }}>Alt+Klick oder E (über Kerbe)</span>
              <span
                style={{
                  fontSize: 11,
                  color: '#6d4c41',
                  border: '1px solid #cfd8dc',
                  borderRadius: 999,
                  padding: '2px 8px',
                  background: '#fafafa',
                }}
                title="Kerbe ist frei auf der Linie"
              >
                Frei (Linienanker)
              </span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ whiteSpace: 'nowrap' }}>Aus Einstellungen</span>
                <select
                  value={matchedPreset === null ? '' : String(matchedPreset)}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === '') return
                    const idx = Number(v)
                    const preset = notchSettings[idx]
                    if (!preset) return
                    const f = modelNotchFieldsFromPreset(preset)
                    if (!f) {
                      setToastMessage(
                        'error: Dieses Preset ist „Keine Notch“. In den Einstellungen einen Typ wählen (Strich/Kerbe).'
                      )
                      return
                    }
                    updateNotch(editPiece.id, editNotch.id, {
                      type: f.type,
                      depth: f.depth,
                      width: f.width,
                    })
                  }}
                  style={{ fontSize: 13, minWidth: 220, maxWidth: 360 }}
                >
                  {matchedPreset === null && (
                    <option value="">Preset aus Einstellungen wählen…</option>
                  )}
                  {notchSettings.map((n, i) => {
                    const typLabel = n.type === 'kerbe' ? 'Kerbe' : n.type === 'keine' ? 'Keine' : 'Strich'
                    return (
                      <option key={i} value={i}>
                        Notch {i + 1}: {typLabel} ({n.widthMm}×{n.depthMm} mm)
                      </option>
                    )
                  })}
                </select>
              </label>
              {matchedPreset === null && (
                <span style={{ fontSize: 11, color: '#c62828', maxWidth: 280 }}>
                  Kein exakter Treffer zu den 10 Einstellungen (z. B. Doppel-Kerbe). Bitte Preset wählen.
                </span>
              )}
              <button
                type="button"
                className="sidebar-btn"
                style={{ fontSize: 12, padding: '4px 10px' }}
                onClick={() => setNotchEditTarget(null)}
              >
                Schließen
              </button>
            </div>
          )
        })()}
      {batchSelectionTargets.length > 0 && (
        <div
          className="batch-selection-bar"
          style={{
            position: 'fixed',
            bottom: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10000,
            isolation: 'isolate',
            pointerEvents: 'auto',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            background: 'rgba(255,255,255,0.96)',
            border: '1px solid #bdbdbd',
            borderRadius: 8,
            boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
            maxWidth: 'min(96vw, 920px)',
            fontSize: 13,
            fontFamily: 'system-ui, sans-serif',
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          <span style={{ fontWeight: 600, marginRight: 4 }}>Fensterauswahl</span>
          <span style={{ color: '#555' }}>
            {filteredBatchTargets.length} von {batchSelectionTargets.length}
          </span>
          <span style={{ color: '#999' }}>|</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            Filter:
            <select
              value={batchSelectionFilter}
              onChange={(e) => setBatchSelectionFilter(e.currentTarget.value as BatchSelectionFilter)}
              style={{ fontSize: 13 }}
            >
              <option value="all">Alles</option>
              <option value="vertices">Eckpunkte (alle)</option>
              <option value="softVertices">Weiche Punkte (blau)</option>
              <option value="hardVertices">Feste Eckpunkte (rot)</option>
              <option value="notches">Kerben</option>
              <option value="curvePoints">Kurvenpunkte</option>
              <option value="internalLines">Interne Linien</option>
              <option value="pieces">Komplette Teile (Rahmen umschließt Teil)</option>
            </select>
          </label>
          <span style={{ color: '#999' }}>|</span>
          <span style={{ fontSize: 12, color: '#666' }}>Markierung (nur Anzeige):</span>
          <button
            type="button"
            style={{ padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}
            onClick={() => setBatchUiHighlightForFiltered('#ff9800')}
          >
            Orange
          </button>
          <button
            type="button"
            style={{ padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}
            onClick={() => setBatchUiHighlightForFiltered('#e91e63')}
          >
            Magenta
          </button>
          <button
            type="button"
            style={{ padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}
            onClick={() => setBatchUiHighlightForFiltered('#2e7d32')}
          >
            Grün
          </button>
          <button type="button" style={{ padding: '4px 8px', fontSize: 12, cursor: 'pointer' }} onClick={() => clearBatchUiHighlight()}>
            Markierung aus
          </button>
          <span style={{ color: '#999' }}>|</span>
          <span style={{ fontSize: 12, color: '#666' }}>Eckpunkte:</span>
          <button type="button" style={{ padding: '4px 8px', fontSize: 12, cursor: 'pointer' }} onClick={() => batchSetVerticesSoft(true)}>
            weich (blau)
          </button>
          <button type="button" style={{ padding: '4px 8px', fontSize: 12, cursor: 'pointer' }} onClick={() => batchSetVerticesSoft(false)}>
            fest (rot)
          </button>
          <span style={{ color: '#999' }}>|</span>
          <button
            type="button"
            style={{ padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}
            onClick={() => {
              if (window.confirm('Ausgewählte Elemente (gefiltert) wirklich löschen?')) batchDeleteFiltered()
            }}
          >
            Löschen
          </button>
          <button type="button" style={{ padding: '4px 8px', fontSize: 12, cursor: 'pointer' }} onClick={() => clearBatchSelection()}>
            Auswahl aufheben
          </button>
          <span style={{ fontSize: 11, color: '#888', width: '100%', marginTop: 2 }}>
            Shift+Fensterauswahl: zur bestehenden Auswahl hinzufügen · Entf: gefilterte löschen (inkl. komplette Teile) · Esc:
            Auswahl aufheben
          </span>
        </div>
      )}
      {workspaceNoteEditor && (() => {
        const edited = (workspaceNotesList ?? []).find((n) => n.id === workspaceNoteEditor.noteId)
        if (!edited) return null
        return createPortal(
          <div
            ref={workspaceNoteEditorRef}
            className="workspace-note-editor"
            style={{
              position: 'fixed',
              left: workspaceNoteEditor.clientX,
              top: workspaceNoteEditor.clientY,
              zIndex: 2500,
              transform: 'translate(8px, 8px)',
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                background: '#fffde7',
                border: '1px solid #f9a825',
                borderRadius: 8,
                boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
                padding: 10,
                minWidth: 220,
                maxWidth: 360,
                fontSize: 13,
                fontFamily: 'system-ui, sans-serif',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 8, color: '#e65100' }}>Notiz</div>
              <textarea
                className="workspace-note-textarea"
                value={edited.text}
                onChange={(e) => updateWorkspaceNote(edited.id, { text: e.target.value })}
                rows={5}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  resize: 'vertical',
                  font: 'inherit',
                  border: '1px solid #ccc',
                  borderRadius: 4,
                  padding: 8,
                }}
                autoFocus
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="workspace-note-delete-btn"
                  style={{
                    padding: '6px 12px',
                    fontSize: 13,
                    cursor: 'pointer',
                    border: '1px solid #c62828',
                    borderRadius: 4,
                    background: '#fff',
                    color: '#c62828',
                  }}
                  onClick={() => {
                    removeWorkspaceNote(edited.id)
                    setWorkspaceNoteEditor(null)
                  }}
                >
                  Löschen
                </button>
                <button
                  type="button"
                  className="workspace-note-close-btn"
                  style={{
                    padding: '6px 12px',
                    fontSize: 13,
                    cursor: 'pointer',
                    border: '1px solid #ccc',
                    borderRadius: 4,
                    background: '#fff',
                  }}
                  onClick={() => setWorkspaceNoteEditor(null)}
                >
                  Schließen
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      })()}
      {grainFlipHover && !grainContextMenu && !hoveredDeletablePoint && !hoveredDeletableNotch && (
        <div
          className="grain-flip-tooltip"
          style={{
            position: 'fixed',
            left: grainFlipHover.clientX,
            top: grainFlipHover.clientY,
            transform: 'translate(8px, 8px)',
            pointerEvents: 'none',
            zIndex: 1000,
          }}
        >
          Leertaste: Menü · L: Nahtzugabe/Kante
        </div>
      )}
      {grainContextMenu && (
        <div
          style={{
            position: 'fixed',
            left: grainContextMenu.clientX,
            top: grainContextMenu.clientY,
            zIndex: 2000,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              background: '#fff',
              border: '1px solid #ccc',
              borderRadius: 6,
              boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
              minWidth: 180,
              padding: '4px 0',
              fontSize: 13,
              fontFamily: 'sans-serif',
            }}
          >
            <button
              type="button"
              style={{
                display: 'block',
                width: '100%',
                padding: '6px 16px',
                background: 'none',
                border: 'none',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 13,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              onClick={() => {
                flipPieceAlongGrain(grainContextMenu.pieceId)
                setGrainContextMenu(null)
                setGrainFlipHover(null)
              }}
            >
              Spiegellinie (Flippen)
            </button>
            <button
              type="button"
              style={{
                display: 'block',
                width: '100%',
                padding: '6px 16px',
                background: 'none',
                border: 'none',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 13,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              onClick={() => {
                deletePiece(grainContextMenu.pieceId)
                setGrainContextMenu(null)
                setGrainFlipHover(null)
              }}
            >
              Teil löschen
            </button>
            <button
              type="button"
              style={{
                display: 'block',
                width: '100%',
                padding: '6px 16px',
                background: 'none',
                border: 'none',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 13,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              onClick={() => {
                const piece = pieces.find((p) => p.id === grainContextMenu.pieceId)
                if (!piece) return
                addPiece({
                  ...piece,
                  id: undefined,
                  number: undefined,
                  name: piece.name,
                })
                setGrainContextMenu(null)
                setGrainFlipHover(null)
              }}
            >
              Teil kopieren
            </button>
            <button
              type="button"
              style={{
                display: 'block',
                width: '100%',
                padding: '6px 16px',
                background: 'none',
                border: 'none',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 13,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              onClick={() => {
                const piece = pieces.find((p) => p.id === grainContextMenu.pieceId)
                if (!piece) return
                selectPiece(piece.id)
                setPiecePropertiesDialogPieceId(piece.id)
                setGrainContextMenu(null)
                setGrainFlipHover(null)
              }}
            >
              Teil-Eigenschaften
            </button>
          </div>
        </div>
      )}
      {pieceContextMenu && (
        <div
          style={{
            position: 'fixed',
            left: pieceContextMenu.clientX,
            top: pieceContextMenu.clientY,
            zIndex: 2000,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              background: '#fff',
              border: '1px solid #ccc',
              borderRadius: 6,
              boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
              minWidth: 140,
              padding: '4px 0',
              fontSize: 13,
              fontFamily: 'sans-serif',
            }}
          >
            <button
              type="button"
              style={{
                display: 'block',
                width: '100%',
                padding: '6px 16px',
                background: 'none',
                border: 'none',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 13,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              onClick={() => {
                rotatePiece90(pieceContextMenu.pieceId)
                setPieceContextMenu(null)
              }}
            >
              90° drehen
            </button>
            <button
              type="button"
              style={{
                display: 'block',
                width: '100%',
                padding: '6px 16px',
                background: 'none',
                border: 'none',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 13,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              onClick={() => {
                alignPieceToGrain(pieceContextMenu.pieceId)
                setPieceContextMenu(null)
              }}
            >
              An Laufrichtung ausrichten <span className="menubar-shortcut">A</span>
            </button>
            <button
              type="button"
              style={{
                display: 'block',
                width: '100%',
                padding: '6px 16px',
                background: 'none',
                border: 'none',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 13,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              onClick={() => {
                selectPiece(pieceContextMenu.pieceId)
                setPiecePropertiesDialogPieceId(pieceContextMenu.pieceId)
                setPieceContextMenu(null)
              }}
            >
              Teil-Eigenschaften
            </button>
          </div>
        </div>
      )}
      {segmentMenuVisible && segmentForMenu && segmentPosForMenu && (
        <div
          className="segment-context-menu"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerEnter={() => {
            if (lastSegmentRef.current && lastSegmentPosRef.current) {
              setPointerOverSegmentMenu(true)
              setFrozenSegment(lastSegmentRef.current)
              setFrozenSegmentPos(lastSegmentPosRef.current)
            }
          }}
          onPointerLeave={() => {
            setPointerOverSegmentMenu(false)
            setFrozenSegment(null)
            setFrozenSegmentPos(null)
          }}
          style={{
            position: 'fixed',
            left: segmentPosForMenu.clientX,
            top: segmentPosForMenu.clientY,
            transform: 'translate(12px, 12px)',
            zIndex: 1001,
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: 6,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            padding: '8px 0',
            minWidth: 160,
            fontSize: 13,
            fontFamily: 'sans-serif',
          }}
        >
          <div style={{ padding: '4px 12px', color: '#666', borderBottom: '1px solid #eee', marginBottom: 6 }}>
            Kante
            {segmentMenuPinned && (
              <span style={{ marginLeft: 6, fontSize: 11, color: '#999' }}>· Leertaste zum Lösen</span>
            )}
          </div>
          <div style={{ padding: '4px 12px 8px', borderBottom: '1px solid #eee' }}>
            <label style={{ display: 'block', marginBottom: 4, color: '#333' }}>Abstand (mm)</label>
            <input
              type="number"
              step={0.5}
              min={-100}
              max={100}
              value={segmentMenuMm}
              onChange={(e) => setSegmentMenuMm(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '4px 6px',
                border: '1px solid #ccc',
                borderRadius: 4,
                fontSize: 13,
              }}
            />
          </div>
          <button
            type="button"
            style={{
              display: 'block',
              width: '100%',
              padding: '6px 12px',
              border: 'none',
              background: 'none',
              textAlign: 'left',
              cursor: 'pointer',
            }}
            onClick={() => {
              const mm = Number.isFinite(parseFloat(segmentMenuMm)) ? parseFloat(segmentMenuMm) : 5
              offsetSegment(segmentForMenu.pieceId, segmentForMenu.curveIndex, mm)
              closeSegmentMenu()
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#e3f2fd'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'none'
            }}
          >
            Offset <span style={{ color: '#999', marginLeft: 4 }}>O</span>
          </button>
          <button
            type="button"
            style={{
              display: 'block',
              width: '100%',
              padding: '6px 12px',
              border: 'none',
              background: 'none',
              textAlign: 'left',
              cursor: 'pointer',
            }}
            onClick={() => {
              const mm = Number.isFinite(parseFloat(segmentMenuMm)) ? parseFloat(segmentMenuMm) : 5
              const p = pieces.find((x) => x.id === segmentForMenu.pieceId)
              if (p) {
                const masterSeg = useSeamLineForPointCurveEditing(p) ? p.seamLine : p.cutLine
                const pts = offsetSegmentPoints(masterSeg, segmentForMenu.curveIndex, mm)
                if (pts) {
                  addInternalLine(segmentForMenu.pieceId, { type: 'line', start: pts.start, end: pts.end })
                }
              }
              closeSegmentMenu()
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#e3f2fd'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'none'
            }}
          >
            Parallel <span style={{ color: '#999', marginLeft: 4 }}>P</span>
          </button>
        </div>
      )}
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block' }}
      >
        <g transform={`translate(${view.panX},${view.panY}) scale(${view.zoom})`}>
          {showGrid && (
            <>
              <defs>
                <pattern
                  id="grid"
                  width={GRID_SIZE}
                  height={GRID_SIZE}
                  patternUnits="userSpaceOnUse"
                >
                  <path d={`M ${GRID_SIZE} 0 V ${GRID_SIZE * 100} M 0 ${GRID_SIZE} H ${GRID_SIZE * 100}`} fill="none" stroke="#e0e0e0" strokeWidth={0.3} />
                </pattern>
              </defs>
              <rect width="10000" height="10000" x="-5000" y="-5000" fill="url(#grid)" />
            </>
          )}
          {imageDigitizeSession &&
            imageDigitizeSession.imageDataUrl &&
            imageDigitizeSession.imageSizePx && (
              (() => {
                const session = imageDigitizeSession
                const effMmPerPixel = session.renderMmPerPixel
                const imageDataUrl = session.imageDataUrl ?? undefined
                const imageSizePx = session.imageSizePx!
                const imgW = imageSizePx.width * effMmPerPixel
                const imgH = imageSizePx.height * effMmPerPixel
                const x = session.imagePosition.x - imgW / 2
                const y = session.imagePosition.y - imgH / 2
                const lay = workspaceImageLayout(session)
                if (!lay) return null
                const corners = [
                  { cx: lay.left, cy: lay.top },
                  { cx: lay.right, cy: lay.top },
                  { cx: lay.left, cy: lay.bottom },
                  { cx: lay.right, cy: lay.bottom },
                ]
                const handleR = 5

                return (
                  <g pointerEvents="none">
                    <image
                      href={imageDataUrl}
                      x={x}
                      y={y}
                      width={imgW}
                      height={imgH}
                      opacity={WORKSPACE_IMAGE_OPACITY}
                      preserveAspectRatio="xMidYMid meet"
                    />
                    {workspaceImageSelected && (
                      <>
                        <rect
                          x={lay.left}
                          y={lay.top}
                          width={lay.w}
                          height={lay.h}
                          fill="none"
                          stroke={session.locked ? '#e65100' : '#1976d2'}
                          strokeWidth={1.2}
                          strokeDasharray="6 4"
                          vectorEffect="non-scaling-stroke"
                        />
                        {!session.locked &&
                          corners.map((c, i) => (
                            <circle
                              key={`img-handle-${i}`}
                              cx={c.cx}
                              cy={c.cy}
                              r={handleR}
                              fill="#fff"
                              stroke="#1976d2"
                              strokeWidth={1.2}
                              vectorEffect="non-scaling-stroke"
                            />
                          ))}
                      </>
                    )}
                  </g>
                )
              })()
            )}
          {pieces.map((piece) => {
            return (
            <PieceGroup
              key={piece.id}
              piece={piece}
              viewZoom={view.zoom}
              isSelected={selectedPieceIds.includes(piece.id)}
              isHovered={hoveredPieceId === piece.id}
              hoveredSegmentCurveIndex={effectiveSegmentForHighlight?.pieceId === piece.id ? effectiveSegmentForHighlight.curveIndex : null}
              hoveredSegmentOnSeam={
                effectiveSegmentForHighlight != null &&
                effectiveSegmentForHighlight.pieceId === piece.id &&
                useSeamLineForPointCurveEditing(piece) &&
                (tool === 'kante' ||
                  (tool === 'curvepoint' &&
                    hoveredCurvepointSegment != null &&
                    hoveredCurvepointSegment.pieceId === effectiveSegmentForHighlight.pieceId &&
                    hoveredCurvepointSegment.curveIndex === effectiveSegmentForHighlight.curveIndex))
              }
              hoveredInternalLineCurveIndex={hoveredInternalLine?.pieceId === piece.id ? hoveredInternalLine.curveIndex : null}
              onPointerDown={handlePointerDown}
              cutSeamSwapped={cutSeamSwappedSet.has(piece.id)}
              showGrain={showGrain}
              showNotches={showNotches}
              showDrills={showDrills}
              showInternalLines={showInternalLines}
              showPieceNames={showPieceNames}
              showContourMeasurements={showContourMeasurements}
              showPoints={showPoints}
              notchIdBeingDragged={
                dragging?.kind === 'notchMove' &&
                dragging.pieceId === piece.id &&
                notchPreview?.pieceId === piece.id
                  ? dragging.notchId
                  : null
              }
              hoveredNotchId={
                hoveredDeletableNotch?.pieceId === piece.id ? hoveredDeletableNotch.notchId : null
              }
              onGrainArrowEnter={(e) =>
                setGrainFlipHover({ pieceId: piece.id, clientX: e.clientX, clientY: e.clientY })
              }
              onGrainArrowLeave={() => setGrainFlipHover(null)}
              onGrainArrowMove={(e) =>
                setGrainFlipHover((prev) =>
                  prev && prev.pieceId === piece.id ? { ...prev, clientX: e.clientX, clientY: e.clientY } : prev
                )
              }
              onGrainArrowClick={(e) => {
                e.stopPropagation()
              }}
              onContextMenu={
                tool === 'select'
                  ? (e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setPieceContextMenu({ pieceId: piece.id, clientX: e.clientX, clientY: e.clientY })
                    }
                  : undefined
              }
            />
            )
          })}
          {showWorkspaceNotes &&
            (workspaceNotesList ?? []).map((wn) => {
              const piece = pieces.find((p) => p.id === wn.pieceId)
              if (!piece) return null
              const worldPos = pieceLocalToWorld(wn.position, piece)
              const z = 1 / Math.max(view.zoom, 1e-6)
              return (
                <g key={wn.id} transform={`translate(${worldPos.x},${worldPos.y}) scale(${z})`} pointerEvents="none">
                  <circle r={11} cx={0} cy={0} fill="#fff9c4" stroke="#f9a825" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                  <path
                    d="M -4,-3 L 4,-3 L 4,5 L 0,2 L -4,5 Z"
                    fill="none"
                    stroke="#e65100"
                    strokeWidth={1.2}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )
            })}
          {notchPreview && (() => {
            const piece = pieces.find((p) => p.id === notchPreview.pieceId)
            if (!piece) return null
            const tx = `translate(${piece.transform.x},${piece.transform.y}) rotate(${piece.transform.rotation}) scale(${piece.transform.mirrored ? -1 : 1},1)`
            const previewPresetIdx = Math.max(0, Math.min(notchSettings.length - 1, activeNotchPresetIndex))
            const previewPreset = notchSettings[previewPresetIdx] ?? { type: 'strich' as const, widthMm: 2.5, depthMm: 2 }
            const previewFields = modelNotchFieldsFromPreset(previewPreset)
            const depth = previewFields?.depth ?? 4
            const width = previewFields?.width ?? 6
            const previewNotchType: ModelNotchType =
              previewFields?.type ?? (previewPreset.type === 'kerbe' ? 'v' : 'single')
            /** Kerben hängen an der cutLine; bei Seam-Ansicht sind curveIndex/t auf der Naht — immer auf Schnitt projizieren. */
            const cutNearest = nearestCurveIndexAndPoint(notchPreview.position, piece.cutLine)
            const posOnCut = cutNearest?.point ?? notchPreview.position
            const previewAnchor = cutNearest
              ? { curveIndex: cutNearest.curveIndex, t: cutNearest.t ?? 0 }
              : { curveIndex: notchPreview.curveIndex, t: notchPreview.t }
            const angleOnCut = cutNearest
              ? outwardNormalAngleAt(piece.cutLine, cutNearest.curveIndex, cutNearest.t ?? 0) + 180
              : notchPreview.angle
            const PREVIEW_VERTEX_T_EPS = 0.03
            const previewNearCutVertex =
              previewAnchor.t <= PREVIEW_VERTEX_T_EPS || previewAnchor.t >= 1 - PREVIEW_VERTEX_T_EPS
            const previewCutPts =
              previewNotchType === 'single' || previewNearCutVertex
                ? null
                : notchCutoutPoints(
                    posOnCut,
                    angleOnCut,
                    depth,
                    width,
                    piece.cutLine,
                    previewAnchor,
                    previewNotchType
                  )
            const { fillD, edgesD } = previewCutPts
              ? notchCutoutSvgPaths(previewCutPts)
              : (() => {
                  const [a, b, c] = notchTriangleCorners(posOnCut, angleOnCut, depth, width)
                  return {
                    fillD: `M ${a.x} ${a.y} L ${b.x} ${b.y} L ${c.x} ${c.y} Z`,
                    edgesD: `M ${a.x} ${a.y} L ${c.x} ${c.y} L ${b.x} ${b.y}`,
                  }
                })()
            const previewNotchForSeam = {
              id: '__preview__',
              position: posOnCut,
              angle: angleOnCut,
              type: previewNotchType,
              depth,
              width,
            }
            const seamPreviewPose =
              piece.seamLine.length >= 3
                ? getNotchPositionAndAngleOnSeamLine(previewNotchForSeam, piece.cutLine, piece.seamLine)
                : null
            const seamNearest = seamPreviewPose
              ? nearestCurveIndexAndPoint(seamPreviewPose.position, piece.seamLine)
              : null
            const previewNearSeamVertex =
              seamNearest != null &&
              ((seamNearest.t ?? 0) <= PREVIEW_VERTEX_T_EPS ||
                (seamNearest.t ?? 0) >= 1 - PREVIEW_VERTEX_T_EPS)
            const seamPreviewPts =
              seamPreviewPose && !previewNearSeamVertex
                ? notchCutoutPoints(
                    seamPreviewPose.position,
                    seamPreviewPose.angle,
                    depth,
                    width,
                    piece.seamLine,
                    undefined,
                    previewNotchType
                  )
                : null
            const seamPreviewPaths = seamPreviewPts ? notchCutoutSvgPaths(seamPreviewPts) : null
            const labelOffset = 14
            const fontSize = 7
            const previewIsLine = previewCutPts?.kind === 'line'
            return (
              <g transform={tx} pointerEvents="none">
                {seamPreviewPaths?.fillD ? (
                  <path d={seamPreviewPaths.fillD} fill="#fff" fillOpacity={0.55} stroke="none" />
                ) : null}
                {seamPreviewPaths ? (
                  <path
                    d={seamPreviewPaths.edgesD}
                    fill="none"
                    stroke={NOTCH_STROKE}
                    strokeWidth={previewIsLine ? 0.85 : 0.75}
                    strokeLinejoin="round"
                    strokeLinecap={previewIsLine ? 'round' : 'butt'}
                    strokeOpacity={0.7}
                    strokeDasharray="3 2"
                  />
                ) : null}
                {fillD ? <path d={fillD} fill="#fff" stroke="none" /> : null}
                <path
                  d={edgesD}
                  fill="none"
                  stroke={NOTCH_STROKE}
                  strokeWidth={previewIsLine ? 0.9 : 0.8}
                  strokeLinejoin="round"
                  strokeLinecap={previewIsLine ? 'round' : 'butt'}
                />
                <text
                  x={posOnCut.x - labelOffset}
                  y={posOnCut.y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize={fontSize}
                  fill={NOTCH_STROKE}
                  fontFamily="sans-serif"
                  fontWeight="600"
                >
                  {notchPreview.distanceMmLeft.toFixed(1)} mm
                </text>
                <text
                  x={posOnCut.x + labelOffset}
                  y={posOnCut.y}
                  textAnchor="start"
                  dominantBaseline="middle"
                  fontSize={fontSize}
                  fill={NOTCH_STROKE}
                  fontFamily="sans-serif"
                  fontWeight="600"
                >
                  {notchPreview.distanceMmRight.toFixed(1)} mm
                </text>
              </g>
            )
          })()}
          {/* Punkt-Vorschau: wo der neue Punkt (P) gesetzt wird, wenn Maus auf der Linie ist */}
          {pointPreview && (() => {
            const piece = pieces.find((p) => p.id === pointPreview.pieceId)
            if (!piece) return null
            const w = pieceLocalToWorld(pointPreview.point, piece)
            const ps = 1 / Math.max(view.zoom, 1e-6)
            const [fill, stroke] = COLOR_SOFT_PUNKT
            return (
              <circle
                cx={w.x}
                cy={w.y}
                r={POINT_SCREEN_R * ps}
                fill={fill}
                stroke={stroke}
                strokeWidth={POINT_SCREEN_STROKE * ps}
                pointerEvents="none"
              />
            )
          })()}
          {/* Eckpunkte: Seam-as-Master = auf seamLine; sonst cut/seam je nach Ansicht */}
          {showPoints && (tool === 'select' || tool === 'point' || tool === 'curvepoint') &&
            (() => {
              const ps = 1 / Math.max(view.zoom, 1e-6)
              return selectedPieceIds.flatMap((pieceId) => {
                const piece = pieces.find((p) => p.id === pieceId)
                const useSeamMaster = piece != null && useSeamLineForVertexEditing(piece)
                const curvesForVertices = useSeamMaster ? piece!.seamLine : piece?.cutLine ?? []
                if (!piece || curvesForVertices.length === 0) return []
                const n = curvesForVertices.length
                const softOnMaster = masterSoftVertexIndexSet(piece)
                return Array.from({ length: n }, (_, vi) => {
                  const vertexPos = vi === 0 ? curvesForVertices[0].start : curvesForVertices[vi - 1].end
                  const w = pieceLocalToWorld(vertexPos, piece)
                  const isSoft = useSeamMaster ? softOnMaster.has(vi) : (piece.softVertices ?? []).includes(vi)
                  const [fill, stroke] = isSoft ? COLOR_SOFT_PUNKT : COLOR_ECKPUNKT
                  const eckSize = POINT_SCREEN_RECT * ps
                  return isSoft ? (
                    <circle
                      key={`${pieceId}-v-${vi}`}
                      cx={w.x}
                      cy={w.y}
                      r={POINT_SCREEN_R * ps}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={POINT_SCREEN_STROKE * ps}
                      pointerEvents="none"
                    />
                  ) : (
                    <rect
                      key={`${pieceId}-v-${vi}`}
                      x={w.x - eckSize / 2}
                      y={w.y - eckSize / 2}
                      width={eckSize}
                      height={eckSize}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={POINT_SCREEN_STROKE * ps}
                      pointerEvents="none"
                    />
                  )
                })
              })
            })()
          }
          {/* Kurvenpunkte (Bézier-Mitte): bei Nahtzugabe auf Nahtlinie, sonst Schnittkontur */}
          {showPoints && (tool === 'select' || tool === 'point' || tool === 'curvepoint') &&
            (() => {
              const ps = 1 / Math.max(view.zoom, 1e-6)
              return selectedPieceIds.flatMap((pieceId) => {
                const piece = pieces.find((p) => p.id === pieceId)
                if (!piece) return []
                const curvesDraw = useSeamLineForPointCurveEditing(piece) ? piece.seamLine : piece.cutLine
                const [fill, stroke] = COLOR_PUNKT_AUF_KURVE
                return curvesDraw.flatMap((c, ci) => {
                  if (c.type !== 'bezier') return []
                  const ptOnCurve = bezierAt(c, 0.5)
                  const w = pieceLocalToWorld(ptOnCurve, piece)
                  return [
                    <circle
                      key={`${pieceId}-oncurve-${ci}`}
                      cx={w.x}
                      cy={w.y}
                      r={POINT_SCREEN_R * ps}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={POINT_SCREEN_STROKE * ps}
                      pointerEvents="none"
                    />,
                  ]
                })
              })
            })()}
          {/* Digitalisierung: Linien/Kurven, Punkte, Handles, Vorschau, Close-Indikator */}
          {tool === 'digitize' && digitizeState && digitizeState.nodes.length > 0 && (() => {
            const dps = 1 / Math.max(view.zoom, 1e-6)
            const nodes = digitizeState.nodes
            const segments: React.ReactNode[] = []
            for (let i = 0; i < nodes.length - 1; i++) {
              const a = nodes[i]
              const b = nodes[i + 1]
              const hasA = a.handleOut != null
              const hasB = b.handleOut != null
              if (!hasA && !hasB) {
                segments.push(
                  <line
                    key={`dig-seg-${i}`}
                    x1={a.point.x} y1={a.point.y}
                    x2={b.point.x} y2={b.point.y}
                    stroke="#1565c0" strokeWidth={0.8}
                    pointerEvents="none"
                  />
                )
              } else {
                const cp1 = hasA ? a.handleOut! : a.point
                const cp2 = hasB
                  ? { x: 2 * b.point.x - b.handleOut!.x, y: 2 * b.point.y - b.handleOut!.y }
                  : b.point
                segments.push(
                  <path
                    key={`dig-seg-${i}`}
                    d={`M ${a.point.x} ${a.point.y} C ${cp1.x} ${cp1.y} ${cp2.x} ${cp2.y} ${b.point.x} ${b.point.y}`}
                    fill="none" stroke="#1565c0" strokeWidth={0.8}
                    pointerEvents="none"
                  />
                )
              }
            }
            const lastNode = nodes[nodes.length - 1]
            const handleElements: React.ReactNode[] = []
            for (let i = 0; i < nodes.length; i++) {
              const n = nodes[i]
              if (n.handleOut) {
                const reflected = { x: 2 * n.point.x - n.handleOut.x, y: 2 * n.point.y - n.handleOut.y }
                handleElements.push(
                  <g key={`dig-handle-${i}`} pointerEvents="none">
                    <line x1={n.point.x} y1={n.point.y} x2={n.handleOut.x} y2={n.handleOut.y}
                      stroke="#e65100" strokeWidth={0.5} strokeDasharray="2 1.5" opacity={0.7} />
                    <line x1={n.point.x} y1={n.point.y} x2={reflected.x} y2={reflected.y}
                      stroke="#e65100" strokeWidth={0.5} strokeDasharray="2 1.5" opacity={0.5} />
                    <circle
                      cx={n.handleOut.x}
                      cy={n.handleOut.y}
                      r={DIGITIZE_HANDLE_R * dps}
                      fill="#e65100"
                      stroke="#fff"
                      strokeWidth={0.5 * dps}
                    />
                    <circle
                      cx={reflected.x}
                      cy={reflected.y}
                      r={DIGITIZE_HANDLE_REFLECT_R * dps}
                      fill="none"
                      stroke="#e65100"
                      strokeWidth={0.45 * dps}
                      opacity={0.5}
                    />
                  </g>
                )
              }
            }
            return (
              <g pointerEvents="none">
                {segments}
                {handleElements}
                {digitizeMouseWorld && !digitizeState.isDragging && (
                  <line
                    x1={lastNode.point.x} y1={lastNode.point.y}
                    x2={digitizeMouseWorld.x} y2={digitizeMouseWorld.y}
                    stroke="#1565c0" strokeWidth={0.6}
                    strokeDasharray="3 2" opacity={0.5}
                  />
                )}
                {nodes.map((n, i) => (
                  <circle
                    key={`dig-pt-${i}`}
                    cx={n.point.x}
                    cy={n.point.y}
                    r={(i === 0 && digitizeNearFirst ? DIGITIZE_NODE_R_NEAR : DIGITIZE_NODE_R) * dps}
                    fill={i === 0 && digitizeNearFirst ? '#4caf50' : '#2196F3'}
                    stroke={i === 0 && digitizeNearFirst ? '#1b5e20' : '#0d47a1'}
                    strokeWidth={0.75 * dps}
                  />
                ))}
              </g>
            )
          })()}
          {dragging?.kind === 'rectangle' && (
            <rect
              x={Math.min(dragging.start.x, dragging.current.x)}
              y={Math.min(dragging.start.y, dragging.current.y)}
              width={Math.abs(dragging.current.x - dragging.start.x)}
              height={Math.abs(dragging.current.y - dragging.start.y)}
              fill="none"
              stroke="#000"
              strokeWidth={1}
              strokeDasharray="4 2"
              pointerEvents="none"
            />
          )}
          {dragging?.kind === 'selectionMarquee' && (
            <rect
              x={Math.min(dragging.start.x, dragging.current.x)}
              y={Math.min(dragging.start.y, dragging.current.y)}
              width={Math.abs(dragging.current.x - dragging.start.x)}
              height={Math.abs(dragging.current.y - dragging.start.y)}
              fill="rgba(21,101,192,0.08)"
              stroke="#1565c0"
              strokeWidth={0.8}
              strokeDasharray="5 3"
              pointerEvents="none"
            />
          )}
          {filteredBatchTargets.length > 0 &&
            filteredBatchTargets.map((t) => {
              const piece = pieces.find((p) => p.id === t.pieceId)
              if (!piece) return null
              const key = batchTargetKey(t)
              const hi = batchUiHighlightByTargetId[key]
              const ringStroke = hi ?? '#7b1fa2'
              const ringFill = hi ? `${hi}55` : 'none'
              const ps = 1 / Math.max(view.zoom, 1e-6)
              const tx = `translate(${piece.transform.x},${piece.transform.y}) rotate(${piece.transform.rotation}) scale(${piece.transform.mirrored ? -1 : 1},1)`
              if (t.kind === 'vertex') {
                const w = getVertexWorldForBatchHighlight(piece, t.vertexIndex)
                if (!w) return null
                return (
                  <circle
                    key={key}
                    cx={w.x}
                    cy={w.y}
                    r={(POINT_SCREEN_R + 2.5) * ps}
                    fill={ringFill}
                    stroke={ringStroke}
                    strokeWidth={1.2 * ps}
                    pointerEvents="none"
                  />
                )
              }
              if (t.kind === 'curvePoint') {
                const curvesDraw = useSeamLineForPointCurveEditing(piece) ? piece.seamLine : piece.cutLine
                const c = curvesDraw[t.curveIndex]
                if (!c || c.type !== 'bezier') return null
                const ptOnCurve = bezierAt(c, 0.5)
                const w = pieceLocalToWorld(ptOnCurve, piece)
                return (
                  <circle
                    key={key}
                    cx={w.x}
                    cy={w.y}
                    r={(POINT_SCREEN_R + 2.5) * ps}
                    fill={ringFill}
                    stroke={ringStroke}
                    strokeWidth={1.2 * ps}
                    pointerEvents="none"
                  />
                )
              }
              if (t.kind === 'notch') {
                const n = piece.notches.find((x) => x.id === t.notchId)
                if (!n) return null
                const cutPos = getNotchPositionAndAngleOnCutLine(n, piece.cutLine, piece.seamLine)
                const w = pieceLocalToWorld(cutPos.position, piece)
                return (
                  <circle
                    key={key}
                    cx={w.x}
                    cy={w.y}
                    r={5 * ps}
                    fill={ringFill}
                    stroke={ringStroke}
                    strokeWidth={1.2 * ps}
                    pointerEvents="none"
                  />
                )
              }
              if (t.kind === 'internalLine') {
                const curve = piece.internalLines[t.curveIndex]
                if (!curve) return null
                return (
                  <g key={key} transform={tx} pointerEvents="none">
                    <path
                      d={curveToPathD([curve])}
                      fill="none"
                      stroke={ringStroke}
                      strokeWidth={2.2}
                      strokeDasharray="4 2"
                      opacity={0.95}
                    />
                  </g>
                )
              }
              if (t.kind === 'piece') {
                const b = boundsForPieceCutLineWorld(piece)
                if (!b) return null
                const pad = 2 * ps
                return (
                  <rect
                    key={key}
                    x={b.minX - pad}
                    y={b.minY - pad}
                    width={b.maxX - b.minX + 2 * pad}
                    height={b.maxY - b.minY + 2 * pad}
                    fill={ringFill}
                    stroke={ringStroke}
                    strokeWidth={1.4 * ps}
                    strokeDasharray="6 3"
                    pointerEvents="none"
                  />
                )
              }
              return null
            })}
          {dragging?.kind === 'line' && (() => {
            const piece = pieces.find((p) => p.id === dragging.pieceId)
            if (!piece) return null
            const w1 = pieceLocalToWorld(dragging.start, piece)
            const w2 = pieceLocalToWorld(dragging.current, piece)
            return (
              <line
                x1={w1.x}
                y1={w1.y}
                x2={w2.x}
                y2={w2.y}
                stroke="#000"
                strokeWidth={1}
                strokeDasharray="4 2"
                pointerEvents="none"
              />
            )
          })()}
          {dragging?.kind === 'notch' && (() => {
            const piece = pieces.find((p) => p.id === dragging.pieceId)
            if (!piece) return null
            const { position, current, curveIndex, t, useSeamLine } = dragging
            const dx = current.x - position.x
            const dy = current.y - position.y
            const dragDist = Math.hypot(dx, dy)
            const isDragPreview = dragDist >= 2
            const presetIdx = Math.max(0, Math.min(notchSettings.length - 1, activeNotchPresetIndex))
            const notchPreset = notchSettings[presetIdx] ?? { type: 'strich' as const, widthMm: 2.5, depthMm: 2 }
            const modelFields = modelNotchFieldsFromPreset(notchPreset)
            if (!modelFields) return null
            const { type: dragNotchType, depth: defaultDepth, width: defaultWidth } = modelFields
            /** V-Kerbe: Zug bestimmt Vorschau-Tiefe; Strich: Preset-Tiefe wie beim Loslassen. */
            const depth =
              dragNotchType === 'single' ? defaultDepth : isDragPreview ? dragDist : defaultDepth
            const width = defaultWidth
            const angle =
              dragNotchType === 'single'
                ? (() => {
                    if (useSeamLine && piece.seamLine.length >= 3) {
                      const cutNearest = nearestCurveIndexAndPoint(position, piece.cutLine)
                      if (cutNearest) {
                        const ct = cutNearest.t ?? 0
                        return outwardNormalAngleAt(piece.cutLine, cutNearest.curveIndex, ct) + 180
                      }
                    }
                    return outwardNormalAngleAt(piece.cutLine, curveIndex, t) + 180
                  })()
                : isDragPreview
                  ? (Math.atan2(dy, dx) * 180) / Math.PI
                  : (() => {
                      if (useSeamLine && piece.seamLine.length >= 3) {
                        const cutNearest = nearestCurveIndexAndPoint(position, piece.cutLine)
                        if (cutNearest) {
                          const ct = cutNearest.t ?? 0
                          return outwardNormalAngleAt(piece.cutLine, cutNearest.curveIndex, ct) + 180
                        }
                      }
                      return outwardNormalAngleAt(piece.cutLine, curveIndex, t) + 180
                    })()
            let cutAnchor: { curveIndex: number; t: number } | null = null
            if (useSeamLine && piece.seamLine.length >= 3) {
              const cutNearest = nearestCurveIndexAndPoint(position, piece.cutLine)
              if (cutNearest) cutAnchor = { curveIndex: cutNearest.curveIndex, t: cutNearest.t ?? 0 }
            } else {
              cutAnchor = { curveIndex, t }
            }
            const cutPts = notchCutoutPoints(position, angle, depth, width, piece.cutLine, cutAnchor, dragNotchType)
            const toW = (p: Point) => pieceLocalToWorld(p, piece)
            const { fillD, edgesD } = cutPts
              ? cutPts.kind === 'line'
                ? (() => {
                    const s = toW(cutPts.start)
                    const e = toW(cutPts.end)
                    return { fillD: '', edgesD: `M ${s.x} ${s.y} L ${e.x} ${e.y}` }
                  })()
                : notchCutoutSvgPaths({
                    kind: 'v',
                    left: toW(cutPts.left),
                    tip: toW(cutPts.tip),
                    right: toW(cutPts.right),
                  })
              : (() => {
                  const [a, b, c] = notchTriangleCorners(position, angle, depth, width)
                  const wa = toW(a)
                  const wb = toW(b)
                  const wc = toW(c)
                  return {
                    fillD: `M ${wa.x} ${wa.y} L ${wb.x} ${wb.y} L ${wc.x} ${wc.y} Z`,
                    edgesD: `M ${wa.x} ${wa.y} L ${wc.x} ${wc.y} L ${wb.x} ${wb.y}`,
                  }
                })()
            const dragIsLine = cutPts?.kind === 'line'
            return (
              <g pointerEvents="none">
                {fillD ? <path d={fillD} fill="#fff" stroke="none" /> : null}
                <path
                  d={edgesD}
                  fill="none"
                  stroke={NOTCH_STROKE}
                  strokeWidth={dragIsLine ? 0.9 : 0.8}
                  strokeDasharray="4 2"
                  strokeLinejoin="round"
                  strokeLinecap={dragIsLine ? 'round' : 'butt'}
                />
              </g>
            )
          })()}
          {dragging?.kind === 'drill' && (() => {
            const piece = pieces.find((p) => p.id === dragging.pieceId)
            if (!piece) return null
            const { center, current } = dragging
            const radius = Math.hypot(current.x - center.x, current.y - center.y) || 2
            const wc = pieceLocalToWorld(center, piece)
            const wr = Math.hypot(
              pieceLocalToWorld({ x: center.x + radius, y: center.y }, piece).x - wc.x,
              pieceLocalToWorld({ x: center.x + radius, y: center.y }, piece).y - wc.y
            )
            return (
              <circle
                cx={wc.x}
                cy={wc.y}
                r={wr}
                fill="none"
                stroke="#000"
                strokeWidth={0.5}
                strokeDasharray="4 2"
                pointerEvents="none"
              />
            )
          })()}
          {dragging?.kind === 'internalCircle' && (() => {
            const piece = pieces.find((p) => p.id === dragging.pieceId)
            if (!piece) return null
            const { center, current } = dragging
            const r = Math.hypot(current.x - center.x, current.y - center.y) || 2
            const wc = pieceLocalToWorld(center, piece)
            const wr = Math.hypot(
              pieceLocalToWorld({ x: center.x + r, y: center.y }, piece).x - wc.x,
              pieceLocalToWorld({ x: center.x + r, y: center.y }, piece).y - wc.y
            )
            return (
              <circle
                cx={wc.x}
                cy={wc.y}
                r={wr}
                fill="none"
                stroke="#1565c0"
                strokeWidth={0.6}
                strokeDasharray="4 3"
                pointerEvents="none"
              />
            )
          })()}
          {((rulerLine && rulerMode) || dragging?.kind === 'ruler') && (() => {
            const start = rulerLine ? rulerLine.start : dragging?.kind === 'ruler' ? dragging.start : null
            const end = rulerLine ? rulerLine.end : dragging?.kind === 'ruler' ? dragging.current : null
            if (!start || !end) return null
            const len = Math.hypot(end.x - start.x, end.y - start.y)
            const mx = (start.x + end.x) / 2
            const my = (start.y + end.y) / 2
            const rps = 1 / Math.max(view.zoom, 1e-6)
            return (
              <g pointerEvents="none">
                <line
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  stroke="#1565c0"
                  strokeWidth={1.2 * rps}
                />
                <circle
                  cx={start.x}
                  cy={start.y}
                  r={POINT_SCREEN_R * rps}
                  fill="#1565c0"
                  stroke="#fff"
                  strokeWidth={POINT_SCREEN_STROKE * rps}
                />
                <circle
                  cx={end.x}
                  cy={end.y}
                  r={POINT_SCREEN_R * rps}
                  fill="#1565c0"
                  stroke="#fff"
                  strokeWidth={POINT_SCREEN_STROKE * rps}
                />
                <text x={mx} y={my - 6} textAnchor="middle" fontSize={10} fill="#1565c0" fontWeight="600">
                  {len.toFixed(1)} mm
                </text>
              </g>
            )
          })()}
          {(nahtzuordnungMode === 'first' || nahtzuordnungMode === 'second') && hoveredSeamForNahtzuordnung && (() => {
            const piece = pieces.find((p) => p.id === hoveredSeamForNahtzuordnung.pieceId)
            if (!piece?.cutLine?.length) return null
            const indices = hoveredSeamForNahtzuordnung.curveIndices
            const master = getCurvesForSeamEdge(piece)
            const curves = piece.seamAllowanceMm != null && piece.seamLine.length >= 3
              ? getSeamEdgeCurves(piece, indices)
              : indices.map((ci) => master[ci]).filter(Boolean)
            let d = ''
            for (const seg of curves) {
              if (!seg) continue
              const ws = pieceLocalToWorld(seg.start, piece)
              const we = pieceLocalToWorld(seg.end, piece)
              if (seg.type === 'line') {
                d += `M ${ws.x} ${ws.y} L ${we.x} ${we.y} `
              } else {
                const wc1 = pieceLocalToWorld(seg.cp1, piece)
                const wc2 = pieceLocalToWorld(seg.cp2, piece)
                d += `M ${ws.x} ${ws.y} C ${wc1.x} ${wc1.y} ${wc2.x} ${wc2.y} ${we.x} ${we.y} `
              }
            }
            if (!d) return null
            return (
              <path
                key="nahtzuordnung-hover"
                d={d}
                fill="none"
                stroke="#1565c0"
                strokeWidth={2.5}
                strokeOpacity={0.9}
                pointerEvents="none"
              />
            )
          })()}
          {edgeSeamPickingActive && hoveredEdgePicking && (() => {
            const piece = pieces.find((p) => p.id === hoveredEdgePicking.pieceId)
            if (!piece) return null
            const curves = hoveredEdgePicking.curveIndices.map((ci) => piece.seamLine[ci]).filter(Boolean)
            let d = ''
            for (const seg of curves) {
              if (!seg) continue
              const ws = pieceLocalToWorld(seg.start, piece)
              const we = pieceLocalToWorld(seg.end, piece)
              if (seg.type === 'line') {
                d += `M ${ws.x} ${ws.y} L ${we.x} ${we.y} `
              } else {
                const wc1 = pieceLocalToWorld(seg.cp1, piece)
                const wc2 = pieceLocalToWorld(seg.cp2, piece)
                d += `M ${ws.x} ${ws.y} C ${wc1.x} ${wc1.y} ${wc2.x} ${wc2.y} ${we.x} ${we.y} `
              }
            }
            if (!d) return null
            return (
              <path
                key="edge-picking-hover"
                d={d}
                fill="none"
                stroke="#e65100"
                strokeWidth={3.5}
                strokeOpacity={0.9}
                pointerEvents="none"
              />
            )
          })()}
          {tool === 'profil' && hoveredProfileEdge && (() => {
            const piece = pieces.find((p) => p.id === hoveredProfileEdge.pieceId)
            if (!piece) return null
            const masterK = getCurvesForSeamEdge(piece)
            const curves = hoveredProfileEdge.curveIndices.map((ci) => masterK[ci]).filter(Boolean)
            let d = ''
            for (const seg of curves) {
              if (!seg) continue
              const ws = pieceLocalToWorld(seg.start, piece)
              const we = pieceLocalToWorld(seg.end, piece)
              if (seg.type === 'line') {
                d += `M ${ws.x} ${ws.y} L ${we.x} ${we.y} `
              } else {
                const wc1 = pieceLocalToWorld(seg.cp1, piece)
                const wc2 = pieceLocalToWorld(seg.cp2, piece)
                d += `M ${ws.x} ${ws.y} C ${wc1.x} ${wc1.y} ${wc2.x} ${wc2.y} ${we.x} ${we.y} `
              }
            }
            if (!d) return null
            return (
              <path
                key="profile-edge-hover"
                d={d}
                fill="none"
                stroke="#7b1fa2"
                strokeWidth={3.5}
                strokeOpacity={0.9}
                pointerEvents="none"
              />
            )
          })()}
          {profileAssignments.length > 0 && profileAssignments.map((pa) => {
            const piece = pieces.find((p) => p.id === pa.pieceId)
            if (!piece) return null
            const masterK = getCurvesForSeamEdge(piece)
            const edges = enumerateEdges(piece)
            const edge = edges.find((e) => e.edgeIndex === pa.edgeIndex)
            if (!edge) return null
            const curves = edge.curveIndices.map((ci) => masterK[ci]).filter(Boolean)
            if (curves.length === 0) return null

            const PROFILE_LINE_OFFSET = 20
            const area = signedAreaCurves(masterK)
            const outSign = area >= 0 ? -1 : 1

            let d = ''
            for (const seg of curves) {
              if (seg.type === 'line') {
                const tdx = seg.end.x - seg.start.x
                const tdy = seg.end.y - seg.start.y
                const tlen = Math.hypot(tdx, tdy) || 1
                const ox = outSign * (-tdy / tlen) * PROFILE_LINE_OFFSET
                const oy = outSign * (tdx / tlen) * PROFILE_LINE_OFFSET
                const ws = pieceLocalToWorld({ x: seg.start.x + ox, y: seg.start.y + oy }, piece)
                const we = pieceLocalToWorld({ x: seg.end.x + ox, y: seg.end.y + oy }, piece)
                d += `M ${ws.x} ${ws.y} L ${we.x} ${we.y} `
              } else {
                const d0 = bezierDerivativeAt(seg, 0)
                const d1 = bezierDerivativeAt(seg, 1)
                const len0 = Math.hypot(d0.x, d0.y) || 1
                const len1 = Math.hypot(d1.x, d1.y) || 1
                const o0x = outSign * (-d0.y / len0) * PROFILE_LINE_OFFSET
                const o0y = outSign * (d0.x / len0) * PROFILE_LINE_OFFSET
                const o1x = outSign * (-d1.y / len1) * PROFILE_LINE_OFFSET
                const o1y = outSign * (d1.x / len1) * PROFILE_LINE_OFFSET
                const ws = pieceLocalToWorld({ x: seg.start.x + o0x, y: seg.start.y + o0y }, piece)
                const wc1 = pieceLocalToWorld({ x: seg.cp1.x + o0x, y: seg.cp1.y + o0y }, piece)
                const wc2 = pieceLocalToWorld({ x: seg.cp2.x + o1x, y: seg.cp2.y + o1y }, piece)
                const we = pieceLocalToWorld({ x: seg.end.x + o1x, y: seg.end.y + o1y }, piece)
                d += `M ${ws.x} ${ws.y} C ${wc1.x} ${wc1.y} ${wc2.x} ${wc2.y} ${we.x} ${we.y} `
              }
            }
            if (!d) return null

            const firstSeg = curves[0]
            const lastSeg = curves[curves.length - 1]
            const startL = firstSeg.start
            const endL = lastSeg.end
            const edgeDx = endL.x - startL.x
            const edgeDy = endL.y - startL.y
            const edgeLen = Math.hypot(edgeDx, edgeDy) || 1
            const midLocal = { x: (startL.x + endL.x) / 2, y: (startL.y + endL.y) / 2 }
            const nxLocal = outSign * (-edgeDy / edgeLen)
            const nyLocal = outSign * (edgeDx / edgeLen)
            const keyOffsetMm = PROFILE_LINE_OFFSET + 10
            const detailOffsetMm = PROFILE_LINE_OFFSET + 16
            const keyLocal = {
              x: midLocal.x + nxLocal * keyOffsetMm,
              y: midLocal.y + nyLocal * keyOffsetMm,
            }
            const detailLocal = {
              x: midLocal.x + nxLocal * detailOffsetMm,
              y: midLocal.y + nyLocal * detailOffsetMm,
            }
            const keyW = pieceLocalToWorld(keyLocal, piece)
            const detailW = pieceLocalToWorld(detailLocal, piece)
            const startW = pieceLocalToWorld(startL, piece)
            const endW = pieceLocalToWorld(endL, piece)
            const angleDeg = (Math.atan2(endW.y - startW.y, endW.x - startW.x) * 180) / Math.PI

            const lengthMm = edgeTotalLength(piece, edge.curveIndices)
            const labelParts: string[] = []
            if (pa.supplierNumber) labelParts.push(pa.supplierNumber)
            if (pa.internalArticleNumber) labelParts.push(pa.internalArticleNumber)
            labelParts.push(`${lengthMm.toFixed(0)} mm`)
            const detailText = labelParts.join(' · ')

            return (
              <g key={`profile-${pa.id}`} pointerEvents="none">
                <path
                  d={d}
                  fill="none"
                  stroke="#7b1fa2"
                  strokeWidth={2}
                  strokeOpacity={0.7}
                  strokeDasharray="6 3"
                />
                <text
                  x={keyW.x}
                  y={keyW.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#7b1fa2"
                  fontSize={5}
                  fontFamily="sans-serif"
                  fontWeight={700}
                  transform={`rotate(${angleDeg},${keyW.x},${keyW.y})`}
                >
                  {pa.profileKey}
                </text>
                <text
                  x={detailW.x}
                  y={detailW.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#7b1fa2"
                  fontSize={3.2}
                  fontFamily="sans-serif"
                  fontWeight={400}
                  opacity={0.8}
                  transform={`rotate(${angleDeg},${detailW.x},${detailW.y})`}
                >
                  {detailText}
                </text>
              </g>
            )
          })}
          {seamAssignments.length > 0 &&
            seamAssignments.map((a: SeamAssignment) => {
              const pieceA = pieces.find((p) => p.id === a.pieceIdA)
              const pieceB = pieces.find((p) => p.id === a.pieceIdB)
              if (!pieceA?.cutLine?.length || !pieceB?.cutLine?.length) return null
              const idxA = resolvedSeamAssignmentCurveIndices(pieceA, a.curveIndicesA)
              const idxB = resolvedSeamAssignmentCurveIndices(pieceB, a.curveIndicesB)
              const curvesA = getCurvesForSeamEdge(pieceA)
              const curvesB = getCurvesForSeamEdge(pieceB)
              const segsA = idxA.map((ci) => curvesA[ci]).filter(Boolean)
              const segsB = idxB.map((ci) => curvesB[ci]).filter(Boolean)
              if (segsA.length === 0 || segsB.length === 0) return null
              const lenA = segsA.reduce((sum, s) => sum + curveSegmentArcLength(s, 0, 1), 0)
              const lenB = segsB.reduce((sum, s) => sum + curveSegmentArcLength(s, 0, 1), 0)
              const diffMm = Math.abs(lenA - lenB)
              const showLengthDiff = diffMm >= 0.1
              const notchCountA = countNotchesOnEdge(pieceA, idxA)
              const notchCountB = countNotchesOnEdge(pieceB, idxB)
              const notchMismatch = notchCountA !== notchCountB
              const subsA = getSubSegments(pieceA, idxA)
              const subsB = getSubSegments(pieceB, idxB)
              const subPairing = bestSeamSubSegmentPairing(subsA, subsB)
              let subDiffs: { lenA: number; lenB: number; midA: Point; midB: Point }[] | null = null
              if (!notchMismatch && subPairing && subsA.length >= 2) {
                const rev = subPairing.reverseB
                subDiffs = subsA.map((sa, i) => {
                  const sb = rev ? subsB[subsB.length - 1 - i] : subsB[i]
                  return {
                    lenA: sa.length,
                    lenB: sb.length,
                    midA: pieceLocalToWorld(sa.midpoint, pieceA),
                    midB: pieceLocalToWorld(sb.midpoint, pieceB),
                  }
                })
              }
              const subSegMismatch =
                !notchMismatch && subPairing && subsA.length >= 2 && subPairing.maxSegmentMismatchMm >= 0.1
              const midResultA = pointAtPathLength(segsA, lenA / 2)
              const midResultB = pointAtPathLength(segsB, lenB / 2)
              const midALocal = midResultA ? midResultA.point : curveMidpoint(segsA[Math.floor(segsA.length / 2)])
              const midBLocal = midResultB ? midResultB.point : curveMidpoint(segsB[Math.floor(segsB.length / 2)])
              const midA = pieceLocalToWorld(midALocal, pieceA)
              const midB = pieceLocalToWorld(midBLocal, pieceB)
              const dx = midB.x - midA.x
              const dy = midB.y - midA.y
              const len = Math.hypot(dx, dy) || 1
              const ux = dx / len
              const uy = dy / len
              const arrowLen = 6
              const arrowWing = 3
              const base = { x: midB.x - arrowLen * ux, y: midB.y - arrowLen * uy }
              const wing1 = { x: base.x + arrowWing * -uy, y: base.y + arrowWing * ux }
              const wing2 = { x: base.x - arrowWing * -uy, y: base.y - arrowWing * ux }
              const labelX = (midA.x + midB.x) / 2
              const labelY = (midA.y + midB.y) / 2 - 8
              const metaParts: string[] = []
              if (a.orderNumber != null) metaParts.push(String(a.orderNumber))
              if (a.seamKind) metaParts.push(SEAM_ASSIGNMENT_KIND_LABELS[a.seamKind])
              const metaText = metaParts.join(' · ')
              const warnStack =
                (showLengthDiff ? 11 : 0) + (notchMismatch ? 11 : 0) + (subSegMismatch ? 11 : 0)
              return (
                <g
                  key={a.id}
                  pointerEvents="stroke"
                  onPointerEnter={() => setHoveredSeamAssignmentId(a.id)}
                  onPointerLeave={() => setHoveredSeamAssignmentId(null)}
                  style={{ cursor: hoveredSeamAssignmentId === a.id ? 'pointer' : 'default' }}
                >
                  <title>
                    Leertaste: Nummer und Nahtart · Backspace/Entf: Zuordnung löschen
                  </title>
                  {/* Unsichtbare breite Linie für Hover-/Trefferfläche */}
                  <line x1={midA.x} y1={midA.y} x2={midB.x} y2={midB.y} stroke="transparent" strokeWidth={14} />
                  <line
                    x1={midA.x}
                    y1={midA.y}
                    x2={midB.x}
                    y2={midB.y}
                    stroke="#1565c0"
                    strokeWidth={1}
                    strokeDasharray="6 4"
                    pointerEvents="none"
                  />
                  <path
                    d={`M ${wing1.x} ${wing1.y} L ${midB.x} ${midB.y} L ${wing2.x} ${wing2.y}`}
                    fill="none"
                    stroke="#1565c0"
                    strokeWidth={1}
                    pointerEvents="none"
                  />
                  {showLengthDiff && (
                    <text
                      x={labelX}
                      y={labelY}
                      textAnchor="middle"
                      fontSize={9}
                      fill="#c62828"
                      fontWeight="600"
                      fontFamily="sans-serif"
                      pointerEvents="none"
                    >
                      Δ {diffMm.toFixed(1)} mm
                    </text>
                  )}
                  {notchMismatch && (
                    <text
                      x={labelX}
                      y={labelY + (showLengthDiff ? 11 : 0)}
                      textAnchor="middle"
                      fontSize={9}
                      fill="#e65100"
                      fontWeight="600"
                      fontFamily="sans-serif"
                      pointerEvents="none"
                    >
                      ⚠ Notch {notchCountA}:{notchCountB}
                    </text>
                  )}
                  {subSegMismatch && subPairing && (
                    <text
                      x={labelX}
                      y={
                        labelY +
                        (showLengthDiff ? 11 : 0) +
                        (notchMismatch ? 11 : 0)
                      }
                      textAnchor="middle"
                      fontSize={9}
                      fill="#e65100"
                      fontWeight="600"
                      fontFamily="sans-serif"
                      pointerEvents="none"
                    >
                      ⚠ Kerben-Abstände max Δ {subPairing.maxSegmentMismatchMm.toFixed(1)} mm
                    </text>
                  )}
                  {metaText && (
                    <text
                      x={labelX}
                      y={labelY + warnStack}
                      textAnchor="middle"
                      fontSize={8}
                      fill="#1565c0"
                      fontWeight="600"
                      fontFamily="sans-serif"
                      pointerEvents="none"
                    >
                      {metaText}
                    </text>
                  )}
                  {subDiffs && subDiffs.map((sd, i) => {
                    const isMatch = Math.abs(sd.lenA - sd.lenB) < 0.1
                    const color = isMatch ? '#2e7d32' : '#c62828'
                    const labelA = isMatch ? '✓' : `${sd.lenA.toFixed(1)}`
                    const labelB = isMatch ? '✓' : `${sd.lenB.toFixed(1)}`
                    return (
                      <g key={`sub-${i}`} pointerEvents="none">
                        <text x={sd.midA.x} y={sd.midA.y - 5} textAnchor="middle" fontSize={8} fill={color} fontWeight="600" fontFamily="sans-serif">{labelA}</text>
                        <text x={sd.midB.x} y={sd.midB.y - 5} textAnchor="middle" fontSize={8} fill={color} fontWeight="600" fontFamily="sans-serif">{labelB}</text>
                      </g>
                    )
                  })}
                </g>
              )
            })}
        </g>
      </svg>
      <div className="workspace-stoff-icon" title="So liegen die Teile auf dem Stoff beim Zuschneiden">
        <svg viewBox="0 0 48 44" width="44" height="40" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {/* Stoffrolle links: Querschnitt */}
          <ellipse cx="10" cy="14" rx="6" ry="8" />
          <ellipse cx="10" cy="14" rx="3.5" ry="5" />
          <ellipse cx="10" cy="14" rx="1.5" ry="2.5" />
          {/* Rollenkörper: obere Bogenlinie */}
          <path d="M 10 6 C 28 4 38 14 40 14" />
          {/* Abgelegter Stoff: Rechteck unter der Rolle */}
          <path d="M 10 22 L 10 42 L 42 42 L 42 22 L 10 22" />
          {/* Untere Kante der Rolle (Anschluss zum Stoff) */}
          <path d="M 10 22 C 30 20 40 22 40 22" />
        </svg>
      </div>
      {(dragging?.kind === 'line' && tool === 'internalLine' && !lineLengthEditor) && (
        <div style={{
          position: 'absolute',
          top: 16,
          right: 16,
          background: 'rgba(21,101,192,0.92)',
          color: '#fff',
          padding: '6px 10px',
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 600,
          zIndex: 9998,
          pointerEvents: 'none',
        }}>
          Leertaste: feste Laenge setzen
        </div>
      )}
      {!dragging && hoveredInternalLine && !lineLengthEditor && (
        <div style={{
          position: 'absolute',
          top: 16,
          right: 16,
          background: 'rgba(21,101,192,0.92)',
          color: '#fff',
          padding: '6px 10px',
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 600,
          zIndex: 9998,
          pointerEvents: 'none',
        }}>
          Linie hovern + Leertaste: Laenge aendern
        </div>
      )}
      {tool === 'select' &&
        !dragging &&
        hoveredWorkspaceImage &&
        imageDigitizeSession?.imageDataUrl &&
        !workspaceImageQuickMenu &&
        !lineLengthEditor && (
          <div
            style={{
              position: 'absolute',
              bottom: 56,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(21,101,192,0.92)',
              color: '#fff',
              padding: '6px 10px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              zIndex: 9998,
              pointerEvents: 'none',
              maxWidth: '90%',
              textAlign: 'center',
            }}
          >
            {imageDigitizeSession.locked
              ? 'Leertaste: Menü — Bild wieder freigeben oder Auswahl aufheben'
              : 'Leertaste: Menü — Bild festsetzen (kein Verschieben/Größe)'}
          </div>
        )}
      {workspaceImageQuickMenu && imageDigitizeSession?.imageDataUrl && (
        <div
          role="menu"
          style={{
            position: 'fixed',
            left: Math.min(
              workspaceImageQuickMenu.clientX + 6,
              (typeof window !== 'undefined' ? window.innerWidth : 800) - 216
            ),
            top: workspaceImageQuickMenu.clientY + 6,
            zIndex: 10002,
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: 6,
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
            padding: '4px 0',
            minWidth: 200,
            fontSize: 13,
            fontFamily: 'sans-serif',
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div style={{ padding: '6px 12px', color: '#666', fontSize: 11, borderBottom: '1px solid #eee' }}>
            Hintergrundbild
          </div>
          {!imageDigitizeSession.locked ? (
            <button
              type="button"
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 14px',
                background: 'none',
                border: 'none',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 13,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              onClick={() => {
                setWorkspaceImageLocked(true)
                setWorkspaceImageQuickMenu(null)
              }}
            >
              Bild festsetzen
            </button>
          ) : (
            <button
              type="button"
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 14px',
                background: 'none',
                border: 'none',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 13,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              onClick={() => {
                setWorkspaceImageLocked(false)
                setWorkspaceImageQuickMenu(null)
              }}
            >
              Bearbeiten freigeben
            </button>
          )}
          <button
            type="button"
            style={{
              display: 'block',
              width: '100%',
              padding: '8px 14px',
              background: 'none',
              border: 'none',
              textAlign: 'left',
              cursor: 'pointer',
              fontSize: 13,
              borderTop: '1px solid #eee',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
            onClick={() => {
              setWorkspaceImageSelected(false)
              setWorkspaceImageQuickMenu(null)
            }}
          >
            Auswahl aufheben
          </button>
        </div>
      )}
      {lineLengthEditor && (
        <form
          onSubmit={(ev) => {
            ev.preventDefault()
            const mm = Number.parseFloat(lineLengthEditor.value)
            if (!Number.isFinite(mm) || mm <= 0) {
              setToastMessage('error: Bitte eine gueltige Laenge in mm eingeben.')
              return
            }
            const end = pointAtDistanceOnRay(lineLengthEditor.start, lineLengthEditor.current, mm)
            if (lineLengthEditor.mode === 'hoverInternal' && lineLengthEditor.curveIndex != null) {
              const piece = pieces.find((p) => p.id === lineLengthEditor.pieceId)
              if (!piece || lineLengthEditor.curveIndex < 0 || lineLengthEditor.curveIndex >= piece.internalLines.length) {
                setToastMessage('error: Linie konnte nicht aktualisiert werden.')
                return
              }
              const oldCurve = piece.internalLines[lineLengthEditor.curveIndex]
              const nextCurve = { ...oldCurve, start: lineLengthEditor.start, end }
              const internalLines = piece.internalLines.map((curve, idx) =>
                idx === lineLengthEditor.curveIndex ? nextCurve : curve
              )
              updatePiece(piece.id, { internalLines })
            } else {
              addInternalLine(lineLengthEditor.pieceId, { type: 'line', start: lineLengthEditor.start, end })
              setDragging(null)
              setTool('select')
            }
            setLineLengthEditor(null)
          }}
          style={{
            position: 'absolute',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#fff',
            border: '1px solid #cfd8dc',
            borderRadius: 8,
            padding: '10px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            zIndex: 10000,
            boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
          }}
          onPointerDown={(ev) => ev.stopPropagation()}
        >
          <span style={{ fontSize: 12, color: '#263238', fontWeight: 600 }}>Laenge (mm)</span>
          <input
            ref={lineLengthInputRef}
            type="text"
            inputMode="decimal"
            value={lineLengthEditor.value}
            onChange={(ev) => setLineLengthEditor((s) => (s ? { ...s, value: ev.target.value } : s))}
            style={{
              width: 90,
              padding: '4px 6px',
              border: '1px solid #90a4ae',
              borderRadius: 4,
              fontSize: 13,
            }}
          />
          <button type="submit" style={{ padding: '5px 9px', fontSize: 12 }}>OK</button>
          <button
            type="button"
            onClick={() => {
              if (lineLengthEditor.mode === 'draw') {
                setDragging(null)
                setTool('select')
              }
              setLineLengthEditor(null)
            }}
            style={{ padding: '5px 9px', fontSize: 12 }}
          >
            Abbrechen
          </button>
        </form>
      )}
      {toastMessage && (
        <div style={{
          position: 'absolute',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          background: toastMessage.startsWith('success:')
            ? '#2e7d32'
            : toastMessage.startsWith('warn:')
              ? '#e65100'
              : '#d32f2f',
          color: '#fff',
          padding: '8px 20px',
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 500,
          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          zIndex: 9999,
          pointerEvents: 'none',
          maxWidth: 'min(92vw, 520px)',
          whiteSpace: 'normal',
          textAlign: 'center',
        }}>
          {toastMessage.startsWith('success:')
            ? toastMessage.slice(8)
            : toastMessage.startsWith('error:')
              ? toastMessage.slice(6)
              : toastMessage.startsWith('warn:')
                ? toastMessage.slice(5)
                : toastMessage}
        </div>
      )}
      {edgeSeamPickingActive && !edgeAllowancePopover && (
        <div style={{
          position: 'fixed',
          top: 48,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#e65100',
          color: '#fff',
          padding: '6px 18px',
          borderRadius: 6,
          fontSize: 13,
          fontFamily: 'sans-serif',
          zIndex: 3000,
          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
          <span>Kante anklicken, um Nahtzugabe festzulegen</span>
          <button
            type="button"
            onClick={() => {
              setEdgeSeamPickingActive(false)
              setHoveredEdgePicking(null)
            }}
            style={{
              background: 'rgba(255,255,255,0.25)',
              border: 'none',
              color: '#fff',
              padding: '2px 10px',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Abbrechen
          </button>
        </div>
      )}
      {edgeAllowancePopover && <EdgeAllowancePopover
        popover={edgeAllowancePopover}
        onConfirm={(mm) => {
          setEdgeSeamAllowance(edgeAllowancePopover.pieceId, edgeAllowancePopover.edgeIndex, mm)
          setEdgeAllowancePopover(null)
        }}
        onCancel={() => setEdgeAllowancePopover(null)}
      />}
    </div>
  )
}

function EdgeAllowancePopover({
  popover,
  onConfirm,
  onCancel,
}: {
  popover: { currentMm: number; clientX: number; clientY: number }
  onConfirm: (mm: number) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(String(popover.currentMm))
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])
  const confirm = () => {
    const mm = parseFloat(value)
    if (Number.isFinite(mm) && mm >= 0) onConfirm(mm)
    else onCancel()
  }
  return (
    <div
      style={{
        position: 'fixed',
        left: popover.clientX,
        top: popover.clientY,
        transform: 'translate(-50%, 12px)',
        background: '#fff',
        border: '1px solid #ccc',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        padding: '10px 14px',
        zIndex: 3000,
        fontFamily: 'sans-serif',
        fontSize: 13,
        minWidth: 160,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ marginBottom: 6, fontWeight: 600, color: '#333' }}>Nahtzugabe (mm)</div>
      <input
        ref={inputRef}
        type="number"
        min={0}
        step={0.5}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); confirm() }
          if (e.key === 'Escape') { e.preventDefault(); onCancel() }
          e.stopPropagation()
        }}
        style={{
          width: '100%',
          padding: '4px 8px',
          fontSize: 14,
          border: '1px solid #bbb',
          borderRadius: 4,
          boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '3px 10px',
            fontSize: 12,
            border: '1px solid #ccc',
            borderRadius: 4,
            background: '#f5f5f5',
            cursor: 'pointer',
          }}
        >
          Abbrechen
        </button>
        <button
          type="button"
          onClick={confirm}
          style={{
            padding: '3px 10px',
            fontSize: 12,
            border: 'none',
            borderRadius: 4,
            background: '#e65100',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          OK
        </button>
      </div>
    </div>
  )
}

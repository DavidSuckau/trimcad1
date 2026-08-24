import { useRef, useCallback, useState, useEffect, useMemo, memo } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useStore as useZustandStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { useStore, undoAction, redoAction } from '../store/useStore'
import { canvasTextSize } from '../ui/uiTextScale'
import { VIEWBOX_WIDTH, VIEWBOX_HEIGHT } from '../workspaceConstants'
import { CanvasToolbar } from './CanvasToolbar'
import {
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
  cutLineFormsClosedLoop,
} from '../geometry/curveToPath'
import {
  getCutLineNotchMeasurementDistances,
  getNotchMeasurementDistancesOnContour,
  targetArcLengthForNotchDistanceEdit,
} from '../geometry/measurementStations'
import { nearestCurveIndexAndPoint } from '../geometry/nearestOnCurve'
import { internalLineEndpointsTouch } from '../geometry/internalLineJunctions'
import { parallelCurveFromSegment } from '../geometry/offset'
import {
  getNotchPositionAndAngle,
  getNotchPositionAndAngleOnCutLine,
  getNotchPositionAndAngleOnSeamLine,
  getNotchCurveIndexAndT,
  notchTriangleCorners,
  notchCutoutPoints,
  type NotchCutoutGeom,
} from '../geometry/notchOnCurve'
import { isNotchSpacingValid, isInternalNotchSpacingValid, NOTCH_MIN_SPACING_MM } from '../geometry/notchMinSpacing'
import {
  isNotchOnInternalLine,
  getNotchPositionAndAngleOnInternalLine,
  resolveNotchInternalLineAnchor,
  internalLineSegmentPathLength,
  internalLineSegmentTotalLength,
} from '../geometry/notchOnInternalLine'
import {
  evenlySpacedTsOnLineSegment,
  lineSegmentLengthMm,
  midpointOnLineSegment,
  pointAtLineSegmentT,
} from '../geometry/notchEdgeMidpoint'
import { isPointInClosedCurves, isPointInPolygon } from '../geometry/pointInPolygon'
import {
  getCornerRange,
  getSeamEdgeCurves,
  getCurvesForSeamEdge,
  deriveContourProfileBoundaryRangeAtArcLength,
  deriveContourProfileBoundaryRangeOnEdge,
  edgeHasProfileBoundaryNotches,
  getEdgeCurvesInNotchRange,
  mapMasterVertexIndexToCutVertexIndex,
  resolvedSeamAssignmentCurveIndices,
  edgeTotalLength,
  masterSoftVertexIndexSet,
} from '../geometry/seamUtils'
import { dragTriggersSeamAdjustmentCheck, getSeamAssignmentDisplayMetrics } from '../geometry/seamAdjustmentCheck'
import {
  useSeamLineForVertexEditing,
  useSeamLineForPointCurveEditing,
  getDisplayedMasterCurves,
  getSharpMasterCurves,
} from '../geometry/vertexMaster'
import { vertexPositionOnClosedMaster, validateCornerRound, ROUND_CORNER_MIN_RADIUS_MM, ROUND_CORNER_MAX_RADIUS_MM, applyCornerRoundings } from '../geometry/cornerRounding'
import { getCutLineContourMeasurements } from '../geometry/contourMeasurements'
import { enumerateEdges, getAllowanceForCurveIndex } from '../geometry/edgeEnumeration'
import {
  deriveInternalProfileBoundaryRangeAtArcLength,
  deriveInternalProfileBoundaryRangeOnPath,
  internalPathHasProfileBoundaryNotches,
  getInternalProfileCurvesInRange,
  getProfileAssignmentDisplayCurves,
  hitProfileAssignment,
  profileAssignmentLengthMm,
  PROFILE_DISPLAY_OFFSET_MM,
} from '../geometry/internalLineProfile'
import {
  computeProfileFitPreviewsForPiece,
  type ProfileFitPreview,
} from '../geometry/profileLengthFit'
import {
  deriveInternalSeamNotchRangeAtClick,
  getInternalSeamAssignmentCurves,
  hitInternalLineForSeamAssignment,
  isInternalSeamAssignment,
} from '../geometry/internalSeamAssignment'
import { masterEdgeIsStraightLine } from '../geometry/horizontalLevelEdge'
import {
  crossZ,
  symmetryAxisEndpointsFromInternalCurve,
  symmetryAxisFromMasterEdgePick,
  symmetryAxisClippedToPieceBounds,
  getSymmetryHalfPlaneClipPolygons,
  symmetryClipPolygonPointsAttr,
  vertexHalfPlane,
  SYMMETRY_INTERNAL_HOVER_MM,
} from '../symmetry'
import { getPiecePivotLocal, getRotationUiLayout } from '../geometry/pieceTransform'
import { collectMarqueeTargets, filterBatchTargets, batchTargetKey } from '../workspace/workspaceMarqueeSelection'
import { boundsForPieceCutLineWorld } from '../workspace/workspaceOverviewBounds'
import {
  getPieceGrainLine,
  getGrainArrowLayout,
  GRAIN_SNAP_TO_EDGE_MM,
  grainLineWithMovedEndpoint,
  snapGrainLineToContourEdge,
} from '../geometry/grainArrowLayout'
import type { PatternPiece, Point, Line, Curve, Notch, SeamAssignment, BatchSelectionFilter, NotchType as ModelNotchType, NotchRole } from '../types/model'
import { findMatchingNotchPresetIndex, modelNotchFieldsFromPreset } from '../notch/notchPresetMapping'
import { SEAM_ASSIGNMENT_KIND_LABELS } from '../types/model'
import { canvasTheme, canvasThemeDark, type CanvasTheme } from '../theme/canvasTheme'
import { pieceInteriorFillFromMaterial } from '../theme/materialFillColor'
import { strokeColorForProfileKey } from '../profile/profileKeyColor'
import { getPieceContourDisplayPaths, pieceGroupTransformAttr, pieceSolidContourPathD } from './pieceSolidContourPath'
import { isFacingDerivedPiece, sortPiecesFacingBehind } from '../geometry/facingPiece'
import { WorkspaceLiveCostPanel } from './WorkspaceLiveCostPanel'

let T: CanvasTheme = canvasTheme
/** Rasterabstand in mm (Arbeitsfläche maßstabsgetreu in mm) */
const GRID_SIZE = 10
/** Kerben Kantenmitte: max. gleichzeitig verteilte Kerben pro Kante. */
const NOTCH_EDGE_LINE_MAX = 30
const ROTATION_RING_HOVER_RADIUS_PX = 26
const ROTATION_RING_STROKE_BASE = 1.2
const ROTATION_RING_ALPHA_IDLE = 0.5
const ROTATION_RING_ALPHA_HOVER = 0.68
const ROTATION_HANDLE_BASE_RADIUS = 10
const NOTCH_ROLE_LABELS: Record<NotchRole, string> = {
  nahtanfang: 'Nahtanfang',
  nahtende: 'Nahtende',
  beides: 'Beides',
}

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

/** strokeDasharray in Nutzerkoordinaten skalieren (Faktor typisch 1/zoom), damit Striche unter `scale(zoom)` optisch gleich bleiben. */
function scaleSvgDashArray(dash: string, factor: number): string {
  return dash
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => {
      const n = Number(p)
      return Number.isFinite(n) ? String(n * factor) : p
    })
    .join(' ')
}

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

function distanceToNotchHoverMm(local: Point, notch: Notch, piece: PatternPiece): number {
  const depth = notch.depth
  const width = notch.width ?? 6
  if (isNotchOnInternalLine(notch) && piece.internalLines.length > 0) {
    const intPos = getNotchPositionAndAngleOnInternalLine(notch, piece.internalLines)
    if (!intPos) return 1e15
    const intParam = resolveNotchInternalLineAnchor(notch, piece.internalLines)
    const intPts = notchCutoutPoints(
      intPos.position,
      intPos.angle,
      depth,
      width,
      piece.internalLines,
      intParam,
      notch.type
    )
    if (intPts) return distanceToNotchCutoutGeom(local, intPts, intPos.position)
    return Math.hypot(local.x - intPos.position.x, local.y - intPos.position.y)
  }
  const cutPos = getNotchPositionAndAngleOnCutLine(notch, piece.cutLine, piece.seamLine)
  const cutParam = getNotchCurveIndexAndT(notch, piece.cutLine, piece.seamLine)
  const cutPts = notchCutoutPoints(cutPos.position, cutPos.angle, depth, width, piece.cutLine, cutParam, notch.type)
  let d = 1e15
  if (cutPts) {
    d = distanceToNotchCutoutGeom(local, cutPts, cutPos.position)
  } else {
    const { position } = getNotchPositionAndAngle(notch, piece.cutLine, piece.seamLine)
    d = Math.hypot(local.x - position.x, local.y - position.y)
  }
  if (piece.seamLine.length >= 3) {
    const seamPos = getNotchPositionAndAngleOnSeamLine(notch, piece.cutLine, piece.seamLine)
    if (seamPos) {
      const seamPts = notchCutoutPoints(seamPos.position, seamPos.angle, depth, width, piece.seamLine, undefined, notch.type)
      if (seamPts) {
        const dSeam = distanceToNotchCutoutGeom(local, seamPts, seamPos.position)
        if (dSeam < d) d = dSeam
      } else {
        const dSeam = Math.hypot(local.x - seamPos.position.x, local.y - seamPos.position.y)
        if (dSeam < d) d = dSeam
      }
    }
  }
  return d
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

type NotchContourSnap = { point: Point; curveIndex: number; t: number }

/** Eck- oder Bézier-Mittelpunkt auf der Master-Kontur → Anker auf der Kerben-Projektionskontur. */
function snapPointToPlacementCurves(
  vertexPos: Point,
  placementCurves: Curve[],
  sharpMaster: Curve[],
  preferredCurveIndex?: number,
  preferredT?: number,
): NotchContourSnap | null {
  if (
    placementCurves === sharpMaster &&
    preferredCurveIndex != null &&
    preferredT != null &&
    preferredCurveIndex >= 0 &&
    preferredCurveIndex < placementCurves.length
  ) {
    return { point: { ...vertexPos }, curveIndex: preferredCurveIndex, t: preferredT }
  }
  const nr = nearestCurveIndexAndPoint(vertexPos, placementCurves)
  if (!nr) return null
  return { point: nr.point, curveIndex: nr.curveIndex, t: nr.t ?? 0 }
}

/**
 * Kerben-Werkzeug: gleiche Treffer wie bei „Punkte anzeigen“ (blaue Eckpunkte, grüne Bézier-Mitte),
 * damit Kerben exakt auf weichen Punkten und Kurvenpunkten gesetzt werden können.
 */
function findNotchContourSnapOnPiece(
  piece: PatternPiece,
  local: Point,
  placementCurves: Curve[],
  vertexHitMm: number,
  vertexSeamHitMm: number,
  curveMidHitMm: number,
): NotchContourSnap | null {
  if (placementCurves.length === 0) return null
  const displayed = getDisplayedMasterCurves(piece).curves
  if (displayed.length === 0) return null
  const useSeamMaster = useSeamLineForVertexEditing(piece)
  const vertexHitR = useSeamMaster ? vertexSeamHitMm : vertexHitMm
  const sharpMaster = getSharpMasterCurves(piece)

  let bestVertex: { dist: number; vi: number } | null = null
  if (displayed.length > 3) {
    for (let vi = 0; vi < displayed.length; vi++) {
      const vertexPos = vi === 0 ? displayed[0].start : displayed[vi - 1].end
      const d = Math.hypot(local.x - vertexPos.x, local.y - vertexPos.y)
      if (d < vertexHitR && (!bestVertex || d < bestVertex.dist)) {
        bestVertex = { dist: d, vi }
      }
    }
  }

  let bestCurve: { dist: number; ci: number; point: Point } | null = null
  for (let ci = 0; ci < displayed.length; ci++) {
    const c = displayed[ci]
    if (c.type !== 'bezier') continue
    const pt = bezierAt(c, 0.5)
    const d = Math.hypot(local.x - pt.x, local.y - pt.y)
    if (d < curveMidHitMm && (!bestCurve || d < bestCurve.dist)) {
      bestCurve = { dist: d, ci, point: pt }
    }
  }

  if (bestCurve && bestVertex) {
    if (bestCurve.dist <= bestVertex.dist) bestVertex = null
    else bestCurve = null
  }

  if (bestCurve) {
    const c = sharpMaster[bestCurve.ci]
    if (c?.type === 'bezier') {
      const onSharp = snapPointToPlacementCurves(
        bezierAt(c, 0.5),
        placementCurves,
        sharpMaster,
        bestCurve.ci,
        0.5,
      )
      if (onSharp) return onSharp
    }
    return snapPointToPlacementCurves(bestCurve.point, placementCurves, sharpMaster)
  }

  if (bestVertex) {
    const vi = bestVertex.vi
    const vertexPos = vi === 0 ? displayed[0].start : displayed[vi - 1].end
    const ci = vi === 0 ? 0 : vi - 1
    const t = vi === 0 ? 0 : 1
    return snapPointToPlacementCurves(vertexPos, placementCurves, sharpMaster, ci, t)
  }

  return null
}

type NotchContourSnapHits = { vertexHitMm: number; vertexSeamHitMm: number; curveMidHitMm: number }

function notchContourSnapHitRadiiMm(
  container: HTMLElement,
  svgEl: SVGElement | null,
  view: { zoom: number; panX: number; panY: number },
  vertexUiScale: number,
): NotchContourSnapHits {
  return {
    vertexHitMm: clampPointHitWorldMm(
      worldHitRadiusFromScreenPx(VERTEX_HIT_RADIUS_PX * vertexUiScale, view, svgEl, container),
    ),
    vertexSeamHitMm: clampPointHitWorldMm(
      worldHitRadiusFromScreenPx(VERTEX_HIT_SEAM_RADIUS_PX * vertexUiScale, view, svgEl, container),
    ),
    curveMidHitMm: clampPointHitWorldMm(
      worldHitRadiusFromScreenPx(POINT_ON_CURVE_HIT_RADIUS_PX * vertexUiScale, view, svgEl, container),
    ),
  }
}

/** Kontur-Snap (Eck-/Kurvenpunkt) auf placementCurves → Speicherung entlang cutLine. */
function mapContourSnapToCutLine(
  piece: PatternPiece,
  snap: NotchContourSnap,
  placementCurves: Curve[],
): { curveIndex: number; t: number; point: Point } {
  if (placementCurves === piece.cutLine) {
    return { curveIndex: snap.curveIndex, t: snap.t, point: snap.point }
  }
  const onCut = nearestCurveIndexAndPoint(snap.point, piece.cutLine)
  if (!onCut) {
    return { curveIndex: snap.curveIndex, t: snap.t, point: snap.point }
  }
  return { curveIndex: onCut.curveIndex, t: onCut.t ?? 0, point: onCut.point }
}

function findInternalLineNotchSnap(
  piece: PatternPiece,
  local: Point,
  hitMm: number,
): NotchContourSnap | null {
  let best: { dist: number; curveIndex: number; t: number; point: Point } | null = null
  for (const { dist, target } of collectInternalLineVertexHoverCandidates(piece, local, hitMm)) {
    if (best && dist >= best.dist) continue
    const lines = piece.internalLines
    if (target.kind === 'internalTerminal') {
      const ci = target.curveIndex
      const c = lines[ci]
      if (!c) continue
      const point = target.end === 'start' ? c.start : c.end
      best = { dist, curveIndex: ci, t: target.end === 'start' ? 0 : 1, point: { ...point } }
    } else if (target.kind === 'internalJunction') {
      const j = target.j
      const pt = lines[j]?.start
      if (!pt) continue
      best = { dist, curveIndex: j, t: 0, point: { ...pt } }
    }
  }
  if (!best) return null
  return { point: best.point, curveIndex: best.curveIndex, t: best.t }
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

/** Fallback, wenn Container fehlt (sollte selten sein). */
const POINT_INSERT_HIT_FALLBACK_MM = 15

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

function nearestInternalLineForPointInsert(
  piece: PatternPiece,
  local: Point,
  hitMm: number
): { curveIndex: number; point: Point; t?: number; distance: number } | null {
  if (piece.internalLines.length === 0) return null
  const nearest = nearestCurveIndexAndPoint(local, piece.internalLines)
  if (!nearest || nearest.distance > hitMm) return null
  return nearest
}

function nearestPointForMasterPointEditing(piece: PatternPiece, local: Point, hitMm: number) {
  const seamPc = useSeamLineForPointCurveEditing(piece)
  const master = seamPc ? piece.seamLine : piece.cutLine
  if (master.length === 0) return null
  // Nahtzugabe: Maus oft auf der äußeren cutLine; minimaler Zusatz in mm (Screen-Basis liefert `hitMm` beim Zoom).
  const hitMaster =
    seamPc && piece.seamAllowanceMm != null ? Math.max(hitMm, piece.seamAllowanceMm + 2) : hitMm
  const hitCut =
    seamPc && piece.seamAllowanceMm != null ? Math.max(hitMm, piece.seamAllowanceMm + 2) : hitMm
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
  const ly = dx * sin + dy * cos
  if (mirrored) lx = -lx
  return { x: lx, y: ly }
}

function pieceLocalToWorld(local: Point, piece: PatternPiece): Point {
  const { x: tx, y: ty, rotation, mirrored } = piece.transform
  let lx = local.x
  const ly = local.y
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
const GRAIN_HIT_ENDPOINT_MM = 8

/** Prüft, ob ein Punkt (Teilkoordinaten) im Klick-/Hover-Bereich des Laufrichtungspfeils liegt. */
function isPointInGrainArrowArea(local: Point, piece: PatternPiece): boolean {
  const g = getGrainArrowLayout(piece)
  if (!g) return false
  const { line, tickStart, tickEnd, tickBaseLeft, tickBaseRight, endTip, baseLeft, baseRight } = g
  if (Math.hypot(local.x - line.start.x, local.y - line.start.y) <= GRAIN_HIT_ENDPOINT_MM) return true
  if (Math.hypot(local.x - line.end.x, local.y - line.end.y) <= GRAIN_HIT_ENDPOINT_MM) return true
  const shaft = distPointToSegmentMm(local, line.start, line.end)
  if (shaft.d <= GRAIN_HIT_SHAFT_HALF_MM) return true
  const tick = distPointToSegmentMm(local, tickStart, tickEnd)
  if (tick.d <= GRAIN_HIT_TICK_HALF_MM) return true
  if (isPointInPolygon(local, [endTip, baseLeft, baseRight])) return true
  if (minDistToTriangleEdgesMm(local, endTip, baseLeft, baseRight) <= GRAIN_HIT_HEAD_MM) return true
  if (isPointInPolygon(local, [tickEnd, tickBaseLeft, tickBaseRight])) return true
  if (minDistToTriangleEdgesMm(local, tickEnd, tickBaseLeft, tickBaseRight) <= GRAIN_HIT_HEAD_MM) return true
  return false
}

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

/** Treffer-/Hover-Distanz (mm) für Nahtzuordnung: Klick oder Zeiger auf Konturlinie (Kante von Punkt zu Punkt) */
const SEAM_HIT_MM = 28

/** Trefferradius in Bildschirm-px (Radius); wird über `worldHitRadiusFromScreenPx` in Welt-mm umgerechnet. */
const VERTEX_HIT_RADIUS_PX = 8
const VERTEX_HIT_SEAM_RADIUS_PX = 10
const POINT_ON_CURVE_HIT_RADIUS_PX = 10
const POINT_INSERT_HIT_RADIUS_PX = 14
/** Kerbe: gleiche Toleranz wie Hover zum Verschieben/Löschen. */
const PIVOT_SNAP_NOTCH_MM = 6

type DeletableHoverTarget =
  | { pieceId: string; kind: 'vertex'; vertexIndex: number }
  | { pieceId: string; kind: 'pointOnCurve'; curveIndex: number }
  | { pieceId: string; kind: 'internalJunction'; j: number }
  | { pieceId: string; kind: 'internalTerminal'; curveIndex: number; end: 'start' | 'end' }
  | { pieceId: string; kind: 'internalPointOnCurve'; curveIndex: number }

function collectInternalLineVertexHoverCandidates(
  piece: PatternPiece,
  local: Point,
  hitMm: number
): Array<{ dist: number; target: DeletableHoverTarget }> {
  const lines = piece.internalLines
  const n = lines.length
  if (n === 0) return []
  const pid = piece.id
  const out: Array<{ dist: number; target: DeletableHoverTarget }> = []
  const p0 = lines[0].start
  out.push({
    dist: Math.hypot(local.x - p0.x, local.y - p0.y),
    target: { pieceId: pid, kind: 'internalTerminal', curveIndex: 0, end: 'start' },
  })
  for (let j = 1; j < n; j++) {
    const jp = lines[j].start
    const d = Math.hypot(local.x - jp.x, local.y - jp.y)
    if (internalLineEndpointsTouch(lines[j - 1].end, lines[j].start)) {
      out.push({ dist: d, target: { pieceId: pid, kind: 'internalJunction', j } })
    } else {
      const ep = lines[j - 1].end
      out.push({
        dist: Math.hypot(local.x - ep.x, local.y - ep.y),
        target: { pieceId: pid, kind: 'internalTerminal', curveIndex: j - 1, end: 'end' },
      })
      out.push({ dist: d, target: { pieceId: pid, kind: 'internalTerminal', curveIndex: j, end: 'start' } })
    }
  }
  const en = lines[n - 1].end
  out.push({
    dist: Math.hypot(local.x - en.x, local.y - en.y),
    target: { pieceId: pid, kind: 'internalTerminal', curveIndex: n - 1, end: 'end' },
  })
  return out.filter((x) => x.dist <= hitMm)
}

function mergeInternalLineVertexVsCurve(
  bestVertex: { dist: number; value: DeletableHoverTarget | null },
  bestCurve: { dist: number; value: DeletableHoverTarget | null }
): { dist: number; value: DeletableHoverTarget | null } {
  if (bestCurve.value == null && bestVertex.value == null) {
    return { dist: 1e15, value: null }
  }
  if (bestCurve.value == null) return bestVertex
  if (bestVertex.value == null) return bestCurve
  if (bestCurve.dist <= bestVertex.dist) return bestCurve
  return bestVertex
}

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
    return { dist: 1e15, value: null }
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
function findPivotSnapTargetAtWorld(
  world: Point,
  pieces: PatternPiece[],
  view: { zoom: number; panX: number; panY: number },
  svgEl: SVGElement | null,
  container: HTMLElement | null
): { pieceId: string; pivotLocal: Point } | null {
  const vtxUi = useStore.getState().canvasVertexPointUiScale
  const vtxS = Math.min(2.5, Math.max(0.5, Number.isFinite(vtxUi) ? vtxUi : 1))
  const NOTCH_HOVER_HIT = PIVOT_SNAP_NOTCH_MM
  const hoverVertexHitMm = container
    ? clampPointHitWorldMm(worldHitRadiusFromScreenPx(VERTEX_HIT_RADIUS_PX * vtxS, view, svgEl, container))
    : 5
  const hoverVertexSeamHitMm = container
    ? clampPointHitWorldMm(worldHitRadiusFromScreenPx(VERTEX_HIT_SEAM_RADIUS_PX * vtxS, view, svgEl, container))
    : 8
  const hoverCurveMidHitMm = container
    ? clampPointHitWorldMm(worldHitRadiusFromScreenPx(POINT_ON_CURVE_HIT_RADIUS_PX * vtxS, view, svgEl, container))
    : 10

  let bestVertexOnly: { dist: number; value: DeletableHoverTarget | null } = {
    dist: 1e15,
    value: null,
  }
  let bestCurveOnly: { dist: number; value: DeletableHoverTarget | null } = {
    dist: 1e15,
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
      const d = distanceToNotchHoverMm(local, notch, p)
      if (d < bestNotch.dist) bestNotch = { dist: d, pieceId: p.id, notchId: notch.id }
    }
  }

  let bestAux: { dist: number; pieceId: string; point: Point } = {
    dist: 1e15,
    pieceId: '',
    point: { x: 0, y: 0 },
  }
  for (const p of pieces) {
    const local = worldToPieceLocal(world, p)
    const grain = getPieceGrainLine(p)
    const auxPoints: Point[] = [
      grain.start,
      grain.end,
      { x: (grain.start.x + grain.end.x) / 2, y: (grain.start.y + grain.end.y) / 2 },
      ...p.internalCircles.map((ic) => ic.center),
      ...p.drills.map((d) => d.center),
    ]
    for (const il of p.internalLines) {
      auxPoints.push(il.start, il.end)
    }
    for (const ap of auxPoints) {
      const d = Math.hypot(local.x - ap.x, local.y - ap.y)
      if (d < bestAux.dist) bestAux = { dist: d, pieceId: p.id, point: ap }
    }
  }

  const pieceForPivot = bestVertex.value ? pieces.find((p) => p.id === bestVertex.value!.pieceId) : null
  const useSeamPivot = pieceForPivot != null && useSeamLineForVertexEditing(pieceForPivot)
  const pivotHoverMaxDist =
    bestVertex.value == null
      ? 0
      : bestVertex.value.kind === 'vertex'
        ? (useSeamPivot ? hoverVertexSeamHitMm : hoverVertexHitMm)
        : hoverCurveMidHitMm
  const vertexInRange = bestVertex.value != null && bestVertex.dist <= pivotHoverMaxDist
  const notchInRange = bestNotch.dist <= NOTCH_HOVER_HIT
  const auxInRange = bestAux.pieceId !== '' && bestAux.dist <= hoverVertexHitMm

  type PivotPick = 'notch' | 'vertex' | 'aux'
  let pick: PivotPick | null = null
  let bestDist = 1e15
  if (notchInRange && bestNotch.dist < bestDist) {
    pick = 'notch'
    bestDist = bestNotch.dist
  }
  if (vertexInRange && bestVertex.value != null && bestVertex.dist < bestDist) {
    pick = 'vertex'
    bestDist = bestVertex.dist
  }
  if (auxInRange && bestAux.dist < bestDist) {
    pick = 'aux'
    bestDist = bestAux.dist
  }
  if (!pick) return null

  if (pick === 'notch') {
    const piece = pieces.find((x) => x.id === bestNotch.pieceId)
    const notch = piece?.notches.find((n) => n.id === bestNotch.notchId)
    if (!piece || !notch) return null
    const intPos =
      isNotchOnInternalLine(notch) && piece.internalLines.length > 0
        ? getNotchPositionAndAngleOnInternalLine(notch, piece.internalLines)?.position
        : null
    const position =
      intPos ?? getNotchPositionAndAngle(notch, piece.cutLine, piece.seamLine).position
    return { pieceId: piece.id, pivotLocal: { ...position } }
  }
  if (pick === 'aux') {
    return { pieceId: bestAux.pieceId, pivotLocal: { ...bestAux.point } }
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

function resolvePivotFromHoveredTarget(
  hoveredPoint: DeletableHoverTarget | null,
  hoveredNotch: { pieceId: string; notchId: string } | null,
  hoveredInternalLine: { pieceId: string; curveIndex: number } | null,
  hoveredInternalCircle: { pieceId: string; circleId: string } | null,
  world: Point,
  pieces: PatternPiece[]
): { pieceId: string; pivotLocal: Point } | null {
  if (hoveredNotch) {
    const piece = pieces.find((x) => x.id === hoveredNotch.pieceId)
    const notch = piece?.notches.find((n) => n.id === hoveredNotch.notchId)
    if (piece && notch) {
      const intPos =
        isNotchOnInternalLine(notch) && piece.internalLines.length > 0
          ? getNotchPositionAndAngleOnInternalLine(notch, piece.internalLines)?.position
          : null
      const { position } = intPos
        ? { position: intPos }
        : getNotchPositionAndAngle(notch, piece.cutLine, piece.seamLine)
      return { pieceId: piece.id, pivotLocal: { ...position } }
    }
  }
  if (hoveredPoint) {
    const piece = pieces.find((x) => x.id === hoveredPoint.pieceId)
    if (!piece) return null
    if (hoveredPoint.kind === 'vertex') {
      const p = getMasterContourVertexLocal(piece, hoveredPoint.vertexIndex)
      if (!p) return null
      return { pieceId: piece.id, pivotLocal: p }
    }
    if (hoveredPoint.kind === 'pointOnCurve') {
      const curvesPv = useSeamLineForPointCurveEditing(piece) ? piece.seamLine : piece.cutLine
      const c = curvesPv[hoveredPoint.curveIndex]
      if (c?.type !== 'bezier') return null
      return { pieceId: piece.id, pivotLocal: bezierAt(c, 0.5) }
    }
    if (hoveredPoint.kind === 'internalPointOnCurve') {
      const c = piece.internalLines[hoveredPoint.curveIndex]
      if (c?.type !== 'bezier') return null
      return { pieceId: piece.id, pivotLocal: bezierAt(c, 0.5) }
    }
    if (hoveredPoint.kind === 'internalJunction') {
      const j = hoveredPoint.j
      const p = piece.internalLines[j]?.start
      if (!p) return null
      return { pieceId: piece.id, pivotLocal: { ...p } }
    }
    if (hoveredPoint.kind === 'internalTerminal') {
      const c = piece.internalLines[hoveredPoint.curveIndex]
      if (!c) return null
      const p = hoveredPoint.end === 'start' ? c.start : c.end
      return { pieceId: piece.id, pivotLocal: { ...p } }
    }
    return null
  }
  if (hoveredInternalLine) {
    const piece = pieces.find((x) => x.id === hoveredInternalLine.pieceId)
    const line = piece?.internalLines[hoveredInternalLine.curveIndex]
    if (!piece || !line) return null
    const local = worldToPieceLocal(world, piece)
    const dStart = Math.hypot(local.x - line.start.x, local.y - line.start.y)
    const dEnd = Math.hypot(local.x - line.end.x, local.y - line.end.y)
    return { pieceId: piece.id, pivotLocal: dStart <= dEnd ? { ...line.start } : { ...line.end } }
  }
  if (hoveredInternalCircle) {
    const piece = pieces.find((x) => x.id === hoveredInternalCircle.pieceId)
    const circle = piece?.internalCircles.find((c) => c.id === hoveredInternalCircle.circleId)
    if (!piece || !circle) return null
    return { pieceId: piece.id, pivotLocal: { ...circle.center } }
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

function getVertexColors() {
  return {
    COLOR_ECKPUNKT: T.vertex.corner,
    COLOR_SOFT_PUNKT: T.vertex.soft,
    COLOR_PUNKT_AUF_KURVE: T.vertex.curvePoint,
    NOTCH_STROKE: T.notch.stroke,
  }
}

type NotchMovePreviewState = {
  pieceId: string
  position: Point
  angle: number
  curveIndex: number
  t: number
  distanceMmLeft: number
  distanceMmRight: number
  storePos: Point
  storeAngle: number
  onInternalLine?: boolean
}

type NotchMovePreviewOpts = {
  /** Mausposition in Teillokal-Koordinaten (für Eck-/Kurvenpunkt-Snap wie beim Kerben-Werkzeug). */
  local?: Point
  placementCurves?: Curve[]
  snapHits?: NotchContourSnapHits
}

/** Vorschau beim Verschieben einer Kerbe (cutLine); optional Mausposition zur Projektion. */
function buildNotchMovePreview(
  piece: PatternPiece,
  notchId: string,
  moveOpts?: NotchMovePreviewOpts,
): NotchMovePreviewState | null {
  const notch = piece.notches.find((n) => n.id === notchId)
  if (!notch) return null
  const localHint = moveOpts?.local
  if (isNotchOnInternalLine(notch)) {
    if (piece.internalLines.length === 0) return null
    const intPos = getNotchPositionAndAngleOnInternalLine(notch, piece.internalLines)
    if (!intPos) return null
    const intSnap =
      localHint && moveOpts?.snapHits
        ? findInternalLineNotchSnap(piece, localHint, moveOpts.snapHits.vertexHitMm)
        : null
    const nearest = intSnap
      ? { curveIndex: intSnap.curveIndex, point: intSnap.point, t: intSnap.t }
      : nearestCurveIndexAndPoint(localHint ?? intPos.position, piece.internalLines)
    if (!nearest) return null
    const t = intSnap?.t ?? nearest.t ?? 0
    const curve = piece.internalLines[nearest.curveIndex]
    const storePos = intSnap?.point ?? pointOnCurveAt(curve, t)
    const storeAngle = outwardNormalAngleAt(piece.internalLines, nearest.curveIndex, t) + 180
    const dist = getNotchMeasurementDistancesOnContour(
      piece,
      piece.internalLines,
      nearest.curveIndex,
      t,
      { excludeNotchId: notchId, onInternalLine: true },
    )
    return {
      pieceId: piece.id,
      position: storePos,
      angle: storeAngle,
      curveIndex: nearest.curveIndex,
      t,
      distanceMmLeft: dist.distanceMmLeft,
      distanceMmRight: dist.distanceMmRight,
      storePos,
      storeAngle,
      onInternalLine: true,
    }
  }
  if (piece.cutLine.length === 0) return null
  const { position: notchPos } = getNotchPositionAndAngle(notch, piece.cutLine, piece.seamLine)
  const placementCurves = moveOpts?.placementCurves ?? piece.cutLine
  let cutCurveIndex: number
  let cutT: number
  let storePos: Point
  if (localHint && moveOpts?.snapHits && placementCurves.length > 0) {
    const contourSnap = findNotchContourSnapOnPiece(
      piece,
      localHint,
      placementCurves,
      moveOpts.snapHits.vertexHitMm,
      moveOpts.snapHits.vertexSeamHitMm,
      moveOpts.snapHits.curveMidHitMm,
    )
    if (contourSnap) {
      const onCut = mapContourSnapToCutLine(piece, contourSnap, placementCurves)
      cutCurveIndex = onCut.curveIndex
      cutT = onCut.t
      storePos = onCut.point
    } else {
      const cutNearest = nearestCurveIndexAndPoint(localHint, piece.cutLine)
      if (!cutNearest) return null
      cutCurveIndex = cutNearest.curveIndex
      cutT = cutNearest.t ?? 0
      storePos = cutNearest.point
    }
  } else {
    const cutNearest = nearestCurveIndexAndPoint(localHint ?? notchPos, piece.cutLine)
    if (!cutNearest) return null
    cutCurveIndex = cutNearest.curveIndex
    cutT = cutNearest.t ?? 0
    storePos = cutNearest.point
  }
  const storeAngle = outwardNormalAngleAt(piece.cutLine, cutCurveIndex, cutT) + 180
  const dist = getCutLineNotchMeasurementDistances(piece, cutCurveIndex, cutT, notchId)
  return {
    pieceId: piece.id,
    position: storePos,
    angle: storeAngle,
    curveIndex: cutCurveIndex,
    t: cutT,
    distanceMmLeft: dist.distanceMmLeft,
    distanceMmRight: dist.distanceMmRight,
    storePos,
    storeAngle,
  }
}

function openNotchMoveDistanceEditorFromPreview(
  piece: PatternPiece,
  notchId: string,
  preview: NotchMovePreviewState,
  side: 'left' | 'right',
  clientX: number,
  clientY: number,
): {
  pieceId: string
  notchId: string
  curveIndex: number
  anchorS: number
  boundPrevS: number
  boundNextS: number
  onInternalLine?: boolean
  side: 'left' | 'right'
  value: string
  clientX: number
  clientY: number
} {
  const onInternalLine = preview.onInternalLine ?? false
  const contours = onInternalLine ? piece.internalLines : piece.cutLine
  const bounds = getNotchMeasurementDistancesOnContour(
    piece,
    contours,
    preview.curveIndex,
    preview.t,
    { excludeNotchId: notchId, onInternalLine },
  )
  const value =
    side === 'left'
      ? preview.distanceMmLeft.toFixed(1).replace('.', ',')
      : preview.distanceMmRight.toFixed(1).replace('.', ',')
  return {
    pieceId: piece.id,
    notchId,
    curveIndex: preview.curveIndex,
    anchorS: bounds.anchorS,
    boundPrevS: bounds.boundPrevS,
    boundNextS: bounds.boundNextS,
    onInternalLine,
    side,
    value,
    clientX,
    clientY,
  }
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

/**
 * Radius in Browser-Pixeln → zulässiger Abstand in Welt-mm (wie `getScreenPoint`).
 * So bleibt die sichtbare Klick-/Hover-Fläche beim Zoomen etwa konstant statt mit fester mm-Toleranz riesig zu werden.
 */
function worldHitRadiusFromScreenPx(
  radiusPx: number,
  view: { zoom: number; panX: number; panY: number },
  svgEl: SVGElement | null,
  container: HTMLElement
): number {
  if (radiusPx <= 0) return 0
  let scale = Math.min(container.getBoundingClientRect().width / VIEWBOX_WIDTH, container.getBoundingClientRect().height / VIEWBOX_HEIGHT)
  if (svgEl) {
    const svgRect = svgEl.getBoundingClientRect()
    scale = Math.min(svgRect.width / VIEWBOX_WIDTH, svgRect.height / VIEWBOX_HEIGHT)
  }
  return radiusPx / (Math.max(scale, 1e-9) * Math.max(view.zoom, 1e-6))
}

/** Extremzoom / Mini-Zoom begrenzen, damit Punkte greifbar bleiben ohne riesige Toleranz. */
function clampPointHitWorldMm(r: number): number {
  return Math.min(Math.max(r, 0.2), 12)
}

const PieceGroup = memo(function PieceGroup({
  piece,
  isSelected,
  isHovered,
  isDialogHovered = false,
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
  /** Endpunkte des Laufrichtungs-Pfeils (nur wenn Fadenlauf per Ziehen änderbar, z. B. Layout-Modus). */
  showGrainDragHandles,
  /** Schaft ziehbar (nur Layout-Modus, nicht Kontur bearbeiten). */
  grainArrowDraggable,
  showNotches,
  showDrills,
  showInternalLines,
  showPieceNames,
  showContourMeasurements,
  showRotationRing,
  showPivotRotationUi,
  isRotationRingHovered,
  isRotationHandleHovered,
  isRotationActive,
  hoveredInternalLineCurveIndex,
  hoveredInternalCircleId,
  onContextMenu,
  viewZoom,
  rotationUiScale,
  textUiScale,
  themeMode: _themeMode,
}: {
  piece: PatternPiece
  isSelected: boolean
  isHovered: boolean
  isDialogHovered?: boolean
  hoveredSegmentCurveIndex: number | null
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
  showGrainDragHandles?: boolean
  grainArrowDraggable?: boolean
  showNotches?: boolean
  showDrills?: boolean
  showInternalLines?: boolean
  showPieceNames?: boolean
  showContourMeasurements?: boolean
  showRotationRing?: boolean
  /** Drehpunkt, Drehring, Drehgriff am ausgewählten Teil */
  showPivotRotationUi: boolean
  isRotationRingHovered?: boolean
  isRotationHandleHovered?: boolean
  isRotationActive?: boolean
  hoveredInternalLineCurveIndex?: number | null
  hoveredInternalCircleId?: string | null
  onContextMenu?: (e: React.MouseEvent) => void
  viewZoom: number
  /** Zoom-unabhängige Skalierung für Drehring, Drehgriff, Drehpunkt (Einstellungen). */
  rotationUiScale: number
  /** Schrift auf dem Teil (Teilename, Maße, …). */
  textUiScale: number
  /** Theme-Modus: nur für memo-Invalidierung, T wird modulweit gesetzt. */
  themeMode: string
}) {
  void _themeMode
  const ct = (base: number) => canvasTextSize(base, textUiScale)
  const { NOTCH_STROKE } = getVertexColors()
  const { cutLine, seamLine, notches, drills, internalLines, internalCircles } = piece
  const ptPs = 1 / Math.max(viewZoom, 1e-6)
  const tx = pieceGroupTransformAttr(piece)
  const { solidPath, dashedPath, hasSeam, solidStrokeOnly, dashedStrokeOnly } = getPieceContourDisplayPaths(
    piece,
    !!cutSeamSwapped,
    notchIdBeingDragged ?? undefined,
  )
  const materialFill = pieceInteriorFillFromMaterial(piece.material, _themeMode === 'dark')
  const isDialogHighlightActive = isDialogHovered
  const isFacing = piece.kind === 'facing' || !!piece.facingParentId
  const facingHatchFill =
    _themeMode === 'dark' ? 'url(#facing-hatch-dark)' : 'url(#facing-hatch-light)'
  const interiorFill = isDialogHighlightActive
    ? T.piece.fillDialogHover
    : isFacing
      ? facingHatchFill
      : piece.fillInterior != null && piece.fillInterior !== false
        ? typeof piece.fillInterior === 'string'
          ? piece.fillInterior
          : materialFill ?? T.piece.fillSelected
        : isSelected
          ? T.piece.fillSelected
          : T.piece.fill
  const interiorFillOpacity =
    interiorFill === 'none' ? undefined : isFacing ? 1 : isSelected && T.piece.fill === 'none' ? 1 : 0.82
  const dashedFill = dashedStrokeOnly ? 'none' : interiorFill
  const dashedFillOpacity = dashedStrokeOnly ? undefined : interiorFillOpacity
  const solidFill = solidStrokeOnly ? 'none' : interiorFill
  const solidFillOpacity = solidStrokeOnly ? undefined : interiorFillOpacity

  const sym = piece.symmetryConstraint
  const symClips =
    sym && solidPath && !solidStrokeOnly
      ? getSymmetryHalfPlaneClipPolygons(sym.axisA, sym.axisB, sym.keepSide, cutLine)
      : null
  const symKeepClipId = symClips ? `sym-keep-${piece.id}` : null
  const symMirrorClipId = symClips ? `sym-mirror-${piece.id}` : null

  const renderSplitFill = (
    pathD: string | null,
    strokeOnly: boolean,
    dashed = false,
  ) => {
    if (!pathD || strokeOnly) return null
    if (!symClips || !symKeepClipId || !symMirrorClipId) {
      return (
        <path
          d={pathD}
          fill={dashed ? dashedFill : solidFill}
          fillOpacity={dashed ? dashedFillOpacity : solidFillOpacity}
          stroke="none"
          pointerEvents="none"
        />
      )
    }
    const fill = dashed ? dashedFill : solidFill
    if (fill === 'none' && !symClips) return null
    const effectiveFill = fill === 'none' ? T.piece.fillSelected : fill
    if (!symClips || !symKeepClipId || !symMirrorClipId) {
      return (
        <path
          d={pathD}
          fill={effectiveFill}
          fillOpacity={dashed ? dashedFillOpacity : solidFillOpacity}
          stroke="none"
          pointerEvents="none"
        />
      )
    }
    return (
      <>
        <path
          d={pathD}
          fill={effectiveFill}
          fillOpacity={T.piece.symmetryMirrorFillOpacity}
          clipPath={`url(#${symMirrorClipId})`}
          stroke="none"
          pointerEvents="none"
        />
        <path
          d={pathD}
          fill={effectiveFill}
          fillOpacity={T.piece.symmetryKeepFillOpacity}
          clipPath={`url(#${symKeepClipId})`}
          stroke="none"
          pointerEvents="none"
        />
      </>
    )
  }

  const solidStroke = isDialogHighlightActive ? T.piece.strokeDialogHover
    : isHovered ? T.piece.strokeHover
      : isSelected ? T.piece.strokeSelected
        : T.piece.stroke
  const solidStrokeWidth = isDialogHighlightActive ? T.piece.strokeWidthDialogHover
    : isHovered ? T.piece.strokeWidthHover
      : isSelected ? T.piece.strokeWidthSelected
        : T.piece.strokeWidth

  return (
    <g
      transform={tx}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
    >
      {symClips && symKeepClipId && symMirrorClipId && (
        <defs>
          <clipPath id={symKeepClipId}>
            <polygon points={symmetryClipPolygonPointsAttr(symClips.keep)} />
          </clipPath>
          <clipPath id={symMirrorClipId}>
            <polygon points={symmetryClipPolygonPointsAttr(symClips.mirror)} />
          </clipPath>
        </defs>
      )}
      {hasSeam && dashedPath && (
        <>
          {renderSplitFill(dashedPath, !!dashedStrokeOnly, true)}
          <path
            d={dashedPath}
            fill="none"
            stroke={T.piece.strokeDashed}
            strokeWidth={T.piece.strokeWidthDashed * ptPs}
            strokeLinecap={dashedStrokeOnly ? 'round' : undefined}
            opacity={T.piece.dashOpacity}
            pointerEvents="none"
          />
        </>
      )}
      {solidPath && (
        <>
          {renderSplitFill(solidPath, !!solidStrokeOnly, false)}
          <path
            d={solidPath}
            fill="none"
            stroke={solidStroke}
            strokeWidth={solidStrokeWidth * ptPs}
            strokeLinecap={solidStrokeOnly ? 'round' : undefined}
            pointerEvents="none"
          />
        </>
      )}
      {hoveredSegmentCurveIndex != null &&
        (hoveredSegmentOnSeam ? seamLine[hoveredSegmentCurveIndex] : cutLine[hoveredSegmentCurveIndex]) && (
        <path
          d={curveToPathD([
            (hoveredSegmentOnSeam ? seamLine : cutLine)[hoveredSegmentCurveIndex],
          ])}
          fill="none"
          stroke={T.piece.strokeSegmentHover}
          strokeWidth={T.piece.strokeWidthSegmentHover * ptPs}
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
          stroke={T.piece.strokeEmpty}
          strokeWidth={0.55 * ptPs}
          pointerEvents="none"
        />
      )}
      {showInternalLines !== false && internalCircles.map((ic) => {
        const isHovered = hoveredInternalCircleId === ic.id
        const w = (isHovered ? T.internalLine.strokeWidthHover : T.internalLine.strokeWidth) * ptPs
        return (
          <circle
            key={`internal-circle-${ic.id}`}
            cx={ic.center.x}
            cy={ic.center.y}
            r={ic.radius}
            fill="none"
            stroke={isHovered ? T.internalLine.strokeHover : T.internalLine.stroke}
            strokeWidth={w}
            strokeDasharray={scaleSvgDashArray(T.internalLine.dash, ptPs)}
            opacity={isHovered ? 1 : T.internalLine.opacity}
            pointerEvents="none"
          />
        )
      })}
      {showInternalLines !== false && internalLines.map((curve, i) => {
        const isHovered = hoveredInternalLineCurveIndex === i
        const w = (isHovered ? T.internalLine.strokeWidthHover : T.internalLine.strokeWidth) * ptPs
        return (
          <path
            key={`internal-${i}`}
            d={curveToPathD([curve])}
            fill="none"
            stroke={isHovered ? T.internalLine.strokeHover : T.internalLine.stroke}
            strokeWidth={w}
            strokeDasharray={scaleSvgDashArray(T.internalLine.dash, ptPs)}
            opacity={isHovered ? 1 : T.internalLine.opacity}
            pointerEvents="none"
          />
        )
      })}
      {piece.symmetryConstraint && (() => {
        const { axisA, axisB } = piece.symmetryConstraint
        const clipped = symmetryAxisClippedToPieceBounds(axisA, axisB, cutLine)
        if (!clipped) return null
        return (
          <line
            key="piece-symmetry-constraint-axis"
            x1={clipped.p1.x}
            y1={clipped.p1.y}
            x2={clipped.p2.x}
            y2={clipped.p2.y}
            stroke="#0d9488"
            strokeWidth={2.4 * ptPs}
            strokeDasharray={scaleSvgDashArray('8 5', ptPs)}
            pointerEvents="none"
            opacity={0.9}
          />
        )
      })()}
      {showNotches !== false && notches.map((n) => {
        if (notchIdBeingDragged === n.id) return null
        const depth = n.depth
        const width = n.width ?? 6
        if (isNotchOnInternalLine(n) && internalLines.length > 0) {
          const intPos = getNotchPositionAndAngleOnInternalLine(n, internalLines)
          if (!intPos) return null
          const intParam = resolveNotchInternalLineAnchor(n, internalLines)
          const intPts = notchCutoutPoints(
            intPos.position,
            intPos.angle,
            depth,
            width,
            internalLines,
            intParam,
            n.type
          )
          if (!intPts) return null
          const { fillD: intFillD, edgesD: intEdgesD } = notchCutoutSvgPaths(intPts)
          const intIsLine = intPts.kind === 'line'
          const isHovered = hoveredNotchId === n.id
          const stroke = isHovered ? T.notch.strokeHover : NOTCH_STROKE
          const roleFill = n.role ? (isHovered ? T.notch.roleFillHover : T.notch.roleFill) : T.notch.fill
          const strokeW = isHovered ? 0.7 : 0.4
          return (
            <g key={n.id} pointerEvents="none">
              {intFillD ? <path d={intFillD} fill={roleFill} stroke="none" /> : null}
              <path
                d={intEdgesD}
                fill="none"
                stroke={stroke}
                strokeWidth={intIsLine ? Math.max(strokeW, 0.55) : strokeW}
                strokeLinejoin="round"
                strokeLinecap={intIsLine ? 'round' : 'butt'}
              />
            </g>
          )
        }
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
        const stroke = isHovered ? T.notch.strokeHover : NOTCH_STROKE
        const roleFill = n.role ? (isHovered ? T.notch.roleFillHover : T.notch.roleFill) : T.notch.fill
        const strokeW = isHovered ? 0.7 : 0.4
        return (
          <g key={n.id} pointerEvents="none">
            {cutFillD ? <path d={cutFillD} fill={roleFill} stroke="none" /> : null}
            <path
              d={cutEdgesD}
              fill="none"
              stroke={stroke}
              strokeWidth={cutIsLine ? Math.max(strokeW, 0.55) : strokeW}
              strokeLinejoin="round"
              strokeLinecap={cutIsLine ? 'round' : 'butt'}
            />
            {seamFillD ? <path d={seamFillD} fill={roleFill} stroke="none" /> : null}
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
          stroke={T.drill.stroke}
          strokeWidth={T.drill.strokeWidth}
          pointerEvents="none"
        />
      ))}
      {showGrain !== false && cutLine.length >= 3 && (() => {
        const g = getGrainArrowLayout(piece)
        if (!g) return null
        const { line, tickStart, tickEnd, tickTriangleD, triangleD } = g
        const shaftH = Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y) || 1
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
              style={
                hasGrainHandlers
                  ? {
                      cursor:
                        grainArrowDraggable !== false && isSelected ? 'grab' : 'pointer',
                    }
                  : undefined
              }
            >
              <line
                x1={line.start.x}
                y1={line.start.y}
                x2={line.end.x}
                y2={line.end.y}
                stroke={T.grain.stroke}
                strokeWidth={T.grain.strokeWidth}
                strokeDasharray={T.grain.dash}
                pointerEvents="none"
              />
              <line
                x1={tickStart.x}
                y1={tickStart.y}
                x2={tickEnd.x}
                y2={tickEnd.y}
                stroke={T.grain.stroke}
                strokeWidth={T.grain.strokeWidth}
                strokeDasharray={T.grain.dash}
                pointerEvents="none"
              />
              <path
                d={tickTriangleD}
                fill="none"
                stroke={T.grain.stroke}
                strokeWidth={T.grain.strokeWidth}
                pointerEvents="none"
              />
              <path
                d={triangleD}
                fill="none"
                stroke={T.grain.stroke}
                strokeWidth={T.grain.strokeWidth}
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
                    d={tickTriangleD}
                    fill="rgba(0,0,0,0)"
                    stroke="rgba(0,0,0,0)"
                    strokeWidth={2 * GRAIN_HIT_HEAD_MM}
                    strokeLinejoin="miter"
                    pointerEvents="all"
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
            {showGrainDragHandles && (
              <>
                <circle
                  cx={line.start.x}
                  cy={line.start.y}
                  r={2.35 * ptPs}
                  fill={T.grain.endpoint}
                  stroke={T.grain.endpointStroke}
                  strokeWidth={0.55 * ptPs}
                  pointerEvents="none"
                />
                <circle
                  cx={line.end.x}
                  cy={line.end.y}
                  r={2.35 * ptPs}
                  fill={T.grain.endpoint}
                  stroke={T.grain.endpointStroke}
                  strokeWidth={0.55 * ptPs}
                  pointerEvents="none"
                />
              </>
            )}
            {showPieceNames !== false && (() => {
              // Waagerecht unter der Querlinie (Richtung Pfeilspitze).
              const tickMidX = (tickStart.x + tickEnd.x) / 2
              const tickMidY = (tickStart.y + tickEnd.y) / 2
              const grainDirX = (line.end.x - line.start.x) / shaftH
              const grainDirY = (line.end.y - line.start.y) / shaftH
              const offMm = 4
              const tx = tickMidX + grainDirX * offMm
              const ty = tickMidY + grainDirY * offMm
              return (
                <text
                  x={tx}
                  y={ty}
                  textAnchor="middle"
                  dominantBaseline="hanging"
                  fill={T.text.pieceName}
                  fontSize={ct(3.8)}
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
                  fontSize={ct(3.4)}
                  fontFamily="sans-serif"
                  fontWeight={600}
                  fill={T.text.contourMeasure}
                  stroke={T.text.haloStroke}
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
                  fontSize={ct(3)}
                  fontFamily="sans-serif"
                  fontWeight={700}
                  fill={T.text.edgeAllowance}
                  stroke={T.text.haloStroke}
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
          stroke={T.selection.originMark}
          strokeWidth={0.5}
          strokeDasharray="2 2"
          pointerEvents="none"
        />
      )}
      {isSelected && cutLine.length >= 3 && showPivotRotationUi && (() => {
        const layout = getRotationUiLayout(piece)
        if (!layout) return null
        const { pivot, rotationRadius, handleLocal } = layout
        const hx = handleLocal.x
        const hy = handleLocal.y
        const handleIconRot = (Math.atan2(hy - pivot.y, hx - pivot.x) * 180) / Math.PI + 90
        const ringInteractive = !!isRotationRingHovered || !!isRotationHandleHovered || !!isRotationActive
        const handleScale = isRotationHandleHovered ? 1.1 : 1
        const rs = Math.min(2.5, Math.max(0.5, rotationUiScale))
        const z = ptPs * rs
        const handleRadius = ROTATION_HANDLE_BASE_RADIUS * z * handleScale
        return (
          <>
            <g style={{ cursor: 'grab' }} pointerEvents="all">
              <title>Drehpunkt: ziehen, Doppelklick zurücksetzen · Alt+D auf Ecke, Kerbe oder Bézier-Mitte (ohne „Punkte anzeigen“)</title>
              <circle cx={pivot.x} cy={pivot.y} r={16 * z} fill="transparent" />
              <circle
                cx={pivot.x}
                cy={pivot.y}
                r={4.2 * z}
                fill={T.selection.pivotFill}
                stroke={T.selection.pivotStroke}
                strokeWidth={1 * z}
                pointerEvents="none"
              />
              <line
                x1={pivot.x - 6 * z}
                y1={pivot.y}
                x2={pivot.x + 6 * z}
                y2={pivot.y}
                stroke={T.selection.crosshairStroke}
                strokeWidth={0.8 * z}
                pointerEvents="none"
              />
              <line
                x1={pivot.x}
                y1={pivot.y - 6 * z}
                x2={pivot.x}
                y2={pivot.y + 6 * z}
                stroke={T.selection.crosshairStroke}
                strokeWidth={0.8 * z}
                pointerEvents="none"
              />
            </g>
            {showRotationRing && (
              <circle
                cx={pivot.x}
                cy={pivot.y}
                r={rotationRadius}
                fill="none"
                stroke={ringInteractive ? T.selection.rotationHandleAccent : '#7f7f7f'}
                strokeWidth={ROTATION_RING_STROKE_BASE * z}
                opacity={ringInteractive ? ROTATION_RING_ALPHA_HOVER : ROTATION_RING_ALPHA_IDLE}
                pointerEvents="none"
              />
            )}
            {showRotationRing && (
              <g style={{ cursor: isRotationActive ? 'grabbing' : 'grab' }}>
                <title>Drehgriff: Ziehen zum Drehen des Teils</title>
                <circle
                  cx={hx}
                  cy={hy}
                  r={handleRadius}
                  fill={T.selection.rotationHandleFill}
                  stroke={T.selection.rotationHandleStroke}
                  strokeWidth={1.2 * z}
                />
                <g transform={`rotate(${handleIconRot}, ${hx}, ${hy})`}>
                  <path
                    d={`M ${hx + 5 * z * handleScale} ${hy} A ${5 * z * handleScale} ${5 * z * handleScale} 0 0 1 ${hx - 5 * z * handleScale} ${hy}`}
                    fill="none"
                    stroke={T.selection.rotationHandleStroke}
                    strokeWidth={1.1 * z}
                    strokeLinecap="round"
                  />
                  <path
                    d={`M ${hx - 5 * z * handleScale} ${hy} L ${hx - 6 * z * handleScale} ${hy + 1.2 * z * handleScale} L ${hx - 4.2 * z * handleScale} ${hy + 0.4 * z * handleScale} Z`}
                    fill={T.selection.rotationHandleAccent}
                  />
                </g>
              </g>
            )}
            {!showRotationRing && (
              <g style={{ cursor: 'grab' }}>
                <title>Drehgriff: Ziehen zum Drehen des Teils</title>
              <circle
                cx={hx}
                cy={hy}
                r={ROTATION_HANDLE_BASE_RADIUS * z}
                fill={T.selection.rotationHandleFill}
                stroke={T.selection.rotationHandleStroke}
                strokeWidth={1.2 * z}
              />
              <g transform={`rotate(${handleIconRot}, ${hx}, ${hy})`}>
                <path
                  d={`M ${hx + 5 * z} ${hy} A ${5 * z} ${5 * z} 0 0 1 ${hx - 5 * z} ${hy}`}
                  fill="none"
                  stroke={T.selection.rotationHandleStroke}
                  strokeWidth={1.1 * z}
                  strokeLinecap="round"
                />
                <path
                  d={`M ${hx - 5 * z} ${hy} L ${hx - 6 * z} ${hy + 1.2 * z} L ${hx - 4.2 * z} ${hy + 0.4 * z} Z`}
                  fill={T.selection.rotationHandleAccent}
                />
              </g>
              </g>
            )}
          </>
        )
      })()}
    </g>
  )
})

export function WorkspaceCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const activeTouchPointsRef = useRef<Map<number, { clientX: number; clientY: number }>>(new Map())
  const touchPanPointerIdRef = useRef<number | null>(null)
  const pinchStartRef = useRef<{
    distance: number
    centerClient: { x: number; y: number }
    view: { zoom: number; panX: number; panY: number }
  } | null>(null)
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
    showProfiles,
    showContourMeasurements,
    showWorkspaceNotes,
    showContourChangePreview,
    showSeamPruefanzeigen,
    contourEditEnabled,
    rulerMode,
    setRulerMode,
    rulerLine,
    setView,
    setRulerLine,
    pendingNahtzugabeClick,
    setPendingNahtzugabeClick,
    setNahtzugabeDialogPieceId,
    edgeSeamPickingActive,
    setEdgeSeamPickingActive,
    horizontalLevelPickingActive,
    setHorizontalLevelPickingActive,
    pieceSymmetryState,
    setPieceSymmetryState,
    applyPieceSymmetry,
    alignPieceEdgeHorizontal,
    nahtzuordnungMode,
    setNahtzuordnungMode,
    pendingNahtzuordnungFirst,
    setPendingNahtzuordnungFirst,
    nahtTrimPickCutVertexActive,
    completeNahtTrimAtCutVertex,
    cancelNahtTrimVertexPick,
    addSeamAssignment,
    addInternalSeamAssignment,
    removeSeamAssignment,
    selectPiece,
    movePiece,
    addCurveToCutLine,
    addInternalLine,
    addInternalCircle,
    updateInternalCircle,
    addInternalLines,
    updatePiece,
    removeInternalLine,
    insertPointOnInternalLine,
    replaceInternalLineSegmentWithBezier,
    moveInternalLinePointOnCurve,
    moveInternalLineVertex,
    convertInternalLineBezierToLine,
    removeInternalCircle,
    offsetSegment,
    addNotch,
    removeNotch,
    removeNotchAnchor: _removeNotchAnchor,
    toggleNotchAnchor,
    updateNotch,
    addDrill,
    addPiece,
    createFacingPiece,
    setTool,
    insertPointOnCutLine,
    updateVertex,
    replaceSegmentWithBezier,
    movePointOnCurve,
    removeVertex,
    roundCorner,
    convertBezierSegmentToLine,
    setVertexSoft,
    flipPieceAlongGrain,
    flipPieceAlongAxis,
    rotatePiece90,
    setPieceRotation,
    setPiecePivot,
    setGrainLine,
    materializeMissingGrainLines,
    alignPieceToGrain,
    toastMessage,
    setToastMessage,
    checkSeamAdjustment,
    snapSeamEdgeToMatch,
    recomputeSeamLine,
    applyProfileLengthFitPreviews,
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
    canvasThemeMode,
    seamAdjustmentHoverPieceId,
    canvasRotationUiScale,
    canvasDigitizeUiScale,
    canvasVertexPointUiScale,
    uiTextScale,
    showPivotRotationUi,
  } = useStore(
    useShallow((s) => ({
      workspace: s.workspace,
      selectedPieceIds: s.selectedPieceIds,
      tool: s.tool,
      showGrid: s.showGrid,
      showPoints: s.showPoints,
      showGrain: s.showGrain,
      showNotches: s.showNotches,
      showDrills: s.showDrills,
      showInternalLines: s.showInternalLines,
      showPieceNames: s.showPieceNames,
      showProfiles: s.showProfiles,
      showContourMeasurements: s.showContourMeasurements,
      showWorkspaceNotes: s.showWorkspaceNotes,
      showContourChangePreview: s.showContourChangePreview,
      showSeamPruefanzeigen: s.showSeamPruefanzeigen,
      contourEditEnabled: s.contourEditEnabled,
      rulerMode: s.rulerMode,
      setRulerMode: s.setRulerMode,
      rulerLine: s.rulerLine,
      setView: s.setView,
      setRulerLine: s.setRulerLine,
      pendingNahtzugabeClick: s.pendingNahtzugabeClick,
      setPendingNahtzugabeClick: s.setPendingNahtzugabeClick,
      setNahtzugabeDialogPieceId: s.setNahtzugabeDialogPieceId,
      edgeSeamPickingActive: s.edgeSeamPickingActive,
      setEdgeSeamPickingActive: s.setEdgeSeamPickingActive,
      horizontalLevelPickingActive: s.horizontalLevelPickingActive,
      setHorizontalLevelPickingActive: s.setHorizontalLevelPickingActive,
      pieceSymmetryState: s.pieceSymmetryState,
      setPieceSymmetryState: s.setPieceSymmetryState,
      applyPieceSymmetry: s.applyPieceSymmetry,
      alignPieceEdgeHorizontal: s.alignPieceEdgeHorizontal,
      nahtzuordnungMode: s.nahtzuordnungMode,
      setNahtzuordnungMode: s.setNahtzuordnungMode,
      pendingNahtzuordnungFirst: s.pendingNahtzuordnungFirst,
      setPendingNahtzuordnungFirst: s.setPendingNahtzuordnungFirst,
      nahtTrimPickCutVertexActive: s.nahtTrimPickCutVertexActive,
      completeNahtTrimAtCutVertex: s.completeNahtTrimAtCutVertex,
      cancelNahtTrimVertexPick: s.cancelNahtTrimVertexPick,
      addSeamAssignment: s.addSeamAssignment,
      addInternalSeamAssignment: s.addInternalSeamAssignment,
      removeSeamAssignment: s.removeSeamAssignment,
      selectPiece: s.selectPiece,
      movePiece: s.movePiece,
      addCurveToCutLine: s.addCurveToCutLine,
      addInternalLine: s.addInternalLine,
      addInternalCircle: s.addInternalCircle,
      updateInternalCircle: s.updateInternalCircle,
      addInternalLines: s.addInternalLines,
      updatePiece: s.updatePiece,
      removeInternalLine: s.removeInternalLine,
      insertPointOnInternalLine: s.insertPointOnInternalLine,
      replaceInternalLineSegmentWithBezier: s.replaceInternalLineSegmentWithBezier,
      moveInternalLinePointOnCurve: s.moveInternalLinePointOnCurve,
      moveInternalLineVertex: s.moveInternalLineVertex,
      convertInternalLineBezierToLine: s.convertInternalLineBezierToLine,
      removeInternalCircle: s.removeInternalCircle,
      offsetSegment: s.offsetSegment,
      addNotch: s.addNotch,
      removeNotch: s.removeNotch,
      removeNotchAnchor: s.removeNotchAnchor,
      toggleNotchAnchor: s.toggleNotchAnchor,
      updateNotch: s.updateNotch,
      addDrill: s.addDrill,
      addPiece: s.addPiece,
      createFacingPiece: s.createFacingPiece,
      setTool: s.setTool,
      insertPointOnCutLine: s.insertPointOnCutLine,
      updateVertex: s.updateVertex,
      replaceSegmentWithBezier: s.replaceSegmentWithBezier,
      movePointOnCurve: s.movePointOnCurve,
      removeVertex: s.removeVertex,
      roundCorner: s.roundCorner,
      convertBezierSegmentToLine: s.convertBezierSegmentToLine,
      setVertexSoft: s.setVertexSoft,
      flipPieceAlongGrain: s.flipPieceAlongGrain,
      flipPieceAlongAxis: s.flipPieceAlongAxis,
      rotatePiece90: s.rotatePiece90,
      setPieceRotation: s.setPieceRotation,
      setPiecePivot: s.setPiecePivot,
      setGrainLine: s.setGrainLine,
      materializeMissingGrainLines: s.materializeMissingGrainLines,
      alignPieceToGrain: s.alignPieceToGrain,
      toastMessage: s.toastMessage,
      setToastMessage: s.setToastMessage,
      checkSeamAdjustment: s.checkSeamAdjustment,
      snapSeamEdgeToMatch: s.snapSeamEdgeToMatch,
      recomputeSeamLine: s.recomputeSeamLine,
      applyProfileLengthFitPreviews: s.applyProfileLengthFitPreviews,
      digitizeState: s.digitizeState,
      addDigitizeNode: s.addDigitizeNode,
      updateDigitizeDrag: s.updateDigitizeDrag,
      finishDigitizeDrag: s.finishDigitizeDrag,
      cancelDigitize: s.cancelDigitize,
      finishDigitize: s.finishDigitize,
      startDigitize: s.startDigitize,
      imageDigitizeSession: s.imageDigitizeSession,
      workspaceImageSelected: s.workspaceImageSelected,
      setWorkspaceImageSelected: s.setWorkspaceImageSelected,
      setImageRenderMmPerPixel: s.setImageRenderMmPerPixel,
      cancelImageSession: s.cancelImageSession,
      setImagePosition: s.setImagePosition,
      setShowHelpModal: s.setShowHelpModal,
      deletePiece: s.deletePiece,
      setPiecePropertiesDialogPieceId: s.setPiecePropertiesDialogPieceId,
      setEdgeSeamAllowance: s.setEdgeSeamAllowance,
      setWorkspaceImageLocked: s.setWorkspaceImageLocked,
      exitAllModes: s.exitAllModes,
      notchSettings: s.notchSettings,
      activeNotchPresetIndex: s.activeNotchPresetIndex,
      setMassstabDialog: s.setMassstabDialog,
      setSeamAssignmentMetaDialogId: s.setSeamAssignmentMetaDialogId,
      seamAssignmentMetaDialogId: s.seamAssignmentMetaDialogId,
      batchSelectionFilter: s.batchSelectionFilter,
      batchSelectionTargets: s.batchSelectionTargets,
      batchUiHighlightByTargetId: s.batchUiHighlightByTargetId,
      setBatchSelectionFilter: s.setBatchSelectionFilter,
      setBatchSelectionTargets: s.setBatchSelectionTargets,
      clearBatchSelection: s.clearBatchSelection,
      setBatchUiHighlightForFiltered: s.setBatchUiHighlightForFiltered,
      clearBatchUiHighlight: s.clearBatchUiHighlight,
      batchSetVerticesSoft: s.batchSetVerticesSoft,
      batchDeleteFiltered: s.batchDeleteFiltered,
      addWorkspaceNote: s.addWorkspaceNote,
      updateWorkspaceNote: s.updateWorkspaceNote,
      removeWorkspaceNote: s.removeWorkspaceNote,
      addProfileAssignment: s.addProfileAssignment,
      setProfileDialogAssignmentId: s.setProfileDialogAssignmentId,
      canvasThemeMode: s.canvasThemeMode,
      seamAdjustmentHoverPieceId: s.seamAdjustmentHoverPieceId,
      canvasRotationUiScale: s.canvasRotationUiScale,
      canvasDigitizeUiScale: s.canvasDigitizeUiScale,
      canvasVertexPointUiScale: s.canvasVertexPointUiScale,
      uiTextScale: s.uiTextScale,
      showPivotRotationUi: s.showPivotRotationUi,
    })),
  )
  const fs = (px: number) => `${px}px`
  const ct = (base: number) => canvasTextSize(base, uiTextScale)
  T = canvasThemeMode === 'dark' ? canvasThemeDark : canvasTheme
  const { COLOR_ECKPUNKT, COLOR_SOFT_PUNKT, COLOR_PUNKT_AUF_KURVE, NOTCH_STROKE } = getVertexColors()
  const { pieces: piecesStoreOrder, view, notes: workspaceNotesList } = workspace
  const pieces = useMemo(() => sortPiecesFacingBehind(piecesStoreOrder), [piecesStoreOrder])
  const seamAssignments = workspace.seamAssignments ?? []
  const profileAssignments = workspace.profileAssignments ?? []
  const pastStates = useZustandStore(useStore.temporal, (s) => s.pastStates)

  const prevDragKindRef = useRef<string | null>(null)
  const dragSnapshotRef = useRef<{ workspace: typeof workspace } | null>(null)
  /** Workspace zu Drag-Beginn – Re-Render für „Vorher“-Kontur beim Ziehen (Vertex, Kurve, …). */
  const [contourDragSnapshotWorkspace, setContourDragSnapshotWorkspace] = useState<typeof workspace | null>(null)
  const [grainFlipHover, setGrainFlipHover] = useState<{
    pieceId: string
    clientX: number
    clientY: number
  } | null>(null)
  /** Weltpunkt für Vorschau Linie 2. Spiegelpunkt (Symmetrie-Modus). */
  const [symmetryHoverWorld, setSymmetryHoverWorld] = useState<Point | null>(null)
  /** Symmetrie: gerade Master-Kante als Achse (wie Wasserwaage). */
  const [hoveredSymmetryEdge, setHoveredSymmetryEdge] = useState<{
    pieceId: string
    edgeIndex: number
    curveIndices: number[]
    distance: number
    curveHitIndex: number
    curveHitT: number
    snapPointLocal: Point
  } | null>(null)
  /** Symmetrie: Index in `piece.internalLines` des Teils unter dem Mauszeiger. */
  const [hoveredSymmetryInternalIdx, setHoveredSymmetryInternalIdx] = useState<number | null>(null)
  /** Tastatur-Modus: F gedrückt -> gerade Kante wählen, dann direkt entlang dieser Kante spiegeln. */
  const [flipByEdgeActive, setFlipByEdgeActive] = useState(false)
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
    | { kind: 'pointOnCurve'; pieceId: string; curveIndex: number; t: number; seamDrag?: { startLocal: Point; cutCurveIndex: number; cutT: number }; notchStabilize?: { notches: PatternPiece['notches']; cutLine: Curve[]; seamLine: Curve[] } }
    | { kind: 'internalPointOnCurve'; pieceId: string; curveIndex: number; t: number }
    | {
        kind: 'internalLineVertex'
        pieceId: string
        target: { kind: 'junction'; j: number } | { kind: 'terminal'; curveIndex: number; end: 'start' | 'end' }
      }
    | { kind: 'rectangle'; start: Point; current: Point }
    /** Fensterauswahl im Select-Tool (leerer Bereich). */
    | { kind: 'selectionMarquee'; start: Point; current: Point }
    | { kind: 'line'; pieceId: string; start: Point; current: Point }
    | {
        kind: 'notch'
        pieceId: string
        position: Point
        current: Point
        curveIndex: number
        t: number
        useSeamLine?: boolean
        onInternalLine?: boolean
      }
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
    | {
        kind: 'roundCorner'
        pieceId: string
        masterVertexIndex: number
        cornerLocal: Point
        currentLocal: Point
      }
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
  const [hoveredDeletablePoint, setHoveredDeletablePoint] = useState<DeletableHoverTarget | null>(null)
  const [hoveredDeletableNotch, setHoveredDeletableNotch] = useState<{ pieceId: string; notchId: string } | null>(null)
  const [hoveredPivotForRotationPieceId, setHoveredPivotForRotationPieceId] = useState<string | null>(null)
  const [hoveredRotationRingPieceId, setHoveredRotationRingPieceId] = useState<string | null>(null)
  const [hoveredRotationHandlePieceId, setHoveredRotationHandlePieceId] = useState<string | null>(null)
  const [rotateAroundPivotPieceId, setRotateAroundPivotPieceId] = useState<string | null>(null)
  /** Kerbe bearbeiten (Typ/Breite/Tiefe); unabhängig vom Hover, damit das Panel bedienbar bleibt. */
  const [notchEditTarget, setNotchEditTarget] = useState<{ pieceId: string; notchId: string } | null>(null)
  /** Kerben: Leertaste → nächster Klick setzt Kerbe in der Mitte einer geraden Kante. */
  const [notchEdgeMidMode, setNotchEdgeMidMode] = useState(false)
  /** Anzahl Kerben gleichmäßig auf der nächsten angeklickten geraden Kante (≥1). */
  const [notchEdgeLineCount, setNotchEdgeLineCount] = useState(1)
  const [notchEdgeLineCountEditor, setNotchEdgeLineCountEditor] = useState<{ countStr: string } | null>(null)
  const notchEdgeLineCountInputRef = useRef<HTMLInputElement | null>(null)
  /** Kerben: Leertaste → kleines Menü (Mitte vs. Anzahl). */
  const [notchEdgeSpaceMenu, setNotchEdgeSpaceMenu] = useState<{ clientX: number; clientY: number } | null>(null)
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
    onInternalLine?: boolean
  } | null>(null)
  const [profileFitPreviews, setProfileFitPreviews] = useState<ProfileFitPreview[]>([])
  const [profileFitConfirm, setProfileFitConfirm] = useState<{
    pieceId: string
    previews: ProfileFitPreview[]
  } | null>(null)
  const [notchMoveDistanceEditor, setNotchMoveDistanceEditor] = useState<{
    pieceId: string
    notchId: string
    curveIndex: number
    anchorS: number
    boundPrevS: number
    boundNextS: number
    onInternalLine?: boolean
    side: 'left' | 'right'
    value: string
    clientX: number
    clientY: number
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
  const [hoveredInternalSeamForNahtzuordnung, setHoveredInternalSeamForNahtzuordnung] = useState<{
    pieceId: string
    curveIndices: number[]
    startNotchId?: string
    endNotchId?: string
  } | null>(null)
  const [hoveredSeamAssignmentId, setHoveredSeamAssignmentId] = useState<string | null>(null)
  const [hoveredProfileEdge, setHoveredProfileEdge] = useState<{
    pieceId: string
    edgeIndex: number
    curveIndices: number[]
    startNotchId?: string
    endNotchId?: string
    onInternalLine?: boolean
  } | null>(null)
  const [hoveredEdgePicking, setHoveredEdgePicking] = useState<{
    pieceId: string
    edgeIndex: number
    curveIndices: number[]
  } | null>(null)
  const [hoveredHorizontalLevelEdge, setHoveredHorizontalLevelEdge] = useState<{
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
  const [hoveredCurvepointSegment, setHoveredCurvepointSegment] = useState<{
    pieceId: string
    curveIndex: number
    internal?: boolean
  } | null>(null)
  const [hoveredInternalLine, setHoveredInternalLine] = useState<{ pieceId: string; curveIndex: number } | null>(null)
  const [hoveredInternalCircle, setHoveredInternalCircle] = useState<{ pieceId: string; circleId: string } | null>(null)
  const [digitizeMouseWorld, setDigitizeMouseWorld] = useState<Point | null>(null)
  const [digitizeNearFirst, setDigitizeNearFirst] = useState(false)
  const [lineLengthEditor, setLineLengthEditor] = useState<{
    mode: 'draw' | 'hoverInternal'
    pieceId: string
    curveIndex?: number
    start: Point
    current: Point
    value: string
    /** Nur `mode === 'draw'`: Kontur vs. interne Linie. */
    drawTarget?: 'internal' | 'contour'
  } | null>(null)
  /** Interner Kreis ziehen: Leertaste → Radius in mm (Richtung der Vorschau wie beim Zug). */
  const [internalCircleRadiusEditor, setInternalCircleRadiusEditor] = useState<{
    pieceId: string
    center: Point
    /** Normiert, vom Mittelpunkt zum aktuellen Zug-Ende (fuer Vorschau). */
    dir: Point
    radiusStr: string
    /** Gesetzt bei Bearbeitung per Leertaste auf existierenden Kreis. */
    circleId?: string
  } | null>(null)
  /** Rechteck ziehen: Leertaste → Breite/Höhe per Tastatur (Ecke = erster Klick, Richtung aus Zug). */
  const [rectangleSizeEditor, setRectangleSizeEditor] = useState<{
    anchor: Point
    signX: 1 | -1
    signY: 1 | -1
    widthStr: string
    heightStr: string
  } | null>(null)
  /** Eckenrundung: Leertaste → Radius in mm per Tastatur eingeben. */
  const [cornerRoundEditor, setCornerRoundEditor] = useState<{
    pieceId: string
    masterVertexIndex: number
    cornerLocal: Point
    radiusStr: string
    /** Falls eine bestehende Rundung editiert wird – sonst undefined. */
    existing?: boolean
  } | null>(null)
  /** Aktueller Maß-Dialog (Ref vermeidet veraltete handlePointerUp-Closures bei Leertaste + Loslassen). */
  const notchMoveDistanceEditorRef = useRef(notchMoveDistanceEditor)
  notchMoveDistanceEditorRef.current = notchMoveDistanceEditor
  const lineLengthEditorRef = useRef(lineLengthEditor)
  lineLengthEditorRef.current = lineLengthEditor
  const rectangleSizeEditorRef = useRef(rectangleSizeEditor)
  rectangleSizeEditorRef.current = rectangleSizeEditor
  const internalCircleRadiusEditorRef = useRef(internalCircleRadiusEditor)
  internalCircleRadiusEditorRef.current = internalCircleRadiusEditor
  const cornerRoundEditorRef = useRef(cornerRoundEditor)
  cornerRoundEditorRef.current = cornerRoundEditor
  const lineLengthInputRef = useRef<HTMLInputElement | null>(null)
  const internalCircleRadiusInputRef = useRef<HTMLInputElement | null>(null)
  const rectangleWidthInputRef = useRef<HTMLInputElement | null>(null)
  const cornerRoundInputRef = useRef<HTMLInputElement | null>(null)
  const notchMoveDistanceInputRef = useRef<HTMLInputElement | null>(null)
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

  const rectangleSizeEditorActiveRef = useRef(false)
  useEffect(() => {
    if (rectangleSizeEditor) {
      if (!rectangleSizeEditorActiveRef.current) {
        rectangleSizeEditorActiveRef.current = true
        rectangleWidthInputRef.current?.focus()
        rectangleWidthInputRef.current?.select()
      }
    } else {
      rectangleSizeEditorActiveRef.current = false
    }
  }, [rectangleSizeEditor])

  useEffect(() => {
    if (!rectangleSizeEditor) return
    const w = Number.parseFloat(rectangleSizeEditor.widthStr)
    const h = Number.parseFloat(rectangleSizeEditor.heightStr)
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return
    const { anchor, signX, signY } = rectangleSizeEditor
    const nextCurrent = { x: anchor.x + signX * w, y: anchor.y + signY * h }
    setDragging((d) => {
      if (!d || d.kind !== 'rectangle') return d
      if (
        d.start.x === anchor.x &&
        d.start.y === anchor.y &&
        d.current.x === nextCurrent.x &&
        d.current.y === nextCurrent.y
      ) {
        return d
      }
      return { ...d, start: anchor, current: nextCurrent }
    })
  }, [rectangleSizeEditor])

  useEffect(() => {
    if (!lineLengthEditor || lineLengthEditor.mode !== 'draw') return
    const mm = Number.parseFloat(lineLengthEditor.value.replace(',', '.'))
    if (!Number.isFinite(mm) || mm <= 0) return
    const end = pointAtDistanceOnRay(lineLengthEditor.start, lineLengthEditor.current, mm)
    const pid = lineLengthEditor.pieceId
    setDragging((d) => {
      if (!d || d.kind !== 'line' || d.pieceId !== pid) return d
      if (d.current.x === end.x && d.current.y === end.y) return d
      return { ...d, current: end }
    })
  }, [lineLengthEditor])

  const internalCircleRadiusEditorActiveRef = useRef(false)
  useEffect(() => {
    if (internalCircleRadiusEditor) {
      if (!internalCircleRadiusEditorActiveRef.current) {
        internalCircleRadiusEditorActiveRef.current = true
        internalCircleRadiusInputRef.current?.focus()
        internalCircleRadiusInputRef.current?.select()
      }
    } else {
      internalCircleRadiusEditorActiveRef.current = false
    }
  }, [internalCircleRadiusEditor])

  useEffect(() => {
    if (!internalCircleRadiusEditor) return
    const r = Number.parseFloat(internalCircleRadiusEditor.radiusStr.replace(',', '.'))
    if (!Number.isFinite(r) || r < 0.5) return
    const rClamped = Math.min(10000, r)
    const { center, dir, pieceId } = internalCircleRadiusEditor
    const nextCurrent = { x: center.x + dir.x * rClamped, y: center.y + dir.y * rClamped }
    setDragging((d) => {
      if (!d || d.kind !== 'internalCircle' || d.pieceId !== pieceId) return d
      if (d.current.x === nextCurrent.x && d.current.y === nextCurrent.y) return d
      return { ...d, center, current: nextCurrent }
    })
  }, [internalCircleRadiusEditor])

  const cornerRoundEditorActiveRef = useRef(false)
  useEffect(() => {
    if (cornerRoundEditor) {
      if (!cornerRoundEditorActiveRef.current) {
        cornerRoundEditorActiveRef.current = true
        cornerRoundInputRef.current?.focus()
        cornerRoundInputRef.current?.select()
      }
    } else {
      cornerRoundEditorActiveRef.current = false
    }
  }, [cornerRoundEditor])

  const notchMoveDistanceEditorActiveRef = useRef(false)
  useEffect(() => {
    if (notchMoveDistanceEditor) {
      if (!notchMoveDistanceEditorActiveRef.current) {
        notchMoveDistanceEditorActiveRef.current = true
        notchMoveDistanceInputRef.current?.focus()
        notchMoveDistanceInputRef.current?.select()
      }
    } else {
      notchMoveDistanceEditorActiveRef.current = false
    }
  }, [notchMoveDistanceEditor])

  useEffect(() => {
    if (!notchMoveDistanceEditor) return
    const piece = pieces.find((p) => p.id === notchMoveDistanceEditor.pieceId)
    if (!piece) return
    const onInternal = notchMoveDistanceEditor.onInternalLine ?? false
    const contours = onInternal ? piece.internalLines : piece.cutLine
    if (contours.length === 0) return
    const raw = Number.parseFloat(notchMoveDistanceEditor.value.replace(',', '.'))
    if (!Number.isFinite(raw) || raw < 0) return
    const closed = !onInternal && cutLineFormsClosedLoop(piece.cutLine)
    const total = totalPathLength(contours)
    const targetS = targetArcLengthForNotchDistanceEdit(
      notchMoveDistanceEditor.anchorS,
      notchMoveDistanceEditor.boundPrevS,
      notchMoveDistanceEditor.boundNextS,
      notchMoveDistanceEditor.side,
      raw,
      closed,
      total,
    )
    const pr = pointAtPathLength(contours, targetS)
    if (!pr) return
    const t = pr.t
    const storePos = pointOnCurveAt(contours[pr.curveIndex], t)
    const storeAngle = outwardNormalAngleAt(contours, pr.curveIndex, t) + 180
    const dist = getNotchMeasurementDistancesOnContour(piece, contours, pr.curveIndex, t, {
      excludeNotchId: notchMoveDistanceEditor.notchId,
      onInternalLine: onInternal,
    })
    setNotchPreview({
      pieceId: piece.id,
      position: storePos,
      angle: storeAngle,
      curveIndex: pr.curveIndex,
      t,
      distanceMmLeft: dist.distanceMmLeft,
      distanceMmRight: dist.distanceMmRight,
      storePos,
      storeAngle,
      onInternalLine: onInternal,
    })
  }, [notchMoveDistanceEditor, pieces])

  // Wenn der Nutzer im Eingabefeld einen Radius eintippt, Vorschau-Drag entsprechend skalieren.
  useEffect(() => {
    if (!cornerRoundEditor) return
    const r = Number.parseFloat(cornerRoundEditor.radiusStr.replace(',', '.'))
    if (!Number.isFinite(r) || r < 0.5) return
    setDragging((d) => {
      if (!d || d.kind !== 'roundCorner' || d.pieceId !== cornerRoundEditor.pieceId) return d
      if (d.masterVertexIndex !== cornerRoundEditor.masterVertexIndex) return d
      const dx = d.currentLocal.x - d.cornerLocal.x
      const dy = d.currentLocal.y - d.cornerLocal.y
      const L = Math.hypot(dx, dy)
      const ux = L > 1e-6 ? dx / L : 1
      const uy = L > 1e-6 ? dy / L : 0
      const next = { x: d.cornerLocal.x + ux * r, y: d.cornerLocal.y + uy * r }
      if (d.currentLocal.x === next.x && d.currentLocal.y === next.y) return d
      return { ...d, currentLocal: next }
    })
  }, [cornerRoundEditor])

  const STORE_MODIFYING_DRAGS = useMemo(() => new Set([
    'vertex', 'piece', 'rotate', 'pointOnCurve', 'notchMove',
    'grainPoint', 'grainLine', 'controlpoint', 'workspaceNote',
    'pivot', 'image-move', 'image-resize',
  ]), [])
  useEffect(() => {
    const currentKind = dragging?.kind ?? null
    const prevKind = prevDragKindRef.current
    prevDragKindRef.current = currentKind
    const wasData = prevKind != null && STORE_MODIFYING_DRAGS.has(prevKind)
    const isData = currentKind != null && STORE_MODIFYING_DRAGS.has(currentKind)
    if (isData && !wasData) {
      const ws = useStore.getState().workspace
      dragSnapshotRef.current = { workspace: ws }
      setContourDragSnapshotWorkspace(ws)
      useStore.temporal.getState().pause()
    } else if (!isData && wasData && dragSnapshotRef.current) {
      setContourDragSnapshotWorkspace(null)
      const snapshot = dragSnapshotRef.current
      dragSnapshotRef.current = null
      const temporal = useStore.temporal.getState()
      temporal.resume()
      const currentWs = useStore.getState().workspace
      if (snapshot.workspace !== currentWs) {
        useStore.temporal.setState({
          pastStates: [...temporal.pastStates, snapshot].slice(-20),
          futureStates: [],
        })
      }
    }
  }, [dragging, STORE_MODIFYING_DRAGS])

  const cutSeamSwappedKey = useMemo(() => [...cutSeamSwappedSet].sort().join(','), [cutSeamSwappedSet])

  const contourHistoryPreviewPaths = useMemo(() => {
    if (!showContourChangePreview || pastStates.length === 0) return []
    const steps = pastStates.slice(-2) as { workspace: typeof workspace }[]
    const pt = T.piece
    const rows: {
      key: string
      pieceId: string
      d: string
      transform: string
      opacity: number
      stroke: string
    }[] = []
    for (let si = 0; si < steps.length; si++) {
      const snap = steps[si]
      const isOlder = steps.length === 2 && si === 0
      const opacity = isOlder ? 0.28 : 0.42
      const stroke = isOlder ? pt.strokeChangePreviewOlder : pt.strokeChangePreview
      for (const pieceId of selectedPieceIds) {
        const pastPiece = snap.workspace.pieces.find((p) => p.id === pieceId)
        if (!pastPiece) continue
        const d = pieceSolidContourPathD(pastPiece, cutSeamSwappedSet.has(pieceId))
        if (!d) continue
        rows.push({
          key: `hist-${pieceId}-${si}`,
          pieceId,
          d,
          transform: pieceGroupTransformAttr(pastPiece),
          opacity,
          stroke,
        })
      }
    }
    return rows
  }, [showContourChangePreview, pastStates, selectedPieceIds, cutSeamSwappedKey, canvasThemeMode])

  const contourDragGhostPath = useMemo(() => {
    if (!showContourChangePreview || !contourDragSnapshotWorkspace || !dragging) return null
    const dk = dragging.kind
    if (dk !== 'vertex' && dk !== 'pointOnCurve' && dk !== 'controlpoint' && dk !== 'notchMove') return null
    const pieceId = dragging.pieceId
    if (!selectedPieceIds.includes(pieceId)) return null
    const pastPiece = contourDragSnapshotWorkspace.pieces.find((p) => p.id === pieceId)
    if (!pastPiece) return null
    const excludeNotch = dk === 'notchMove' ? dragging.notchId : undefined
    const d = pieceSolidContourPathD(pastPiece, cutSeamSwappedSet.has(pieceId), excludeNotch)
    if (!d) return null
    return { d, transform: pieceGroupTransformAttr(pastPiece), pieceId }
  }, [
    showContourChangePreview,
    contourDragSnapshotWorkspace,
    dragging,
    selectedPieceIds,
    cutSeamSwappedKey,
    canvasThemeMode,
  ])

  const contourHistoryPreviewPathsDeduped = useMemo(() => {
    if (!contourDragGhostPath) return contourHistoryPreviewPaths
    return contourHistoryPreviewPaths.filter((r) => r.pieceId !== contourDragGhostPath.pieceId)
  }, [contourHistoryPreviewPaths, contourDragGhostPath])

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

  useEffect(() => {
    if (horizontalLevelPickingActive && selectedPieceIds.length !== 1) {
      setHorizontalLevelPickingActive(false)
    }
  }, [horizontalLevelPickingActive, selectedPieceIds, setHorizontalLevelPickingActive])

  useEffect(() => {
    if (!horizontalLevelPickingActive) setHoveredHorizontalLevelEdge(null)
  }, [horizontalLevelPickingActive])

  useEffect(() => {
    if (pieceSymmetryState && (selectedPieceIds.length !== 1 || selectedPieceIds[0] !== pieceSymmetryState.pieceId)) {
      setPieceSymmetryState(null)
      setSymmetryHoverWorld(null)
    }
  }, [pieceSymmetryState, selectedPieceIds, setPieceSymmetryState])

  useEffect(() => {
    if (!pieceSymmetryState) {
      setSymmetryHoverWorld(null)
      setHoveredSymmetryEdge(null)
      setHoveredSymmetryInternalIdx(null)
      setFlipByEdgeActive(false)
    }
  }, [pieceSymmetryState])

  useEffect(() => {
    if (!contourEditEnabled) {
      setPendingNahtzugabeClick(false)
      setEdgeSeamPickingActive(false)
      setPieceSymmetryState(null)
      setSymmetryHoverWorld(null)
      setFlipByEdgeActive(false)
      setNahtzuordnungMode('idle')
      setPendingNahtzuordnungFirst(null)
      cancelNahtTrimVertexPick()
      setRulerMode(false)
      if (useStore.getState().digitizeState) cancelDigitize()
      setHoveredDeletablePoint(null)
      setHoveredDeletableNotch(null)
      setPointPreview(null)
      setHoveredCurvepointSegment(null)
      setGrainFlipHover(null)
    }
  }, [
    contourEditEnabled,
    cancelDigitize,
    cancelNahtTrimVertexPick,
    setPendingNahtzugabeClick,
    setEdgeSeamPickingActive,
    setPieceSymmetryState,
    setNahtzuordnungMode,
    setPendingNahtzuordnungFirst,
    setRulerMode,
  ])

  useEffect(() => {
    if (!contourEditEnabled && tool !== 'select' && tool !== 'pan') {
      setTool('select')
    }
  }, [contourEditEnabled, tool, setTool])

  useEffect(() => {
    materializeMissingGrainLines()
  }, [materializeMissingGrainLines, pieces])

  const prevDraggingRef = useRef(dragging)
  useEffect(() => {
    const wasDragging = prevDraggingRef.current
    prevDraggingRef.current = dragging
    if (wasDragging && !dragging && dragTriggersSeamAdjustmentCheck(wasDragging.kind)) {
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
      if (profileFitConfirm) {
        setProfileFitConfirm(null)
        setProfileFitPreviews([])
      }
      const navigationOnlyPointer =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(pointer: coarse)').matches &&
        e.pointerType !== 'pen'
      if (navigationOnlyPointer) {
        e.preventDefault()
        closeSegmentMenu()
        setWorkspaceImageQuickMenu(null)
        if (e.pointerType === 'touch') {
          activeTouchPointsRef.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY })
          ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
          const activeTouches = [...activeTouchPointsRef.current.values()]
          if (activeTouches.length >= 2) {
            const a = activeTouches[0]
            const b = activeTouches[1]
            const distance = Math.max(Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), 1)
            pinchStartRef.current = {
              distance,
              centerClient: { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 },
              view: { zoom: view.zoom, panX: view.panX, panY: view.panY },
            }
            touchPanPointerIdRef.current = null
            setDragging(null)
          } else {
            pinchStartRef.current = null
            touchPanPointerIdRef.current = e.pointerId
            setDragging({
              kind: 'pan',
              startClient: { x: e.clientX, y: e.clientY },
              startPan: { x: view.panX, y: view.panY },
            })
          }
        }
        return
      }
      /** UI-Leiste Fensterauswahl: nicht als Canvas-Klick/Marquee behandeln (sonst blockiert preventDefault das Dropdown). */
      if (e.target instanceof Element && e.target.closest('.batch-selection-bar')) {
        return
      }
      if (e.button === 1) {
        e.preventDefault()
        e.stopPropagation()
        if (edgeSeamPickingActive || edgeAllowancePopover) {
          setEdgeAllowancePopover(null)
          setHoveredEdgePicking(null)
          setEdgeSeamPickingActive(false)
        }
        if (horizontalLevelPickingActive) {
          setHoveredHorizontalLevelEdge(null)
          setHorizontalLevelPickingActive(false)
        }
        if (pieceSymmetryState) {
          setPieceSymmetryState(null)
          setSymmetryHoverWorld(null)
          setHoveredSymmetryEdge(null)
          setHoveredSymmetryInternalIdx(null)
          setFlipByEdgeActive(false)
        }
        if (nahtTrimPickCutVertexActive) cancelNahtTrimVertexPick()
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
      const layoutOnly = !contourEditEnabled
      const sym = pieceSymmetryState
      if (sym && contourEditEnabled && selectedPieceIds.length === 1 && selectedPieceIds[0] === sym.pieceId) {
        const piece = pieces.find((x) => x.id === sym.pieceId)
        if (!piece) {
          setPieceSymmetryState(null)
          setSymmetryHoverWorld(null)
          setHoveredSymmetryEdge(null)
          setHoveredSymmetryInternalIdx(null)
          setFlipByEdgeActive(false)
          return
        }
        const local = worldToPieceLocal(world, piece)
        if (sym.phase === 'pickEdge') {
          if (
            hoveredSymmetryEdge?.pieceId === sym.pieceId &&
            hoveredSymmetryEdge.edgeIndex >= 0
          ) {
            const edgesEnum = enumerateEdges(piece)
            const pickedEdge = edgesEnum.find((ed) => ed.edgeIndex === hoveredSymmetryEdge.edgeIndex)
            if (!pickedEdge) {
              setToastMessage('warn:Kante nicht gefunden.')
              return
            }
            const axis = symmetryAxisFromMasterEdgePick(
              piece,
              pickedEdge,
              hoveredSymmetryEdge.curveHitIndex,
              hoveredSymmetryEdge.curveHitT,
            )
            if (!axis) {
              setToastMessage('warn:Keine gültige Spiegelachse (Tangente zu kurz oder degeneriert).')
              return
            }
            if (flipByEdgeActive) {
              flipPieceAlongAxis(sym.pieceId, axis.axisA, axis.axisB)
              setToastMessage('success:Teil über Kante gespiegelt.')
              setPieceSymmetryState(null)
              setSymmetryHoverWorld(null)
              setHoveredSymmetryEdge(null)
              setHoveredSymmetryInternalIdx(null)
              setFlipByEdgeActive(false)
              return
            }
            setPieceSymmetryState({
              pieceId: sym.pieceId,
              phase: 'pickSide',
              axisA: axis.axisA,
              axisB: axis.axisB,
            })
            setHoveredSymmetryEdge(null)
            return
          }
        } else if (sym.phase === 'pickInternalLine') {
          if (hoveredSymmetryInternalIdx != null) {
            const c = piece.internalLines[hoveredSymmetryInternalIdx]
            if (!c) return
            const axis = symmetryAxisEndpointsFromInternalCurve(c)
            const alen = Math.hypot(axis.axisB.x - axis.axisA.x, axis.axisB.y - axis.axisA.y)
            if (alen < 0.5) {
              setToastMessage('warn:Diese interne Linie ist zu kurz für eine Spiegelachse.')
              return
            }
            setPieceSymmetryState({
              pieceId: sym.pieceId,
              phase: 'pickSide',
              axisA: axis.axisA,
              axisB: axis.axisB,
            })
            setHoveredSymmetryInternalIdx(null)
            return
          }
        } else if (sym.phase === 'axisA') {
          setPieceSymmetryState({ pieceId: sym.pieceId, phase: 'axisB', axisA: { ...local } })
          return
        } else if (sym.phase === 'axisB') {
          if (sym.axisA && Math.hypot(local.x - sym.axisA.x, local.y - sym.axisA.y) < 0.5) {
            setToastMessage('warn:Zweiter Punkt zu nah am ersten.')
            return
          }
          setPieceSymmetryState({
            pieceId: sym.pieceId,
            phase: 'pickSide',
            axisA: sym.axisA,
            axisB: { ...local },
          })
          setSymmetryHoverWorld(null)
          return
        } else if (sym.phase === 'pickSide' && sym.axisA && sym.axisB) {
          const c = crossZ(sym.axisA, sym.axisB, local)
          if (Math.abs(c) < 1e-4) {
            setToastMessage('warn:Bitte links oder rechts der Spiegelachse klicken.')
            return
          }
          const keepSide = c >= 0 ? 'left' : 'right'
          applyPieceSymmetry(sym.pieceId, sym.axisA, sym.axisB, keepSide)
          setPieceSymmetryState(null)
          setSymmetryHoverWorld(null)
          setHoveredSymmetryEdge(null)
          setHoveredSymmetryInternalIdx(null)
          return
        }
        // chooseMethod / fehlgeschlagene Kante oder interne Linie: nicht in normale Bearbeitung fallen
        // (sonst Auswahl/Marquee → Symmetrie bricht still per useEffect ab).
        if (sym.phase === 'chooseMethod') {
          return
        }
        if (sym.phase === 'pickEdge') {
          setToastMessage('warn:Bitte eine Kante der Kontur treffen (grün hervorgehoben) oder Abbrechen.')
          return
        }
        if (sym.phase === 'pickInternalLine') {
          setToastMessage('warn:Bitte eine interne Linie treffen (grün hervorgehoben) oder Abbrechen.')
          return
        }
      }
      if (horizontalLevelPickingActive) {
        if (selectedPieceIds.length === 1 && hoveredHorizontalLevelEdge?.pieceId === selectedPieceIds[0]) {
          const ok = alignPieceEdgeHorizontal(selectedPieceIds[0], hoveredHorizontalLevelEdge.edgeIndex)
          if (ok) {
            setHorizontalLevelPickingActive(false)
            setHoveredHorizontalLevelEdge(null)
            setToastMessage('success:Kante waagerecht ausgerichtet.')
          } else {
            setToastMessage('warn:Nur gerade Kanten (Liniensegmente) können waagerecht ausgerichtet werden.')
          }
          return
        }
      }
      if (layoutOnly && tool !== 'select') return
      if (!layoutOnly && tool === 'massstab') {
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
      if (!layoutOnly && rulerMode) {
        setRulerLine(null)
        const start = snapRulerToNearestPoint(world, pieces)
        setDragging({ kind: 'ruler', start, current: start })
        ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
        return
      }
      if (!layoutOnly && (nahtzuordnungMode === 'first' || nahtzuordnungMode === 'second')) {
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
      if (!layoutOnly && nahtzuordnungMode === 'internal') {
        const world = toWorld(e.clientX, e.clientY)
        let best: {
          pieceId: string
          curveIndices: number[]
          curveIndex: number
          t: number
          distance: number
        } | null = null
        for (const p of pieces) {
          const local = worldToPieceLocal(world, p)
          const hit = hitInternalLineForSeamAssignment(local, p, SEAM_HIT_MM)
          if (hit && (!best || hit.distance < best.distance)) {
            best = { pieceId: p.id, ...hit }
          }
        }
        if (best) {
          addInternalSeamAssignment(best.pieceId, best.curveIndices, best.curveIndex, best.t)
        }
        return
      }
      if (nahtTrimPickCutVertexActive && tool === 'select') {
        const world = toWorld(e.clientX, e.clientY)
        const ctnHit = containerRef.current
        const svgHit = svgRef.current
        const vHitWorld = ctnHit
          ? clampPointHitWorldMm(
              worldHitRadiusFromScreenPx(VERTEX_HIT_RADIUS_PX * canvasVertexPointUiScale, view, svgHit, ctnHit),
            )
          : 5
        const vHitSeamWorld = ctnHit
          ? clampPointHitWorldMm(
              worldHitRadiusFromScreenPx(VERTEX_HIT_SEAM_RADIUS_PX * canvasVertexPointUiScale, view, svgHit, ctnHit),
            )
          : 8
        const targetId = selectedPieceIds[0]
        const p = pieces.find((x) => x.id === targetId)
        if (!p || p.cutLine.length < 3) {
          setToastMessage('warn:Kein gültiges Zielteil.')
          return
        }
        // Dieselben Eckpunkte wie beim Ziehen: bei Nahtzugabe Nahtlinie (rote Punkte), sonst Schnittkontur.
        const useSeamMaster = useSeamLineForVertexEditing(p)
        const curvesForVertices =
          useSeamMaster && p.seamLine.length >= 3 ? p.seamLine : p.cutLine
        const vertexHitR = useSeamMaster && p.seamLine.length >= 3 ? vHitSeamWorld : vHitWorld
        const local = worldToPieceLocal(world, p)
        const n = curvesForVertices.length
        let bestVi: number | null = null
        let bestD = Infinity
        for (let vi = 0; vi < n; vi++) {
          const vertexPos = vi === 0 ? curvesForVertices[0].start : curvesForVertices[vi - 1].end
          const d = Math.hypot(local.x - vertexPos.x, local.y - vertexPos.y)
          if (d < vertexHitR && d < bestD) {
            bestD = d
            bestVi = vi
          }
        }
        if (bestVi != null) {
          let cutVi =
            useSeamMaster && p.seamLine.length >= 3
              ? mapMasterVertexIndexToCutVertexIndex(p, bestVi)
              : bestVi
          if (cutVi == null && p.cutLine.length > 0) {
            // Fallback: falls Master->Cut-Mapping wegen stärkerer Konturabweichung fehlschlägt,
            // die nächstliegende Cut-Ecke zur angeklickten Master-Ecke verwenden.
            const masterVertexPos =
              bestVi === 0 ? curvesForVertices[0].start : curvesForVertices[bestVi - 1].end
            let nearestCutVi = 0
            let nearestCutDist = Infinity
            for (let cvi = 0; cvi < p.cutLine.length; cvi++) {
              const cutVertexPos = cvi === 0 ? p.cutLine[0].start : p.cutLine[cvi - 1].end
              const d = Math.hypot(
                cutVertexPos.x - masterVertexPos.x,
                cutVertexPos.y - masterVertexPos.y
              )
              if (d < nearestCutDist) {
                nearestCutDist = d
                nearestCutVi = cvi
              }
            }
            cutVi = nearestCutVi
          }
          if (cutVi == null) {
            setToastMessage('warn:Diese Ecke konnte der Schnittkontur nicht zugeordnet werden.')
            return
          }
          if ((p.notches ?? []).some((nt) => nt.vertexIndex === cutVi)) {
            setToastMessage('warn:Kerbe auf diesem Eckpunkt – bitte zuerst Kerbe löschen oder verschieben.')
            return
          }
          completeNahtTrimAtCutVertex(p.id, cutVi)
          return
        }
        setToastMessage(
          useSeamMaster && p.seamLine.length >= 3
            ? 'warn:Bitte einen Eckpunkt auf der Nahtlinie treffen (Außenkontur wird dort beschnitten).'
            : 'warn:Bitte eine Ecke der Schnittkontur treffen.'
        )
        return
      }
      if (!layoutOnly && edgeSeamPickingActive && !edgeAllowancePopover && hoveredEdgePicking) {
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
      if (!layoutOnly && edgeSeamPickingActive && edgeAllowancePopover) {
        return
      }
      if (!layoutOnly && tool === 'profil' && hoveredProfileEdge) {
        const sameProfileRange = (
          pa: {
            edgeIndex: number
            startNotchId?: string
            endNotchId?: string
            onInternalLine?: boolean
          },
          edge: {
            edgeIndex: number
            startNotchId?: string
            endNotchId?: string
            onInternalLine?: boolean
          }
        ) =>
          pa.edgeIndex === edge.edgeIndex &&
          Boolean(pa.onInternalLine) === Boolean(edge.onInternalLine) &&
          (pa.startNotchId ?? null) === (edge.startNotchId ?? null) &&
          (pa.endNotchId ?? null) === (edge.endNotchId ?? null)
        const existing = profileAssignments.find(
          (pa) =>
            pa.pieceId === hoveredProfileEdge.pieceId && sameProfileRange(pa, hoveredProfileEdge)
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
            onInternalLine: hoveredProfileEdge.onInternalLine,
            startNotchId: hoveredProfileEdge.startNotchId,
            endNotchId: hoveredProfileEdge.endNotchId,
            profileName: '',
            profileKey: nextKey,
          })
          setProfileDialogAssignmentId(newId)
        }
        return
      }
      if (!layoutOnly && pendingNahtzugabeClick) {
        for (let i = pieces.length - 1; i >= 0; i--) {
          const p = pieces[i]
          const local = worldToPieceLocal(world, p)
          if (isPointInsidePiece(local, p)) {
            if (isFacingDerivedPiece(p)) {
              setToastMessage(
                'info:Kaschierungen werden nur von der Mutter synchronisiert – Nahtzugabe hier nicht editierbar.'
              )
              setPendingNahtzugabeClick(false)
              return
            }
            setNahtzugabeDialogPieceId(p.id)
            setPendingNahtzugabeClick(false)
            ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
            return
          }
        }
        setPendingNahtzugabeClick(false)
        return
      }

      if (!layoutOnly && showWorkspaceNotes) {
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

      if (!layoutOnly && showProfiles && (tool === 'select' || tool === 'profil') && profileAssignments.length > 0) {
        const PROFILE_HIT_PX = 16
        const ctnProfile = containerRef.current
        const svgProfile = svgRef.current
        const profileHitMm = ctnProfile
          ? clampPointHitWorldMm(
              worldHitRadiusFromScreenPx(PROFILE_HIT_PX, view, svgProfile, ctnProfile),
            )
          : 12
        for (let i = profileAssignments.length - 1; i >= 0; i--) {
          const pa = profileAssignments[i]
          const pp = pieces.find((p) => p.id === pa.pieceId)
          if (!pp) continue
          const local = worldToPieceLocal(world, pp)
          if (hitProfileAssignment(pp, pa, local, profileHitMm)) {
            setProfileDialogAssignmentId(pa.id)
            return
          }
        }
      }

      const ctnHit = containerRef.current
      const svgHit = svgRef.current
      const vHitWorld = ctnHit
        ? clampPointHitWorldMm(
            worldHitRadiusFromScreenPx(VERTEX_HIT_RADIUS_PX * canvasVertexPointUiScale, view, svgHit, ctnHit),
          )
        : 5
      const vHitSeamWorld = ctnHit
        ? clampPointHitWorldMm(
            worldHitRadiusFromScreenPx(VERTEX_HIT_SEAM_RADIUS_PX * canvasVertexPointUiScale, view, svgHit, ctnHit),
          )
        : 8
      const pocHitWorld = ctnHit
        ? clampPointHitWorldMm(
            worldHitRadiusFromScreenPx(POINT_ON_CURVE_HIT_RADIUS_PX * canvasVertexPointUiScale, view, svgHit, ctnHit),
          )
        : 10
      const pointInsertHitMmDown = ctnHit
        ? clampPointHitWorldMm(
            worldHitRadiusFromScreenPx(POINT_INSERT_HIT_RADIUS_PX * canvasVertexPointUiScale, view, svgHit, ctnHit),
          )
        : POINT_INSERT_HIT_FALLBACK_MM
      // Treffer: Seam-as-Master = Eckpunkte auf Innenkontur (seamLine); sonst cut/seam je nach Ansicht.
      if (!layoutOnly && showPoints && (tool === 'select' || tool === 'point' || tool === 'curvepoint') && selectedPieceIds.length > 0) {
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
          const vertexHitR = useSeamMaster ? vHitSeamWorld : vHitWorld
          const curvesForPointCurve = useSeamLineForPointCurveEditing(p) ? p.seamLine : p.cutLine
          // Kurvenpunkte (Bézier-Mitte): bei Nahtzugabe auf Nahtlinie, sonst Schnittkontur
          for (let ci = 0; ci < curvesForPointCurve.length; ci++) {
            const c = curvesForPointCurve[ci]
            if (c.type !== 'bezier') continue
            const ptOnCurve = bezierAt(c, 0.5)
            const d = Math.hypot(local.x - ptOnCurve.x, local.y - ptOnCurve.y)
            if (d < pocHitWorld && (!bestPointOnCurve || d < bestPointOnCurve.dist)) {
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
              const d = distanceToNotchHoverMm(local, notch, p)
              if (d <= NOTCH_CLICK_HIT && (!bestNotchClick || d < bestNotchClick.dist)) {
                bestNotchClick = { dist: d, pieceId: p.id, notchId: notch.id }
              }
            }
          }
        }
        const minVertexDist = bestVertex?.dist ?? Infinity
        const minPointOnCurveDist = bestPointOnCurve?.dist ?? Infinity
        const minNotchDist = bestNotchClick?.dist ?? Infinity
        let bestInternalVertexOnly: { dist: number; value: DeletableHoverTarget | null } = {
          dist: 1e15,
          value: null,
        }
        let bestInternalCurveOnly: { dist: number; value: DeletableHoverTarget | null } = {
          dist: 1e15,
          value: null,
        }
        for (const p of piecesForClick) {
          if (!p.internalLines.length) continue
          const localIl = worldToPieceLocal(world, p)
          for (let ci = 0; ci < p.internalLines.length; ci++) {
            const c = p.internalLines[ci]
            if (c.type !== 'bezier') continue
            const ptOnCurve = bezierAt(c, 0.5)
            const d = Math.hypot(localIl.x - ptOnCurve.x, localIl.y - ptOnCurve.y)
            if (d < pocHitWorld && (!bestInternalCurveOnly.value || d < bestInternalCurveOnly.dist)) {
              bestInternalCurveOnly = {
                dist: d,
                value: { pieceId: p.id, kind: 'internalPointOnCurve', curveIndex: ci },
              }
            }
          }
          for (const { dist, target } of collectInternalLineVertexHoverCandidates(p, localIl, vHitWorld)) {
            if (dist < bestInternalVertexOnly.dist) bestInternalVertexOnly = { dist, value: target }
          }
        }
        const internalMerged = mergeInternalLineVertexVsCurve(bestInternalVertexOnly, bestInternalCurveOnly)
        const minInternalDist = internalMerged.value != null ? internalMerged.dist : Infinity
        // Modifier-Klick soll die Kerben-Bearbeitung robust öffnen, auch wenn Vertex/Kurvenpunkt ähnlich nah liegt.
        if (tool === 'select' && contourEditEnabled && (e.altKey || e.metaKey) && bestNotchClick) {
          e.preventDefault()
          setNotchEditTarget({
            pieceId: bestNotchClick.pieceId,
            notchId: bestNotchClick.notchId,
          })
          return
        }
        const useNotch =
          bestNotchClick &&
          minNotchDist < minVertexDist &&
          minNotchDist < minPointOnCurveDist &&
          minNotchDist < minInternalDist
        if (useNotch && bestNotchClick && tool === 'select') {
          // Vor dem Ziehen: gleicher Treffer wie hover — ⌥/⌘+Klick öffnet Bearbeiten (sonst blockiert dieser Block den späteren Handler).
          if (contourEditEnabled && (e.altKey || e.metaKey)) {
            e.preventDefault()
            setNotchEditTarget({
              pieceId: bestNotchClick.pieceId,
              notchId: bestNotchClick.notchId,
            })
            return
          }
          const movePiece = pieces.find((p) => p.id === bestNotchClick.pieceId)
          if (movePiece) {
            setNotchPreview(buildNotchMovePreview(movePiece, bestNotchClick.notchId))
          }
          setDragging({
            kind: 'notchMove',
            pieceId: bestNotchClick.pieceId,
            notchId: bestNotchClick.notchId,
          })
          ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
          return
        }
        // Punkt-/Kurvenpunkt-Werkzeug: Kontur vs. interne Linie — näherer Treffer gewinnt.
        const contourVertexForMerge: { dist: number; value: DeletableHoverTarget | null } = bestVertex
          ? { dist: bestVertex.dist, value: { pieceId: bestVertex.pieceId, kind: 'vertex', vertexIndex: bestVertex.vertexIndex } }
          : { dist: 1e15, value: null }
        const contourCurveForMerge: { dist: number; value: DeletableHoverTarget | null } = bestPointOnCurve
          ? {
              dist: bestPointOnCurve.dist,
              value: { pieceId: bestPointOnCurve.pieceId, kind: 'pointOnCurve', curveIndex: bestPointOnCurve.curveIndex },
            }
          : { dist: 1e15, value: null }
        const contourMerged = mergeDeletableHoverVertexVsCurve(contourVertexForMerge, contourCurveForMerge)
        const internalCloser =
          internalMerged.value != null &&
          (contourMerged.value == null || internalMerged.dist < contourMerged.dist - 1e-9)

        const usePointOnCurve =
          tool === 'select' &&
          !internalCloser &&
          bestPointOnCurve &&
          (!bestVertex || bestPointOnCurve.dist <= bestVertex.dist)
        const useVertex =
          tool === 'select' &&
          !internalCloser &&
          bestVertex &&
          (!bestPointOnCurve || bestVertex.dist < bestPointOnCurve.dist)
        const useInternalPointOnCurve =
          tool === 'select' &&
          internalCloser &&
          internalMerged.value?.kind === 'internalPointOnCurve'
        const useInternalVertex =
          tool === 'select' &&
          internalCloser &&
          internalMerged.value != null &&
          internalMerged.value.kind !== 'internalPointOnCurve'

        if (useInternalPointOnCurve && internalMerged.value?.kind === 'internalPointOnCurve') {
          setDragging({
            kind: 'internalPointOnCurve',
            pieceId: internalMerged.value.pieceId,
            curveIndex: internalMerged.value.curveIndex,
            t: 0.5,
          })
          ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
          return
        }
        if (useInternalVertex && internalMerged.value) {
          const iv = internalMerged.value
          if (iv.kind === 'internalJunction') {
            setDragging({ kind: 'internalLineVertex', pieceId: iv.pieceId, target: { kind: 'junction', j: iv.j } })
          } else if (iv.kind === 'internalTerminal') {
            setDragging({
              kind: 'internalLineVertex',
              pieceId: iv.pieceId,
              target: { kind: 'terminal', curveIndex: iv.curveIndex, end: iv.end },
            })
          }
          ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
          return
        }
        if (usePointOnCurve && bestPointOnCurve) {
          const pocPiece = pieces.find((x) => x.id === bestPointOnCurve.pieceId)
          const pocNotchSnap = pocPiece && (pocPiece.notches ?? []).length > 0
            ? {
                notches: cloneVertexDragNotches(pocPiece.notches),
                cutLine: cloneVertexDragCutLine(pocPiece.cutLine),
                seamLine: pocPiece.seamLine.length > 0
                  ? pocPiece.seamLine.map(c => c.type === 'line' ? { ...c, start: { ...c.start }, end: { ...c.end } } : { ...c, start: { ...c.start }, end: { ...c.end }, cp1: { ...c.cp1 }, cp2: { ...c.cp2 } })
                  : [],
              }
            : undefined
          setDragging({ kind: 'pointOnCurve', pieceId: bestPointOnCurve.pieceId, curveIndex: bestPointOnCurve.curveIndex, t: bestPointOnCurve.t, ...(pocNotchSnap ? { notchStabilize: pocNotchSnap } : {}) })
          ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
          return
        }
        if (useVertex && bestVertex) {
          if (bestVertex.dist <= bestVertex.hitRadius) {
            const p = pieces.find((x) => x.id === bestVertex.pieceId)
            if (p && (p.notches ?? []).some((n) => n.vertexIndex === bestVertex!.vertexIndex)) {
              setToastMessage('warn:Kerbe auf diesem Eckpunkt – bitte zuerst Kerbe löschen oder verschieben.')
              return
            }
            const useSeamMaster = p != null && useSeamLineForVertexEditing(p)
            const curves = useSeamMaster ? p!.seamLine : p!.cutLine
            const startLocal = bestVertex.vertexIndex === 0
              ? curves[0].start
              : curves[bestVertex.vertexIndex - 1].end
            const notchStabilize = (p!.notches ?? []).length > 0
              ? {
                  notches: cloneVertexDragNotches(p!.notches),
                  cutLine: cloneVertexDragCutLine(p!.cutLine),
                  seamLine: p!.seamLine.length > 0
                    ? p!.seamLine.map(c => c.type === 'line' ? { ...c, start: { ...c.start }, end: { ...c.end } } : { ...c, start: { ...c.start }, end: { ...c.end }, cp1: { ...c.cp1 }, cp2: { ...c.cp2 } })
                    : [],
                }
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
      if (!layoutOnly && tool === 'curvepoint' && selectedPieceIds.length === 1) {
        const pieceId = selectedPieceIds[0]
        const piece = pieces.find((x) => x.id === pieceId)
        if (!piece) {
          return
        }
        const local = worldToPieceLocal(world, piece)
        const masterPc = useSeamLineForPointCurveEditing(piece) ? piece.seamLine : piece.cutLine
        const nearMaster =
          masterPc.length > 0 ? nearestPointForMasterPointEditing(piece, local, pointInsertHitMmDown) : null
        const nearIl =
          piece.internalLines.length > 0
            ? nearestInternalLineForPointInsert(piece, local, pointInsertHitMmDown)
            : null
        const pickIl = nearIl && (!nearMaster || nearIl.distance < nearMaster.distance - 1e-9)
        if (pickIl && nearIl) {
          const curve = piece.internalLines[nearIl.curveIndex]
          if (curve.type === 'line') {
            const seg = curve
            const { start, end } = seg
            const dx = end.x - start.x
            const dy = end.y - start.y
            const cp1 = { x: start.x + dx / 3, y: start.y + dy / 3 }
            const cp2 = { x: start.x + (2 * dx) / 3, y: start.y + (2 * dy) / 3 }
            replaceInternalLineSegmentWithBezier(pieceId, nearIl.curveIndex, cp1, cp2)
          } else if (curve.type === 'bezier' && nearIl.t != null && nearIl.t > 1e-6 && nearIl.t < 1 - 1e-6) {
            insertPointOnInternalLine(pieceId, nearIl.curveIndex, nearIl.point, nearIl.t)
          }
          ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
          return
        }
        if (nearMaster && masterPc.length > 0) {
          const curve = masterPc[nearMaster.curveIndex]
          if (curve.type === 'line') {
            const seg = masterPc[nearMaster.curveIndex]
            if (seg?.type === 'line') {
              const { start, end } = seg
              const dx = end.x - start.x
              const dy = end.y - start.y
              const cp1 = { x: start.x + dx / 3, y: start.y + dy / 3 }
              const cp2 = { x: start.x + (2 * dx) / 3, y: start.y + (2 * dy) / 3 }
              replaceSegmentWithBezier(pieceId, nearMaster.curveIndex, cp1, cp2)
            }
          } else if (curve.type === 'bezier' && nearMaster.t != null && nearMaster.t > 1e-6 && nearMaster.t < 1 - 1e-6) {
            const bez = masterPc[nearMaster.curveIndex]
            if (bez?.type === 'bezier') {
              const pt = nearMaster.point
              insertPointOnCutLine(pieceId, nearMaster.curveIndex, pt, nearMaster.t)
            }
          }
          ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
          return
        }
        return
      }
      if (!layoutOnly && tool === 'roundcorner' && selectedPieceIds.length === 1) {
        const pieceId = selectedPieceIds[0]
        const piece = pieces.find((x) => x.id === pieceId)
        if (!piece) {
          selectPiece(null)
          setTool('select')
          return
        }
        const useSeamMaster = useSeamLineForVertexEditing(piece)
        const master = useSeamMaster ? piece.seamLine : piece.cutLine
        if (master.length < 3) {
          setToastMessage('warn:Kontur unvollständig – Eckenrundung nicht möglich.')
          return
        }
        const softSet = new Set(useSeamMaster ? piece.softVerticesMaster ?? [] : piece.softVertices ?? [])
        const local = worldToPieceLocal(world, piece)
        // Hit-Test: nächster harter Eckpunkt innerhalb Snap-Radius (12 px in Welt-mm).
        const SNAP_PX = 12
        const snapMm = SNAP_PX / Math.max(view.zoom, 1e-6)
        let bestVi = -1
        let bestDist = Infinity
        for (let vi = 0; vi < master.length; vi++) {
          if (softSet.has(vi)) continue
          const v = vi === 0 ? master[0].start : master[vi - 1].end
          const d = Math.hypot(v.x - local.x, v.y - local.y)
          if (d < bestDist) {
            bestDist = d
            bestVi = vi
          }
        }
        if (bestVi < 0 || bestDist > snapMm) {
          // Wenn ein bestehender Bogen angeklickt wurde → zugehörige gerundete Ecke editieren.
          const display = getDisplayedMasterCurves(piece)
          if (display.applied.length > 0) {
            const nearest = nearestCurveIndexAndPoint(local, display.curves)
            if (nearest && nearest.distance <= snapMm) {
              const found = display.applied.find((a) => a.arcCurveIndices.includes(nearest.curveIndex))
              if (found) {
                const cornerPos = vertexPositionOnClosedMaster(master, found.masterVertexIndex)
                if (cornerPos) {
                  setDragging({
                    kind: 'roundCorner',
                    pieceId,
                    masterVertexIndex: found.masterVertexIndex,
                    cornerLocal: cornerPos,
                    currentLocal: local,
                  })
                  ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
                  return
                }
              }
            }
          }
          setToastMessage('warn:Auf einen roten Eckpunkt klicken (oder einen bestehenden Bogen).')
          return
        }
        const cornerPos = vertexPositionOnClosedMaster(master, bestVi)
        if (!cornerPos) return
        setDragging({
          kind: 'roundCorner',
          pieceId,
          masterVertexIndex: bestVi,
          cornerLocal: cornerPos,
          currentLocal: cornerPos,
        })
        ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
        return
      }
      if (!layoutOnly && tool === 'point' && selectedPieceIds.length === 1) {
        const pieceId = selectedPieceIds[0]
        const piece = pieces.find((x) => x.id === pieceId)
        if (!piece) {
          return
        }
        const local = worldToPieceLocal(world, piece)
        const masterPt = useSeamLineForPointCurveEditing(piece) ? piece.seamLine : piece.cutLine
        const nearMaster =
          masterPt.length > 0 ? nearestPointForMasterPointEditing(piece, local, pointInsertHitMmDown) : null
        const nearIl =
          piece.internalLines.length > 0
            ? nearestInternalLineForPointInsert(piece, local, pointInsertHitMmDown)
            : null
        const pickIl = nearIl && (!nearMaster || nearIl.distance < nearMaster.distance - 1e-9)
        if (pickIl && nearIl) {
          const curve = piece.internalLines[nearIl.curveIndex]
          let inserted = false
          if (curve.type === 'line') {
            inserted = insertPointOnInternalLine(pieceId, nearIl.curveIndex, nearIl.point, nearIl.t)
          } else if (
            curve.type === 'bezier' &&
            nearIl.t != null &&
            nearIl.t > 1e-6 &&
            nearIl.t < 1 - 1e-6
          ) {
            inserted = insertPointOnInternalLine(pieceId, nearIl.curveIndex, nearIl.point, nearIl.t)
          }
          if (inserted) setPointPreview(null)
          ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
          return
        }
        if (nearMaster && masterPt.length > 0) {
          const curve = masterPt[nearMaster.curveIndex]
          let inserted = false
          if (curve.type === 'line') {
            inserted = insertPointOnCutLine(pieceId, nearMaster.curveIndex, nearMaster.point, nearMaster.t)
          } else if (
            curve.type === 'bezier' &&
            nearMaster.t != null &&
            nearMaster.t > 1e-6 &&
            nearMaster.t < 1 - 1e-6
          ) {
            inserted = insertPointOnCutLine(pieceId, nearMaster.curveIndex, nearMaster.point, nearMaster.t)
          }
          if (inserted) setPointPreview(null)
          ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
          return
        }
        return
      }
      if (tool === 'select') {
        if (rotateAroundPivotPieceId) {
          const piece = pieces.find((p) => p.id === rotateAroundPivotPieceId)
          if (!piece || piece.cutLine.length < 3) {
            if (rotateAroundPivotPieceId) setPiecePivot(rotateAroundPivotPieceId, null)
            setRotateAroundPivotPieceId(null)
            return
          }
          const pivot = getPiecePivotLocal(piece)
          const worldCenter = pieceLocalToWorld(pivot, piece)
          const startWorldAngle = (Math.atan2(world.y - worldCenter.y, world.x - worldCenter.x) * 180) / Math.PI
          setDragging({
            kind: 'rotate',
            pieceId: piece.id,
            startRotation: piece.transform.rotation,
            startWorldAngle,
          })
          containerRef.current?.setPointerCapture?.(e.pointerId)
          return
        }
        // Mac: ⌥ (Option) = altKey; viele Nutzer erwarten ⌘ (meta) wie bei anderen Shortcuts.
        if (contourEditEnabled && hoveredDeletableNotch && (e.altKey || e.metaKey)) {
          e.preventDefault()
          setNotchEditTarget({
            pieceId: hoveredDeletableNotch.pieceId,
            notchId: hoveredDeletableNotch.notchId,
          })
          return
        }
        if (contourEditEnabled && hoveredDeletableNotch) {
          const movePiece = pieces.find((p) => p.id === hoveredDeletableNotch.pieceId)
          if (movePiece) {
            setNotchPreview(buildNotchMovePreview(movePiece, hoveredDeletableNotch.notchId))
          }
          setDragging({
            kind: 'notchMove',
            pieceId: hoveredDeletableNotch.pieceId,
            notchId: hoveredDeletableNotch.notchId,
          })
          ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
          return
        }
        if (showPivotRotationUi) {
          const rotationHitMm = containerRef.current
            ? clampPointHitWorldMm(
                worldHitRadiusFromScreenPx(
                  ROTATION_RING_HOVER_RADIUS_PX * canvasRotationUiScale,
                  view,
                  svgRef.current,
                  containerRef.current,
                ),
              )
            : 10
          const PIVOT_HIT = 20
          for (let i = pieces.length - 1; i >= 0; i--) {
            const p = pieces[i]
            if (!selectedPieceIds.includes(p.id) || p.cutLine.length < 3) continue
            const layout = getRotationUiLayout(p)
            if (!layout) continue
            const { pivot, rotationRadius: radius, handleLocal } = layout
            const handleWorld = pieceLocalToWorld(handleLocal, p)
            const distHandle = Math.hypot(world.x - handleWorld.x, world.y - handleWorld.y)
            const pivotWorld = pieceLocalToWorld(pivot, p)
            const distRing = Math.abs(Math.hypot(world.x - pivotWorld.x, world.y - pivotWorld.y) - radius)
            if (distHandle < rotationHitMm || distRing < rotationHitMm) {
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
        }
        if (!contourEditEnabled) {
        const GRAIN_SHAFT_HIT = 14
        const GRAIN_ENDPOINT_HIT = 16
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
          // Anfang/Ende zuerst: Linie länger/kürzer machen und Richtung anpassen
          if (dStart < GRAIN_ENDPOINT_HIT || dEnd < GRAIN_ENDPOINT_HIT) {
            const which: 'start' | 'end' =
              dStart <= dEnd ? 'start' : 'end'
            setDragging({ kind: 'grainPoint', pieceId: p.id, which })
            containerRef.current?.setPointerCapture?.(e.pointerId)
            return
          }
          const shaftHit = distPointToSegmentMm(local, grain.start, grain.end)
          if (shaftHit.d > GRAIN_SHAFT_HIT) continue
          setDragging({
            kind: 'grainLine',
            pieceId: p.id,
            startLocal: { ...local },
            lineAtPointerDown: { start: { ...grain.start }, end: { ...grain.end } },
          })
          containerRef.current?.setPointerCapture?.(e.pointerId)
          return
        }
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
        if (!layoutOnly && imageDigitizeSession?.imageDataUrl && imageDigitizeSession.imageSizePx) {
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
        if (layoutOnly) {
          selectPiece(null)
        } else {
          setDragging({ kind: 'selectionMarquee', start: world, current: world })
          ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
        }
        return
      }
      if (!layoutOnly && (tool === 'line' || tool === 'internalLine')) {
        let pieceUnderCursor: PatternPiece | null = null
        for (let i = pieces.length - 1; i >= 0; i--) {
          const p = pieces[i]
          const local = worldToPieceLocal(world, p)
          if (isPointInsidePiece(local, p)) {
            pieceUnderCursor = p
            break
          }
        }
        if (pieceUnderCursor) {
          selectPiece(pieceUnderCursor.id)
          const local = worldToPieceLocal(world, pieceUnderCursor)
          setDragging({ kind: 'line', pieceId: pieceUnderCursor.id, start: local, current: local })
          ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
          return
        }
        if (selectedPieceIds.length === 1) {
          const pieceId = selectedPieceIds[0]
          const piece = pieces.find((x) => x.id === pieceId)
          if (piece) {
            const local = worldToPieceLocal(world, piece)
            setDragging({ kind: 'line', pieceId, start: local, current: local })
            ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
            return
          }
        }
        setToastMessage(
          'warn:In ein Schnittteil klicken oder genau ein Teil in der Liste wählen – Linien-Werkzeug bleibt aktiv.',
        )
        return
      }
      if (!layoutOnly && tool === 'notch' && notchEdgeMidMode && selectedPieceIds.length !== 1) {
        setToastMessage('warn: Kerben Kantenmitte: bitte genau ein Schnittteil in der Liste auswaehlen.')
        setNotchEdgeMidMode(false)
        return
      }
      if (!layoutOnly && tool === 'notch' && selectedPieceIds.length === 1) {
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
        const nearestInternal =
          piece.internalLines.length > 0
            ? nearestCurveIndexAndPoint(local, piece.internalLines)
            : null
        if (curves.length === 0 && !nearestInternal) {
          selectPiece(null)
          setTool('select')
          return
        }
        const contourSnap = findNotchContourSnapOnPiece(
          piece,
          local,
          curves,
          vHitWorld,
          vHitSeamWorld,
          pocHitWorld,
        )
        const nearestRaw = curves.length > 0 ? nearestCurveIndexAndPoint(local, curves) : null
        const nearest =
          contourSnap != null
            ? {
                curveIndex: contourSnap.curveIndex,
                point: contourSnap.point,
                t: contourSnap.t,
                distance: 0,
              }
            : nearestRaw
        const contourOk =
          contourSnap != null || (nearestRaw != null && nearestRaw.distance <= maxSnapDistance)
        const internalOk = nearestInternal != null && nearestInternal.distance <= maxSnapDistance
        if (!contourOk && !internalOk) {
          if (notchEdgeMidMode) {
            setToastMessage('warn: Nahe einer Kante klicken (Kantenmitte-Modus, 20 mm).')
            return
          }
          selectPiece(null)
          setTool('select')
          return
        }
        if (
          internalOk &&
          nearestInternal &&
          (!contourOk || nearestInternal.distance < (nearest?.distance ?? 1e15) - 1e-9)
        ) {
          if (notchEdgeMidMode) {
            setToastMessage('warn: Kantenmitte gilt nur für Schnitt- oder Nahtkanten.')
            return
          }
          const tInt = nearestInternal.t ?? 0
          setNotchPreview(null)
          setDragging({
            kind: 'notch',
            pieceId,
            position: nearestInternal.point,
            current: nearestInternal.point,
            curveIndex: nearestInternal.curveIndex,
            t: tInt,
            onInternalLine: true,
          })
          ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
          return
        }
        if (!nearest) {
          selectPiece(null)
          setTool('select')
          return
        }
        const seg = curves[nearest.curveIndex]
        if (notchEdgeMidMode) {
          if (!seg || seg.type !== 'line') {
            setToastMessage('warn: Kantenmitte-Modus: nur gerade Kanten (Liniensegmente).')
            return
          }
          const lineSeg = seg
          const n = Math.min(NOTCH_EDGE_LINE_MAX, Math.max(1, notchEdgeLineCount))
          const Lmm = lineSegmentLengthMm(lineSeg)
          if (n > 1 && Lmm + 1e-6 < NOTCH_MIN_SPACING_MM * (n + 1)) {
            setToastMessage(
              `error: Kante zu kurz für ${n} Kerben (je Teilung mind. ${NOTCH_MIN_SPACING_MM} mm; Kante ca. ${Lmm.toFixed(1)} mm).`
            )
            return
          }
          if (n === 1) {
            const { point, t } = midpointOnLineSegment(lineSeg)
            setNotchPreview(null)
            setNotchEdgeMidMode(false)
            setDragging({
              kind: 'notch',
              pieceId,
              position: point,
              current: point,
              curveIndex: nearest.curveIndex,
              t,
              useSeamLine: useSeam,
            })
            ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
            return
          }
          const presetIdx = Math.max(0, Math.min(notchSettings.length - 1, activeNotchPresetIndex))
          const notchPreset = notchSettings[presetIdx] ?? { type: 'strich' as const, widthMm: 2.5, depthMm: 2 }
          const modelFields = modelNotchFieldsFromPreset(notchPreset)
          if (!modelFields) {
            setToastMessage('error: Kerben-Preset ungueltig.')
            return
          }
          const { type: notchModelType, depth: defaultDepth, width: defaultWidth } = modelFields
          const curvesForAngle = useSeam && piece.seamLine.length >= 3 ? piece.seamLine : piece.cutLine
          const ts = evenlySpacedTsOnLineSegment(n)
          type EdgeNotchCand = {
            cutCi: number
            cutT: number
            notchPos: Point
            notchAngle: number
            seamAdd: boolean
          }
          const cands: EdgeNotchCand[] = []
          for (const tMaster of ts) {
            const posMaster = pointAtLineSegmentT(lineSeg, tMaster)
            if (useSeam && piece.seamLine.length >= 3) {
              const cutNearest = nearestCurveIndexAndPoint(posMaster, piece.cutLine)
              if (!cutNearest) {
                setToastMessage('error: Kerbe auf Schnittkontur nicht abbildbar.')
                return
              }
              const cutCi = cutNearest.curveIndex
              const cutT = cutNearest.t ?? 0
              let notchAngle: number
              if (notchModelType === 'single') {
                const ct = cutNearest.t ?? 0
                notchAngle = outwardNormalAngleAt(piece.cutLine, cutNearest.curveIndex, ct) + 180
              } else {
                notchAngle = outwardNormalAngleAt(curvesForAngle, nearest.curveIndex, tMaster) + 180
              }
              cands.push({
                cutCi,
                cutT,
                notchPos: cutNearest.point,
                notchAngle,
                seamAdd: true,
              })
            } else {
              let notchAngle: number
              if (notchModelType === 'single') {
                notchAngle = outwardNormalAngleAt(piece.cutLine, nearest.curveIndex, tMaster) + 180
              } else {
                notchAngle = outwardNormalAngleAt(curvesForAngle, nearest.curveIndex, tMaster) + 180
              }
              const notchPos =
                nearestCurveIndexAndPoint(posMaster, piece.cutLine)?.point ?? posMaster
              cands.push({
                cutCi: nearest.curveIndex,
                cutT: tMaster,
                notchPos,
                notchAngle,
                seamAdd: false,
              })
            }
          }
          for (const c of cands) {
            if (!isNotchSpacingValid(piece, c.cutCi, c.cutT)) {
              setToastMessage(
                'error: Abstand zu vorhandener Kerbe zu gering (mind. 4 mm). Weniger Kerben wählen oder andere Kante.'
              )
              return
            }
          }
          for (const c of cands) {
            const id = 'n' + Math.random().toString(36).slice(2, 9)
            if (c.seamAdd) {
              addNotch(pieceId, {
                id,
                position: c.notchPos,
                angle: c.notchAngle,
                type: notchModelType,
                depth: defaultDepth,
                width: defaultWidth,
              })
            } else {
              const pathL = pathLengthAt(piece.cutLine, c.cutCi, c.cutT)
              const total = totalPathLength(piece.cutLine)
              addNotch(pieceId, {
                id,
                position: c.notchPos,
                angle: c.notchAngle,
                type: notchModelType,
                depth: defaultDepth,
                width: defaultWidth,
                sNormalized: total > 0 ? pathL / total : undefined,
                arcLengthMm: total > 0 ? pathL : undefined,
              })
            }
          }
          setNotchPreview(null)
          setNotchEdgeMidMode(false)
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
      if (!layoutOnly && tool === 'drill' && selectedPieceIds.length === 1) {
        const pieceId = selectedPieceIds[0]
        const piece = pieces.find((x) => x.id === pieceId)
        if (!piece) return
        const local = worldToPieceLocal(world, piece)
        setDragging({ kind: 'drill', pieceId, center: local, current: local })
        ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
        return
      }
      if (!layoutOnly && tool === 'internalCircle' && selectedPieceIds.length === 1) {
        const pieceId = selectedPieceIds[0]
        const piece = pieces.find((x) => x.id === pieceId)
        if (!piece) return
        const local = worldToPieceLocal(world, piece)
        setDragging({ kind: 'internalCircle', pieceId, center: local, current: local })
        ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
        return
      }
      if (!layoutOnly && tool === 'rectangle') {
        setDragging({ kind: 'rectangle', start: world, current: world })
        ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
        return
      }
      if (!layoutOnly && tool === 'note') {
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
      if (!layoutOnly && tool === 'digitize' && digitizeState) {
        const CLOSE_HIT = 8 * canvasDigitizeUiScale
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
      contourEditEnabled,
      rulerMode,
      pendingNahtzugabeClick,
      setPendingNahtzugabeClick,
      setNahtzugabeDialogPieceId,
      nahtzuordnungMode,
      setNahtzuordnungMode,
      setPendingNahtzuordnungFirst,
      pendingNahtzuordnungFirst,
      addSeamAssignment,
      addInternalSeamAssignment,
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
      insertPointOnInternalLine,
      replaceSegmentWithBezier,
      replaceInternalLineSegmentWithBezier,
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
      showProfiles,
      horizontalLevelPickingActive,
      hoveredHorizontalLevelEdge,
      alignPieceEdgeHorizontal,
      setHorizontalLevelPickingActive,
      pieceSymmetryState,
      flipByEdgeActive,
      flipPieceAlongAxis,
      setFlipByEdgeActive,
      setPieceSymmetryState,
      applyPieceSymmetry,
      setSymmetryHoverWorld,
      hoveredSymmetryEdge,
      hoveredSymmetryInternalIdx,
      setHoveredSymmetryEdge,
      setHoveredSymmetryInternalIdx,
      notchEdgeMidMode,
      setNotchEdgeMidMode,
      notchEdgeLineCount,
      notchSettings,
      activeNotchPresetIndex,
      nahtTrimPickCutVertexActive,
      completeNahtTrimAtCutVertex,
      cancelNahtTrimVertexPick,
      canvasRotationUiScale,
      canvasDigitizeUiScale,
      canvasVertexPointUiScale,
      showPivotRotationUi,
      profileFitConfirm,
    ]
  )

  /** Hover/Klick auf Notch – bei Überlappung mit Eckpunkt gewinnt der nähere. */
  const NOTCH_HOVER_HIT = 6
  const NOTCH_CLICK_HIT = 6

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const navigationOnlyPointer =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(pointer: coarse)').matches &&
        e.pointerType !== 'pen'
      if (navigationOnlyPointer) {
        if (e.pointerType !== 'touch') return
        const tracked = activeTouchPointsRef.current.get(e.pointerId)
        if (!tracked) return
        e.preventDefault()
        activeTouchPointsRef.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY })
        const activeTouches = [...activeTouchPointsRef.current.values()]
        if (activeTouches.length >= 2) {
          const a = activeTouches[0]
          const b = activeTouches[1]
          const centerClient = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }
          const distance = Math.max(Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), 1)
          if (!pinchStartRef.current) {
            pinchStartRef.current = {
              distance,
              centerClient,
              view: { zoom: view.zoom, panX: view.panX, panY: view.panY },
            }
          }
          if (!svgRef.current || !pinchStartRef.current) return
          const svgRect = svgRef.current.getBoundingClientRect()
          const scale = Math.min(svgRect.width / VIEWBOX_WIDTH, svgRect.height / VIEWBOX_HEIGHT)
          const offsetX = (svgRect.width - VIEWBOX_WIDTH * scale) / 2
          const offsetY = (svgRect.height - VIEWBOX_HEIGHT * scale) / 2
          const pinch = pinchStartRef.current
          const centerSvgX = (centerClient.x - svgRect.left - offsetX) / scale
          const centerSvgY = (centerClient.y - svgRect.top - offsetY) / scale
          const startCenterSvgX = (pinch.centerClient.x - svgRect.left - offsetX) / scale
          const startCenterSvgY = (pinch.centerClient.y - svgRect.top - offsetY) / scale
          const startZoom = pinch.view.zoom
          const factor = distance / Math.max(pinch.distance, 1)
          const newZoom = Math.max(0.1, Math.min(10, startZoom * factor))
          const worldCenterX = (startCenterSvgX - pinch.view.panX) / startZoom
          const worldCenterY = (startCenterSvgY - pinch.view.panY) / startZoom
          setView({
            zoom: newZoom,
            panX: centerSvgX - worldCenterX * newZoom,
            panY: centerSvgY - worldCenterY * newZoom,
          })
          return
        }
        pinchStartRef.current = null
        if (dragging?.kind !== 'pan' || touchPanPointerIdRef.current !== e.pointerId) return
      }
      const worldSym = toWorld(e.clientX, e.clientY)
      if (pieceSymmetryState?.phase === 'axisB' && pieceSymmetryState.axisA) {
        setSymmetryHoverWorld(worldSym)
      } else {
        setSymmetryHoverWorld(null)
      }

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
          setDigitizeNearFirst(Math.hypot(world.x - first.x, world.y - first.y) < 8 * canvasDigitizeUiScale)
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
        const ctnM = containerRef.current
        const svgM = svgRef.current
        const hoverVertexHitMm = ctnM
          ? clampPointHitWorldMm(
              worldHitRadiusFromScreenPx(VERTEX_HIT_RADIUS_PX * canvasVertexPointUiScale, view, svgM, ctnM),
            )
          : 5
        const hoverVertexSeamHitMm = ctnM
          ? clampPointHitWorldMm(
              worldHitRadiusFromScreenPx(VERTEX_HIT_SEAM_RADIUS_PX * canvasVertexPointUiScale, view, svgM, ctnM),
            )
          : 8
        const hoverCurveMidHitMm = ctnM
          ? clampPointHitWorldMm(
              worldHitRadiusFromScreenPx(POINT_ON_CURVE_HIT_RADIUS_PX * canvasVertexPointUiScale, view, svgM, ctnM),
            )
          : 10
        const pointInsertHitMmMove = ctnM
          ? clampPointHitWorldMm(
              worldHitRadiusFromScreenPx(POINT_INSERT_HIT_RADIUS_PX * canvasVertexPointUiScale, view, svgM, ctnM),
            )
          : POINT_INSERT_HIT_FALLBACK_MM
        const worldImg = toWorld(e.clientX, e.clientY)
        lastPointerClientRef.current = { x: e.clientX, y: e.clientY }
        if (tool === 'select' && showPivotRotationUi) {
          const rotationHoverHitMm = ctnM
            ? clampPointHitWorldMm(
                worldHitRadiusFromScreenPx(
                  ROTATION_RING_HOVER_RADIUS_PX * canvasRotationUiScale,
                  view,
                  svgM,
                  ctnM,
                ),
              )
            : 10
          let pivotHit: { pieceId: string; dist: number } | null = null
          let ringHit: { pieceId: string; dist: number } | null = null
          let handleHit: { pieceId: string; dist: number } | null = null
          for (let i = pieces.length - 1; i >= 0; i--) {
            const p = pieces[i]
            if (!selectedPieceIds.includes(p.id) || p.cutLine.length < 3) continue
            const layout = getRotationUiLayout(p)
            if (!layout) continue
            const { pivot, rotationRadius: radius, handleLocal } = layout
            if (radius <= 0) continue
            const worldPivot = pieceLocalToWorld(pivot, p)
            const dPivot = Math.hypot(worldImg.x - worldPivot.x, worldImg.y - worldPivot.y)
            if (dPivot <= rotationHoverHitMm && (!pivotHit || dPivot < pivotHit.dist)) {
              pivotHit = { pieceId: p.id, dist: dPivot }
            }
            const dRing = Math.abs(dPivot - radius)
            if (dRing <= rotationHoverHitMm && (!ringHit || dRing < ringHit.dist)) {
              ringHit = { pieceId: p.id, dist: dRing }
            }
            const handleWorld = pieceLocalToWorld(handleLocal, p)
            const dHandle = Math.hypot(worldImg.x - handleWorld.x, worldImg.y - handleWorld.y)
            if (dHandle <= rotationHoverHitMm && (!handleHit || dHandle < handleHit.dist)) {
              handleHit = { pieceId: p.id, dist: dHandle }
            }
          }
          setHoveredPivotForRotationPieceId(pivotHit?.pieceId ?? null)
          setHoveredRotationRingPieceId(ringHit?.pieceId ?? null)
          setHoveredRotationHandlePieceId(handleHit?.pieceId ?? null)
        } else {
          setHoveredPivotForRotationPieceId(null)
          setHoveredRotationRingPieceId(null)
          setHoveredRotationHandlePieceId(null)
        }
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
        if (nahtzuordnungMode === 'internal') {
          const world = toWorld(e.clientX, e.clientY)
          let bestHover: {
            pieceId: string
            curveIndices: number[]
            startNotchId?: string
            endNotchId?: string
            distance: number
          } | null = null
          for (const p of pieces) {
            const local = worldToPieceLocal(world, p)
            const hit = hitInternalLineForSeamAssignment(local, p, SEAM_HIT_MM)
            if (hit && (!bestHover || hit.distance < bestHover.distance)) {
              const range = deriveInternalSeamNotchRangeAtClick(p, hit.curveIndex, hit.t)
              bestHover = {
                pieceId: p.id,
                curveIndices: hit.curveIndices,
                distance: hit.distance,
                ...(range ? { startNotchId: range.startNotchId, endNotchId: range.endNotchId } : {}),
              }
            }
          }
          setHoveredInternalSeamForNahtzuordnung(
            bestHover
              ? {
                  pieceId: bestHover.pieceId,
                  curveIndices: bestHover.curveIndices,
                  startNotchId: bestHover.startNotchId,
                  endNotchId: bestHover.endNotchId,
                }
              : null
          )
          setHoveredSeamForNahtzuordnung(null)
        } else if (nahtzuordnungMode === 'first' || nahtzuordnungMode === 'second') {
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
          setHoveredInternalSeamForNahtzuordnung(null)
        } else {
          setHoveredSeamForNahtzuordnung(null)
          setHoveredInternalSeamForNahtzuordnung(null)
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
          let bestEdge: {
            pieceId: string
            edgeIndex: number
            curveIndices: number[]
            distance: number
            startNotchId?: string
            endNotchId?: string
            onInternalLine?: boolean
          } | null = null
          for (const p of pieces) {
            const local = worldToPieceLocal(world, p)
            if (p.internalLines.length > 0) {
              const nearestInt = nearestCurveIndexAndPoint(local, p.internalLines)
              if (nearestInt && nearestInt.distance < SEAM_HIT_MM) {
                const curveIndices = [nearestInt.curveIndex]
                const seg = p.internalLines[nearestInt.curveIndex]
                const arcOnPath = seg
                  ? curveSegmentArcLength(seg, 0, nearestInt.t ?? 0)
                  : 0
                const rangeAtClick =
                  deriveInternalProfileBoundaryRangeAtArcLength(p, curveIndices, arcOnPath) ??
                  deriveInternalProfileBoundaryRangeOnPath(p, curveIndices)
                if (internalPathHasProfileBoundaryNotches(p, curveIndices) && !rangeAtClick) {
                  continue
                }
                const startNotchId = rangeAtClick?.startNotchId
                const endNotchId = rangeAtClick?.endNotchId
                if (!bestEdge || nearestInt.distance < bestEdge.distance) {
                  bestEdge = {
                    pieceId: p.id,
                    edgeIndex: nearestInt.curveIndex,
                    curveIndices,
                    distance: nearestInt.distance,
                    startNotchId,
                    endNotchId,
                    onInternalLine: true,
                  }
                }
              }
            }
            const masterK = getCurvesForSeamEdge(p)
            if (masterK.length < 3) continue
            const nearest = nearestCurveIndexAndPoint(local, masterK)
            if (!nearest || nearest.distance >= SEAM_HIT_MM) continue
            const edges = enumerateEdges(p)
            for (const edge of edges) {
              if (edge.curveIndices.includes(nearest.curveIndex)) {
                if (!bestEdge || nearest.distance < bestEdge.distance) {
                  let startNotchId: string | undefined
                  let endNotchId: string | undefined
                  const idxInEdge = edge.curveIndices.indexOf(nearest.curveIndex)
                  if (idxInEdge >= 0) {
                    const lengths = edge.curveIndices.map((ci) => {
                      const seg = masterK[ci]
                      return seg ? curveSegmentArcLength(seg, 0, 1) : 0
                    })
                    const prefix = lengths.slice(0, idxInEdge).reduce((a, b) => a + b, 0)
                    const segArc = curveSegmentArcLength(masterK[nearest.curveIndex], 0, nearest.t ?? 0)
                    const arcOnEdge = prefix + segArc
                    const rangeAtClick =
                      deriveContourProfileBoundaryRangeAtArcLength(p, edge.curveIndices, arcOnEdge, masterK) ??
                      deriveContourProfileBoundaryRangeOnEdge(p, edge.curveIndices, masterK)
                    if (edgeHasProfileBoundaryNotches(p, edge.curveIndices, masterK) && !rangeAtClick) {
                      continue
                    }
                    startNotchId = rangeAtClick?.startNotchId
                    endNotchId = rangeAtClick?.endNotchId
                  }
                  bestEdge = {
                    pieceId: p.id,
                    edgeIndex: edge.edgeIndex,
                    curveIndices: edge.curveIndices,
                    distance: nearest.distance,
                    startNotchId,
                    endNotchId,
                    onInternalLine: false,
                  }
                }
                break
              }
            }
          }
          setHoveredProfileEdge(bestEdge)
        } else {
          setHoveredProfileEdge(null)
        }
        if (horizontalLevelPickingActive && selectedPieceIds.length === 1) {
          const world = toWorld(e.clientX, e.clientY)
          const selId = selectedPieceIds[0]
          const p = pieces.find((x) => x.id === selId)
          let bestEdge: { pieceId: string; edgeIndex: number; curveIndices: number[]; distance: number } | null = null
          if (p) {
            const masterK = getCurvesForSeamEdge(p)
            if (masterK.length >= 3) {
              const local = worldToPieceLocal(world, p)
              const nearest = nearestCurveIndexAndPoint(local, masterK)
              if (nearest && nearest.distance < SEAM_HIT_MM) {
                const edges = enumerateEdges(p)
                for (const edge of edges) {
                  if (edge.curveIndices.includes(nearest.curveIndex)) {
                    if (masterEdgeIsStraightLine(masterK, edge)) {
                      bestEdge = {
                        pieceId: p.id,
                        edgeIndex: edge.edgeIndex,
                        curveIndices: edge.curveIndices,
                        distance: nearest.distance,
                      }
                    }
                    break
                  }
                }
              }
            }
          }
          setHoveredHorizontalLevelEdge(bestEdge)
        } else {
          setHoveredHorizontalLevelEdge(null)
        }
        if (pieceSymmetryState?.phase === 'pickEdge' && selectedPieceIds.length === 1) {
          const world = toWorld(e.clientX, e.clientY)
          const selId = selectedPieceIds[0]
          const p = pieces.find((x) => x.id === selId)
          let bestEdge: {
            pieceId: string
            edgeIndex: number
            curveIndices: number[]
            distance: number
            curveHitIndex: number
            curveHitT: number
            snapPointLocal: Point
          } | null = null
          if (p && pieceSymmetryState.pieceId === p.id) {
            const masterK = getCurvesForSeamEdge(p)
            if (masterK.length >= 3) {
              const local = worldToPieceLocal(world, p)
              const nearest = nearestCurveIndexAndPoint(local, masterK)
              if (nearest && nearest.distance < SEAM_HIT_MM) {
                const edges = enumerateEdges(p)
                for (const edge of edges) {
                  if (edge.curveIndices.includes(nearest.curveIndex)) {
                    bestEdge = {
                      pieceId: p.id,
                      edgeIndex: edge.edgeIndex,
                      curveIndices: edge.curveIndices,
                      distance: nearest.distance,
                      curveHitIndex: nearest.curveIndex,
                      curveHitT: nearest.t ?? 0.5,
                      snapPointLocal: { ...nearest.point },
                    }
                    break
                  }
                }
              }
            }
          }
          setHoveredSymmetryEdge(bestEdge)
        } else {
          setHoveredSymmetryEdge(null)
        }
        if (pieceSymmetryState?.phase === 'pickInternalLine' && selectedPieceIds.length === 1) {
          const p = pieces.find((x) => x.id === selectedPieceIds[0])
          if (p && pieceSymmetryState.pieceId === p.id && p.internalLines.length > 0) {
            const world = toWorld(e.clientX, e.clientY)
            const local = worldToPieceLocal(world, p)
            const r = nearestCurveIndexAndPoint(local, p.internalLines)
            if (r && r.distance < SYMMETRY_INTERNAL_HOVER_MM) setHoveredSymmetryInternalIdx(r.curveIndex)
            else setHoveredSymmetryInternalIdx(null)
          } else {
            setHoveredSymmetryInternalIdx(null)
          }
        } else {
          setHoveredSymmetryInternalIdx(null)
        }
        if (
          contourEditEnabled &&
          showPoints &&
          (tool === 'select' || tool === 'point' || tool === 'curvepoint') &&
          selectedPieceIds.length > 0
        ) {
          const world = toWorld(e.clientX, e.clientY)
          const piecesForHover = pieces.filter((p) => selectedPieceIds.includes(p.id))
          const piecesForNotchHover =
            piecesForHover.some((p) => p.notches.length > 0) ? piecesForHover : pieces
          let bestVertexOnly: { dist: number; value: DeletableHoverTarget | null } = {
            dist: 1e15,
            value: null,
          }
          let bestCurveOnly: { dist: number; value: DeletableHoverTarget | null } = {
            dist: 1e15,
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
          const contourHoverMerged = mergeDeletableHoverVertexVsCurve(bestVertexOnly, bestCurveOnly)
          let bestInternalVertexOnlyH: { dist: number; value: DeletableHoverTarget | null } = {
            dist: 1e15,
            value: null,
          }
          let bestInternalCurveOnlyH: { dist: number; value: DeletableHoverTarget | null } = {
            dist: 1e15,
            value: null,
          }
          for (const p of piecesForHover) {
            if (!p.internalLines.length) continue
            const localIl = worldToPieceLocal(world, p)
            for (let ci = 0; ci < p.internalLines.length; ci++) {
              const c = p.internalLines[ci]
              if (c.type !== 'bezier') continue
              const pt = bezierAt(c, 0.5)
              const d = Math.hypot(localIl.x - pt.x, localIl.y - pt.y)
              if (d < hoverCurveMidHitMm && (!bestInternalCurveOnlyH.value || d < bestInternalCurveOnlyH.dist)) {
                bestInternalCurveOnlyH = {
                  dist: d,
                  value: { pieceId: p.id, kind: 'internalPointOnCurve', curveIndex: ci },
                }
              }
            }
            for (const { dist, target } of collectInternalLineVertexHoverCandidates(p, localIl, hoverVertexHitMm)) {
              if (dist < bestInternalVertexOnlyH.dist) bestInternalVertexOnlyH = { dist, value: target }
            }
          }
          const internalHoverMerged = mergeInternalLineVertexVsCurve(bestInternalVertexOnlyH, bestInternalCurveOnlyH)
          const internalCloserHover =
            internalHoverMerged.value != null &&
            (contourHoverMerged.value == null || internalHoverMerged.dist < contourHoverMerged.dist - 1e-9)
          const hoverPick = internalCloserHover ? internalHoverMerged.value : contourHoverMerged.value
          const hoverPickDist = internalCloserHover ? internalHoverMerged.dist : contourHoverMerged.dist
          const hpPiece = hoverPick ? pieces.find((x) => x.id === hoverPick.pieceId) : null
          const hoverDelMaxDist = hoverPick
            ? hoverPick.kind === 'vertex'
              ? hpPiece && useSeamLineForVertexEditing(hpPiece)
                ? hoverVertexSeamHitMm
                : hoverVertexHitMm
              : hoverPick.kind === 'pointOnCurve' || hoverPick.kind === 'internalPointOnCurve'
                ? hoverCurveMidHitMm
                : hoverVertexHitMm
            : 0
          let bestNotch: { dist: number; pieceId: string; notchId: string } = {
            dist: NOTCH_HOVER_HIT + 1,
            pieceId: '',
            notchId: '',
          }
          for (const p of piecesForNotchHover) {
            const local = worldToPieceLocal(world, p)
            for (const notch of p.notches) {
              const d = distanceToNotchHoverMm(local, notch, p)
              if (d < bestNotch.dist) bestNotch = { dist: d, pieceId: p.id, notchId: notch.id }
            }
          }
          const vertexInRange = hoverPick != null && hoverPickDist <= hoverDelMaxDist
          const notchInRange = bestNotch.dist <= NOTCH_HOVER_HIT
          if (vertexInRange && notchInRange) {
            setHoveredDeletableNotch({ pieceId: bestNotch.pieceId, notchId: bestNotch.notchId })
            setHoveredDeletablePoint(hoverPick)
            setHoveredInternalLine(null)
            setHoveredInternalCircle(null)
            setNotchPreview(null)
            setHoveredPieceId(null)
            return
          } else if (notchInRange) {
            setHoveredDeletableNotch({ pieceId: bestNotch.pieceId, notchId: bestNotch.notchId })
            setHoveredDeletablePoint(null)
            setHoveredInternalLine(null)
            setHoveredInternalCircle(null)
            setNotchPreview(null)
            setHoveredPieceId(null)
            return
          }
          if (vertexInRange) {
            setHoveredDeletablePoint(hoverPick)
            setHoveredDeletableNotch(null)
            setHoveredInternalLine(null)
            setHoveredInternalCircle(null)
            setHoveredPieceId(null)
            return
          }
          const INTERNAL_LINE_HOVER_HIT = 10
          let bestInternalLine: { dist: number; pieceId: string; curveIndex: number } | null = null
          let bestInternalCircle: { dist: number; pieceId: string; circleId: string } | null = null
          for (const p of piecesForHover) {
            const local = worldToPieceLocal(world, p)
            for (const ic of p.internalCircles) {
              const ringD = Math.abs(Math.hypot(local.x - ic.center.x, local.y - ic.center.y) - ic.radius)
              if (ringD < INTERNAL_LINE_HOVER_HIT && (!bestInternalCircle || ringD < bestInternalCircle.dist)) {
                bestInternalCircle = { dist: ringD, pieceId: p.id, circleId: ic.id }
              }
            }
            if (p.internalLines.length === 0) continue
            const r = nearestCurveIndexAndPoint(local, p.internalLines)
            if (r && r.distance < INTERNAL_LINE_HOVER_HIT && (!bestInternalLine || r.distance < bestInternalLine.dist)) {
              bestInternalLine = { dist: r.distance, pieceId: p.id, curveIndex: r.curveIndex }
            }
          }
          const circlePick =
            bestInternalCircle && (!bestInternalLine || bestInternalCircle.dist < bestInternalLine.dist)
              ? bestInternalCircle
              : null
          if (circlePick) {
            setHoveredInternalCircle({
              pieceId: circlePick.pieceId,
              circleId: circlePick.circleId,
            })
            setHoveredInternalLine(null)
          } else if (bestInternalLine) {
            setHoveredInternalLine({ pieceId: bestInternalLine.pieceId, curveIndex: bestInternalLine.curveIndex })
            setHoveredInternalCircle(null)
          } else {
            setHoveredInternalLine(null)
            setHoveredInternalCircle(null)
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
              const d = distanceToNotchHoverMm(local, notch, p)
              if (d < bestNotch.dist) bestNotch = { dist: d, pieceId: p.id, notchId: notch.id }
            }
          }
          if (bestNotch.dist <= NOTCH_HOVER_HIT) {
            setHoveredDeletableNotch({ pieceId: bestNotch.pieceId, notchId: bestNotch.notchId })
            setHoveredDeletablePoint(null)
            setHoveredInternalLine(null)
            setHoveredInternalCircle(null)
            setNotchPreview(null)
            setHoveredPieceId(null)
          } else {
            setHoveredDeletableNotch(null)
            if (tool === 'select' || tool === 'point' || tool === 'curvepoint') {
              const INTERNAL_LINE_HOVER_HIT_ELSE = 10
              let bestInternalLine: { dist: number; pieceId: string; curveIndex: number } | null = null
              let bestInternalCircle: { dist: number; pieceId: string; circleId: string } | null = null
              for (const p of piecesForNotchHover) {
                const local = worldToPieceLocal(worldForNotch, p)
                for (const ic of p.internalCircles) {
                  const ringD = Math.abs(Math.hypot(local.x - ic.center.x, local.y - ic.center.y) - ic.radius)
                  if (ringD < INTERNAL_LINE_HOVER_HIT_ELSE && (!bestInternalCircle || ringD < bestInternalCircle.dist)) {
                    bestInternalCircle = { dist: ringD, pieceId: p.id, circleId: ic.id }
                  }
                }
                if (p.internalLines.length === 0) continue
                const r = nearestCurveIndexAndPoint(local, p.internalLines)
                if (r && r.distance < INTERNAL_LINE_HOVER_HIT_ELSE && (!bestInternalLine || r.distance < bestInternalLine.dist)) {
                  bestInternalLine = { dist: r.distance, pieceId: p.id, curveIndex: r.curveIndex }
                }
              }
              const circlePickElse =
                bestInternalCircle && (!bestInternalLine || bestInternalCircle.dist < bestInternalLine.dist)
                  ? bestInternalCircle
                  : null
              if (circlePickElse) {
                setHoveredInternalCircle({
                  pieceId: circlePickElse.pieceId,
                  circleId: circlePickElse.circleId,
                })
                setHoveredInternalLine(null)
              } else if (bestInternalLine) {
                setHoveredInternalLine({ pieceId: bestInternalLine.pieceId, curveIndex: bestInternalLine.curveIndex })
                setHoveredInternalCircle(null)
              } else {
                setHoveredInternalLine(null)
                setHoveredInternalCircle(null)
              }
            } else {
              setHoveredInternalLine(null)
              setHoveredInternalCircle(null)
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
            onInternalLine: boolean
          } | null = null
          for (const piece of piecesToCheck) {
            const local = worldToPieceLocal(world, piece)
            if (piece.internalLines.length > 0) {
              const ri = nearestCurveIndexAndPoint(local, piece.internalLines)
              if (ri && ri.distance <= 20 && (!best || ri.distance < best.distance)) {
                const t = ri.t ?? 0
                best = {
                  distance: ri.distance,
                  piece,
                  r: { curveIndex: ri.curveIndex, point: ri.point, t },
                  curves: piece.internalLines,
                  onInternalLine: true,
                }
              }
            }
            const hasSeam = piece.seamLine.length >= 3
            const solidIsCut = !hasSeam || cutSeamSwappedSet.has(piece.id)
            const curves = hasSeam && !solidIsCut ? piece.seamLine : piece.cutLine
            if (curves.length === 0) continue
            const snap = findNotchContourSnapOnPiece(
              piece,
              local,
              curves,
              hoverVertexHitMm,
              hoverVertexSeamHitMm,
              hoverCurveMidHitMm,
            )
            const r = snap
              ? {
                  curveIndex: snap.curveIndex,
                  point: snap.point,
                  t: snap.t,
                  distance: 0,
                }
              : nearestCurveIndexAndPoint(local, curves)
            if (!r || r.distance > 20) continue
            const t = r.t ?? 0
            if (!best || r.distance < best.distance) {
              best = {
                distance: r.distance,
                piece,
                r: { curveIndex: r.curveIndex, point: r.point, t },
                curves,
                onInternalLine: false,
              }
            }
          }
          if (best) {
            setHoveredInternalLine(null)
            setHoveredInternalCircle(null)
            const { piece, r, curves, onInternalLine } = best
            const outwardAngle = outwardNormalAngleAt(curves, r.curveIndex, r.t)
            const angle = outwardAngle + 180
            const dist = getNotchMeasurementDistancesOnContour(piece, curves, r.curveIndex, r.t, {
              onInternalLine,
            })
            setNotchPreview({
              pieceId: piece.id,
              position: r.point,
              angle,
              curveIndex: r.curveIndex,
              t: r.t,
              distanceMmLeft: dist.distanceMmLeft,
              distanceMmRight: dist.distanceMmRight,
              storePos: r.point,
              storeAngle: angle,
              onInternalLine,
            })
          } else {
            setNotchPreview(null)
            setHoveredInternalLine(null)
            setHoveredInternalCircle(null)
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
            setHoveredInternalCircle(null)
            setHoveredPieceId(null)
            return
          }
          setHoveredSegment(null)
          setHoveredSegmentPos(null)
          setHoveredInternalLine(null)
          setHoveredInternalCircle(null)
        }
        if (tool === 'point' && selectedPieceIds.length === 1) {
          const world = toWorld(e.clientX, e.clientY)
          const pieceId = selectedPieceIds[0]
          const p = pieces.find((x) => x.id === pieceId)
          if (!p) {
            setPointPreview(null)
          } else {
            const local = worldToPieceLocal(world, p)
            const masterPv = useSeamLineForPointCurveEditing(p) ? p.seamLine : p.cutLine
            const nm = masterPv.length > 0 ? nearestPointForMasterPointEditing(p, local, pointInsertHitMmMove) : null
            const ni =
              p.internalLines.length > 0
                ? nearestInternalLineForPointInsert(p, local, pointInsertHitMmMove)
                : null
            const pick = ni && (!nm || ni.distance < nm.distance - 1e-9) ? ni : nm
            if (pick) setPointPreview({ pieceId: p.id, point: pick.point })
            else setPointPreview(null)
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
            setHoveredInternalLine(null)
          } else {
            const local = worldToPieceLocal(world, p)
            const masterCv = useSeamLineForPointCurveEditing(p) ? p.seamLine : p.cutLine
            const nm = masterCv.length > 0 ? nearestPointForMasterPointEditing(p, local, pointInsertHitMmMove) : null
            const ni =
              p.internalLines.length > 0
                ? nearestInternalLineForPointInsert(p, local, pointInsertHitMmMove)
                : null
            const pickIl = ni && (!nm || ni.distance < nm.distance - 1e-9)
            if (pickIl && ni && p.internalLines[ni.curveIndex]?.type === 'line') {
              setHoveredCurvepointSegment({ pieceId: p.id, curveIndex: ni.curveIndex, internal: true })
              setHoveredInternalLine({ pieceId: p.id, curveIndex: ni.curveIndex })
            } else if (nm && masterCv[nm.curveIndex]?.type === 'line') {
              setHoveredCurvepointSegment({ pieceId: p.id, curveIndex: nm.curveIndex })
              setHoveredInternalLine(null)
            } else {
              setHoveredCurvepointSegment(null)
              setHoveredInternalLine(null)
            }
          }
        } else {
          setHoveredCurvepointSegment(null)
        }
        if (
          tool === 'select' &&
          nahtzuordnungMode !== 'first' &&
          nahtzuordnungMode !== 'second' &&
          nahtzuordnungMode !== 'internal'
        ) {
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
        let deltaAngle = currentWorldAngle - dragging.startWorldAngle
        if (e.shiftKey) {
          const snapStepDeg = 15
          deltaAngle = Math.round(deltaAngle / snapStepDeg) * snapStepDeg
        }
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
        const world = toWorld(e.clientX, e.clientY)
        const local = worldToPieceLocal(world, piece)
        const currentLine = piece.grainLine ?? getPieceGrainLine(piece)
        setGrainLine(dragging.pieceId, grainLineWithMovedEndpoint(currentLine, dragging.which, local))
      } else if (dragging.kind === 'grainLine') {
        const piece = pieces.find((p) => p.id === dragging.pieceId)
        if (!piece || piece.cutLine.length < 3) return
        const world = toWorld(e.clientX, e.clientY)
        const local = worldToPieceLocal(world, piece)
        const dx = local.x - dragging.startLocal.x
        const dy = local.y - dragging.startLocal.y
        const base = dragging.lineAtPointerDown
        setGrainLine(dragging.pieceId, {
          start: { x: base.start.x + dx, y: base.start.y + dy },
          end: { x: base.end.x + dx, y: base.end.y + dy },
        })
      } else if (dragging.kind === 'rectangle') {
        if (rectangleSizeEditor) return
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
        const nextPiece = useStore.getState().workspace.pieces.find((p) => p.id === dragging.pieceId)
        if (nextPiece) {
          setProfileFitPreviews(
            computeProfileFitPreviewsForPiece(nextPiece, useStore.getState().workspace.profileAssignments ?? [])
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
        movePointOnCurve(dragging.pieceId, dragging.curveIndex, dragging.t, target, false, dragging.notchStabilize ? { notchResyncBaseline: dragging.notchStabilize } : undefined)
        const nextPiecePc = useStore.getState().workspace.pieces.find((p) => p.id === dragging.pieceId)
        if (nextPiecePc) {
          setProfileFitPreviews(
            computeProfileFitPreviewsForPiece(nextPiecePc, useStore.getState().workspace.profileAssignments ?? [])
          )
        }
      } else if (dragging.kind === 'internalPointOnCurve') {
        const piece = pieces.find((p) => p.id === dragging.pieceId)
        if (!piece) return
        const local = worldToPieceLocal(toWorld(e.clientX, e.clientY), piece)
        moveInternalLinePointOnCurve(dragging.pieceId, dragging.curveIndex, dragging.t, local)
        const nextPieceIntPc = useStore.getState().workspace.pieces.find((p) => p.id === dragging.pieceId)
        if (nextPieceIntPc) {
          setProfileFitPreviews(
            computeProfileFitPreviewsForPiece(nextPieceIntPc, useStore.getState().workspace.profileAssignments ?? [])
          )
        }
      } else if (dragging.kind === 'internalLineVertex') {
        const piece = pieces.find((p) => p.id === dragging.pieceId)
        if (!piece) return
        let local = worldToPieceLocal(toWorld(e.clientX, e.clientY), piece)
        if (e.altKey) {
          const SNAP_MM = 5
          const start =
            dragging.target.kind === 'junction'
              ? piece.internalLines[dragging.target.j]?.start
              : dragging.target.end === 'start'
                ? piece.internalLines[dragging.target.curveIndex]?.start
                : piece.internalLines[dragging.target.curveIndex]?.end
          if (start) {
            local = {
              x: start.x + Math.round((local.x - start.x) / SNAP_MM) * SNAP_MM,
              y: start.y + Math.round((local.y - start.y) / SNAP_MM) * SNAP_MM,
            }
          }
        }
        moveInternalLineVertex(dragging.pieceId, dragging.target, local)
        const nextPieceIntV = useStore.getState().workspace.pieces.find((p) => p.id === dragging.pieceId)
        if (nextPieceIntV) {
          setProfileFitPreviews(
            computeProfileFitPreviewsForPiece(nextPieceIntV, useStore.getState().workspace.profileAssignments ?? [])
          )
        }
      } else if (dragging.kind === 'line') {
        if (lineLengthEditor?.mode === 'draw' && lineLengthEditor.pieceId === dragging.pieceId) return
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
      } else if (dragging.kind === 'roundCorner') {
        if (cornerRoundEditor) return
        const piece = pieces.find((p) => p.id === dragging.pieceId)
        if (!piece) return
        const world = toWorld(e.clientX, e.clientY)
        const local = worldToPieceLocal(world, piece)
        setDragging((d) => (d && d.kind === 'roundCorner' ? { ...d, currentLocal: local } : d))
      } else if (dragging.kind === 'notchMove') {
        if (notchMoveDistanceEditorRef.current) return
        const piece = pieces.find((p) => p.id === dragging.pieceId)
        const moveNotch = piece?.notches.find((n) => n.id === dragging.notchId)
        if (!piece || !moveNotch) return
        const world = toWorld(e.clientX, e.clientY)
        const local = worldToPieceLocal(world, piece)
        const ctnNm = containerRef.current
        const svgNm = svgRef.current
        const snapHits =
          ctnNm != null ? notchContourSnapHitRadiiMm(ctnNm, svgNm, view, canvasVertexPointUiScale) : undefined
        const movePreviewOpts = (placementCurves: Curve[]): NotchMovePreviewOpts => ({
          local,
          placementCurves,
          snapHits,
        })
        if (isNotchOnInternalLine(moveNotch)) {
          if (piece.internalLines.length === 0) return
          const nearest = nearestCurveIndexAndPoint(local, piece.internalLines)
          if (nearest && nearest.distance < 25) {
            setNotchPreview(buildNotchMovePreview(piece, dragging.notchId, movePreviewOpts(piece.internalLines)))
          } else {
            setNotchPreview(null)
          }
          return
        }
        if (piece.cutLine.length === 0) return
        const hasSeam = piece.seamLine.length >= 3
        const solidIsCut = !hasSeam || cutSeamSwappedSet.has(piece.id)
        const useSeam = hasSeam && !solidIsCut
        const curves = useSeam ? piece.seamLine : piece.cutLine
        const nearest = nearestCurveIndexAndPoint(local, curves)
        if (nearest && nearest.distance < 25) {
          const preview = buildNotchMovePreview(piece, dragging.notchId, movePreviewOpts(curves))
          setNotchPreview(preview)
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
        if (internalCircleRadiusEditor) return
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
      view,
      toWorld,
      setView,
      movePiece,
      pieces,
      updateVertex,
      movePointOnCurve,
      moveInternalLinePointOnCurve,
      moveInternalLineVertex,
      updateNotch,
      toggleNotchAnchor,
      contourEditEnabled,
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
      horizontalLevelPickingActive,
      selectedPieceIds,
      pieceSymmetryState,
      setSymmetryHoverWorld,
      setHoveredSymmetryEdge,
      setHoveredSymmetryInternalIdx,
      rectangleSizeEditor,
      lineLengthEditor,
      internalCircleRadiusEditor,
      cornerRoundEditor,
      canvasRotationUiScale,
      canvasDigitizeUiScale,
      canvasVertexPointUiScale,
      showPivotRotationUi,
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
    setInternalCircleRadiusEditor(null)
    setRectangleSizeEditor(null)
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
    setHoveredInternalCircle(null)
    setHoveredSeamAssignmentId(null)
    setHoveredCurvepointSegment(null)
    setHoveredHorizontalLevelEdge(null)
    closeSegmentMenu()
    setWorkspaceNoteEditor(null)
    setNotchEditTarget(null)
    setNotchEdgeMidMode(false)
    setNotchEdgeLineCountEditor(null)
    setNotchEdgeSpaceMenu(null)
    setNotchMoveDistanceEditor(null)
  }, [closeSegmentMenu])

  useEffect(() => {
    if (tool !== 'notch') {
      setNotchEdgeMidMode(false)
      setNotchEdgeLineCountEditor(null)
      setNotchEdgeSpaceMenu(null)
    }
  }, [tool])

  const notchEdgeLineCountEditorActiveRef = useRef(false)
  useEffect(() => {
    if (notchEdgeLineCountEditor) {
      if (!notchEdgeLineCountEditorActiveRef.current) {
        notchEdgeLineCountEditorActiveRef.current = true
        notchEdgeLineCountInputRef.current?.focus()
        notchEdgeLineCountInputRef.current?.select()
      }
    } else {
      notchEdgeLineCountEditorActiveRef.current = false
    }
  }, [notchEdgeLineCountEditor])

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

  const keydownHandlerRef = useRef<((e: KeyboardEvent) => void) | null>(null)
  keydownHandlerRef.current = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      const layoutOnly = !contourEditEnabled
      if (!inInput && (e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undoAction()
        return
      }
      if (!inInput && (e.ctrlKey || e.metaKey) && (e.key === 'z' && e.shiftKey || e.key === 'y')) {
        e.preventDefault()
        redoAction()
        return
      }
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
      if (!inInput && internalCircleRadiusEditor && e.key === 'Escape') {
        e.preventDefault()
        setInternalCircleRadiusEditor(null)
        setDragging(null)
        setTool('select')
        return
      }
      if (!inInput && cornerRoundEditor && e.key === 'Escape') {
        e.preventDefault()
        setCornerRoundEditor(null)
        setDragging(null)
        return
      }
      if (!inInput && rectangleSizeEditor && e.key === 'Escape') {
        e.preventDefault()
        setRectangleSizeEditor(null)
        setDragging(null)
        setTool('select')
        return
      }
      if (!inInput && notchEdgeLineCountEditor && e.key === 'Escape') {
        e.preventDefault()
        setNotchEdgeLineCountEditor(null)
        return
      }
      if (!inInput && notchMoveDistanceEditor && e.key === 'Escape') {
        e.preventDefault()
        setNotchMoveDistanceEditor(null)
        return
      }
      if (!inInput && (rectangleSizeEditor || internalCircleRadiusEditor || notchEdgeLineCountEditor || cornerRoundEditor) && e.key === ' ') {
        e.preventDefault()
        return
      }
      if (!inInput && notchMoveDistanceEditor && e.key === ' ') {
        e.preventDefault()
        return
      }
      if (
        contourEditEnabled &&
        !inInput &&
        dragging?.kind === 'notchMove' &&
        e.key === ' ' &&
        !notchMoveDistanceEditor
      ) {
        e.preventDefault()
        const piece = pieces.find((p) => p.id === dragging.pieceId)
        const container = containerRef.current
        if (!piece || !container) return
        let preview =
          notchPreview?.pieceId === dragging.pieceId ? notchPreview : null
        if (!preview) {
          preview = buildNotchMovePreview(piece, dragging.notchId)
          if (preview) setNotchPreview(preview)
        }
        if (!preview) {
          setToastMessage('warn: Kerbe konnte nicht auf der Schnittkontur projiziert werden.')
          return
        }
        const notchWorld = pieceLocalToWorld(preview.position, piece)
        const notchClient = worldToClientPoint(notchWorld, container, view, svgRef.current)
        const side: 'left' | 'right' =
          lastPointerClientRef.current.x < notchClient.x ? 'left' : 'right'
        const editor = openNotchMoveDistanceEditorFromPreview(
          piece,
          dragging.notchId,
          preview,
          side,
          lastPointerClientRef.current.x,
          lastPointerClientRef.current.y,
        )
        notchMoveDistanceEditorRef.current = editor
        setNotchMoveDistanceEditor(editor)
        return
      }
      // Eckenrundung: Spacebar während Drag → Eingabefenster für exakten Radius öffnen.
      if (
        !inInput &&
        dragging?.kind === 'roundCorner' &&
        tool === 'roundcorner' &&
        e.key === ' ' &&
        !cornerRoundEditor
      ) {
        e.preventDefault()
        const dx = dragging.currentLocal.x - dragging.cornerLocal.x
        const dy = dragging.currentLocal.y - dragging.cornerLocal.y
        const r = Math.hypot(dx, dy)
        const initial = r >= ROUND_CORNER_MIN_RADIUS_MM ? r : 5
        const piece = pieces.find((p) => p.id === dragging.pieceId)
        const existing = piece?.roundedCorners?.find((rc) => rc.masterVertexIndex === dragging.masterVertexIndex)
        setCornerRoundEditor({
          pieceId: dragging.pieceId,
          masterVertexIndex: dragging.masterVertexIndex,
          cornerLocal: dragging.cornerLocal,
          radiusStr: existing != null ? existing.radiusMm.toFixed(1).replace('.', ',') : initial.toFixed(1).replace('.', ','),
          existing: existing != null,
        })
        return
      }
      if (
        contourEditEnabled &&
        !inInput &&
        dragging?.kind === 'line' &&
        (tool === 'internalLine' || tool === 'line') &&
        e.key === ' '
      ) {
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
          drawTarget: tool === 'line' ? 'contour' : 'internal',
        })
        return
      }
      if (contourEditEnabled && !inInput && dragging?.kind === 'internalCircle' && tool === 'internalCircle' && e.key === ' ') {
        e.preventDefault()
        const { center, current, pieceId } = dragging
        const dx = current.x - center.x
        const dy = current.y - center.y
        const len = Math.hypot(dx, dy)
        const dir =
          len >= 0.01
            ? { x: dx / len, y: dy / len }
            : { x: 1, y: 0 }
        setInternalCircleRadiusEditor({
          pieceId,
          center: { ...center },
          dir,
          radiusStr: len >= 0.5 ? len.toFixed(1) : '10',
        })
        return
      }
      if (contourEditEnabled && !inInput && dragging?.kind === 'rectangle' && tool === 'rectangle' && e.key === ' ') {
        e.preventDefault()
        const dx = dragging.current.x - dragging.start.x
        const dy = dragging.current.y - dragging.start.y
        const signX = dx >= 0 ? 1 : -1
        const signY = dy >= 0 ? 1 : -1
        const aw = Math.abs(dx)
        const ah = Math.abs(dy)
        setRectangleSizeEditor({
          anchor: { ...dragging.start },
          signX,
          signY,
          widthStr: aw >= 1 ? aw.toFixed(1) : '100',
          heightStr: ah >= 1 ? ah.toFixed(1) : '100',
        })
        return
      }
      if (contourEditEnabled && !inInput && hoveredSeamAssignmentId && e.key === ' ') {
        e.preventDefault()
        setSeamAssignmentMetaDialogId(hoveredSeamAssignmentId)
        return
      }
      if (
        contourEditEnabled &&
        !inInput &&
        !dragging &&
        hoveredInternalCircle &&
        !hoveredSeamAssignmentId &&
        e.key === ' '
      ) {
        const piece = pieces.find((p) => p.id === hoveredInternalCircle.pieceId)
        const ic = piece?.internalCircles.find((c) => c.id === hoveredInternalCircle.circleId)
        if (piece && ic) {
          e.preventDefault()
          const dir = { x: 1, y: 0 }
          const current = { x: ic.center.x + dir.x * ic.radius, y: ic.center.y + dir.y * ic.radius }
          setDragging({ kind: 'internalCircle', pieceId: piece.id, center: { ...ic.center }, current })
          setInternalCircleRadiusEditor({
            pieceId: piece.id,
            center: { ...ic.center },
            dir,
            radiusStr: ic.radius >= 0.5 ? ic.radius.toFixed(1) : '10',
            circleId: ic.id,
          })
          return
        }
      }
      if (contourEditEnabled && !inInput && !dragging && tool === 'notch' && e.key === ' ') {
        e.preventDefault()
        if (notchEdgeSpaceMenu) {
          setNotchEdgeSpaceMenu(null)
          return
        }
        setNotchEdgeSpaceMenu({
          clientX: lastPointerClientRef.current.x,
          clientY: lastPointerClientRef.current.y,
        })
        return
      }
      if (contourEditEnabled && !inInput && !dragging && hoveredInternalLine && !hoveredSeamAssignmentId && e.key === ' ') {
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
      if (
        !inInput &&
        e.key === 'Escape' &&
        (edgeSeamPickingActive ||
          edgeAllowancePopover ||
          horizontalLevelPickingActive ||
          pieceSymmetryState ||
          nahtTrimPickCutVertexActive)
      ) {
        e.preventDefault()
        setEdgeAllowancePopover(null)
        setHoveredEdgePicking(null)
        setEdgeSeamPickingActive(false)
        setHoveredHorizontalLevelEdge(null)
        setHorizontalLevelPickingActive(false)
        setPieceSymmetryState(null)
        setSymmetryHoverWorld(null)
        setHoveredSymmetryEdge(null)
        setHoveredSymmetryInternalIdx(null)
        setFlipByEdgeActive(false)
        cancelNahtTrimVertexPick()
        return
      }
      if (!inInput && e.key === 'Escape' && tool === 'profil') {
        e.preventDefault()
        setHoveredProfileEdge(null)
        setTool('select')
        return
      }
      if (!inInput && e.key === 'Escape') {
        if (rotateAroundPivotPieceId) {
          e.preventDefault()
          setPiecePivot(rotateAroundPivotPieceId, null)
          setRotateAroundPivotPieceId(null)
          setDragging((d) => (d?.kind === 'rotate' ? null : d))
          setToastMessage('info:Drehmodus beendet. Drehpunkt wieder auf Teilmitte.')
          return
        }
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
          if (notchEdgeLineCountEditor) {
            setNotchEdgeLineCountEditor(null)
            return
          }
          if (notchEdgeSpaceMenu) {
            setNotchEdgeSpaceMenu(null)
            return
          }
          if (dragging?.kind === 'notch') {
            setDragging(null)
            return
          }
          if (notchEdgeMidMode) {
            setNotchEdgeMidMode(false)
            return
          }
          setTool('select')
          return
        }
        if (tool === 'roundcorner') {
          e.preventDefault()
          if (dragging?.kind === 'roundCorner') {
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
      if (contourEditEnabled && grainFlipHover && !grainContextMenu && !inInput && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault()
        const hoverPiece = pieces.find((p) => p.id === grainFlipHover.pieceId)
        if (isFacingDerivedPiece(hoverPiece)) {
          setToastMessage(
            'info:Kaschierungen werden nur von der Mutter synchronisiert – Nahtzugabe hier nicht editierbar.'
          )
          return
        }
        setHorizontalLevelPickingActive(false)
        setHoveredHorizontalLevelEdge(null)
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
      if (contourEditEnabled && !inInput && hoveredDeletablePoint) {
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
        } else if (hp.kind === 'internalPointOnCurve' && (e.key === 'e' || e.key === 'E')) {
          convertInternalLineBezierToLine(hp.pieceId, hp.curveIndex)
          e.preventDefault()
          return
        } else if (hp.kind === 'internalTerminal' && (e.key === 'c' || e.key === 'C')) {
          const piece = pieces.find((x) => x.id === hp.pieceId)
          if (piece) {
            const curve = piece.internalLines[hp.curveIndex]
            if (curve?.type === 'line') {
              const { start, end } = curve
              const dx = end.x - start.x
              const dy = end.y - start.y
              const cp1 = { x: start.x + dx / 3, y: start.y + dy / 3 }
              const cp2 = { x: start.x + (2 * dx) / 3, y: start.y + (2 * dy) / 3 }
              replaceInternalLineSegmentWithBezier(hp.pieceId, hp.curveIndex, cp1, cp2)
            } else if (curve?.type === 'bezier') {
              setToastMessage('warn:Segment ist bereits eine Kurve.')
            }
          }
          e.preventDefault()
          return
        }
      }
      if (contourEditEnabled && segmentActive && !inInput) {
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
            const parallel = parallelCurveFromSegment(masterSeg, segmentActive.curveIndex, mm)
            if (parallel) addInternalLine(segmentActive.pieceId, parallel)
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
      if (!layoutOnly && (e.key === 'n' || e.key === 'N')) {
        if (!inInput) {
          setTool('notch')
          e.preventDefault()
        }
        return
      }
      if (!layoutOnly && (e.key === 'c' || e.key === 'C')) {
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
        const hoveredPivot = resolvePivotFromHoveredTarget(
          hoveredDeletablePoint,
          hoveredDeletableNotch,
          hoveredInternalLine,
          hoveredInternalCircle,
          world,
          piecesForPivot
        )
        const snapped = hoveredPivot
          ?? (piecesForPivot.length > 0
            ? findPivotSnapTargetAtWorld(world, piecesForPivot, view, svgRef.current, containerRef.current)
            : null)
        if (snapped && selectedPieceIds.includes(snapped.pieceId)) {
          setPiecePivot(snapped.pieceId, snapped.pivotLocal)
          setRotateAroundPivotPieceId(snapped.pieceId)
          setToastMessage('success:Drehpunkt gesetzt. Drehmodus aktiv (Maus ziehen, Escape/Abbrechen beendet).')
        } else if (piecesForPivot.length === 0) {
          setToastMessage('error:Teil auswählen, dann Maus auf Punkt/Kerbe/interne Elemente/Laufrichtung — Alt+D.')
        } else {
          setToastMessage(
            'error:Maus näher an Zielpunkt (Ecke, Kerbe, interner Endpunkt, Laufrichtung, Kreis/Bohrung) und Alt+D.'
          )
        }
        e.preventDefault()
        return
      }
      if (!layoutOnly && (e.key === 'p' || e.key === 'P')) {
        if (!inInput) {
          setTool('point')
          e.preventDefault()
        }
        return
      }
      if (!layoutOnly && (e.key === 'k' || e.key === 'K')) {
        if (!inInput) {
          setTool('kante')
          e.preventDefault()
        }
        return
      }
      if (!layoutOnly && (e.key === 'm' || e.key === 'M')) {
        if (!inInput) {
          setTool('massstab')
          e.preventDefault()
        }
        return
      }
      if (!layoutOnly && (e.key === 'd' || e.key === 'D')) {
        if (!inInput && !e.altKey) {
          setTool('digitize')
          startDigitize()
          e.preventDefault()
        }
        return
      }
      if (!layoutOnly && (e.key === 's' || e.key === 'S')) {
        if (!inInput) {
          setPendingNahtzugabeClick(true)
          e.preventDefault()
        }
        return
      }
      if (!layoutOnly && (e.key === 'l' || e.key === 'L') && !inInput && !grainFlipHover) {
        e.preventDefault()
        setHorizontalLevelPickingActive(false)
        setHoveredHorizontalLevelEdge(null)
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
      if (contourEditEnabled && (e.key === 'f' || e.key === 'F') && !inInput) {
        e.preventDefault()
        if (selectedPieceIds.length !== 1) {
          setToastMessage('warn:Bitte genau ein Teil auswählen.')
          return
        }
        const pieceId = selectedPieceIds[0]
        setHoveredSymmetryEdge(null)
        setHoveredSymmetryInternalIdx(null)
        setFlipByEdgeActive(true)
        setPieceSymmetryState({ pieceId, phase: 'pickEdge' })
        return
      }
      if (contourEditEnabled && (e.key === 'e' || e.key === 'E') && !inInput && tool === 'select' && hoveredDeletableNotch && !dragging) {
        e.preventDefault()
        setNotchEditTarget({
          pieceId: hoveredDeletableNotch.pieceId,
          notchId: hoveredDeletableNotch.notchId,
        })
        return
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (contourEditEnabled && !inInput && batchSelectionTargets.length > 0) {
        e.preventDefault()
        batchDeleteFiltered()
        return
      }
      if (contourEditEnabled && workspaceImageSelected && imageDigitizeSession && !hoveredDeletablePoint) {
        e.preventDefault()
        cancelImageSession()
        return
      }
      if (contourEditEnabled && hoveredSeamAssignmentId) {
        e.preventDefault()
        removeSeamAssignment(hoveredSeamAssignmentId)
        setHoveredSeamAssignmentId(null)
        return
      }
      if (contourEditEnabled && hoveredDeletableNotch) {
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
      if (contourEditEnabled && hoveredInternalCircle) {
        e.preventDefault()
        removeInternalCircle(hoveredInternalCircle.pieceId, hoveredInternalCircle.circleId)
        setHoveredInternalCircle(null)
        return
      }
      if (contourEditEnabled && hoveredDeletablePoint?.kind === 'internalPointOnCurve') {
        e.preventDefault()
        convertInternalLineBezierToLine(hoveredDeletablePoint.pieceId, hoveredDeletablePoint.curveIndex)
        setHoveredDeletablePoint(null)
        return
      }
      if (contourEditEnabled && hoveredInternalLine && !hoveredDeletablePoint) {
        e.preventDefault()
        removeInternalLine(hoveredInternalLine.pieceId, hoveredInternalLine.curveIndex)
        setHoveredInternalLine(null)
        return
      }
      if (!contourEditEnabled || !hoveredDeletablePoint) return
      e.preventDefault()
      if (hoveredDeletablePoint.kind === 'vertex') {
        removeVertex(hoveredDeletablePoint.pieceId, hoveredDeletablePoint.vertexIndex)
      } else if (hoveredDeletablePoint.kind === 'pointOnCurve') {
        convertBezierSegmentToLine(hoveredDeletablePoint.pieceId, hoveredDeletablePoint.curveIndex)
      }
      setHoveredDeletablePoint(null)
  }
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => keydownHandlerRef.current?.(e)
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const handlePointerUp = useCallback((_e?: React.PointerEvent) => {
    if (_e?.pointerType === 'touch') {
      activeTouchPointsRef.current.delete(_e.pointerId)
      if (activeTouchPointsRef.current.size < 2) pinchStartRef.current = null
      if (dragging?.kind === 'pan' && touchPanPointerIdRef.current === _e.pointerId) {
        setDragging(null)
        touchPanPointerIdRef.current = null
      }
      if (activeTouchPointsRef.current.size === 0) {
        touchPanPointerIdRef.current = null
      } else {
        return
      }
    }
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
      if (rectangleSizeEditorRef.current) {
        setDragging(null)
        setHoveredPieceId(null)
        return
      }
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
      if (lineLengthEditorRef.current && lineLengthEditorRef.current.pieceId === pieceId) {
        setDragging(null)
        setHoveredPieceId(null)
        return
      }
      const piece = pieces.find((p) => p.id === pieceId)
      if (piece) {
        const len = Math.hypot(current.x - start.x, current.y - start.y)
        if (len >= 0.5) {
          if (tool === 'internalLine') {
            setLineLengthEditor({
              mode: 'draw',
              pieceId,
              start: { ...start },
              current: { ...current },
              value: len.toFixed(1),
              drawTarget: 'internal',
            })
          } else {
            addCurveToCutLine(pieceId, { type: 'line', start, end: current })
          }
        }
        setTool('select')
      }
    } else if (dragging?.kind === 'notchMove') {
      if (notchMoveDistanceEditorRef.current) {
        setDragging(null)
        setHoveredPieceId(null)
        return
      }
      if (notchPreview && notchPreview.pieceId === dragging.pieceId) {
        const movePiece = pieces.find((p) => p.id === dragging.pieceId)
        if (movePiece && notchPreview.onInternalLine && movePiece.internalLines.length > 0) {
          const L = internalLineSegmentPathLength(
            movePiece.internalLines,
            notchPreview.curveIndex,
            notchPreview.t,
          )
          const segLen = internalLineSegmentTotalLength(movePiece.internalLines, notchPreview.curveIndex)
          updateNotch(dragging.pieceId, dragging.notchId, {
            internalLineIndex: notchPreview.curveIndex,
            internalSNormalized: segLen > 0 ? L / segLen : undefined,
            internalArcLengthMm: segLen > 0 ? L : undefined,
            position: notchPreview.storePos,
            angle: notchPreview.storeAngle,
          })
        } else if (movePiece && movePiece.cutLine.length > 0) {
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
      const { pieceId, position, current, curveIndex, t, useSeamLine, onInternalLine } = dragging
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
        const id = 'n' + Math.random().toString(36).slice(2, 9)
        if (onInternalLine && piece.internalLines.length > 0) {
          const intCurves = piece.internalLines
          let angle: number
          if (notchModelType === 'single') {
            angle = outwardNormalAngleAt(intCurves, curveIndex, t) + 180
          } else if (isDrag) {
            angle = (Math.atan2(dy, dx) * 180) / Math.PI
          } else {
            angle = outwardNormalAngleAt(intCurves, curveIndex, t) + 180
          }
          if (!isInternalNotchSpacingValid(piece, curveIndex, t)) {
            setToastMessage(
              'error: Zwischen zwei Kerben auf internen Linien müssen mindestens 4 mm Abstand liegen.'
            )
            setDragging(null)
            setTool('notch')
            return
          }
          const notchPos = nearestCurveIndexAndPoint(position, intCurves)?.point ?? position
          const L = internalLineSegmentPathLength(intCurves, curveIndex, t)
          const segLen = internalLineSegmentTotalLength(intCurves, curveIndex)
          addNotch(pieceId, {
            id,
            position: notchPos,
            angle,
            type: notchModelType,
            depth: defaultDepth,
            width: defaultWidth,
            internalLineIndex: curveIndex,
            internalSNormalized: segLen > 0 ? L / segLen : undefined,
            internalArcLengthMm: segLen > 0 ? L : undefined,
          })
          setDragging(null)
          setHoveredPieceId(null)
          return
        }
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
      if (internalCircleRadiusEditorRef.current) {
        setDragging(null)
        setHoveredPieceId(null)
        return
      }
      const { pieceId, center, current } = dragging
      const piece = pieces.find((p) => p.id === pieceId)
      if (piece) {
        const r = Math.hypot(current.x - center.x, current.y - center.y)
        if (r >= 0.5) {
          addInternalCircle(pieceId, { center: { ...center }, radius: r })
        }
        setTool('select')
      }
    } else if (dragging?.kind === 'roundCorner') {
      if (cornerRoundEditorRef.current) {
        setDragging(null)
        setHoveredPieceId(null)
        return
      }
      const { pieceId, masterVertexIndex, cornerLocal, currentLocal } = dragging
      const r = Math.hypot(currentLocal.x - cornerLocal.x, currentLocal.y - cornerLocal.y)
      if (r >= ROUND_CORNER_MIN_RADIUS_MM) {
        roundCorner(pieceId, masterVertexIndex, Math.min(ROUND_CORNER_MAX_RADIUS_MM, r))
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
    if (_e && dragging?.kind === 'grainLine' && !_e.shiftKey) {
      const pieceSnap = useStore.getState().workspace.pieces.find((p) => p.id === dragging.pieceId)
      if (pieceSnap && pieceSnap.cutLine.length >= 3) {
        const currentLine = pieceSnap.grainLine ?? getPieceGrainLine(pieceSnap)
        const snapped = snapGrainLineToContourEdge(currentLine, pieceSnap.cutLine, GRAIN_SNAP_TO_EDGE_MM)
        if (snapped) setGrainLine(dragging.pieceId, snapped)
      }
    }
    const profileFitDragKinds = new Set(['vertex', 'pointOnCurve', 'internalLineVertex', 'internalPointOnCurve'])
    if (dragging && profileFitDragKinds.has(dragging.kind) && 'pieceId' in dragging) {
      const nextPiece = useStore.getState().workspace.pieces.find((p) => p.id === dragging.pieceId)
      if (nextPiece) {
        const previews = computeProfileFitPreviewsForPiece(
          nextPiece,
          useStore.getState().workspace.profileAssignments ?? []
        )
        if (previews.length > 0) {
          setProfileFitPreviews(previews)
          setProfileFitConfirm({ pieceId: dragging.pieceId, previews })
        } else {
          setProfileFitPreviews([])
          setProfileFitConfirm(null)
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
    addInternalCircle,
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
    applyProfileLengthFitPreviews,
    snapSeamEdgeToMatch,
    lineLengthEditor,
    rectangleSizeEditor,
    internalCircleRadiusEditor,
    cornerRoundEditor,
    roundCorner,
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
      onPointerCancel={handlePointerUp}
      onPointerLeave={() => {
        handlePointerUp()
        activeTouchPointsRef.current.clear()
        pinchStartRef.current = null
        touchPanPointerIdRef.current = null
        setHoveredDeletablePoint(null)
        setHoveredDeletableNotch(null)
        if (!notchMoveDistanceEditorRef.current) {
          setNotchPreview(null)
        }
        setPointPreview(null)
        setHoveredSeamForNahtzuordnung(null)
        setHoveredSeamAssignmentId(null)
        setHoveredInternalLine(null)
        setHoveredInternalCircle(null)
        setHoveredPivotForRotationPieceId(null)
        setHoveredRotationRingPieceId(null)
        setHoveredRotationHandlePieceId(null)
      }}
      onWheel={handleWheel}
      style={{
        ['--canvas-bg' as string]: T.background,
        touchAction: 'none',
        cursor:
          rulerMode
            ? 'crosshair'
            : dragging?.kind === 'rotate'
              ? 'grabbing'
              : (hoveredRotationRingPieceId != null || hoveredRotationHandlePieceId != null) && tool === 'select'
                ? 'grab'
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
      } as React.CSSProperties}
    >
      <div className="workspace-version">V. 1.0.0</div>
      <CanvasToolbar />
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
                fontSize: fs(13),
                fontFamily: 'system-ui, sans-serif',
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            >
              <span style={{ fontWeight: 600, color: '#1565c0' }}>Kerbe bearbeiten</span>
              <span style={{ fontSize: fs(11), color: '#666' }}>
                ⌥/Alt+Klick oder ⌘+Klick (Mac), sonst E mit Cursor auf Kerbe
              </span>
              <span
                style={{
                  fontSize: fs(11),
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
                  style={{ fontSize: fs(13), minWidth: 220, maxWidth: 360 }}
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
              {isNotchOnInternalLine(editNotch) ? (
                <span style={{ fontSize: fs(11), color: '#555', maxWidth: 280 }}>
                  Interne Linie – Kerbe erscheint nicht im DXF-Schnitt. Rolle begrenzt Profilsegmente auf der
                  internen Polylinie.
                </span>
              ) : null}
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
                role="group"
                aria-label="Naht-Rolle"
              >
                <span style={{ whiteSpace: 'nowrap' }}>Naht-Rolle</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {(
                    [
                      { key: null, label: 'Keine' },
                      { key: 'nahtanfang', label: NOTCH_ROLE_LABELS.nahtanfang },
                      { key: 'nahtende', label: NOTCH_ROLE_LABELS.nahtende },
                      { key: 'beides', label: NOTCH_ROLE_LABELS.beides },
                    ] satisfies ReadonlyArray<{ key: NotchRole | null; label: string }>
                  ).map(({ key, label }) => {
                    const selected = key == null ? editNotch.role == null : editNotch.role === key
                    return (
                      <button
                        key={key ?? 'none'}
                        type="button"
                        className="sidebar-btn"
                        style={{
                          fontSize: fs(12),
                          padding: '4px 10px',
                          border: selected ? '2px solid #1565c0' : '1px solid #bdbdbd',
                          background: selected ? 'rgba(21,101,192,0.08)' : '#fff',
                        }}
                        onClick={() => {
                          updateNotch(editPiece.id, editNotch.id, {
                            role: key == null ? undefined : key,
                          })
                        }}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
              {matchedPreset === null && (
                <span style={{ fontSize: fs(11), color: '#c62828', maxWidth: 280 }}>
                  Kein exakter Treffer zu den 10 Einstellungen (z. B. Doppel-Kerbe). Bitte Preset wählen.
                </span>
              )}
              <button
                type="button"
                className="sidebar-btn"
                style={{ fontSize: fs(12), padding: '4px 10px' }}
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
            fontSize: fs(13),
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
              style={{ fontSize: fs(13) }}
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
          <span style={{ fontSize: fs(12), color: '#666' }}>Markierung (nur Anzeige):</span>
          <button
            type="button"
            style={{ padding: '4px 8px', fontSize: fs(12), cursor: 'pointer' }}
            onClick={() => setBatchUiHighlightForFiltered('#ff9800')}
          >
            Orange
          </button>
          <button
            type="button"
            style={{ padding: '4px 8px', fontSize: fs(12), cursor: 'pointer' }}
            onClick={() => setBatchUiHighlightForFiltered('#e91e63')}
          >
            Magenta
          </button>
          <button
            type="button"
            style={{ padding: '4px 8px', fontSize: fs(12), cursor: 'pointer' }}
            onClick={() => setBatchUiHighlightForFiltered('#2e7d32')}
          >
            Grün
          </button>
          <button type="button" style={{ padding: '4px 8px', fontSize: fs(12), cursor: 'pointer' }} onClick={() => clearBatchUiHighlight()}>
            Markierung aus
          </button>
          <span style={{ color: '#999' }}>|</span>
          <span style={{ fontSize: fs(12), color: '#666' }}>Eckpunkte:</span>
          <button type="button" style={{ padding: '4px 8px', fontSize: fs(12), cursor: 'pointer' }} onClick={() => batchSetVerticesSoft(true)}>
            weich (blau)
          </button>
          <button type="button" style={{ padding: '4px 8px', fontSize: fs(12), cursor: 'pointer' }} onClick={() => batchSetVerticesSoft(false)}>
            fest (rot)
          </button>
          <span style={{ color: '#999' }}>|</span>
          <button
            type="button"
            style={{ padding: '4px 8px', fontSize: fs(12), cursor: 'pointer' }}
            onClick={() => {
              if (window.confirm('Ausgewählte Elemente (gefiltert) wirklich löschen?')) batchDeleteFiltered()
            }}
          >
            Löschen
          </button>
          <button type="button" style={{ padding: '4px 8px', fontSize: fs(12), cursor: 'pointer' }} onClick={() => clearBatchSelection()}>
            Auswahl aufheben
          </button>
          <span style={{ fontSize: fs(11), color: '#888', width: '100%', marginTop: 2 }}>
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
                fontSize: fs(13),
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
                    fontSize: fs(13),
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
                    fontSize: fs(13),
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
      {grainContextMenu && (() => {
        const menuPiece = pieces.find((p) => p.id === grainContextMenu.pieceId)
        const isFacingPiece = isFacingDerivedPiece(menuPiece)
        const menuBtnStyle: React.CSSProperties = {
          display: 'block',
          width: '100%',
          padding: '6px 16px',
          background: 'none',
          border: 'none',
          textAlign: 'left',
          cursor: 'pointer',
          fontSize: fs(13),
        }
        return (
        <div
          role="menu"
          aria-label="Laufrichtung"
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
              fontSize: fs(13),
              fontFamily: 'sans-serif',
            }}
          >
            {!isFacingPiece && (
              <button
                type="button"
                style={menuBtnStyle}
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
            )}
            <button
              type="button"
              style={menuBtnStyle}
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
              title={
                isFacingPiece
                  ? 'Kopie als unabhängiges Teil (ohne Sync zur Mutter)'
                  : undefined
              }
              style={menuBtnStyle}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              onClick={() => {
                const piece = pieces.find((p) => p.id === grainContextMenu.pieceId)
                if (!piece) return
                if (isFacingDerivedPiece(piece)) {
                  // Snapshot ohne Abhängigkeit – sonst entstünde nur eine zweite Sync-Tochter
                  const { facingParentId: _fp, kind: _k, ...rest } = piece
                  addPiece({
                    ...rest,
                    id: undefined,
                    number: undefined,
                    name: piece.name.endsWith(' (Kopie)') ? piece.name : `${piece.name} (Kopie)`,
                    kind: undefined,
                    facingParentId: undefined,
                  })
                } else {
                  addPiece({
                    ...piece,
                    id: undefined,
                    number: undefined,
                    name: piece.name,
                  })
                }
                setGrainContextMenu(null)
                setGrainFlipHover(null)
              }}
            >
              Teil kopieren
            </button>
            {!isFacingPiece && (
              <button
                type="button"
                title="Abhängiges Kaschierungsteil neben der Mutter anlegen (Kontur folgt der Mutter)"
                style={menuBtnStyle}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                onClick={() => {
                  createFacingPiece(grainContextMenu.pieceId)
                  setGrainContextMenu(null)
                  setGrainFlipHover(null)
                }}
              >
                Kaschierung erzeugen
              </button>
            )}
            <button
              type="button"
              style={menuBtnStyle}
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
        )
      })()}
      {pieceContextMenu && (
        <div
          role="menu"
          aria-label="Teil-Aktionen"
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
              fontSize: fs(13),
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
                fontSize: fs(13),
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
                fontSize: fs(13),
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
                fontSize: fs(13),
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
            fontSize: fs(13),
            fontFamily: 'sans-serif',
          }}
        >
          <div style={{ padding: '4px 12px', color: '#666', borderBottom: '1px solid #eee', marginBottom: 6 }}>
            Kante
            {segmentMenuPinned && (
              <span style={{ marginLeft: 6, fontSize: fs(11), color: '#999' }}>· Leertaste zum Lösen</span>
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
                fontSize: fs(13),
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
                const parallel = parallelCurveFromSegment(masterSeg, segmentForMenu.curveIndex, mm)
                if (parallel) addInternalLine(segmentForMenu.pieceId, parallel)
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
        role="img"
        aria-label="Schnittmuster-Arbeitsfläche"
        width="100%"
        height="100%"
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block' }}
      >
        {showGrid && (
          <>
            <defs>
              <pattern
                id="grid"
                width={GRID_SIZE}
                height={GRID_SIZE}
                patternUnits="userSpaceOnUse"
              >
                <path d={`M ${GRID_SIZE} 0 V ${GRID_SIZE * 100} M 0 ${GRID_SIZE} H ${GRID_SIZE * 100}`} fill="none" stroke={T.grid.stroke} strokeWidth={T.grid.strokeWidth} />
              </pattern>
            </defs>
            <g transform={`translate(${view.panX},${view.panY})`}>
              <rect width="10000" height="10000" x="-5000" y="-5000" fill="url(#grid)" opacity={T.grid.opacity} />
            </g>
          </>
        )}
        <defs>
          <pattern
            id="facing-hatch-light"
            width="10"
            height="10"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="10" height="10" fill="#e8d4bc" />
            <path d="M0 0 H10" stroke="#9a6b3f" strokeWidth="2.2" opacity="0.55" />
          </pattern>
          <pattern
            id="facing-hatch-dark"
            width="10"
            height="10"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="10" height="10" fill="#3d3228" />
            <path d="M0 0 H10" stroke="#c4a882" strokeWidth="2.2" opacity="0.5" />
          </pattern>
        </defs>
        <g transform={`translate(${view.panX},${view.panY}) scale(${view.zoom})`}>
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
                          stroke={session.locked ? T.workspaceImage.borderLocked : T.workspaceImage.border}
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
                              fill={T.workspaceImage.handleFill}
                              stroke={T.workspaceImage.handleStroke}
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
          {showContourChangePreview &&
            (contourHistoryPreviewPathsDeduped.length > 0 || contourDragGhostPath) && (
              <g className="contour-change-preview" pointerEvents="none" aria-hidden>
                {contourHistoryPreviewPathsDeduped.map((row) => {
                  const z = 1 / Math.max(view.zoom, 1e-6)
                  return (
                    <g key={row.key} transform={row.transform}>
                      <path
                        d={row.d}
                        fill="none"
                        stroke={row.stroke}
                        strokeWidth={T.piece.strokeWidthChangePreview * z}
                        opacity={row.opacity}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  )
                })}
                {contourDragGhostPath && (() => {
                  const z = 1 / Math.max(view.zoom, 1e-6)
                  return (
                    <g transform={contourDragGhostPath.transform}>
                      <path
                        d={contourDragGhostPath.d}
                        fill="none"
                        stroke={T.piece.strokeChangePreview}
                        strokeWidth={T.piece.strokeWidthChangePreview * z}
                        opacity={0.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  )
                })()}
              </g>
            )}
          {pieces.map((piece) => {
            return (
            <PieceGroup
              key={piece.id}
              piece={piece}
              viewZoom={view.zoom}
              rotationUiScale={canvasRotationUiScale}
              textUiScale={uiTextScale}
              isSelected={selectedPieceIds.includes(piece.id)}
              isDialogHovered={seamAdjustmentHoverPieceId === piece.id}
              isHovered={hoveredPieceId === piece.id}
              hoveredSegmentCurveIndex={effectiveSegmentForHighlight?.pieceId === piece.id ? effectiveSegmentForHighlight.curveIndex : null}
              hoveredSegmentOnSeam={
                effectiveSegmentForHighlight != null &&
                effectiveSegmentForHighlight.pieceId === piece.id &&
                useSeamLineForPointCurveEditing(piece) &&
                (tool === 'kante' ||
                  (tool === 'curvepoint' &&
                    hoveredCurvepointSegment != null &&
                    !hoveredCurvepointSegment.internal &&
                    hoveredCurvepointSegment.pieceId === effectiveSegmentForHighlight.pieceId &&
                    hoveredCurvepointSegment.curveIndex === effectiveSegmentForHighlight.curveIndex))
              }
              hoveredInternalLineCurveIndex={hoveredInternalLine?.pieceId === piece.id ? hoveredInternalLine.curveIndex : null}
              hoveredInternalCircleId={
                hoveredInternalCircle?.pieceId === piece.id ? hoveredInternalCircle.circleId : null
              }
              onPointerDown={handlePointerDown}
              cutSeamSwapped={cutSeamSwappedSet.has(piece.id)}
              showGrain={showGrain}
              showGrainDragHandles={
                !contourEditEnabled && selectedPieceIds.includes(piece.id) && showGrain
              }
              grainArrowDraggable={!contourEditEnabled}
              showNotches={showNotches}
              showDrills={showDrills}
              showInternalLines={showInternalLines}
              showPieceNames={showPieceNames}
              showContourMeasurements={showContourMeasurements}
              showPivotRotationUi={showPivotRotationUi}
              showRotationRing={
                selectedPieceIds.includes(piece.id) &&
                (hoveredPivotForRotationPieceId === piece.id ||
                  rotateAroundPivotPieceId === piece.id ||
                  (dragging != null && dragging.kind === 'rotate'))
              }
              isRotationRingHovered={hoveredRotationRingPieceId === piece.id}
              isRotationHandleHovered={hoveredRotationHandlePieceId === piece.id}
              isRotationActive={dragging != null && dragging.kind === 'rotate' && dragging.pieceId === piece.id}
              notchIdBeingDragged={
                notchPreview?.pieceId === piece.id
                  ? dragging?.kind === 'notchMove' && dragging.pieceId === piece.id
                    ? dragging.notchId
                    : notchMoveDistanceEditor?.pieceId === piece.id
                      ? notchMoveDistanceEditor.notchId
                      : null
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
              themeMode={canvasThemeMode}
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
                  <circle r={11} cx={0} cy={0} fill={T.workspaceNote.fill} stroke={T.workspaceNote.stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                  <path
                    d="M -4,-3 L 4,-3 L 4,5 L 0,2 L -4,5 Z"
                    fill="none"
                    stroke={T.workspaceNote.pinStroke}
                    strokeWidth={1.2}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )
            })}
          {profileFitPreviews.map((preview) => {
            const pa = profileAssignments.find((a) => a.id === preview.assignmentId)
            const piece = pa ? pieces.find((p) => p.id === pa.pieceId) : null
            if (!piece) return null
            const tx = `translate(${piece.transform.x},${piece.transform.y}) rotate(${piece.transform.rotation}) scale(${piece.transform.mirrored ? -1 : 1},1)`
            const adj = preview.adjust
            const pos =
              adj.kind === 'endNotch'
                ? adj.position
                : adj.kind === 'endVertex'
                  ? adj.position
                  : adj.position
            const angle = adj.kind === 'endNotch' ? adj.angle : 0
            const stroke = '#e65100'
            const [a, b, c] =
              adj.kind === 'endNotch'
                ? notchTriangleCorners(pos, angle, 4, 6)
                : [pos, pos, pos]
            return (
              <g key={preview.assignmentId} transform={tx} pointerEvents="none" opacity={0.85}>
                {adj.kind === 'endNotch' ? (
                  <>
                    <path
                      d={`M ${a.x} ${a.y} L ${b.x} ${b.y} L ${c.x} ${c.y} Z`}
                      fill={stroke}
                      fillOpacity={0.2}
                      stroke={stroke}
                      strokeWidth={1}
                      strokeDasharray="4 3"
                      vectorEffect="non-scaling-stroke"
                    />
                  </>
                ) : (
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={4}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={1.2}
                    strokeDasharray="4 3"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                <text
                  x={pos.x}
                  y={pos.y - 10}
                  textAnchor="middle"
                  fontSize={ct(7)}
                  fill={stroke}
                  fontFamily="sans-serif"
                  fontWeight="700"
                >
                  Profil {preview.profileKey}: {preview.targetLengthMm} mm
                </text>
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
            if (notchPreview.onInternalLine && piece.internalLines.length > 0) {
              const intNearest = nearestCurveIndexAndPoint(notchPreview.position, piece.internalLines)
              const posOnInt = intNearest?.point ?? notchPreview.position
              const intAnchor = intNearest
                ? { curveIndex: intNearest.curveIndex, t: intNearest.t ?? 0 }
                : { curveIndex: notchPreview.curveIndex, t: notchPreview.t }
              const angleOnInt = intNearest
                ? outwardNormalAngleAt(piece.internalLines, intNearest.curveIndex, intNearest.t ?? 0) + 180
                : notchPreview.angle
              const intCutPts = notchCutoutPoints(
                posOnInt,
                angleOnInt,
                depth,
                width,
                piece.internalLines,
                intAnchor,
                previewNotchType
              )
              const intPaths = intCutPts
                ? notchCutoutSvgPaths(intCutPts)
                : (() => {
                    const [a, b, c] = notchTriangleCorners(posOnInt, angleOnInt, depth, width)
                    return {
                      fillD: `M ${a.x} ${a.y} L ${b.x} ${b.y} L ${c.x} ${c.y} Z`,
                      edgesD: `M ${a.x} ${a.y} L ${c.x} ${c.y} L ${b.x} ${b.y}`,
                    }
                  })()
              const labelOffset = 14
              const fontSize = ct(7)
              return (
                <g transform={tx} pointerEvents="none">
                  {intPaths.fillD ? (
                    <path d={intPaths.fillD} fill={T.notch.fill} fillOpacity={0.55} stroke="none" />
                  ) : null}
                  <path
                    d={intPaths.edgesD}
                    fill="none"
                    stroke={NOTCH_STROKE}
                    strokeWidth={0.75}
                    strokeLinejoin="round"
                  />
                  <text
                    x={posOnInt.x - labelOffset}
                    y={posOnInt.y}
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
                    x={posOnInt.x + labelOffset}
                    y={posOnInt.y}
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
            }
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
            const fontSize = ct(7)
            const previewIsLine = previewCutPts?.kind === 'line'
            return (
              <g transform={tx} pointerEvents="none">
                {seamPreviewPaths?.fillD ? (
                  <path d={seamPreviewPaths.fillD} fill={T.notch.fill} fillOpacity={0.55} stroke="none" />
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
                {fillD ? <path d={fillD} fill={T.notch.fill} stroke="none" /> : null}
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
          {contourEditEnabled && pointPreview && (() => {
            const piece = pieces.find((p) => p.id === pointPreview.pieceId)
            if (!piece) return null
            const w = pieceLocalToWorld(pointPreview.point, piece)
            const vpS = Math.min(2.5, Math.max(0.5, canvasVertexPointUiScale))
            const ps = (1 / Math.max(view.zoom, 1e-6)) * vpS
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
          {contourEditEnabled &&
            (showPoints || tool === 'notch') &&
            (tool === 'select' || tool === 'point' || tool === 'curvepoint' || tool === 'notch') &&
            (() => {
              const vpS = Math.min(2.5, Math.max(0.5, canvasVertexPointUiScale))
              const ps = (1 / Math.max(view.zoom, 1e-6)) * vpS
              const HOVER_SCALE = 1.3
              return selectedPieceIds.flatMap((pieceId) => {
                const piece = pieces.find((p) => p.id === pieceId)
                if (!piece || isFacingDerivedPiece(piece)) return []
                const useSeamMaster = useSeamLineForVertexEditing(piece)
                const displayedMaster = piece ? getDisplayedMasterCurves(piece) : null
                const curvesForVertices = displayedMaster?.curves ?? (useSeamMaster ? piece!.seamLine : piece?.cutLine ?? [])
                if (!piece || curvesForVertices.length === 0) return []
                const n = curvesForVertices.length
                const softOnMaster = masterSoftVertexIndexSet(piece)
                const tangentSoftVertices = new Set<number>()
                for (const ar of displayedMaster?.applied ?? []) {
                  tangentSoftVertices.add(ar.t1VertexIndex)
                  tangentSoftVertices.add(ar.t2VertexIndex)
                }
                return Array.from({ length: n }, (_, vi) => {
                  const vertexPos = vi === 0 ? curvesForVertices[0].start : curvesForVertices[vi - 1].end
                  const w = pieceLocalToWorld(vertexPos, piece)
                  const sc = piece.symmetryConstraint
                  const vtxHp = sc ? vertexHalfPlane(vertexPos, sc.axisA, sc.axisB, sc.keepSide) : 'keep'
                  const symVertexOpacity = vtxHp === 'mirror' ? T.piece.symmetryMirrorVertexOpacity : 1
                  const isSoft =
                    tangentSoftVertices.has(vi) ||
                    (useSeamMaster ? softOnMaster.has(vi) : (piece.softVertices ?? []).includes(vi))
                  const isHoveredPt = hoveredDeletablePoint?.pieceId === pieceId && hoveredDeletablePoint.kind === 'vertex' && hoveredDeletablePoint.vertexIndex === vi
                  const [fill, stroke] = isSoft ? COLOR_SOFT_PUNKT : COLOR_ECKPUNKT
                  const scale = isHoveredPt ? HOVER_SCALE : 1
                  const r = POINT_SCREEN_R * ps * scale
                  const eckSize = POINT_SCREEN_RECT * ps * scale
                  const sw = POINT_SCREEN_STROKE * ps * (isHoveredPt ? 1.3 : 1)
                  return isSoft ? (
                    <circle
                      key={`${pieceId}-v-${vi}`}
                      cx={w.x}
                      cy={w.y}
                      r={r}
                      fill={isHoveredPt ? stroke : fill}
                      stroke={stroke}
                      strokeWidth={sw}
                      opacity={symVertexOpacity}
                      pointerEvents="none"
                    />
                  ) : (
                    <rect
                      key={`${pieceId}-v-${vi}`}
                      x={w.x - eckSize / 2}
                      y={w.y - eckSize / 2}
                      width={eckSize}
                      height={eckSize}
                      fill={isHoveredPt ? stroke : fill}
                      stroke={stroke}
                      strokeWidth={sw}
                      opacity={symVertexOpacity}
                      pointerEvents="none"
                    />
                  )
                })
              })
            })()
          }
          {/* Kurvenpunkte (Bézier-Mitte): bei Nahtzugabe auf Nahtlinie, sonst Schnittkontur */}
          {contourEditEnabled &&
            (showPoints || tool === 'notch') &&
            (tool === 'select' || tool === 'point' || tool === 'curvepoint' || tool === 'notch') &&
            (() => {
              const vpS = Math.min(2.5, Math.max(0.5, canvasVertexPointUiScale))
              const ps = (1 / Math.max(view.zoom, 1e-6)) * vpS
              const HOVER_SCALE = 1.3
              return selectedPieceIds.flatMap((pieceId) => {
                const piece = pieces.find((p) => p.id === pieceId)
                if (!piece || isFacingDerivedPiece(piece)) return []
                const curvesDraw = getDisplayedMasterCurves(piece).curves
                const [fill, stroke] = COLOR_PUNKT_AUF_KURVE
                return curvesDraw.flatMap((c, ci) => {
                  if (c.type !== 'bezier') return []
                  const ptOnCurve = bezierAt(c, 0.5)
                  const w = pieceLocalToWorld(ptOnCurve, piece)
                  const isHoveredPt = hoveredDeletablePoint?.pieceId === pieceId && hoveredDeletablePoint.kind === 'pointOnCurve' && hoveredDeletablePoint.curveIndex === ci
                  const scale = isHoveredPt ? HOVER_SCALE : 1
                  return [
                    <circle
                      key={`${pieceId}-oncurve-${ci}`}
                      cx={w.x}
                      cy={w.y}
                      r={POINT_SCREEN_R * ps * scale}
                      fill={isHoveredPt ? stroke : fill}
                      stroke={stroke}
                      strokeWidth={POINT_SCREEN_STROKE * ps * (isHoveredPt ? 1.3 : 1)}
                      pointerEvents="none"
                    />,
                  ]
                })
              })
            })()}
          {/* Interne Linien: Eckpunkte (blau = eingefügte Verbindung) und Kurvenpunkt (Bézier-Mitte) */}
          {contourEditEnabled &&
            showPoints &&
            showInternalLines !== false &&
            (tool === 'select' || tool === 'point' || tool === 'curvepoint') &&
            (() => {
              const vpS = Math.min(2.5, Math.max(0.5, canvasVertexPointUiScale))
              const ps = (1 / Math.max(view.zoom, 1e-6)) * vpS
              const HOVER_SCALE = 1.3
              const nodes: React.ReactNode[] = []
              for (const pieceId of selectedPieceIds) {
                const piece = pieces.find((p) => p.id === pieceId)
                if (!piece || isFacingDerivedPiece(piece) || piece.internalLines.length === 0) continue
                const lines = piece.internalLines
                const n = lines.length
                const softJ = new Set(piece.internalLineSoftJunctions ?? [])
                const hp = hoveredDeletablePoint
                const pushVertex = (
                  reactKey: string,
                  local: Point,
                  isSoft: boolean,
                  isHovered: boolean
                ) => {
                  const w = pieceLocalToWorld(local, piece)
                  const [fill, stroke] = isSoft ? COLOR_SOFT_PUNKT : COLOR_ECKPUNKT
                  const scale = isHovered ? HOVER_SCALE : 1
                  const r = POINT_SCREEN_R * ps * scale
                  const eckSize = POINT_SCREEN_RECT * ps * scale
                  const sw = POINT_SCREEN_STROKE * ps * (isHovered ? 1.3 : 1)
                  nodes.push(
                    isSoft ? (
                      <circle
                        key={reactKey}
                        cx={w.x}
                        cy={w.y}
                        r={r}
                        fill={isHovered ? stroke : fill}
                        stroke={stroke}
                        strokeWidth={sw}
                        pointerEvents="none"
                      />
                    ) : (
                      <rect
                        key={reactKey}
                        x={w.x - eckSize / 2}
                        y={w.y - eckSize / 2}
                        width={eckSize}
                        height={eckSize}
                        fill={isHovered ? stroke : fill}
                        stroke={stroke}
                        strokeWidth={sw}
                        pointerEvents="none"
                      />
                    )
                  )
                }
                pushVertex(
                  `il-${pieceId}-t0s`,
                  lines[0].start,
                  false,
                  hp?.pieceId === pieceId &&
                    hp.kind === 'internalTerminal' &&
                    hp.curveIndex === 0 &&
                    hp.end === 'start'
                )
                for (let j = 1; j < n; j++) {
                  const jp = lines[j].start
                  if (internalLineEndpointsTouch(lines[j - 1].end, lines[j].start)) {
                    pushVertex(
                      `il-${pieceId}-jj${j}`,
                      jp,
                      softJ.has(j),
                      hp?.pieceId === pieceId && hp.kind === 'internalJunction' && hp.j === j
                    )
                  } else {
                    pushVertex(
                      `il-${pieceId}-brk-${j}-a`,
                      lines[j - 1].end,
                      false,
                      hp?.pieceId === pieceId &&
                        hp.kind === 'internalTerminal' &&
                        hp.curveIndex === j - 1 &&
                        hp.end === 'end'
                    )
                    pushVertex(
                      `il-${pieceId}-brk-${j}-b`,
                      jp,
                      false,
                      hp?.pieceId === pieceId &&
                        hp.kind === 'internalTerminal' &&
                        hp.curveIndex === j &&
                        hp.end === 'start'
                    )
                  }
                }
                pushVertex(
                  `il-${pieceId}-tne`,
                  lines[n - 1].end,
                  false,
                  hp?.pieceId === pieceId &&
                    hp.kind === 'internalTerminal' &&
                    hp.curveIndex === n - 1 &&
                    hp.end === 'end'
                )
                const [fillC, strokeC] = COLOR_PUNKT_AUF_KURVE
                for (let ci = 0; ci < n; ci++) {
                  const c = lines[ci]
                  if (c.type !== 'bezier') continue
                  const ptOnCurve = bezierAt(c, 0.5)
                  const w = pieceLocalToWorld(ptOnCurve, piece)
                  const isHoveredPt =
                    hp?.pieceId === pieceId && hp.kind === 'internalPointOnCurve' && hp.curveIndex === ci
                  const scale = isHoveredPt ? HOVER_SCALE : 1
                  nodes.push(
                    <circle
                      key={`il-${pieceId}-poc-${ci}`}
                      cx={w.x}
                      cy={w.y}
                      r={POINT_SCREEN_R * ps * scale}
                      fill={isHoveredPt ? strokeC : fillC}
                      stroke={strokeC}
                      strokeWidth={POINT_SCREEN_STROKE * ps * (isHoveredPt ? 1.3 : 1)}
                      pointerEvents="none"
                    />
                  )
                }
              }
              return nodes
            })()}
          {/* Digitalisierung: Linien/Kurven, Punkte, Handles, Vorschau, Close-Indikator */}
          {tool === 'digitize' && digitizeState && digitizeState.nodes.length > 0 && (() => {
            const digS = Math.min(2.5, Math.max(0.5, canvasDigitizeUiScale))
            const dps = (1 / Math.max(view.zoom, 1e-6)) * digS
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
                    stroke={T.digitize.segment} strokeWidth={T.digitize.segmentWidth}
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
                    fill="none" stroke={T.digitize.segment} strokeWidth={T.digitize.segmentWidth}
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
                      stroke={T.digitize.handleLine} strokeWidth={0.5} strokeDasharray="2 1.5" opacity={0.7} />
                    <line x1={n.point.x} y1={n.point.y} x2={reflected.x} y2={reflected.y}
                      stroke={T.digitize.handleLine} strokeWidth={0.5} strokeDasharray="2 1.5" opacity={0.5} />
                    <circle
                      cx={n.handleOut.x}
                      cy={n.handleOut.y}
                      r={DIGITIZE_HANDLE_R * dps}
                      fill={T.digitize.handleFill}
                      stroke={T.digitize.handleStroke}
                      strokeWidth={0.5 * dps}
                    />
                    <circle
                      cx={reflected.x}
                      cy={reflected.y}
                      r={DIGITIZE_HANDLE_REFLECT_R * dps}
                      fill="none"
                      stroke={T.digitize.handleReflectStroke}
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
                    stroke={T.digitize.preview} strokeWidth={T.digitize.previewWidth}
                    strokeDasharray="3 2" opacity={0.5}
                  />
                )}
                {nodes.map((n, i) => (
                  <circle
                    key={`dig-pt-${i}`}
                    cx={n.point.x}
                    cy={n.point.y}
                    r={(i === 0 && digitizeNearFirst ? DIGITIZE_NODE_R_NEAR : DIGITIZE_NODE_R) * dps}
                    fill={i === 0 && digitizeNearFirst ? T.digitize.nodeNearClose : T.digitize.nodeDefault}
                    stroke={i === 0 && digitizeNearFirst ? T.digitize.nodeNearCloseStroke : T.digitize.nodeDefaultStroke}
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
              stroke={T.dragPreview.stroke}
              strokeWidth={T.dragPreview.strokeWidth}
              strokeDasharray={T.dragPreview.dash}
              pointerEvents="none"
            />
          )}
          {dragging?.kind === 'roundCorner' && (() => {
            const piece = pieces.find((p) => p.id === dragging.pieceId)
            if (!piece) return null
            const useSeamMaster = useSeamLineForVertexEditing(piece)
            const master = useSeamMaster ? piece.seamLine : piece.cutLine
            if (master.length < 3) return null
            const dx = dragging.currentLocal.x - dragging.cornerLocal.x
            const dy = dragging.currentLocal.y - dragging.cornerLocal.y
            const r = Math.hypot(dx, dy)
            if (r < ROUND_CORNER_MIN_RADIUS_MM) {
              const cw = pieceLocalToWorld(dragging.cornerLocal, piece)
              return (
                <circle
                  cx={cw.x}
                  cy={cw.y}
                  r={3 / Math.max(view.zoom, 1e-6)}
                  fill="rgba(21,101,192,0.6)"
                  stroke="#1565c0"
                  strokeWidth={1 / Math.max(view.zoom, 1e-6)}
                  pointerEvents="none"
                />
              )
            }
            const validation = validateCornerRound(master, dragging.masterVertexIndex, r)
            if (!validation.ok) return null
            // Bestehende Rundungen + diese Vorschau-Rundung kombinieren.
            const existing = (piece.roundedCorners ?? []).filter(
              (rc) => rc.masterVertexIndex !== dragging.masterVertexIndex
            )
            const previewMaster = applyCornerRoundings(master, [
              ...existing,
              { masterVertexIndex: dragging.masterVertexIndex, radiusMm: r },
            ]).curves
            // In Welt-Koordinaten konvertieren
            const worldCurves = previewMaster.map((c) => {
              const start = pieceLocalToWorld(c.start, piece)
              const end = pieceLocalToWorld(c.end, piece)
              if (c.type === 'line') return { type: 'line' as const, start, end }
              return {
                type: 'bezier' as const,
                start,
                end,
                cp1: pieceLocalToWorld(c.cp1, piece),
                cp2: pieceLocalToWorld(c.cp2, piece),
              }
            })
            const cornerWorld = pieceLocalToWorld(dragging.cornerLocal, piece)
            return (
              <g pointerEvents="none">
                <path
                  d={curveToPathD(worldCurves, { closed: true })}
                  fill="none"
                  stroke="#1565c0"
                  strokeWidth={2 / Math.max(view.zoom, 1e-6)}
                  strokeDasharray={`${4 / Math.max(view.zoom, 1e-6)} ${3 / Math.max(view.zoom, 1e-6)}`}
                />
                <circle
                  cx={cornerWorld.x}
                  cy={cornerWorld.y}
                  r={3 / Math.max(view.zoom, 1e-6)}
                  fill="#ef5350"
                  stroke="#b71c1c"
                  strokeWidth={1 / Math.max(view.zoom, 1e-6)}
                />
              </g>
            )
          })()}
          {dragging?.kind === 'selectionMarquee' && (
            <rect
              x={Math.min(dragging.start.x, dragging.current.x)}
              y={Math.min(dragging.start.y, dragging.current.y)}
              width={Math.abs(dragging.current.x - dragging.start.x)}
              height={Math.abs(dragging.current.y - dragging.start.y)}
              fill={T.selection.marqueeFill}
              stroke={T.selection.marqueeStroke}
              strokeWidth={T.selection.marqueeStrokeWidth}
              strokeDasharray="5 3"
              pointerEvents="none"
            />
          )}
          {contourEditEnabled &&
            filteredBatchTargets.length > 0 &&
            filteredBatchTargets.map((t) => {
              const piece = pieces.find((p) => p.id === t.pieceId)
              if (!piece) return null
              const key = batchTargetKey(t)
              const hi = batchUiHighlightByTargetId[key]
              const ringStroke = hi ?? T.batch.ringStroke
              const ringFill = hi ? `${hi}55` : 'none'
              const psBase = 1 / Math.max(view.zoom, 1e-6)
              const vpRing = Math.min(2.5, Math.max(0.5, canvasVertexPointUiScale))
              const psV = psBase * vpRing
              const tx = `translate(${piece.transform.x},${piece.transform.y}) rotate(${piece.transform.rotation}) scale(${piece.transform.mirrored ? -1 : 1},1)`
              if (t.kind === 'vertex') {
                const w = getVertexWorldForBatchHighlight(piece, t.vertexIndex)
                if (!w) return null
                return (
                  <circle
                    key={key}
                    cx={w.x}
                    cy={w.y}
                    r={(POINT_SCREEN_R + 2.5) * psV}
                    fill={ringFill}
                    stroke={ringStroke}
                    strokeWidth={1.2 * psV}
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
                    r={(POINT_SCREEN_R + 2.5) * psV}
                    fill={ringFill}
                    stroke={ringStroke}
                    strokeWidth={1.2 * psV}
                    pointerEvents="none"
                  />
                )
              }
              if (t.kind === 'notch') {
                const n = piece.notches.find((x) => x.id === t.notchId)
                if (!n) return null
                const notchPos =
                  isNotchOnInternalLine(n) && piece.internalLines.length > 0
                    ? getNotchPositionAndAngleOnInternalLine(n, piece.internalLines)
                    : getNotchPositionAndAngleOnCutLine(n, piece.cutLine, piece.seamLine)
                const w = pieceLocalToWorld(notchPos?.position ?? n.position, piece)
                return (
                  <circle
                    key={key}
                    cx={w.x}
                    cy={w.y}
                    r={5 * psBase}
                    fill={ringFill}
                    stroke={ringStroke}
                    strokeWidth={1.2 * psBase}
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
                      strokeWidth={T.internalLine.strokeWidthHover * psBase}
                      strokeDasharray={scaleSvgDashArray(T.internalLine.dash, psBase)}
                      opacity={0.95}
                    />
                  </g>
                )
              }
              if (t.kind === 'piece') {
                const b = boundsForPieceCutLineWorld(piece)
                if (!b) return null
                const pad = 2 * psBase
                return (
                  <rect
                    key={key}
                    x={b.minX - pad}
                    y={b.minY - pad}
                    width={b.maxX - b.minX + 2 * pad}
                    height={b.maxY - b.minY + 2 * pad}
                    fill={ringFill}
                    stroke={ringStroke}
                    strokeWidth={1.4 * psBase}
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
            const lps = 1 / Math.max(view.zoom, 1e-6)
            return (
              <line
                x1={w1.x}
                y1={w1.y}
                x2={w2.x}
                y2={w2.y}
                stroke={T.dragPreview.stroke}
                strokeWidth={T.dragPreview.strokeWidth * lps}
                strokeDasharray={scaleSvgDashArray(T.dragPreview.dash, lps)}
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
                {fillD ? <path d={fillD} fill={T.notch.fill} stroke="none" /> : null}
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
                stroke={T.drill.stroke}
                strokeWidth={T.drill.strokeWidth}
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
            const cps = 1 / Math.max(view.zoom, 1e-6)
            return (
              <circle
                cx={wc.x}
                cy={wc.y}
                r={wr}
                fill="none"
                stroke={T.internalLine.stroke}
                strokeWidth={T.internalLine.strokeWidth * cps}
                strokeDasharray={scaleSvgDashArray(T.internalLine.dash, cps)}
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
                  stroke={T.ruler.stroke}
                  strokeWidth={1.2 * rps}
                />
                <circle
                  cx={start.x}
                  cy={start.y}
                  r={POINT_SCREEN_R * rps}
                  fill={T.ruler.endpointFill}
                  stroke={T.ruler.endpointStroke}
                  strokeWidth={POINT_SCREEN_STROKE * rps}
                />
                <circle
                  cx={end.x}
                  cy={end.y}
                  r={POINT_SCREEN_R * rps}
                  fill={T.ruler.endpointFill}
                  stroke={T.ruler.endpointStroke}
                  strokeWidth={POINT_SCREEN_STROKE * rps}
                />
                <text x={mx} y={my - 6} textAnchor="middle" fontSize={ct(10)} fill={T.ruler.text} fontWeight="600">
                  {len.toFixed(1)} mm
                </text>
              </g>
            )
          })()}
          {nahtzuordnungMode === 'internal' && hoveredInternalSeamForNahtzuordnung && (() => {
            const piece = pieces.find((p) => p.id === hoveredInternalSeamForNahtzuordnung.pieceId)
            if (!piece) return null
            const hoverRange =
              hoveredInternalSeamForNahtzuordnung.startNotchId || hoveredInternalSeamForNahtzuordnung.endNotchId
                ? {
                    startNotchId: hoveredInternalSeamForNahtzuordnung.startNotchId ?? '',
                    endNotchId: hoveredInternalSeamForNahtzuordnung.endNotchId ?? '',
                  }
                : null
            const curves = getInternalProfileCurvesInRange(
              piece,
              hoveredInternalSeamForNahtzuordnung.curveIndices,
              hoverRange
            )
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
                key="nahtzuordnung-internal-hover"
                d={d}
                fill="none"
                stroke={T.seamAssignment.hoverStroke}
                strokeWidth={T.seamAssignment.hoverWidth}
                strokeOpacity={0.9}
                pointerEvents="none"
              />
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
                stroke={T.seamAssignment.hoverStroke}
                strokeWidth={T.seamAssignment.hoverWidth}
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
              <g key="edge-picking-hover">
                <path
                  d={d}
                  fill="none"
                  stroke={T.seamAssignment.edgePickHalo}
                  strokeWidth={T.seamAssignment.edgePickHaloWidth}
                  strokeOpacity={T.seamAssignment.edgePickHaloOpacity}
                  pointerEvents="none"
                />
                <path
                  d={d}
                  fill="none"
                  stroke={T.seamAssignment.edgePickStroke}
                  strokeWidth={T.seamAssignment.edgePickWidth}
                  strokeOpacity={0.9}
                  pointerEvents="none"
                />
              </g>
            )
          })()}
          {tool === 'profil' && hoveredProfileEdge && (() => {
            const piece = pieces.find((p) => p.id === hoveredProfileEdge.pieceId)
            if (!piece) return null
            const hoverRange =
              hoveredProfileEdge.startNotchId || hoveredProfileEdge.endNotchId
                ? {
                    startNotchId: hoveredProfileEdge.startNotchId,
                    endNotchId: hoveredProfileEdge.endNotchId,
                  }
                : null
            const curves = hoveredProfileEdge.onInternalLine
              ? getInternalProfileCurvesInRange(piece, hoveredProfileEdge.curveIndices, hoverRange)
              : getEdgeCurvesInNotchRange(
                  piece,
                  hoveredProfileEdge.curveIndices,
                  hoverRange,
                  getCurvesForSeamEdge(piece)
                )
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
                stroke={T.accent.profile}
                strokeWidth={2.2}
                strokeOpacity={0.9}
                pointerEvents="none"
              />
            )
          })()}
          {pieceSymmetryState?.phase === 'pickEdge' &&
            hoveredSymmetryEdge &&
            selectedPieceIds[0] === pieceSymmetryState.pieceId &&
            (() => {
              const piece = pieces.find((p) => p.id === hoveredSymmetryEdge.pieceId)
              if (!piece) return null
              const masterK = getCurvesForSeamEdge(piece)
              const curves = hoveredSymmetryEdge.curveIndices.map((ci) => masterK[ci]).filter(Boolean)
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
                <g key="piece-symmetry-edge-hover">
                  <path
                    d={d}
                    fill="none"
                    stroke={T.seamAssignment.edgePickHalo}
                    strokeWidth={T.seamAssignment.edgePickHaloWidth}
                    strokeOpacity={T.seamAssignment.edgePickHaloOpacity}
                    pointerEvents="none"
                  />
                  <path
                    d={d}
                    fill="none"
                    stroke="#0d9488"
                    strokeWidth={3.5}
                    strokeOpacity={0.95}
                    pointerEvents="none"
                  />
                  {(() => {
                    const ed = enumerateEdges(piece).find((e) => e.edgeIndex === hoveredSymmetryEdge.edgeIndex)
                    if (!ed || masterEdgeIsStraightLine(masterK, ed)) return null
                    const wSnap = pieceLocalToWorld(hoveredSymmetryEdge.snapPointLocal, piece)
                    const seg = masterK[hoveredSymmetryEdge.curveHitIndex]
                    let tx = 1
                    let ty = 0
                    if (seg?.type === 'line') {
                      const dx = seg.end.x - seg.start.x
                      const dy = seg.end.y - seg.start.y
                      const len = Math.hypot(dx, dy)
                      if (len > 1e-9) {
                        tx = dx / len
                        ty = dy / len
                      }
                    } else if (seg?.type === 'bezier') {
                      const d = bezierDerivativeAt(seg, hoveredSymmetryEdge.curveHitT)
                      const len = Math.hypot(d.x, d.y)
                      if (len > 1e-9) {
                        tx = d.x / len
                        ty = d.y / len
                      }
                    }
                    const sl = hoveredSymmetryEdge.snapPointLocal
                    const localA = { x: sl.x - tx * 45, y: sl.y - ty * 45 }
                    const localB = { x: sl.x + tx * 45, y: sl.y + ty * 45 }
                    const wa = pieceLocalToWorld(localA, piece)
                    const wb = pieceLocalToWorld(localB, piece)
                    return (
                      <>
                        <line
                          x1={wa.x}
                          y1={wa.y}
                          x2={wb.x}
                          y2={wb.y}
                          stroke="#f59e0b"
                          strokeWidth={2}
                          strokeDasharray="5 4"
                          strokeOpacity={0.95}
                          pointerEvents="none"
                        />
                        <circle
                          cx={wSnap.x}
                          cy={wSnap.y}
                          r={4}
                          fill="#f59e0b"
                          stroke="#fff"
                          strokeWidth={1.2}
                          pointerEvents="none"
                        />
                      </>
                    )
                  })()}
                </g>
              )
            })()}
          {pieceSymmetryState?.phase === 'pickInternalLine' &&
            hoveredSymmetryInternalIdx != null &&
            selectedPieceIds[0] === pieceSymmetryState.pieceId &&
            (() => {
              const piece = pieces.find((p) => p.id === pieceSymmetryState.pieceId)
              if (!piece) return null
              const seg = piece.internalLines[hoveredSymmetryInternalIdx]
              if (!seg) return null
              const ws = pieceLocalToWorld(seg.start, piece)
              const we = pieceLocalToWorld(seg.end, piece)
              let d = ''
              if (seg.type === 'line') {
                d = `M ${ws.x} ${ws.y} L ${we.x} ${we.y}`
              } else {
                const wc1 = pieceLocalToWorld(seg.cp1, piece)
                const wc2 = pieceLocalToWorld(seg.cp2, piece)
                d = `M ${ws.x} ${ws.y} C ${wc1.x} ${wc1.y} ${wc2.x} ${wc2.y} ${we.x} ${we.y}`
              }
              return (
                <path
                  key="piece-symmetry-internal-hover"
                  d={d}
                  fill="none"
                  stroke="#0d9488"
                  strokeWidth={3.2}
                  strokeDasharray="6 4"
                  pointerEvents="none"
                  opacity={0.95}
                />
              )
            })()}
          {pieceSymmetryState && selectedPieceIds[0] === pieceSymmetryState.pieceId && (() => {
            const piece = pieces.find((p) => p.id === pieceSymmetryState.pieceId)
            if (!piece || !pieceSymmetryState.axisA) return null
            const wa = pieceLocalToWorld(pieceSymmetryState.axisA, piece)
            if (pieceSymmetryState.phase === 'pickSide' && pieceSymmetryState.axisB) {
              const a = pieceSymmetryState.axisA
              const b = pieceSymmetryState.axisB
              const clipped = symmetryAxisClippedToPieceBounds(a, b, piece.cutLine)
              if (!clipped) return null
              const w1 = pieceLocalToWorld(clipped.p1, piece)
              const w2 = pieceLocalToWorld(clipped.p2, piece)
              return (
                <line
                  key="piece-symmetry-axis"
                  x1={w1.x}
                  y1={w1.y}
                  x2={w2.x}
                  y2={w2.y}
                  stroke="#0d9488"
                  strokeWidth={2.8}
                  strokeDasharray="7 5"
                  pointerEvents="none"
                  opacity={0.95}
                />
              )
            }
            if (pieceSymmetryState.phase === 'axisB' && symmetryHoverWorld) {
              return (
                <g key="piece-symmetry-preview">
                  <line
                    x1={wa.x}
                    y1={wa.y}
                    x2={symmetryHoverWorld.x}
                    y2={symmetryHoverWorld.y}
                    stroke="#0d9488"
                    strokeWidth={2.8}
                    strokeDasharray="7 5"
                    pointerEvents="none"
                    opacity={0.9}
                  />
                  <circle cx={wa.x} cy={wa.y} r={4} fill="#0d9488" pointerEvents="none" />
                </g>
              )
            }
            return null
          })()}
          {horizontalLevelPickingActive && hoveredHorizontalLevelEdge && (() => {
            const piece = pieces.find((p) => p.id === hoveredHorizontalLevelEdge.pieceId)
            if (!piece) return null
            const masterK = getCurvesForSeamEdge(piece)
            const curves = hoveredHorizontalLevelEdge.curveIndices.map((ci) => masterK[ci]).filter(Boolean)
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
              <g key="horizontal-level-hover">
                <path
                  d={d}
                  fill="none"
                  stroke={T.seamAssignment.edgePickHalo}
                  strokeWidth={T.seamAssignment.edgePickHaloWidth}
                  strokeOpacity={T.seamAssignment.edgePickHaloOpacity}
                  pointerEvents="none"
                />
                <path
                  d={d}
                  fill="none"
                  stroke="#0d9488"
                  strokeWidth={3.5}
                  strokeOpacity={0.95}
                  pointerEvents="none"
                />
              </g>
            )
          })()}
          {showProfiles && profileAssignments.length > 0 && profileAssignments.map((pa) => {
            const piece = pieces.find((p) => p.id === pa.pieceId)
            if (!piece) return null
            const masterK = getCurvesForSeamEdge(piece)
            const curves = getProfileAssignmentDisplayCurves(piece, pa)
            if (curves.length === 0) return null

            const PROFILE_LINE_OFFSET = PROFILE_DISPLAY_OFFSET_MM
            const outSign = pa.onInternalLine
              ? 1
              : signedAreaCurves(masterK) >= 0
                ? -1
                : 1

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

            const lengthMm = pa.targetLengthMm ?? profileAssignmentLengthMm(piece, pa)
            const labelParts: string[] = []
            if (pa.supplierNumber) labelParts.push(pa.supplierNumber)
            if (pa.internalArticleNumber) labelParts.push(pa.internalArticleNumber)
            labelParts.push(`${lengthMm.toFixed(1)} mm`)
            const detailText = labelParts.join(' · ')
            const profileStroke = strokeColorForProfileKey(pa.profileKey, canvasThemeMode === 'dark')

            return (
              <g key={`profile-${pa.id}`} pointerEvents="none">
                <path
                  d={d}
                  fill="none"
                  stroke={profileStroke}
                  strokeWidth={1.2}
                  strokeOpacity={0.7}
                  strokeDasharray="4 3"
                />
                <text
                  x={keyW.x}
                  y={keyW.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={profileStroke}
                  fontSize={ct(4.2)}
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
                  fill={profileStroke}
                  fontSize={ct(2.7)}
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
          {showSeamPruefanzeigen &&
            seamAssignments.length > 0 &&
            seamAssignments.map((a: SeamAssignment) => {
              if (isInternalSeamAssignment(a)) {
                const pieceA = pieces.find((p) => p.id === a.pieceIdA)
                if (!pieceA || pieceA.internalLines.length === 0) return null
                const curves = getInternalSeamAssignmentCurves(pieceA, a)
                if (curves.length === 0) return null
                let d = ''
                for (const seg of curves) {
                  const ws = pieceLocalToWorld(seg.start, pieceA)
                  const we = pieceLocalToWorld(seg.end, pieceA)
                  if (seg.type === 'line') {
                    d += `M ${ws.x} ${ws.y} L ${we.x} ${we.y} `
                  } else {
                    const wc1 = pieceLocalToWorld(seg.cp1, pieceA)
                    const wc2 = pieceLocalToWorld(seg.cp2, pieceA)
                    d += `M ${ws.x} ${ws.y} C ${wc1.x} ${wc1.y} ${wc2.x} ${wc2.y} ${we.x} ${we.y} `
                  }
                }
                const len = curves.reduce((sum, s) => sum + curveSegmentArcLength(s, 0, 1), 0)
                const midResult = pointAtPathLength(curves, len / 2)
                const midLocal = midResult
                  ? midResult.point
                  : curveMidpoint(curves[Math.floor(curves.length / 2)])
                const midW = pieceLocalToWorld(midLocal, pieceA)
                const metaParts: string[] = []
                if (a.orderNumber != null) metaParts.push(String(a.orderNumber))
                if (a.seamKind) metaParts.push(SEAM_ASSIGNMENT_KIND_LABELS[a.seamKind])
                const metaText = metaParts.join(' · ')
                return (
                  <g
                    key={a.id}
                    pointerEvents="stroke"
                    onPointerEnter={() => setHoveredSeamAssignmentId(a.id)}
                    onPointerLeave={() => setHoveredSeamAssignmentId(null)}
                    style={{ cursor: hoveredSeamAssignmentId === a.id ? 'pointer' : 'default' }}
                  >
                    <title>Leertaste: Nummer und Nahtart · Backspace/Entf: Zuordnung löschen</title>
                    <path
                      d={d}
                      fill="none"
                      stroke={T.seamAssignment.connector}
                      strokeWidth={T.seamAssignment.connectorWidth}
                      strokeDasharray="4 3"
                      pointerEvents="stroke"
                    />
                    {metaText && (
                      <text
                        x={midW.x}
                        y={midW.y - 8}
                        textAnchor="middle"
                        fontSize={ct(8)}
                        fill={T.seamAssignment.connector}
                        fontWeight="600"
                        fontFamily="sans-serif"
                        pointerEvents="none"
                      >
                        {metaText}
                      </text>
                    )}
                  </g>
                )
              }
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

              const metrics = getSeamAssignmentDisplayMetrics(a, pieceA, pieceB)
              if (!metrics) return null

              const {
                diffMm,
                notchCountA,
                notchCountB,
                notchMismatch,
                subPairing,
                subDiffs,
                subSegMismatch,
              } = metrics
              const showLengthDiff = diffMm >= 0.1
              const midResultA = pointAtPathLength(segsA, metrics.lenA / 2)
              const midResultB = pointAtPathLength(segsB, metrics.lenB / 2)
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
                    stroke={T.seamAssignment.connector}
                    strokeWidth={T.seamAssignment.connectorWidth}
                    strokeDasharray="6 4"
                    pointerEvents="none"
                  />
                  <path
                    d={`M ${wing1.x} ${wing1.y} L ${midB.x} ${midB.y} L ${wing2.x} ${wing2.y}`}
                    fill="none"
                    stroke={T.seamAssignment.connector}
                    strokeWidth={T.seamAssignment.connectorWidth}
                    pointerEvents="none"
                  />
                  {showLengthDiff && (
                    <text
                      x={labelX}
                      y={labelY}
                      textAnchor="middle"
                      fontSize={ct(9)}
                      fill={T.accent.error}
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
                      fontSize={ct(9)}
                      fill={T.accent.warning}
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
                      fontSize={ct(9)}
                      fill={T.accent.warning}
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
                      fontSize={ct(8)}
                      fill={T.seamAssignment.connector}
                      fontWeight="600"
                      fontFamily="sans-serif"
                      pointerEvents="none"
                    >
                      {metaText}
                    </text>
                  )}
                  {subDiffs && subDiffs.map((sd, i) => {
                    const isMatch = Math.abs(sd.lenA - sd.lenB) < 0.1
                    const color = isMatch ? T.accent.success : T.accent.error
                    const labelA = isMatch ? '✓' : `${sd.lenA.toFixed(1)}`
                    const labelB = isMatch ? '✓' : `${sd.lenB.toFixed(1)}`
                    const subMidA = pieceLocalToWorld(sd.midA, pieceA)
                    const subMidB = pieceLocalToWorld(sd.midB, pieceB)
                    return (
                      <g key={`sub-${i}`} pointerEvents="none">
                        <text x={subMidA.x} y={subMidA.y - 5} textAnchor="middle" fontSize={ct(8)} fill={color} fontWeight="600" fontFamily="sans-serif">{labelA}</text>
                        <text x={subMidB.x} y={subMidB.y - 5} textAnchor="middle" fontSize={ct(8)} fill={color} fontWeight="600" fontFamily="sans-serif">{labelB}</text>
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
          fontSize: fs(12),
          fontWeight: 600,
          zIndex: 9998,
          pointerEvents: 'none',
          maxWidth: 280,
          textAlign: 'right',
        }}>
          Nach dem Loslassen: Laenge in mm. Leertaste: schon waehrend des Ziehens
        </div>
      )}
      {(dragging?.kind === 'line' && tool === 'line' && !lineLengthEditor) && (
        <div style={{
          position: 'absolute',
          top: 16,
          right: 16,
          background: 'rgba(21,101,192,0.92)',
          color: '#fff',
          padding: '6px 10px',
          borderRadius: 6,
          fontSize: fs(12),
          fontWeight: 600,
          zIndex: 9998,
          pointerEvents: 'none',
        }}>
          Leertaste: feste Laenge setzen
        </div>
      )}
      {(dragging?.kind === 'internalCircle' && tool === 'internalCircle' && !internalCircleRadiusEditor) && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'rgba(21,101,192,0.92)',
            color: '#fff',
            padding: '6px 10px',
            borderRadius: 6,
            fontSize: fs(12),
            fontWeight: 600,
            zIndex: 9998,
            pointerEvents: 'none',
          }}
        >
          Leertaste: Radius eingeben
        </div>
      )}
      {(dragging?.kind === 'roundCorner' && tool === 'roundcorner' && !cornerRoundEditor) && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'rgba(21,101,192,0.92)',
            color: '#fff',
            padding: '6px 10px',
            borderRadius: 6,
            fontSize: fs(12),
            fontWeight: 600,
            zIndex: 9998,
            pointerEvents: 'none',
          }}
        >
          Leertaste: Radius eingeben
        </div>
      )}
      {(dragging?.kind === 'rectangle' && tool === 'rectangle' && !rectangleSizeEditor) && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'rgba(21,101,192,0.92)',
            color: '#fff',
            padding: '6px 10px',
            borderRadius: 6,
            fontSize: fs(12),
            fontWeight: 600,
            zIndex: 9998,
            pointerEvents: 'none',
          }}
        >
          Leertaste: Breite und Hoehe eingeben
        </div>
      )}
      {contourEditEnabled && !dragging && tool === 'notch' && notchEdgeMidMode && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'rgba(21,101,192,0.92)',
            color: '#fff',
            padding: '6px 10px',
            borderRadius: 6,
            fontSize: fs(12),
            fontWeight: 600,
            zIndex: 9998,
            pointerEvents: 'none',
            maxWidth: 320,
            textAlign: 'right',
          }}
        >
          Gerade Kante anklicken (Mitte) — max. 20 mm zur Kante — Escape: abbrechen
        </div>
      )}
      {rotateAroundPivotPieceId && tool === 'select' && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'rgba(13,71,161,0.94)',
            color: '#fff',
            padding: '8px 10px',
            borderRadius: 6,
            fontSize: fs(12),
            fontWeight: 600,
            zIndex: 10002,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
          onPointerDown={(ev) => ev.stopPropagation()}
        >
          Drehmodus aktiv: Maus ziehen dreht um gesetzten Drehpunkt
          <button
            type="button"
            onClick={() => {
              if (rotateAroundPivotPieceId) setPiecePivot(rotateAroundPivotPieceId, null)
              setRotateAroundPivotPieceId(null)
              setDragging((d) => (d?.kind === 'rotate' ? null : d))
            }}
            style={{
              border: '1px solid rgba(255,255,255,0.75)',
              background: 'rgba(255,255,255,0.12)',
              color: '#fff',
              borderRadius: 4,
              padding: '3px 8px',
              fontSize: fs(12),
              cursor: 'pointer',
            }}
          >
            Abbrechen
          </button>
        </div>
      )}
      {notchEdgeSpaceMenu && tool === 'notch' && !dragging && (
        <div
          role="menu"
          style={{
            position: 'fixed',
            left: Math.min(
              notchEdgeSpaceMenu.clientX + 6,
              (typeof window !== 'undefined' ? window.innerWidth : 800) - 260
            ),
            top: Math.min(
              notchEdgeSpaceMenu.clientY + 6,
              (typeof window !== 'undefined' ? window.innerHeight : 600) - 140
            ),
            zIndex: 10001,
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
            padding: '6px 0',
            minWidth: 220,
            fontSize: fs(13),
            fontFamily: 'sans-serif',
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        >
          <div style={{ padding: '6px 12px', color: '#666', fontSize: fs(11), borderBottom: '1px solid #eee' }}>
            Kerbe auf gerader Kante
          </div>
          <button
            type="button"
            role="menuitem"
            onPointerDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setNotchEdgeLineCount(1)
              setNotchEdgeMidMode(true)
              setToastMessage(
                'success: Kantenmitte — jetzt eine gerade Kante treffen (bis ca. 20 mm Abstand).'
              )
              window.setTimeout(() => setNotchEdgeSpaceMenu(null), 0)
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '8px 14px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: fs(13),
            }}
          >
            Eine Kerbe: Kantenmitte
          </button>
          <button
            type="button"
            role="menuitem"
            onPointerDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              window.setTimeout(() => {
                setNotchEdgeSpaceMenu(null)
                setNotchEdgeLineCountEditor({ countStr: String(notchEdgeLineCount) })
              }, 0)
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '8px 14px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: fs(13),
            }}
          >
            Mehrere Kerben: gleichmäßig (Anzahl)…
          </button>
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              window.setTimeout(() => setNotchEdgeSpaceMenu(null), 0)
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '6px 14px',
              border: 'none',
              borderTop: '1px solid #eee',
              background: '#fafafa',
              cursor: 'pointer',
              fontSize: fs(12),
              color: '#666',
            }}
          >
            Schließen
          </button>
        </div>
      )}
      {notchEdgeLineCountEditor && tool === 'notch' && (
        <form
          onSubmit={(ev) => {
            ev.preventDefault()
            const raw = Number.parseInt(
              notchEdgeLineCountEditor.countStr.replace(/,/g, '.').trim(),
              10
            )
            if (!Number.isFinite(raw) || raw < 1 || raw > NOTCH_EDGE_LINE_MAX) {
              setToastMessage(`error: Anzahl gueltig 1 bis ${NOTCH_EDGE_LINE_MAX}.`)
              return
            }
            setNotchEdgeLineCount(raw)
            setNotchEdgeLineCountEditor(null)
            setNotchEdgeMidMode(true)
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
          <span style={{ fontSize: fs(12), color: '#263238', fontWeight: 600 }}>
            Kerben auf Kante (1–{NOTCH_EDGE_LINE_MAX})
          </span>
          <input
            ref={notchEdgeLineCountInputRef}
            type="text"
            inputMode="numeric"
            value={notchEdgeLineCountEditor.countStr}
            onChange={(ev) =>
              setNotchEdgeLineCountEditor((s) => (s ? { ...s, countStr: ev.target.value } : s))
            }
            style={{
              width: 56,
              padding: '4px 6px',
              border: '1px solid #90a4ae',
              borderRadius: 4,
              fontSize: fs(13),
            }}
          />
          <button type="submit" style={{ padding: '5px 9px', fontSize: fs(12) }}>
            OK
          </button>
          <button
            type="button"
            onClick={() => setNotchEdgeLineCountEditor(null)}
            style={{ padding: '5px 9px', fontSize: fs(12) }}
          >
            Abbrechen
          </button>
        </form>
      )}
      {!dragging && hoveredInternalCircle && !internalCircleRadiusEditor && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'rgba(21,101,192,0.92)',
            color: '#fff',
            padding: '6px 10px',
            borderRadius: 6,
            fontSize: fs(12),
            fontWeight: 600,
            zIndex: 9998,
            pointerEvents: 'none',
          }}
        >
          Kreis hovern + Leertaste: Radius aendern — Entf: Kreis loeschen
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
          fontSize: fs(12),
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
              fontSize: fs(12),
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
            fontSize: fs(13),
            fontFamily: 'sans-serif',
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div style={{ padding: '6px 12px', color: '#666', fontSize: fs(11), borderBottom: '1px solid #eee' }}>
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
                fontSize: fs(13),
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
                fontSize: fs(13),
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
              fontSize: fs(13),
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
      {rectangleSizeEditor && (
        <form
          onSubmit={(ev) => {
            ev.preventDefault()
            const w = Number.parseFloat(rectangleSizeEditor.widthStr.replace(',', '.'))
            const h = Number.parseFloat(rectangleSizeEditor.heightStr.replace(',', '.'))
            if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) {
              setToastMessage('error: Bitte gueltige Breite und Hoehe in mm eingeben (min. 1).')
              return
            }
            const wClamped = Math.min(10000, w)
            const hClamped = Math.min(10000, h)
            const { anchor, signX, signY } = rectangleSizeEditor
            const corner2 = { x: anchor.x + signX * wClamped, y: anchor.y + signY * hClamped }
            const minX = Math.min(anchor.x, corner2.x)
            const minY = Math.min(anchor.y, corner2.y)
            const rw = Math.abs(corner2.x - anchor.x)
            const rh = Math.abs(corner2.y - anchor.y)
            const cutLine: import('../types/model').Curve[] = [
              { type: 'line', start: { x: 0, y: 0 }, end: { x: rw, y: 0 } },
              { type: 'line', start: { x: rw, y: 0 }, end: { x: rw, y: rh } },
              { type: 'line', start: { x: rw, y: rh }, end: { x: 0, y: rh } },
              { type: 'line', start: { x: 0, y: rh }, end: { x: 0, y: 0 } },
            ]
            addPiece({
              transform: { x: minX, y: minY, rotation: 0, mirrored: false },
              cutLine,
            })
            setRectangleSizeEditor(null)
            setDragging(null)
            setTool('select')
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
            flexWrap: 'wrap',
            zIndex: 10000,
            boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
            maxWidth: 'min(96vw, 420px)',
          }}
          onPointerDown={(ev) => ev.stopPropagation()}
        >
          <span style={{ fontSize: fs(12), color: '#263238', fontWeight: 600 }}>Rechteck (mm)</span>
          <label style={{ fontSize: fs(12), color: '#455a64', display: 'flex', alignItems: 'center', gap: 4 }}>
            Breite
            <input
              ref={rectangleWidthInputRef}
              type="text"
              inputMode="decimal"
              value={rectangleSizeEditor.widthStr}
              onChange={(ev) =>
                setRectangleSizeEditor((s) => (s ? { ...s, widthStr: ev.target.value } : s))
              }
              style={{
                width: 72,
                padding: '4px 6px',
                border: '1px solid #90a4ae',
                borderRadius: 4,
                fontSize: fs(13),
              }}
            />
          </label>
          <span style={{ fontSize: fs(14), color: '#78909c' }}>×</span>
          <label style={{ fontSize: fs(12), color: '#455a64', display: 'flex', alignItems: 'center', gap: 4 }}>
            Hoehe
            <input
              type="text"
              inputMode="decimal"
              value={rectangleSizeEditor.heightStr}
              onChange={(ev) =>
                setRectangleSizeEditor((s) => (s ? { ...s, heightStr: ev.target.value } : s))
              }
              style={{
                width: 72,
                padding: '4px 6px',
                border: '1px solid #90a4ae',
                borderRadius: 4,
                fontSize: fs(13),
              }}
            />
          </label>
          <button type="submit" style={{ padding: '5px 9px', fontSize: fs(12) }}>
            OK
          </button>
          <button
            type="button"
            onClick={() => {
              setRectangleSizeEditor(null)
              setDragging(null)
              setTool('select')
            }}
            style={{ padding: '5px 9px', fontSize: fs(12) }}
          >
            Abbrechen
          </button>
        </form>
      )}
      {cornerRoundEditor && (
        <form
          onSubmit={(ev) => {
            ev.preventDefault()
            const r = Number.parseFloat(cornerRoundEditor.radiusStr.replace(',', '.'))
            if (!Number.isFinite(r) || r < ROUND_CORNER_MIN_RADIUS_MM) {
              setToastMessage(`error: Bitte einen gueltigen Radius in mm eingeben (min. ${ROUND_CORNER_MIN_RADIUS_MM}).`)
              return
            }
            const rClamped = Math.min(ROUND_CORNER_MAX_RADIUS_MM, r)
            const ok = roundCorner(cornerRoundEditor.pieceId, cornerRoundEditor.masterVertexIndex, rClamped)
            if (!ok) return
            setCornerRoundEditor(null)
            setDragging(null)
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
          <span style={{ fontSize: fs(12), color: '#263238', fontWeight: 600 }}>Radius (mm)</span>
          <input
            ref={cornerRoundInputRef}
            type="text"
            inputMode="decimal"
            value={cornerRoundEditor.radiusStr}
            onChange={(ev) =>
              setCornerRoundEditor((s) => (s ? { ...s, radiusStr: ev.target.value } : s))
            }
            onKeyDown={(ev) => {
              if (ev.key === 'Escape') {
                ev.preventDefault()
                setCornerRoundEditor(null)
                setDragging(null)
              }
              ev.stopPropagation()
            }}
            style={{
              width: 90,
              padding: '4px 6px',
              border: '1px solid #90a4ae',
              borderRadius: 4,
              fontSize: fs(13),
            }}
          />
          <button type="submit" style={{ padding: '5px 9px', fontSize: fs(12) }}>
            OK
          </button>
          <button
            type="button"
            onClick={() => {
              setCornerRoundEditor(null)
              setDragging(null)
            }}
            style={{ padding: '5px 9px', fontSize: fs(12) }}
          >
            Abbrechen
          </button>
        </form>
      )}
      {internalCircleRadiusEditor && (
        <form
          onSubmit={(ev) => {
            ev.preventDefault()
            const r = Number.parseFloat(internalCircleRadiusEditor.radiusStr.replace(',', '.'))
            if (!Number.isFinite(r) || r < 0.5) {
              setToastMessage('error: Bitte einen gueltigen Radius in mm eingeben (min. 0,5).')
              return
            }
            const rClamped = Math.min(10000, r)
            const { pieceId, center, circleId } = internalCircleRadiusEditor
            const piece = pieces.find((p) => p.id === pieceId)
            if (!piece) {
              setToastMessage('error: Teil nicht gefunden.')
              return
            }
            if (circleId) {
              updateInternalCircle(pieceId, circleId, { center: { ...center }, radius: rClamped })
            } else {
              addInternalCircle(pieceId, { center: { ...center }, radius: rClamped })
            }
            setInternalCircleRadiusEditor(null)
            setDragging(null)
            setTool('select')
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
          <span style={{ fontSize: fs(12), color: '#263238', fontWeight: 600 }}>Radius (mm)</span>
          <input
            ref={internalCircleRadiusInputRef}
            type="text"
            inputMode="decimal"
            value={internalCircleRadiusEditor.radiusStr}
            onChange={(ev) =>
              setInternalCircleRadiusEditor((s) => (s ? { ...s, radiusStr: ev.target.value } : s))
            }
            style={{
              width: 90,
              padding: '4px 6px',
              border: '1px solid #90a4ae',
              borderRadius: 4,
              fontSize: fs(13),
            }}
          />
          <button type="submit" style={{ padding: '5px 9px', fontSize: fs(12) }}>
            OK
          </button>
          <button
            type="button"
            onClick={() => {
              setInternalCircleRadiusEditor(null)
              setDragging(null)
              setTool('select')
            }}
            style={{ padding: '5px 9px', fontSize: fs(12) }}
          >
            Abbrechen
          </button>
        </form>
      )}
      {profileFitConfirm && (
        <div
          role="dialog"
          aria-labelledby="profile-fit-confirm-title"
          style={{
            position: 'absolute',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#fff',
            border: '1px solid #cfd8dc',
            borderRadius: 8,
            padding: '10px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            zIndex: 10001,
            boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
            maxWidth: 420,
          }}
          onPointerDown={(ev) => ev.stopPropagation()}
        >
          <div id="profile-fit-confirm-title" style={{ fontSize: fs(13), color: '#263238', fontWeight: 700 }}>
            Profillängen anpassen?
          </div>
          <p style={{ margin: 0, fontSize: fs(12), color: '#455a64', lineHeight: 1.45 }}>
            Die orange Vorschau zeigt, wohin Profil-Enden (Notch oder Ecke) verschoben würden, damit
            die feste Profillänge wieder passt.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: fs(12), color: '#37474f' }}>
            {profileFitConfirm.previews.map((p) => (
              <li key={p.assignmentId}>
                Profil {p.profileKey}: {p.currentLengthMm.toFixed(1)} mm → {p.targetLengthMm} mm
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="sidebar-btn primary"
              style={{ fontSize: fs(12), padding: '5px 12px' }}
              onClick={() => {
                applyProfileLengthFitPreviews(profileFitConfirm.pieceId)
                setProfileFitConfirm(null)
                setProfileFitPreviews([])
              }}
            >
              OK
            </button>
            <button
              type="button"
              className="sidebar-btn"
              style={{ fontSize: fs(12), padding: '5px 12px' }}
              onClick={() => {
                setProfileFitConfirm(null)
                setProfileFitPreviews([])
              }}
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
      {lineLengthEditor && (
        <form
          onSubmit={(ev) => {
            ev.preventDefault()
            const mm = Number.parseFloat(lineLengthEditor.value.replace(',', '.'))
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
            } else if (lineLengthEditor.mode === 'draw') {
              if (lineLengthEditor.drawTarget === 'contour') {
                addCurveToCutLine(lineLengthEditor.pieceId, { type: 'line', start: lineLengthEditor.start, end })
              } else {
                addInternalLine(lineLengthEditor.pieceId, { type: 'line', start: lineLengthEditor.start, end })
              }
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
          <span style={{ fontSize: fs(12), color: '#263238', fontWeight: 600 }}>Laenge (mm)</span>
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
              fontSize: fs(13),
            }}
          />
          <button type="submit" style={{ padding: '5px 9px', fontSize: fs(12) }}>OK</button>
          <button
            type="button"
            onClick={() => {
              if (lineLengthEditor.mode === 'draw') {
                setDragging(null)
                setTool('select')
              }
              setLineLengthEditor(null)
            }}
            style={{ padding: '5px 9px', fontSize: fs(12) }}
          >
            Abbrechen
          </button>
        </form>
      )}
      {notchMoveDistanceEditor && (
        <form
          onSubmit={(ev) => {
            ev.preventDefault()
            const mm = Number.parseFloat(notchMoveDistanceEditor.value.replace(',', '.'))
            if (!Number.isFinite(mm) || mm < 0) {
              setToastMessage('error: Bitte ein gültiges Maß in mm eingeben.')
              return
            }
            const movePiece = pieces.find((p) => p.id === notchMoveDistanceEditor.pieceId)
            const preview =
              notchPreview?.pieceId === notchMoveDistanceEditor.pieceId
                ? notchPreview
                : movePiece
                  ? buildNotchMovePreview(movePiece, notchMoveDistanceEditor.notchId)
                  : null
            if (movePiece && preview) {
              const L = pathLengthAt(movePiece.cutLine, preview.curveIndex, preview.t)
              const total = totalPathLength(movePiece.cutLine)
              updateNotch(notchMoveDistanceEditor.pieceId, notchMoveDistanceEditor.notchId, {
                sNormalized: total > 0 ? L / total : undefined,
                arcLengthMm: total > 0 ? L : undefined,
                position: preview.storePos,
                angle: preview.storeAngle,
              })
            } else {
              setToastMessage('error: Kerbe konnte nicht gesetzt werden.')
            }
            setNotchMoveDistanceEditor(null)
            setNotchPreview(null)
          }}
          style={{
            position: 'fixed',
            left: Math.min(
              notchMoveDistanceEditor.clientX + 8,
              (typeof window !== 'undefined' ? window.innerWidth : 800) - 330
            ),
            top: Math.min(
              notchMoveDistanceEditor.clientY + 8,
              (typeof window !== 'undefined' ? window.innerHeight : 600) - 120
            ),
            background: '#fff',
            border: '1px solid #cfd8dc',
            borderRadius: 8,
            padding: '8px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            zIndex: 10002,
            boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
          }}
          onPointerDown={(ev) => ev.stopPropagation()}
        >
          <span style={{ fontSize: fs(12), color: '#263238', fontWeight: 600 }}>Kerbenabstand</span>
          <button
            type="button"
            onClick={() => setNotchMoveDistanceEditor((s) => (s ? { ...s, side: 'left' } : s))}
            style={{
              padding: '3px 8px',
              fontSize: fs(12),
              border: '1px solid #90a4ae',
              borderRadius: 4,
              background: notchMoveDistanceEditor.side === 'left' ? '#e3f2fd' : '#fff',
            }}
          >
            links
          </button>
          <button
            type="button"
            onClick={() => setNotchMoveDistanceEditor((s) => (s ? { ...s, side: 'right' } : s))}
            style={{
              padding: '3px 8px',
              fontSize: fs(12),
              border: '1px solid #90a4ae',
              borderRadius: 4,
              background: notchMoveDistanceEditor.side === 'right' ? '#e3f2fd' : '#fff',
            }}
          >
            rechts
          </button>
          <input
            ref={notchMoveDistanceInputRef}
            type="text"
            inputMode="decimal"
            value={notchMoveDistanceEditor.value}
            onChange={(ev) =>
              setNotchMoveDistanceEditor((s) => (s ? { ...s, value: ev.target.value } : s))
            }
            onKeyDown={(ev) => {
              if (ev.key === 'Escape') {
                ev.preventDefault()
                setNotchMoveDistanceEditor(null)
                setNotchPreview(null)
              }
              ev.stopPropagation()
            }}
            style={{
              width: 84,
              padding: '4px 6px',
              border: '1px solid #90a4ae',
              borderRadius: 4,
              fontSize: fs(13),
            }}
          />
          <span style={{ fontSize: fs(12), color: '#455a64' }}>mm</span>
          <button type="submit" style={{ padding: '5px 9px', fontSize: fs(12) }}>OK</button>
          <button
            type="button"
            onClick={() => {
              setNotchMoveDistanceEditor(null)
              setNotchPreview(null)
            }}
            style={{ padding: '5px 9px', fontSize: fs(12) }}
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
          fontSize: fs(13),
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
          fontSize: fs(13),
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
              fontSize: fs(12),
            }}
          >
            Abbrechen
          </button>
        </div>
      )}
      {horizontalLevelPickingActive && (
        <div style={{
          position: 'fixed',
          top: 48,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#0f766e',
          color: '#fff',
          padding: '6px 18px',
          borderRadius: 6,
          fontSize: fs(13),
          fontFamily: 'sans-serif',
          zIndex: 3000,
          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
          <span>Gerade Kante anklicken — Teil wird waagerecht ausgerichtet</span>
          <button
            type="button"
            onClick={() => {
              setHorizontalLevelPickingActive(false)
              setHoveredHorizontalLevelEdge(null)
            }}
            style={{
              background: 'rgba(255,255,255,0.25)',
              border: 'none',
              color: '#fff',
              padding: '2px 10px',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: fs(12),
            }}
          >
            Abbrechen
          </button>
        </div>
      )}
      {pieceSymmetryState && (() => {
        const symPiece = pieces.find((p) => p.id === pieceSymmetryState.pieceId)
        const symBtn: CSSProperties = {
          background: 'rgba(255,255,255,0.2)',
          border: '1px solid rgba(255,255,255,0.35)',
          color: '#fff',
          padding: '4px 10px',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: fs(12),
        }
        return (
        <div
          style={{
            position: 'fixed',
            top: 48,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#115e59',
            color: '#fff',
            padding: '6px 18px',
            borderRadius: 6,
            fontSize: fs(13),
            fontFamily: 'sans-serif',
            zIndex: 3000,
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            maxWidth: 'min(96vw, 720px)',
            flexWrap: 'wrap',
          }}
        >
          {pieceSymmetryState.phase === 'chooseMethod' && (
            <>
              <span>Spiegelachse:</span>
              <button
                type="button"
                style={symBtn}
                onClick={() =>
                  setPieceSymmetryState({ pieceId: pieceSymmetryState.pieceId, phase: 'axisA' })
                }
              >
                Linie einzeichnen
              </button>
              <button
                type="button"
                style={{
                  ...symBtn,
                  opacity: symPiece && symPiece.internalLines.length > 0 ? 1 : 0.45,
                  cursor: symPiece && symPiece.internalLines.length > 0 ? 'pointer' : 'not-allowed',
                }}
                disabled={!symPiece || symPiece.internalLines.length === 0}
                onClick={() => {
                  if (!symPiece || symPiece.internalLines.length === 0) return
                  setHoveredSymmetryInternalIdx(null)
                  setPieceSymmetryState({ pieceId: pieceSymmetryState.pieceId, phase: 'pickInternalLine' })
                }}
              >
                Interne Linie
              </button>
              <button
                type="button"
                style={symBtn}
                onClick={() => {
                  setHoveredSymmetryEdge(null)
                  setPieceSymmetryState({ pieceId: pieceSymmetryState.pieceId, phase: 'pickEdge' })
                }}
              >
                Gerade Kante
              </button>
            </>
          )}
          {pieceSymmetryState.phase === 'axisA' && (
            <span>Ersten Punkt der Spiegelachse klicken (Teilkoordinaten).</span>
          )}
          {pieceSymmetryState.phase === 'axisB' && (
            <span>Zweiten Punkt klicken — die Linie durch beide Punkte ist die Spiegelachse.</span>
          )}
          {pieceSymmetryState.phase === 'pickInternalLine' && (
            <span>Interne Linie anklicken (Achse = Strecke Start–Ende; bei Kurve: Sehne).</span>
          )}
          {pieceSymmetryState.phase === 'pickEdge' && (
            <span>
              {flipByEdgeActive
                ? 'Kante oder Kurve anklicken — Spiegelachse: gerade Kante = Kante selbst; Kurve = Tangente am Trefferpunkt.'
                : 'Kante oder Kurve am Teil anklicken (gerade Kante bzw. Tangente an der Kurve wie Wasserwaage).'}
            </span>
          )}
          {pieceSymmetryState.phase === 'pickSide' && (
            <span>
              Seite anklicken, die als Vorlage behalten werden soll (die andere Hälfte wird gespiegelt).
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              setPieceSymmetryState(null)
              setSymmetryHoverWorld(null)
              setHoveredSymmetryEdge(null)
              setHoveredSymmetryInternalIdx(null)
              setFlipByEdgeActive(false)
            }}
            style={{
              background: 'rgba(255,255,255,0.25)',
              border: 'none',
              color: '#fff',
              padding: '2px 10px',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: fs(12),
            }}
          >
            Abbrechen
          </button>
        </div>
        )
      })()}
      {edgeAllowancePopover && <EdgeAllowancePopover
        key={`${edgeAllowancePopover.pieceId}-${edgeAllowancePopover.edgeIndex}`}
        popover={edgeAllowancePopover}
        onConfirm={(mm) => {
          setEdgeSeamAllowance(edgeAllowancePopover.pieceId, edgeAllowancePopover.edgeIndex, mm)
          setEdgeAllowancePopover(null)
          setHoveredEdgePicking(null)
          setEdgeSeamPickingActive(false)
        }}
        onCancel={() => {
          setEdgeAllowancePopover(null)
          setHoveredEdgePicking(null)
          setEdgeSeamPickingActive(false)
        }}
      />}
      <WorkspaceLiveCostPanel />
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

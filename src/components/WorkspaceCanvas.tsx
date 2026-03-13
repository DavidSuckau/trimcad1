import { useRef, useCallback, useState, useEffect } from 'react'
import { useStore } from '../store/useStore'
import { closedPathD, curveToPathD, bezierAt, curveSegmentArcLength, curvesBounds, outwardNormalAngleAt, pointAtPathLength } from '../geometry/curveToPath'
import { nearestCurveIndexAndPoint } from '../geometry/nearestOnCurve'
import { offsetSegmentPoints } from '../geometry/offset'
import { getNotchPositionAndAngle, getNotchPositionAndAngleOnCutLine, getNotchPositionAndAngleOnSeamLine, getNotchCurveIndexAndT, notchTriangleCorners, notchCutoutPoints, cutLineWithNotchCutouts, seamLineWithNotchCutouts } from '../geometry/notchOnCurve'
import { isPointInClosedCurves } from '../geometry/pointInPolygon'
import { getCornerRange, countNotchesOnEdge, getSubSegments } from '../geometry/seamUtils'
import type { PatternPiece, Point, Curve, SeamAssignment } from '../types/model'

/** Rasterabstand in mm (Arbeitsfläche maßstabsgetreu in mm) */
const GRID_SIZE = 10

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

/** Eckpunkte (rot), eingefügte Punkte (blau), Kurvenpunkte (orange) */
const COLOR_ECKPUNKT: [string, string] = ['#ef5350', '#b71c1c']
const COLOR_SOFT_PUNKT: [string, string] = ['#42a5f5', '#1565c0']
/** Punkt auf der Kurve (ziehen = Kurve glatt verschieben, keine Ecke) */
const COLOR_PUNKT_AUF_KURVE: [string, string] = ['#42a5f5', '#1565c0']

/** Farbe für Notch-Kerben – gleiche Farbe wie die Außenkontur. */
const NOTCH_STROKE = '#000'

/** Distanz in mm entlang des Segments von t bis zum nächsten Eckpunkt oder nächsten Notch (falls auf diesem Segment). */
function distanceToNextVertexOrNotch(
  curve: Curve,
  t: number,
  notchesOnSegment: number[]
): number {
  const notchesAhead = notchesOnSegment.filter((tN) => tN > t && tN <= 1)
  const endT = notchesAhead.length > 0 ? Math.min(...notchesAhead) : 1
  return curveSegmentArcLength(curve, t, endT)
}

/** Distanz in mm entlang des Segments vom vorherigen Eckpunkt bzw. letzten Notch bis t. */
function distanceToPrevVertexOrNotch(
  curve: Curve,
  t: number,
  notchesOnSegment: number[]
): number {
  const notchesBehind = notchesOnSegment.filter((tN) => tN >= 0 && tN < t)
  const startT = notchesBehind.length > 0 ? Math.max(...notchesBehind) : 0
  return curveSegmentArcLength(curve, startT, t)
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

function PieceGroup({
  piece,
  isSelected,
  isHovered,
  hoveredSegmentCurveIndex,
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
}: {
  piece: PatternPiece
  isSelected: boolean
  isHovered: boolean
  hoveredSegmentCurveIndex: number | null
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
}) {
  const { cutLine, seamLine, notches, drills, internalLines, transform } = piece
  const tx = `translate(${transform.x},${transform.y}) rotate(${transform.rotation}) scale(${transform.mirrored ? -1 : 1},1)`
  const notchesForCutouts = notchIdBeingDragged ? notches.filter((n) => n.id !== notchIdBeingDragged) : notches
  const mergedCutLine = cutLineWithNotchCutouts(cutLine, notchesForCutouts, seamLine)
  const cutPath = closedPathD(mergedCutLine)
  const mergedSeamLine = seamLineWithNotchCutouts(cutLine, notchesForCutouts, seamLine)
  const seamPath = closedPathD(mergedSeamLine)
  const fillHellgelb = '#fef9c3'
  const hasSeam = !!(seamPath && seamLine.length >= 3)
  const solidIsCut = !hasSeam || !!cutSeamSwapped
  const solidPath = solidIsCut ? cutPath : seamPath
  const dashedPath = solidIsCut ? seamPath : cutPath

  return (
    <g transform={tx} onPointerDown={onPointerDown}>
      {hasSeam && dashedPath && (
        <path
          d={dashedPath}
          fill={fillHellgelb}
          fillOpacity={0.82}
          stroke="#888"
          strokeWidth={0.5}
          pointerEvents="none"
        />
      )}
      {solidPath && (
        <path
          d={solidPath}
          fill={fillHellgelb}
          fillOpacity={0.82}
          stroke={isHovered ? '#e53935' : '#000'}
          strokeWidth={isHovered ? 0.8 : 0.5}
          pointerEvents="none"
        />
      )}
      {hoveredSegmentCurveIndex != null && cutLine[hoveredSegmentCurveIndex] && (
        <path
          d={curveToPathD([cutLine[hoveredSegmentCurveIndex]])}
          fill="none"
          stroke="#1565c0"
          strokeWidth={1.8}
          strokeLinecap="round"
          opacity={0.95}
          pointerEvents="none"
        />
      )}
      {cutLine.length === 0 && (
        <circle cx={0} cy={0} r={2} fill="none" stroke="#ccc" strokeWidth={0.5} pointerEvents="none" />
      )}
      {showInternalLines !== false && internalLines.map((curve, i) => (
        <path
          key={`internal-${i}`}
          d={curveToPathD([curve])}
          fill="none"
          stroke="#1565c0"
          strokeWidth={0.6}
          strokeDasharray="4 3"
          pointerEvents="none"
        />
      ))}
      {showNotches !== false && notches.map((n) => {
        if (notchIdBeingDragged === n.id) return null
        const depth = n.depth
        const width = n.width ?? 6
        const cutPos = getNotchPositionAndAngleOnCutLine(n, cutLine, seamLine)
        const cutPts = notchCutoutPoints(cutPos.position, cutPos.angle, depth, width, cutLine)
        if (!cutPts) return null
        const cutFillD = `M ${cutPts.left.x} ${cutPts.left.y} L ${cutPts.tip.x} ${cutPts.tip.y} L ${cutPts.right.x} ${cutPts.right.y} Z`
        const cutEdgesD = `M ${cutPts.left.x} ${cutPts.left.y} L ${cutPts.tip.x} ${cutPts.tip.y} L ${cutPts.right.x} ${cutPts.right.y}`
        const seamPos = getNotchPositionAndAngleOnSeamLine(n, cutLine, seamLine)
        let seamFillD: string | null = null
        let seamEdgesD: string | null = null
        if (seamPos && seamLine.length > 0) {
          const seamPts = notchCutoutPoints(seamPos.position, seamPos.angle, depth, width, seamLine)
          if (seamPts) {
            seamFillD = `M ${seamPts.left.x} ${seamPts.left.y} L ${seamPts.tip.x} ${seamPts.tip.y} L ${seamPts.right.x} ${seamPts.right.y} Z`
            seamEdgesD = `M ${seamPts.left.x} ${seamPts.left.y} L ${seamPts.tip.x} ${seamPts.tip.y} L ${seamPts.right.x} ${seamPts.right.y}`
          }
        }
        const isAnchored = n.vertexIndex != null
        const isHovered = hoveredNotchId === n.id
        const stroke = isHovered ? '#1565c0' : NOTCH_STROKE
        const strokeW = isHovered ? 0.7 : 0.4
        const circleR = isHovered ? 1 : 0.8
        return (
          <g key={n.id} pointerEvents="none">
            <path d={cutFillD} fill="#fff" stroke="none" />
            <path d={cutEdgesD} fill="none" stroke={stroke} strokeWidth={strokeW} strokeLinejoin="round" />
            <circle
              cx={cutPos.position.x}
              cy={cutPos.position.y}
              r={circleR}
              fill={isAnchored ? stroke : 'none'}
              stroke={stroke}
              strokeWidth={isHovered ? 0.5 : 0.3}
            />
            {seamFillD && (
              <path d={seamFillD} fill="#fff" stroke="none" />
            )}
            {seamEdgesD && (
              <path
                d={seamEdgesD}
                fill="none"
                stroke={stroke}
                strokeWidth={strokeW}
                strokeLinejoin="round"
              />
            )}
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
        const bounds = curvesBounds(cutLine)
        if (!bounds) return null
        const cx = (bounds.minX + bounds.maxX) / 2
        const w = bounds.maxX - bounds.minX
        const h = bounds.maxY - bounds.minY
        const inset = Math.max(h * 0.2, 3)
        const topY = bounds.minY + inset
        const bottomY = bounds.maxY - inset
        const shaftH = bottomY - topY
        const awNom = 6
        const ahNom = 8
        const tickLenNom = 3
        const scale = Math.min(
          1,
          w / (2 * awNom),
          shaftH / (2 * ahNom)
        )
        const aw = awNom * scale
        const ah = ahNom * scale
        const tickLen = tickLenNom * scale
        const midY = (topY + bottomY) / 2
        const hitPad = Math.max(14, aw + 2)
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
              onPointerDown={(e) => e.stopPropagation()}
              style={hasGrainHandlers ? { cursor: 'pointer' } : undefined}
            >
              <line
                x1={cx}
                y1={topY}
                x2={cx}
                y2={bottomY}
                stroke="#333"
                strokeWidth={0.35}
                strokeDasharray="5 3"
                pointerEvents="none"
              />
              <line
                x1={cx - tickLen}
                y1={midY}
                x2={cx}
                y2={midY}
                stroke="#333"
                strokeWidth={0.35}
                pointerEvents="none"
              />
              <path
                d={`M ${cx} ${topY} L ${cx - aw} ${topY + ah} L ${cx + aw} ${topY + ah} Z`}
                fill="none"
                stroke="#333"
                strokeWidth={0.35}
                pointerEvents="none"
              />
              <path
                d={`M ${cx} ${bottomY} L ${cx - aw} ${bottomY - ah} L ${cx + aw} ${bottomY - ah} Z`}
                fill="none"
                stroke="#333"
                strokeWidth={0.35}
                pointerEvents="none"
              />
              {hasGrainHandlers && (
                <rect
                  x={cx - hitPad}
                  y={topY - 4}
                  width={hitPad * 2}
                  height={bottomY - topY + 8}
                  fill="transparent"
                />
              )}
            </g>
            {showPieceNames !== false && (
              <text
                x={cx + 10}
                y={midY}
                textAnchor="start"
                dominantBaseline="middle"
                fill="#333"
                fontSize={3.5}
                fontFamily="sans-serif"
                pointerEvents="none"
              >
                {piece.name}
              </text>
            )}
          </>
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
    rulerMode,
    rulerLine,
    setView,
    setRulerLine,
    pendingNahtzugabeClick,
    setPendingNahtzugabeClick,
    setNahtzugabeDialogPieceId,
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
    flipPieceAlongGrain,
    toastMessage,
    setToastMessage,
    checkSeamAdjustment,
    snapSeamEdgeToMatch,
    digitizeState,
    addDigitizeNode,
    updateDigitizeDrag,
    finishDigitizeDrag,
    cancelDigitize,
    finishDigitize,
    startDigitize,
  } = useStore()
  const { pieces, view } = workspace
  const seamAssignments = workspace.seamAssignments ?? []
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
  const [dragging, setDragging] = useState<
    | { kind: 'pan'; startClient: Point; startPan: Point }
    | { kind: 'piece'; pieceId: string; start: Point }
    | { kind: 'vertex'; pieceId: string; vertexIndex: number; seamDrag?: { startLocal: Point; cutVertexIndex: number } }
    | { kind: 'controlpoint'; pieceId: string; curveIndex: number; pointKey: 'cp1' | 'cp2'; seamDrag?: { startLocal: Point; cutCurveIndex: number; cutPointKey: 'cp1' | 'cp2' } }
    | { kind: 'pointOnCurve'; pieceId: string; curveIndex: number; t: number; seamDrag?: { startLocal: Point; cutCurveIndex: number; cutT: number } }
    | { kind: 'rectangle'; start: Point; current: Point }
    | { kind: 'line'; pieceId: string; start: Point; current: Point }
    | { kind: 'notch'; pieceId: string; position: Point; current: Point; curveIndex: number; t: number; useSeamLine?: boolean }
    | { kind: 'notchMove'; pieceId: string; notchId: string }
    | { kind: 'drill'; pieceId: string; center: Point; current: Point }
    | { kind: 'internalCircle'; pieceId: string; center: Point; current: Point }
    | { kind: 'ruler'; start: Point; current: Point }
    | { kind: 'digitizeDrag' }
    | null
  >(null)
  const [hoveredPieceId, setHoveredPieceId] = useState<string | null>(null)
  const [cutSeamSwappedSet, setCutSeamSwappedSet] = useState<Set<string>>(new Set())
  const [hoveredDeletablePoint, setHoveredDeletablePoint] = useState<
    | { pieceId: string; kind: 'vertex'; vertexIndex: number }
    | { pieceId: string; kind: 'pointOnCurve'; curveIndex: number }
    | null
  >(null)
  const [hoveredDeletablePointPos, setHoveredDeletablePointPos] = useState<{ clientX: number; clientY: number } | null>(null)
  const [hoveredDeletableNotch, setHoveredDeletableNotch] = useState<{ pieceId: string; notchId: string } | null>(null)
  const [hoveredDeletableNotchPos, setHoveredDeletableNotchPos] = useState<{ clientX: number; clientY: number } | null>(null)
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
  const [hoveredCurvepointSegment, setHoveredCurvepointSegment] = useState<{ pieceId: string; curveIndex: number } | null>(null)
  const [digitizeMouseWorld, setDigitizeMouseWorld] = useState<Point | null>(null)
  const [digitizeNearFirst, setDigitizeNearFirst] = useState(false)

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
      e.preventDefault()
      closeSegmentMenu()
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
      if (rulerMode) {
        setRulerLine(null)
        const start = snapRulerToNearestPoint(world, pieces)
        setDragging({ kind: 'ruler', start, current: start })
        ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
        return
      }
      if (nahtzuordnungMode === 'first' || nahtzuordnungMode === 'second') {
        // Nahtzuordnung: Klick immer auf der Nahtlinie (seamLine). Für die Logik speichern wir aber cutLine-Indices.
        let best: { pieceId: string; curveIndex: number; distance: number; piece: PatternPiece } | null = null
        for (const p of pieces) {
          if (!p.cutLine || p.cutLine.length === 0 || p.seamLine.length < 3) continue
          const local = worldToPieceLocal(world, p)
          const nearestSeam = nearestCurveIndexAndPoint(local, p.seamLine)
          if (!nearestSeam || nearestSeam.distance >= SEAM_HIT_MM) continue
          // Innenseite wird relativ zur Außenkontur (cutLine) geprüft
          const nearestCutForInside = nearestCurveIndexAndPoint(local, p.cutLine)
          if (!nearestCutForInside || !isClickOnInnerSideOfEdge(local, nearestCutForInside, p.cutLine)) continue
          // Kante für Zuordnung kommt aus der cutLine
          const nearestCut = nearestCurveIndexAndPoint(nearestSeam.point, p.cutLine)
          if (!nearestCut) continue
          const cutCurveIndex = nearestCut.curveIndex
          if (!best || nearestSeam.distance < best.distance) {
            best = { pieceId: p.id, curveIndex: cutCurveIndex, distance: nearestSeam.distance, piece: p }
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
      const VERTEX_HIT = 12
      const POINT_ON_CURVE_HIT = 12
      // Treffer: bei Seam-Ansicht Abstand zum projizierten Punkt auf seamLine, sonst cutLine.
      if (showPoints && (tool === 'select' || tool === 'point' || tool === 'curvepoint') && selectedPieceIds.length > 0) {
        let bestPointOnCurve: { dist: number; pieceId: string; curveIndex: number; t: number } | null = null
        let bestVertex: { dist: number; pieceId: string; vertexIndex: number } | null = null
        for (const pieceId of selectedPieceIds) {
          const p = pieces.find((x) => x.id === pieceId)
          if (!p || p.cutLine.length === 0) continue
          const local = worldToPieceLocal(world, p)
          const cutLine = p.cutLine
          const hasSeam = p.seamLine.length >= 3
          const solidIsCut = !hasSeam || cutSeamSwappedSet.has(pieceId)
          const notchVIs = new Set(p.notches.map((nn) => nn.vertexIndex).filter((vi): vi is number => vi != null))
          // Kurvenpunkte – immer cutLine (eindeutige Indizes)
          for (let ci = 0; ci < cutLine.length; ci++) {
            const c = cutLine[ci]
            if (c.type !== 'bezier') continue
            const ptOnCurve = bezierAt(c, 0.5)
            const d = Math.hypot(local.x - ptOnCurve.x, local.y - ptOnCurve.y)
            if (d < POINT_ON_CURVE_HIT && (!bestPointOnCurve || d < bestPointOnCurve.dist)) {
              bestPointOnCurve = { dist: d, pieceId: p.id, curveIndex: ci, t: 0.5 }
            }
          }
          // Eckpunkte – bei Seam-Ansicht Treffer auf projizierter Position (auf seamLine)
          const n = cutLine.length
          for (let vi = 0; vi < n; vi++) {
            if (notchVIs.has(vi)) continue
            const cutV = vi === 0 ? cutLine[0].start : cutLine[vi - 1].end
            const hitPos = solidIsCut || !hasSeam
              ? cutV
              : (nearestCurveIndexAndPoint(cutV, p.seamLine)?.point ?? cutV)
            const d = Math.hypot(local.x - hitPos.x, local.y - hitPos.y)
            if (d < VERTEX_HIT && (!bestVertex || d < bestVertex.dist)) {
              bestVertex = { dist: d, pieceId: p.id, vertexIndex: vi }
            }
          }
        }
        const usePointOnCurve = bestPointOnCurve && (!bestVertex || bestPointOnCurve.dist <= bestVertex.dist)
        const useVertex = bestVertex && (!bestPointOnCurve || bestVertex.dist < bestPointOnCurve.dist)
        if (usePointOnCurve && bestPointOnCurve) {
          setDragging({ kind: 'pointOnCurve', pieceId: bestPointOnCurve.pieceId, curveIndex: bestPointOnCurve.curveIndex, t: bestPointOnCurve.t })
          ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
          return
        }
        if (useVertex && bestVertex) {
          if (bestVertex.dist <= VERTEX_HIT * 1.5) {
            setDragging({ kind: 'vertex', pieceId: bestVertex.pieceId, vertexIndex: bestVertex.vertexIndex })
            ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
            return
          }
        }
      }
      if (tool === 'curvepoint' && selectedPieceIds.length === 1) {
        const pieceId = selectedPieceIds[0]
        const piece = pieces.find((x) => x.id === pieceId)
        if (piece && piece.cutLine.length > 0) {
          const local = worldToPieceLocal(world, piece)
          const nearest = nearestCurveIndexAndPoint(local, piece.cutLine)
          if (nearest && nearest.distance < 15) {
            const curve = piece.cutLine[nearest.curveIndex]
            if (curve.type === 'line') {
              const cutCurve = piece.cutLine[nearest.curveIndex]
              if (cutCurve?.type === 'line') {
                const { start, end } = cutCurve
                const dx = end.x - start.x
                const dy = end.y - start.y
                const cp1 = { x: start.x + dx / 3, y: start.y + dy / 3 }
                const cp2 = { x: start.x + (2 * dx) / 3, y: start.y + (2 * dy) / 3 }
                replaceSegmentWithBezier(pieceId, nearest.curveIndex, cp1, cp2)
              }
            } else if (curve.type === 'bezier' && nearest.t != null && nearest.t > 1e-6 && nearest.t < 1 - 1e-6) {
              const cutCurve = piece.cutLine[nearest.curveIndex]
              if (cutCurve?.type === 'bezier') {
                const pt = nearest.point
                insertPointOnCutLine(pieceId, nearest.curveIndex, pt, nearest.t)
              }
            }
            ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
            return
          }
        }
      }
      if (tool === 'point' && selectedPieceIds.length === 1) {
        const pieceId = selectedPieceIds[0]
        const piece = pieces.find((x) => x.id === pieceId)
        if (piece && piece.cutLine.length > 0) {
          const local = worldToPieceLocal(world, piece)
          const nearest = nearestCurveIndexAndPoint(local, piece.cutLine)
          if (nearest && nearest.distance < 15) {
            const curve = piece.cutLine[nearest.curveIndex]
            if (curve.type === 'line') {
              insertPointOnCutLine(pieceId, nearest.curveIndex, nearest.point)
            } else if (curve.type === 'bezier' && nearest.t != null) {
              insertPointOnCutLine(pieceId, nearest.curveIndex, nearest.point, nearest.t)
            }
            ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
            return
          }
        }
      }
      if (tool === 'select') {
        if (hoveredDeletableNotch) {
          setDragging({
            kind: 'notchMove',
            pieceId: hoveredDeletableNotch.pieceId,
            notchId: hoveredDeletableNotch.notchId,
          })
          ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
          return
        }
        for (let i = pieces.length - 1; i >= 0; i--) {
          const p = pieces[i]
          const local = worldToPieceLocal(world, p)
          if (isPointInsidePiece(local, p)) {
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
        selectPiece(null)
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
      selectPiece(null)
      setTool('select')
    },
    [
      tool,
      view.panX,
      view.panY,
      pieces,
      selectedPieceIds,
      showPoints,
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
    ]
  )

  const HOVER_DELETE_HIT = 14

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
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
        if (nahtzuordnungMode === 'first' || nahtzuordnungMode === 'second') {
          const world = toWorld(e.clientX, e.clientY)
          let best: { pieceId: string; curveIndex: number; distance: number; piece: PatternPiece } | null = null
          for (const p of pieces) {
            if (!p.cutLine?.length || p.seamLine.length < 3) continue
            const local = worldToPieceLocal(world, p)
            const nearestSeam = nearestCurveIndexAndPoint(local, p.seamLine)
            if (!nearestSeam || nearestSeam.distance >= SEAM_HIT_MM) continue
            const nearestCutForInside = nearestCurveIndexAndPoint(local, p.cutLine)
            if (!nearestCutForInside || !isClickOnInnerSideOfEdge(local, nearestCutForInside, p.cutLine)) continue
            const nearestCut = nearestCurveIndexAndPoint(nearestSeam.point, p.cutLine)
            if (!nearestCut) continue
            const cutCurveIndex = nearestCut.curveIndex
            if (!best || nearestSeam.distance < best.distance) {
              best = { pieceId: p.id, curveIndex: cutCurveIndex, distance: nearestSeam.distance, piece: p }
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
        if (showPoints && (tool === 'select' || tool === 'point' || tool === 'curvepoint') && selectedPieceIds.length > 0) {
          const world = toWorld(e.clientX, e.clientY)
          let best: { dist: number; value: typeof hoveredDeletablePoint } = { dist: HOVER_DELETE_HIT + 1, value: null }
          for (const pieceId of selectedPieceIds) {
            const p = pieces.find((x) => x.id === pieceId)
            if (!p || p.cutLine.length === 0) continue
            const local = worldToPieceLocal(world, p)
            const hasSeam = p.seamLine.length >= 3
            const solidIsCut = !hasSeam || cutSeamSwappedSet.has(pieceId)
            const notchVIs = new Set(p.notches.map((nn) => nn.vertexIndex).filter((vi): vi is number => vi != null))
            for (let vi = 0; vi < p.cutLine.length; vi++) {
              if (notchVIs.has(vi)) continue
              if (p.cutLine.length <= 3) continue
              const cutV = vi === 0 ? p.cutLine[0].start : p.cutLine[vi - 1].end
              const hitPos = solidIsCut || !hasSeam
                ? cutV
                : (nearestCurveIndexAndPoint(cutV, p.seamLine)?.point ?? cutV)
              const d = Math.hypot(local.x - hitPos.x, local.y - hitPos.y)
              if (d < best.dist) best = { dist: d, value: { pieceId: p.id, kind: 'vertex', vertexIndex: vi } }
            }
            for (let ci = 0; ci < p.cutLine.length; ci++) {
              const c = p.cutLine[ci]
              if (c.type !== 'bezier') continue
              const pt = bezierAt(c, 0.5)
              const d = Math.hypot(local.x - pt.x, local.y - pt.y)
              if (d < best.dist) best = { dist: d, value: { pieceId: p.id, kind: 'pointOnCurve', curveIndex: ci } }
            }
          }
          setHoveredDeletablePoint(best.value)
          setHoveredDeletablePointPos(best.value ? { clientX: e.clientX, clientY: e.clientY } : null)
          if (best.value) {
            setHoveredDeletableNotch(null)
            setHoveredDeletableNotchPos(null)
            setHoveredPieceId(null)
            return
          }
        } else {
          setHoveredDeletablePoint(null)
          setHoveredDeletablePointPos(null)
        }
        const worldForNotch = toWorld(e.clientX, e.clientY)
        const piecesForNotchHover =
          selectedPieceIds.length > 0 ? pieces.filter((p) => selectedPieceIds.includes(p.id)) : pieces
        let bestNotch: { dist: number; pieceId: string; notchId: string } = {
          dist: HOVER_DELETE_HIT + 1,
          pieceId: '',
          notchId: '',
        }
        for (const p of piecesForNotchHover) {
          const local = worldToPieceLocal(worldForNotch, p)
          for (const notch of p.notches) {
            const { position } = getNotchPositionAndAngle(notch, p.cutLine, p.seamLine)
            const d = Math.hypot(local.x - position.x, local.y - position.y)
            if (d < bestNotch.dist) bestNotch = { dist: d, pieceId: p.id, notchId: notch.id }
            if (p.seamLine.length >= 3) {
              const seamPos = getNotchPositionAndAngleOnSeamLine(notch, p.cutLine, p.seamLine)
              if (seamPos) {
                const dSeam = Math.hypot(local.x - seamPos.position.x, local.y - seamPos.position.y)
                if (dSeam < bestNotch.dist) bestNotch = { dist: dSeam, pieceId: p.id, notchId: notch.id }
              }
            }
          }
        }
        if (bestNotch.dist <= HOVER_DELETE_HIT) {
          setHoveredDeletableNotch({ pieceId: bestNotch.pieceId, notchId: bestNotch.notchId })
          setHoveredDeletableNotchPos({ clientX: e.clientX, clientY: e.clientY })
          setHoveredDeletablePoint(null)
          setHoveredDeletablePointPos(null)
          setNotchPreview(null)
          setHoveredPieceId(null)
          return
        }
        setHoveredDeletableNotch(null)
        setHoveredDeletableNotchPos(null)
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
            const { piece, r, curves } = best
            const outwardAngle = outwardNormalAngleAt(curves, r.curveIndex, r.t)
            const angle = outwardAngle + 180
            const notchesOnSegment = piece.notches
              .map((n) => {
                const pos = getNotchPositionAndAngle(n, piece.cutLine, piece.seamLine).position
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
            if (p.cutLine.length === 0) continue
            const local = worldToPieceLocal(world, p)
            const r = nearestCurveIndexAndPoint(local, p.cutLine)
            const curve = r ? p.cutLine[r.curveIndex] : null
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
            setHoveredPieceId(null)
            return
          }
          setHoveredSegment(null)
          setHoveredSegmentPos(null)
        }
        if (tool === 'curvepoint' && selectedPieceIds.length === 1) {
          const world = toWorld(e.clientX, e.clientY)
          const HOVER_CURVEPOINT_HIT = 15
          const pieceId = selectedPieceIds[0]
          const p = pieces.find((x) => x.id === pieceId)
          if (p && p.cutLine.length > 0) {
            const local = worldToPieceLocal(world, p)
            const r = nearestCurveIndexAndPoint(local, p.cutLine)
            if (r && r.distance < HOVER_CURVEPOINT_HIT && p.cutLine[r.curveIndex]?.type === 'line') {
              setHoveredCurvepointSegment({ pieceId: p.id, curveIndex: r.curveIndex })
            } else {
              setHoveredCurvepointSegment(null)
            }
          } else {
            setHoveredCurvepointSegment(null)
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
      } else if (dragging.kind === 'rectangle') {
        const current = toWorld(e.clientX, e.clientY)
        setDragging((d) => (d && d.kind === 'rectangle' ? { ...d, current } : d))
      } else if (dragging.kind === 'vertex') {
        const piece = pieces.find((p) => p.id === dragging.pieceId)
        if (!piece) return
        const world = toWorld(e.clientX, e.clientY)
        const local = worldToPieceLocal(world, piece)
        const n = piece.cutLine.length
        const hasSeam = piece.seamLine.length >= 3
        const showSeam = hasSeam && !cutSeamSwappedSet.has(piece.id)
        let target = local
        if (showSeam && piece.seamAllowanceMm != null && piece.seamAllowanceMm > 0 && n > 0) {
          const prevIdx = (dragging.vertexIndex - 1 + n) % n
          const a1 = outwardNormalAngleAt(piece.cutLine, prevIdx, 1)
          const a2 = outwardNormalAngleAt(piece.cutLine, dragging.vertexIndex, 0)
          const rad = ((a1 + a2) / 2 * Math.PI) / 180
          const dx = piece.seamAllowanceMm * Math.cos(rad)
          const dy = piece.seamAllowanceMm * Math.sin(rad)
          target = { x: local.x + dx, y: local.y + dy }
        }
        updateVertex(dragging.pieceId, dragging.vertexIndex, target)
        snapSeamEdgeToMatch(dragging.pieceId, dragging.vertexIndex)
      } else if (dragging.kind === 'pointOnCurve') {
        const piece = pieces.find((p) => p.id === dragging.pieceId)
        if (!piece) return
        const world = toWorld(e.clientX, e.clientY)
        const local = worldToPieceLocal(world, piece)
        const hasSeam = piece.seamLine.length >= 3
        const showSeam = hasSeam && !cutSeamSwappedSet.has(piece.id)
        let target = local
        if (showSeam && piece.seamAllowanceMm != null && piece.seamAllowanceMm > 0) {
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
        const current = worldToPieceLocal(world, piece)
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
        const notch = piece.notches.find((n) => n.id === dragging.notchId)
        const world = toWorld(e.clientX, e.clientY)
        const local = worldToPieceLocal(world, piece)
        if (notch?.vertexIndex != null) {
          const n = piece.cutLine.length
          const hasSeam = piece.seamLine.length >= 3
          const showSeam = hasSeam && !cutSeamSwappedSet.has(piece.id)
          let target = local
          if (showSeam && piece.seamAllowanceMm != null && piece.seamAllowanceMm > 0 && n > 0) {
            const vi = notch.vertexIndex
            const prevIdx = (vi - 1 + n) % n
            const a1 = outwardNormalAngleAt(piece.cutLine, prevIdx, 1)
            const a2 = outwardNormalAngleAt(piece.cutLine, vi, 0)
            const rad = ((a1 + a2) / 2 * Math.PI) / 180
            target = { x: local.x + piece.seamAllowanceMm * Math.cos(rad), y: local.y + piece.seamAllowanceMm * Math.sin(rad) }
          }
          updateVertex(dragging.pieceId, notch.vertexIndex, target)
          return
        }
        const hasSeam = piece.seamLine.length >= 3
        const solidIsCut = !hasSeam || cutSeamSwappedSet.has(piece.id)
        const useSeam = hasSeam && !solidIsCut
        const curves = useSeam ? piece.seamLine : piece.cutLine
        const nearest = nearestCurveIndexAndPoint(local, curves)
        if (nearest && nearest.distance < 25) {
          const t = nearest.t ?? 0
          const angle = outwardNormalAngleAt(curves, nearest.curveIndex, t) + 180
          let storePos = nearest.point
          let storeAngle = angle
          if (useSeam) {
            const cutNearest = nearestCurveIndexAndPoint(nearest.point, piece.cutLine)
            if (cutNearest) {
              storePos = cutNearest.point
              const ct = cutNearest.t ?? 0
              storeAngle = outwardNormalAngleAt(piece.cutLine, cutNearest.curveIndex, ct) + 180
            }
          }
          const notchesOnSegment = piece.notches.map((n) => {
            if (n.id === dragging.notchId) return t
            const ct = getNotchCurveIndexAndT(n, piece.cutLine, piece.seamLine)
            if (ct && ct.curveIndex === nearest.curveIndex) return ct.t
            const pos = getNotchPositionAndAngle(n, piece.cutLine, piece.seamLine).position
            const nr = nearestCurveIndexAndPoint(pos, curves)
            return nr && nr.curveIndex === nearest.curveIndex && nr.t != null ? nr.t : null
          }).filter((x): x is number => x != null)
          const curve = curves[nearest.curveIndex]
          const distanceMmLeft = distanceToPrevVertexOrNotch(curve, t, notchesOnSegment)
          const distanceMmRight = distanceToNextVertexOrNotch(curve, t, notchesOnSegment)
          setNotchPreview({
            pieceId: dragging.pieceId,
            position: nearest.point,
            angle,
            curveIndex: nearest.curveIndex,
            t,
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
    ]
  )

  useEffect(() => {
    if (!grainContextMenu) return
    const onClose = () => setGrainContextMenu(null)
    document.addEventListener('pointerdown', onClose)
    return () => document.removeEventListener('pointerdown', onClose)
  }, [grainContextMenu])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      const segmentActive = hoveredSegment ?? (segmentMenuPinned ? pinnedSegment : null)
      if (tool === 'digitize' && digitizeState && e.key === 'Escape') {
        e.preventDefault()
        cancelDigitize()
        return
      }
      if (grainContextMenu && !inInput && e.key === 'Escape') {
        e.preventDefault()
        setGrainContextMenu(null)
        return
      }
      if (grainFlipHover && !grainContextMenu && !inInput && e.key === ' ') {
        e.preventDefault()
        setGrainContextMenu({ pieceId: grainFlipHover.pieceId, clientX: grainFlipHover.clientX, clientY: grainFlipHover.clientY })
        return
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
            const pts = offsetSegmentPoints(p.cutLine, segmentActive.curveIndex, mm)
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
      if (e.key === 'd' || e.key === 'D') {
        if (!inInput) {
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
      if ((e.key === 'f' || e.key === 'F') && !inInput && hoveredDeletableNotch) {
        e.preventDefault()
        toggleNotchAnchor(hoveredDeletableNotch.pieceId, hoveredDeletableNotch.notchId)
        return
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (hoveredSeamAssignmentId) {
        e.preventDefault()
        removeSeamAssignment(hoveredSeamAssignmentId)
        setHoveredSeamAssignmentId(null)
        return
      }
      if (hoveredDeletableNotch) {
        e.preventDefault()
        removeNotch(hoveredDeletableNotch.pieceId, hoveredDeletableNotch.notchId)
        setHoveredDeletableNotch(null)
        setHoveredDeletableNotchPos(null)
        return
      }
      if (!hoveredDeletablePoint) return
      e.preventDefault()
      if (hoveredDeletablePoint.kind === 'vertex') {
        removeVertex(hoveredDeletablePoint.pieceId, hoveredDeletablePoint.vertexIndex)
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
    hoveredSeamAssignmentId,
    hoveredSegment,
    segmentMenuPinned,
    pinnedSegment,
    segmentMenuMm,
    pieces,
    removeVertex,
    removeNotch,
    toggleNotchAnchor,
    removeSeamAssignment,
    setTool,
    offsetSegment,
    addInternalLine,
    closeSegmentMenu,
    hoveredPieceId,
    selectedPieceIds,
    setPendingNahtzugabeClick,
    grainFlipHover,
    grainContextMenu,
    digitizeState,
    cancelDigitize,
    startDigitize,
  ])

  const handlePointerUp = useCallback(() => {
    if (dragging?.kind === 'digitizeDrag') {
      finishDigitizeDrag()
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
        updateNotch(dragging.pieceId, dragging.notchId, {
          position: notchPreview.storePos,
          angle: notchPreview.storeAngle,
          vertexIndex: undefined,
        })
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
        const defaultDepth = 4
        const defaultWidth = 6
        const isDrag = dragDist >= DRAG_THRESHOLD
        const curves = useSeamLine && piece.seamLine.length >= 3 ? piece.seamLine : piece.cutLine
        const angle = isDrag
            ? (Math.atan2(dy, dx) * 180) / Math.PI
            : outwardNormalAngleAt(curves, curveIndex, t) + 180
        const id = 'n' + Math.random().toString(36).slice(2, 9)
        if (useSeamLine && piece.seamLine.length >= 3) {
          let notchPos = position
          let notchAngle = angle
          const cutNearest = nearestCurveIndexAndPoint(position, piece.cutLine)
          if (cutNearest) {
            notchPos = cutNearest.point
            if (!isDrag) {
              const ct = cutNearest.t ?? 0
              notchAngle = outwardNormalAngleAt(piece.cutLine, cutNearest.curveIndex, ct) + 180
            }
          }
          addNotch(pieceId, {
            id,
            position: notchPos,
            angle: notchAngle,
            type: 'single',
            depth: isDrag ? dragDist : defaultDepth,
            width: defaultWidth,
          })
        } else {
          const inMiddle = t > 1e-6 && t < 1 - 1e-6
          const n = piece.cutLine.length
          let vertexIndex: number | undefined
          if (inMiddle) {
            const curve = piece.cutLine[curveIndex]
            if (curve.type === 'bezier') {
              insertPointOnCutLine(pieceId, curveIndex, position, t)
            } else {
              insertPointOnCutLine(pieceId, curveIndex, position)
            }
            vertexIndex = curveIndex + 1
          } else {
            vertexIndex = t < 0.5 ? curveIndex : (curveIndex + 1) % n
          }
          addNotch(pieceId, {
            id,
            position,
            angle,
            type: 'single',
            depth: isDrag ? dragDist : defaultDepth,
            width: defaultWidth,
            vertexIndex,
          })
        }
        setTool('select')
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
      snapSeamEdgeToMatch(dragging.pieceId, dragging.vertexIndex)
    }
    setDragging(null)
    setHoveredPieceId(null)
  }, [dragging, pieces, tool, addPiece, addCurveToCutLine, addInternalLine, addInternalLines, insertPointOnCutLine, addNotch, addDrill, updateNotch, notchPreview, setTool, finishDigitizeDrag, snapSeamEdgeToMatch])
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
        setHoveredDeletablePointPos(null)
        setHoveredDeletableNotch(null)
        setHoveredDeletableNotchPos(null)
        setNotchPreview(null)
        setHoveredSeamForNahtzuordnung(null)
        setHoveredSeamAssignmentId(null)
      }}
      onWheel={handleWheel}
      style={{
        touchAction: 'none',
        cursor: rulerMode ? 'crosshair' : tool === 'pan' ? 'grab' : tool === 'rectangle' || tool === 'point' || tool === 'curvepoint' || tool === 'line' || tool === 'internalLine' || tool === 'internalCircle' || tool === 'digitize' ? 'crosshair' : 'default',
      }}
    >
      <div className="workspace-version">Aktuell V. 0.0.3</div>
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
          Leertaste: Menü
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
              minWidth: 140,
              padding: '4px 0',
              fontSize: 13,
              fontFamily: 'sans-serif',
            }}
          >
            <button
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
              Flippen
            </button>
          </div>
        </div>
      )}
      {hoveredDeletablePoint && hoveredDeletablePointPos && (
        <div
          className="grain-flip-tooltip"
          style={{
            position: 'fixed',
            left: hoveredDeletablePointPos.clientX,
            top: hoveredDeletablePointPos.clientY,
            transform: 'translate(8px, 8px)',
            pointerEvents: 'none',
            zIndex: 1000,
          }}
        >
          {hoveredDeletablePoint.kind === 'pointOnCurve' ? 'Entf: Kurve begradigen' : 'Entf: Punkt löschen'}
        </div>
      )}
      {hoveredDeletableNotch && hoveredDeletableNotchPos && (() => {
        const hPiece = pieces.find((p) => p.id === hoveredDeletableNotch.pieceId)
        const hNotch = hPiece?.notches.find((n) => n.id === hoveredDeletableNotch.notchId)
        const anchored = hNotch?.vertexIndex != null
        return (
          <div
            className="grain-flip-tooltip"
            style={{
              position: 'fixed',
              left: hoveredDeletableNotchPos.clientX,
              top: hoveredDeletableNotchPos.clientY,
              transform: 'translate(8px, 8px)',
              pointerEvents: 'none',
              zIndex: 1000,
            }}
          >
            {anchored ? '⚓ Verankert' : '↔ Frei'} · Entf: Löschen · F: {anchored ? 'Lösen' : 'Verankern'}
          </div>
        )
      })()}
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
                const pts = offsetSegmentPoints(p.cutLine, segmentForMenu.curveIndex, mm)
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
          {pieces.map((piece) => {
            return (
            <PieceGroup
              key={piece.id}
              piece={piece}
              isSelected={selectedPieceIds.includes(piece.id)}
              isHovered={hoveredPieceId === piece.id}
              hoveredSegmentCurveIndex={effectiveSegmentForHighlight?.pieceId === piece.id ? effectiveSegmentForHighlight.curveIndex : null}
              onPointerDown={handlePointerDown}
              cutSeamSwapped={cutSeamSwappedSet.has(piece.id)}
              showGrain={showGrain}
              showNotches={showNotches}
              showDrills={showDrills}
              showInternalLines={showInternalLines}
              showPieceNames={showPieceNames}
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
            />
            )
          })}
          {notchPreview && (() => {
            const piece = pieces.find((p) => p.id === notchPreview.pieceId)
            if (!piece) return null
            const tx = `translate(${piece.transform.x},${piece.transform.y}) rotate(${piece.transform.rotation}) scale(${piece.transform.mirrored ? -1 : 1},1)`
            const depth = 4
            const width = 6
            const [a, b, c] = notchTriangleCorners(notchPreview.position, notchPreview.angle, depth, width)
            const fillD = `M ${a.x} ${a.y} L ${b.x} ${b.y} L ${c.x} ${c.y} Z`
            const edgesD = `M ${a.x} ${a.y} L ${c.x} ${c.y} L ${b.x} ${b.y}`
            const labelOffset = 14
            const fontSize = 7
            return (
              <g transform={tx} pointerEvents="none">
                <path d={fillD} fill="#fff" stroke="none" />
                <path d={edgesD} fill="none" stroke={NOTCH_STROKE} strokeWidth={0.8} strokeLinejoin="round" />
                <text
                  x={notchPreview.position.x - labelOffset}
                  y={notchPreview.position.y}
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
                  x={notchPreview.position.x + labelOffset}
                  y={notchPreview.position.y}
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
          {/* Eckpunkte und weiche Punkte: auf cutLine oder seamLine je nach gewählter Ansicht (solid) */}
          {showPoints && (tool === 'select' || tool === 'point' || tool === 'curvepoint') &&
            (() => {
              const ps = 1 / view.zoom
              return selectedPieceIds.flatMap((pieceId) => {
                const piece = pieces.find((p) => p.id === pieceId)
                if (!piece || piece.cutLine.length === 0) return []
                const cutLine = piece.cutLine
                const hasSeam = piece.seamLine.length >= 3
                const solidIsCut = !hasSeam || cutSeamSwappedSet.has(pieceId)
                const n = cutLine.length
                return Array.from({ length: n }, (_, vi) => {
                  if (piece.notches.some((no) => no.vertexIndex === vi)) return null
                  const cutV = vi === 0 ? cutLine[0].start : cutLine[vi - 1].end
                  const v = solidIsCut || !hasSeam
                    ? cutV
                    : (nearestCurveIndexAndPoint(cutV, piece.seamLine)?.point ?? cutV)
                  const w = pieceLocalToWorld(v, piece)
                  const isSoft = (piece.softVertices ?? []).includes(vi)
                  const [fill, stroke] = isSoft ? COLOR_SOFT_PUNKT : COLOR_ECKPUNKT
                  const eckSize = 3 * ps
                  return isSoft ? (
                    <circle
                      key={`${pieceId}-v-${vi}`}
                      cx={w.x}
                      cy={w.y}
                      r={1.5 * ps}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={0.6 * ps}
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
                      strokeWidth={0.6 * ps}
                      pointerEvents="none"
                    />
                  )
                })
              })
            })()
          }
          {/* Kurvenpunkte (Punkt auf Kurve): immer cutLine – Indizes für Ziehen eindeutig */}
          {showPoints && (tool === 'select' || tool === 'point' || tool === 'curvepoint') &&
            (() => {
              const ps = 1 / view.zoom
              return selectedPieceIds.flatMap((pieceId) => {
                const piece = pieces.find((p) => p.id === pieceId)
                if (!piece) return []
                const cutLine = piece.cutLine
                const [fill, stroke] = COLOR_PUNKT_AUF_KURVE
                return cutLine.flatMap((c, ci) => {
                  if (c.type !== 'bezier') return []
                  const ptOnCurve = bezierAt(c, 0.5)
                  const w = pieceLocalToWorld(ptOnCurve, piece)
                  return [
                    <circle
                      key={`${pieceId}-oncurve-${ci}`}
                      cx={w.x}
                      cy={w.y}
                      r={1.5 * ps}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={0.6 * ps}
                      pointerEvents="none"
                    />,
                  ]
                })
              })
            })()}
          {/* Digitalisierung: Linien/Kurven, Punkte, Handles, Vorschau, Close-Indikator */}
          {tool === 'digitize' && digitizeState && digitizeState.nodes.length > 0 && (() => {
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
                    <circle cx={n.handleOut.x} cy={n.handleOut.y} r={1.5}
                      fill="#e65100" stroke="#fff" strokeWidth={0.4} />
                    <circle cx={reflected.x} cy={reflected.y} r={1.2}
                      fill="none" stroke="#e65100" strokeWidth={0.4} opacity={0.5} />
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
                    cx={n.point.x} cy={n.point.y}
                    r={i === 0 && digitizeNearFirst ? 3.5 : 2}
                    fill={i === 0 && digitizeNearFirst ? '#4caf50' : '#2196F3'}
                    stroke={i === 0 && digitizeNearFirst ? '#1b5e20' : '#0d47a1'}
                    strokeWidth={0.6}
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
            const { position, current, curveIndex, t } = dragging
            const dx = current.x - position.x
            const dy = current.y - position.y
            const dragDist = Math.hypot(dx, dy)
            const isDragPreview = dragDist >= 2
            const depth = isDragPreview ? dragDist : 4
            const angle = isDragPreview
                ? (Math.atan2(dy, dx) * 180) / Math.PI
                : outwardNormalAngleAt(piece.cutLine, curveIndex, t) + 180
            const width = 6
            const [a, b, c] = notchTriangleCorners(position, angle, depth, width)
            const wa = pieceLocalToWorld(a, piece)
            const wb = pieceLocalToWorld(b, piece)
            const wc = pieceLocalToWorld(c, piece)
            const fillD = `M ${wa.x} ${wa.y} L ${wb.x} ${wb.y} L ${wc.x} ${wc.y} Z`
            const edgesD = `M ${wa.x} ${wa.y} L ${wc.x} ${wc.y} L ${wb.x} ${wb.y}`
            return (
              <g pointerEvents="none">
                <path d={fillD} fill="#fff" stroke="none" />
                <path d={edgesD} fill="none" stroke={NOTCH_STROKE} strokeWidth={0.8} strokeDasharray="4 2" strokeLinejoin="round" />
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
            return (
              <g pointerEvents="none">
                <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="#1565c0" strokeWidth={1.2} />
                <circle cx={start.x} cy={start.y} r={2} fill="#1565c0" stroke="#fff" strokeWidth={0.8} />
                <circle cx={end.x} cy={end.y} r={2} fill="#1565c0" stroke="#fff" strokeWidth={0.8} />
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
            let d = ''
            for (const ci of indices) {
              const seg = piece.cutLine[ci]
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
          {showPoints && seamAssignments.length > 0 &&
            seamAssignments.map((a: SeamAssignment) => {
              const pieceA = pieces.find((p) => p.id === a.pieceIdA)
              const pieceB = pieces.find((p) => p.id === a.pieceIdB)
              if (!pieceA?.cutLine?.length || !pieceB?.cutLine?.length) return null
              const segsA = a.curveIndicesA.map((ci) => pieceA.cutLine[ci]).filter(Boolean)
              const segsB = a.curveIndicesB.map((ci) => pieceB.cutLine[ci]).filter(Boolean)
              if (segsA.length === 0 || segsB.length === 0) return null
              const lenA = segsA.reduce((sum, s) => sum + curveSegmentArcLength(s, 0, 1), 0)
              const lenB = segsB.reduce((sum, s) => sum + curveSegmentArcLength(s, 0, 1), 0)
              const diffMm = Math.abs(lenA - lenB)
              const showLengthDiff = diffMm >= 0.1
              const notchCountA = countNotchesOnEdge(pieceA, a.curveIndicesA)
              const notchCountB = countNotchesOnEdge(pieceB, a.curveIndicesB)
              const notchMismatch = notchCountA !== notchCountB
              const subsA = getSubSegments(pieceA, a.curveIndicesA)
              const subsB = getSubSegments(pieceB, a.curveIndicesB)
              let subDiffs: { lenA: number; lenB: number; midA: Point; midB: Point }[] | null = null
              if (!notchMismatch && subsA.length === subsB.length && subsA.length >= 2) {
                subDiffs = subsA.map((sa, i) => {
                  const sb = subsB[subsB.length - 1 - i]
                  return {
                    lenA: sa.length,
                    lenB: sb.length,
                    midA: pieceLocalToWorld(sa.midpoint, pieceA),
                    midB: pieceLocalToWorld(sb.midpoint, pieceB),
                  }
                })
              }
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
              return (
                <g
                  key={a.id}
                  pointerEvents="stroke"
                  onPointerEnter={() => setHoveredSeamAssignmentId(a.id)}
                  onPointerLeave={() => setHoveredSeamAssignmentId(null)}
                  style={{ cursor: hoveredSeamAssignmentId === a.id ? 'pointer' : 'default' }}
                  data-title="Backspace oder Entf: Nahtverbindung entfernen"
                >
                  {/* Unsichtbare breite Linie für Hover-/Trefferfläche */}
                  <line x1={midA.x} y1={midA.y} x2={midB.x} y2={midB.y} stroke="transparent" strokeWidth={14} />
                  <line x1={midA.x} y1={midA.y} x2={midB.x} y2={midB.y} stroke="#1565c0" strokeWidth={1} strokeDasharray="6 4" />
                  <path d={`M ${wing1.x} ${wing1.y} L ${midB.x} ${midB.y} L ${wing2.x} ${wing2.y}`} fill="none" stroke="#1565c0" strokeWidth={1} />
                  {showLengthDiff && (
                    <text
                      x={labelX}
                      y={labelY}
                      textAnchor="middle"
                      fontSize={9}
                      fill="#c62828"
                      fontWeight="600"
                      fontFamily="sans-serif"
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
                    >
                      ⚠ Notch {notchCountA}:{notchCountB}
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
      {toastMessage && (
        <div style={{
          position: 'absolute',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          background: toastMessage.startsWith('success:') ? '#2e7d32' : '#d32f2f',
          color: '#fff',
          padding: '8px 20px',
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 500,
          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          zIndex: 9999,
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
        }}>
          {toastMessage.startsWith('success:')
            ? toastMessage.slice(8)
            : toastMessage.startsWith('error:')
              ? toastMessage.slice(6)
              : toastMessage}
        </div>
      )}
    </div>
  )
}

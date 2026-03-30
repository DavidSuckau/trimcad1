import { create } from 'zustand'
import type {
  Workspace,
  PatternPiece,
  ViewState,
  Point,
  Line,
  Curve,
  Notch,
  Drill,
  SeamAssignment,
  SeamAssignmentKindId,
  DigitizeNode,
  DigitizeState,
  BatchSelectionFilter,
  BatchSelectionTarget,
} from '../types/model'
import { SEAM_ASSIGNMENT_KIND_IDS } from '../types/model'
import {
  offsetCurvesInwardForSeam,
  deriveCutLineFromSeamWithValidation,
  offsetSegmentPoints,
  validateContourAfterVertexMove,
} from '../geometry/offset'
import { splitBezierAt, joinBezierSegments, adjustControlPointsForPointOnCurve, pointAtPathLength } from '../geometry/curveToPath'
import { nearestCurveIndexAndPoint } from '../geometry/nearestOnCurve'
import {
  getSubSegments,
  countNotchesOnEdge,
  getNotchesOnEdge,
  edgeTotalLength,
  getCurvesForSeamEdge,
  resolvedSeamAssignmentCurveIndices,
  bestSeamSubSegmentPairing,
  snapVertexToEdgeLength,
  SEAM_EDGE_LENGTH_SNAP_TOLERANCE_MM,
  mapMasterVertexIndexToCutVertexIndex,
} from '../geometry/seamUtils'
import { getNotchPositionAndAngleOnCutLine } from '../geometry/notchOnCurve'
import { pieceLocalToWorld, getPiecePivotLocal } from '../geometry/pieceTransform'
import { applySharpCornerPromotion } from '../geometry/softVertexPromotion'
import { useSeamLineForVertexEditing, useSeamLineForPointCurveEditing } from '../geometry/vertexMaster'
import { isNotchSpacingValidForCandidate } from '../geometry/notchMinSpacing'
import { resyncNotchesAfterCutLineRebuilt, seamVertexNearProjectedNotch } from '../geometry/notchResyncCutLine'
import { applyUniformScaleToPiece, getReferenceEdgePivotLocal } from '../geometry/scalePieceLocal'
import { applySeamAssignmentCutTrim } from '../geometry/seamAssignmentCutTrim'
import type { TrimTexProjectFileV1 } from '../persistence/trimtexProjectJson'
import type { ConfiguratorInstance, ConfiguratorKindId, ConfiguratorPartParams } from '../configurators/types'
import { generateConfiguratorPartGeometry } from '../configurators/generators'
import { getDefaultConfiguratorParts } from '../configurators/registry'
import { batchTargetKey, filterBatchTargets, mergeBatchTargets } from '../workspace/workspaceMarqueeSelection'

const defaultView: ViewState = { zoom: 1, panX: 0, panY: 0 }

/** Passt seamAssignment-Indices an, nachdem eine Kurve bei splitCurveIndex geteilt wurde. */
function adjustSeamAfterInsert(assignments: SeamAssignment[], pieceId: string, splitCurveIndex: number): SeamAssignment[] {
  const shiftCi = (ci: number) => ci > splitCurveIndex ? ci + 1 : ci
  return assignments.map((a) => {
    const adjust = (indices: number[]): number[] | null => {
      let changed = false
      const result: number[] = []
      for (const ci of indices) {
        if (ci === splitCurveIndex) {
          result.push(ci, ci + 1)
          changed = true
        } else if (ci > splitCurveIndex) {
          result.push(ci + 1)
          changed = true
        } else {
          result.push(ci)
        }
      }
      return changed ? result : null
    }
    const newA = a.pieceIdA === pieceId ? adjust(a.curveIndicesA) : null
    const newB = a.pieceIdB === pieceId ? adjust(a.curveIndicesB) : null
    if (!newA && !newB) return a
    return {
      ...a,
      ...(newA ? { curveIndicesA: newA, clickedCurveA: a.pieceIdA === pieceId ? shiftCi(a.clickedCurveA) : a.clickedCurveA } : {}),
      ...(newB ? { curveIndicesB: newB, clickedCurveB: a.pieceIdB === pieceId ? shiftCi(a.clickedCurveB) : a.clickedCurveB } : {}),
    }
  })
}

/** Passt seamAssignment-Indices an, nachdem ein Vertex entfernt wurde (zwei Kurven → eine). */
function adjustSeamAfterRemove(assignments: SeamAssignment[], pieceId: string, vertexIndex: number, oldN: number): SeamAssignment[] {
  const prevIdx = (vertexIndex - 1 + oldN) % oldN
  const nextIdx = vertexIndex
  const mergedIdx = Math.min(prevIdx, nextIdx)
  const isWrapping = vertexIndex === 0
  const remapCi = (ci: number) => {
    if (ci === prevIdx || ci === nextIdx) return mergedIdx
    if (!isWrapping && ci > nextIdx) return ci - 1
    return ci
  }
  return assignments.map((a) => {
    const adjust = (indices: number[]): number[] | null => {
      let changed = false
      const seen = new Set<number>()
      const result: number[] = []
      for (const ci of indices) {
        const newCi = remapCi(ci)
        if (newCi !== ci) changed = true
        if (!seen.has(newCi)) {
          seen.add(newCi)
          result.push(newCi)
        }
      }
      return changed ? result : null
    }
    const newA = a.pieceIdA === pieceId ? adjust(a.curveIndicesA) : null
    const newB = a.pieceIdB === pieceId ? adjust(a.curveIndicesB) : null
    if (!newA && !newB) return a
    return {
      ...a,
      ...(newA ? { curveIndicesA: newA, clickedCurveA: a.pieceIdA === pieceId ? remapCi(a.clickedCurveA) : a.clickedCurveA } : {}),
      ...(newB ? { curveIndicesB: newB, clickedCurveB: a.pieceIdB === pieceId ? remapCi(a.clickedCurveB) : a.clickedCurveB } : {}),
    }
  })
}

/** Fasst zwei benachbarte Segmente zu einem zusammen (evtl. Bezier-Erhalt statt Begradigung). */
function mergeAdjacentSegments(prev: Curve, next: Curve): Curve {
  if (prev.type === 'line' && next.type === 'line') {
    return { type: 'line', start: { ...prev.start }, end: { ...next.end } }
  }
  if (prev.type === 'bezier' && next.type === 'bezier') {
    const joined = joinBezierSegments(prev, next)
    if (joined) return joined
  }
  return { type: 'line', start: { ...prev.start }, end: { ...next.end } }
}

function cloneCurvesArray(curves: Curve[]): Curve[] {
  return curves.map((c) =>
    c.type === 'line'
      ? { type: 'line', start: { ...c.start }, end: { ...c.end } }
      : { type: 'bezier', start: { ...c.start }, end: { ...c.end }, cp1: { ...c.cp1 }, cp2: { ...c.cp2 } }
  )
}

function nearestCutVertexIndex(cutLine: Curve[], point: Point): number | null {
  if (cutLine.length === 0) return null
  let bestIdx = 0
  let bestDist = Infinity
  for (let i = 0; i < cutLine.length; i++) {
    const v = i === 0 ? cutLine[0].start : cutLine[i - 1].end
    const d = Math.hypot(point.x - v.x, point.y - v.y)
    if (d < bestDist) {
      bestDist = d
      bestIdx = i
    }
  }
  return bestIdx
}

function createDefaultPiece(id: string, number: string): PatternPiece {
  return {
    id,
    number,
    name: `Teil ${number}`,
    cutLine: [],
    seamLine: [],
    seamAllowanceMm: null,
    notches: [],
    drills: [],
    grainLine: null,
    internalLines: [],
    layer: 'CUT',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    softVertices: [],
    fillInterior: true,
    material: '',
    bomQuantity: 1,
  }
}

type Tool =
  | 'select'
  | 'pan'
  | 'line'
  | 'bezier'
  | 'notch'
  | 'drill'
  | 'rectangle'
  | 'point'
  | 'curvepoint'
  | 'internalLine'
  | 'internalCircle'
  | 'kante'
  | 'massstab'
  | 'digitize'

/** Hintergrundbild auf der Arbeitsfläche (ohne Kalibrierung, nur Anzeige). */
type ImageDigitizeSession = {
  imageDataUrl: string | null
  imageSizePx: { width: number; height: number } | null
  /** Bildposition im Workspace (mm), Mittelpunkt entspricht dem Bildzentrum. */
  imagePosition: Point
  /** mm pro Bildpixel für Darstellung (Skalierung auf der Fläche). */
  renderMmPerPixel: number
  /** true: Bild nicht mehr verschieben/skalieren (nur Auswahl aufheben / wieder freigeben). */
  locked?: boolean
}

export type NotchType = 'strich' | 'kerbe'

export type NotchSetting = {
  type: NotchType
  widthMm: number
  depthMm: number
}

type Store = {
  workspace: Workspace
  selectedPieceIds: string[]
  selectedPoint: { pieceId: string; curveIndex: number; pointKey: string } | null
  tool: Tool
  // UI
  showGrid: boolean
  showPoints: boolean
  showGrain: boolean
  showNotches: boolean
  showDrills: boolean
  showInternalLines: boolean
  showPieceNames: boolean
  /** Bogenlängen entlang der Schnittkontur (Ecke↔Ecke, Kerbe↔Kerbe, …) auf allen Teilen. */
  showContourMeasurements: boolean
  rulerMode: boolean
  rulerLine: { start: Point; end: Point } | null
  pendingNahtzugabeClick: boolean
  nahtzugabeDialogPieceId: string | null
  /** Dialog „Teil-Eigenschaften“ (Name, Flächenfüllung). */
  piecePropertiesDialogPieceId: string | null
  /** Nahtzuordnung: 'first' = erste Naht anklicken, 'second' = zweite Naht (anderes Teil) anklicken */
  nahtzuordnungMode: 'idle' | 'first' | 'second'
  pendingNahtzuordnungFirst: { pieceId: string; curveIndices: number[]; clickedCurve: number } | null
  showSettingsModal: boolean
  showStuecklisteModal: boolean
  showHelpModal: boolean
  /** Kompakte Tastenkürzel-Übersicht (Hilfe-Menü). */
  showShortcutListModal: boolean
  dxfExportScale: number
  /** Kommagetrennte zusätzliche Layer-Namen für DXF-Import (Schnittkontur). */
  dxfImportExtraCutLayers: string
  /** Globaler Faktor für DXF-Import nach Unit-Erkennung (z. B. 10 bei 10x zu klein). */
  dxfImportScale: number
  notchSettings: NotchSetting[]
  toastMessage: string | null
  /** ID der SeamAssignment für die das Anpassungs-Modal angezeigt wird */
  seamAdjustmentDialog: string | null
  /** Nahtzuordnung: Eigenschaften (Nummer, Nahtart), Leertaste bei Hover */
  seamAssignmentMetaDialogId: string | null
  /** Maßstab: Referenzkante gewählt, Ziel-Länge eingeben. */
  massstabDialog: { pieceId: string; curveIndices: number[]; currentLengthMm: number } | null
  digitizeState: DigitizeState | null
  imageDigitizeSession: ImageDigitizeSession | null
  /** Hintergrundbild ist ausgewählt (wie ein Teil). */
  workspaceImageSelected: boolean
  /** Konfigurator-Modale/Instanzen sind rein UI-Staat (noch nicht im Projekt persistiert). */
  configuratorModalOpen: boolean
  configuratorInstances: ConfiguratorInstance[]
  rockGeneratorModalOpen: boolean

  setView: (v: Partial<ViewState>) => void
  addPiece: (piece?: Partial<PatternPiece>) => string
  updatePiece: (id: string, upd: Partial<PatternPiece>) => void
  deletePiece: (id: string) => void
  selectPiece: (id: string | null, addToSelection?: boolean) => void
  setTool: (t: Tool) => void
  setShowGrid: (v: boolean) => void
  setShowPoints: (v: boolean) => void
  setShowGrain: (v: boolean) => void
  setShowNotches: (v: boolean) => void
  setShowDrills: (v: boolean) => void
  setShowInternalLines: (v: boolean) => void
  setShowPieceNames: (v: boolean) => void
  setShowContourMeasurements: (v: boolean) => void
  setRulerMode: (v: boolean) => void
  setRulerLine: (v: { start: Point; end: Point } | null) => void
  setPendingNahtzugabeClick: (v: boolean) => void
  setNahtzugabeDialogPieceId: (v: string | null) => void
  setPiecePropertiesDialogPieceId: (v: string | null) => void
  setNahtzuordnungMode: (v: 'idle' | 'first' | 'second') => void
  setPendingNahtzuordnungFirst: (v: { pieceId: string; curveIndices: number[]; clickedCurve: number } | null) => void
  setShowSettingsModal: (v: boolean) => void
  setShowStuecklisteModal: (v: boolean) => void
  setShowHelpModal: (v: boolean) => void
  setShowShortcutListModal: (v: boolean) => void
  setShowConfiguratorModal: (v: boolean) => void
  setShowRockGeneratorModal: (v: boolean) => void
  createConfiguratorInstance: (kindId: ConfiguratorKindId) => string
  updateConfiguratorPartParams: (
    instanceId: string,
    partId: string,
    patch: Partial<ConfiguratorPartParams>,
  ) => void
  regenerateConfiguratorPart: (instanceId: string, partId: string) => void
  setDxfExportScale: (v: number) => void
  setDxfImportExtraCutLayers: (v: string) => void
  setDxfImportScale: (v: number) => void
  setToastMessage: (v: string | null) => void
  updateNotchSetting: (index: number, upd: Partial<NotchSetting>) => void
  addSeamAssignment: (pieceIdA: string, curveIndicesA: number[], clickedCurveA: number, pieceIdB: string, curveIndicesB: number[], clickedCurveB: number) => void
  removeSeamAssignment: (id: string) => void
  setSeamAdjustmentDialog: (v: string | null) => void
  setSeamAssignmentMetaDialogId: (v: string | null) => void
  updateSeamAssignmentMeta: (
    assignmentId: string,
    patch: { orderNumber?: number | null; seamKind?: SeamAssignmentKindId | null }
  ) => void
  setMassstabDialog: (v: Store['massstabDialog']) => void
  /** Skaliert das Teil so, dass die gewählte Referenzkante `targetLengthMm` hat (Dialog schließen bei Erfolg). */
  applyMassstab: (targetLengthMm: number) => void
  /** Passt Notch-Positionen auf der Zielseite an die Referenzseite an. */
  adjustSeamNotches: (assignmentId: string, keepSide: 'A' | 'B') => void
  /** Prüft alle SeamAssignments: Gesamtlänge gleich + Notch-Abstände ungleich → Modal öffnen. */
  checkSeamAdjustment: () => void
  /** Snap bei Vertex-Drag: wenn Differenz < 5mm, Vertex exakt auf 0 setzen. */
  snapSeamEdgeToMatch: (
    pieceId: string,
    vertexIndex: number,
    options?: { notchResyncBaseline?: { notches: Notch[]; cutLine: Curve[] } }
  ) => void

  addCurveToCutLine: (pieceId: string, curve: Curve) => void
  addInternalLine: (pieceId: string, curve: Curve) => void
  addInternalLines: (pieceId: string, curves: Curve[]) => void
  removeInternalLine: (pieceId: string, curveIndex: number) => void
  updateCurvePoint: (pieceId: string, curveIndex: number, pointKey: string, p: Point) => void
  addNotch: (pieceId: string, notch: Notch) => void
  removeNotch: (pieceId: string, notchId: string) => void
  /** Entfernt nur den Kontur-Knick (Vertex) eines Notchs, ohne den Notch zu löschen. */
  removeNotchAnchor: (pieceId: string, notchId: string) => void
  /** Wechselt den Notch-Modus: Verankert ↔ Frei (mit/ohne eigenen Konturpunkt). */
  toggleNotchAnchor: (pieceId: string, notchId: string) => void
  updateNotch: (pieceId: string, notchId: string, upd: Partial<Pick<Notch, 'position' | 'angle' | 'vertexIndex'>>) => void
  addDrill: (pieceId: string, drill: Drill) => void
  movePiece: (pieceId: string, dx: number, dy: number) => void
  setSelectedPoint: (v: Store['selectedPoint']) => void
  applyOffset: (pieceId: string, deltaMm: number) => void
  removeSeamAllowance: (pieceId: string) => void
  insertPointOnCutLine: (pieceId: string, curveIndex: number, point: Point, t?: number) => boolean
  updateVertex: (
    pieceId: string,
    vertexIndex: number,
    point: Point,
    skipSeamRecalc?: boolean,
    /** Seam-Master-Drag: Kerben immer von dieser CutLine/Notch-Startlage auf die neue Cut projizieren (keine Ketten-Resyncs). */
    notchOpts?: { notchResyncBaseline?: { notches: Notch[]; cutLine: Curve[] } }
  ) => void
  replaceSegmentWithBezier: (pieceId: string, curveIndex: number, cp1: Point, cp2?: Point) => void
  movePointOnCurve: (pieceId: string, curveIndex: number, t: number, newPoint: Point, skipSeamRecalc?: boolean) => void
  removeVertex: (pieceId: string, vertexIndex: number) => void
  convertBezierSegmentToLine: (pieceId: string, curveIndex: number) => void
  /** Eckpunkt weich (blau) / fest (rot); gleiche Index-Basis wie updateVertex/removeVertex. */
  setVertexSoft: (pieceId: string, vertexIndex: number, soft: boolean) => void
  flipPieceAlongGrain: (pieceId: string) => void
  /** Teil auf der Arbeitsfläche um 90° im Uhrzeigersinn drehen (um Teilmittelpunkt). */
  rotatePiece90: (pieceId: string) => void
  /** Rotation eines Teils setzen (Grad), Pivot bleibt fest. Für freie Drehung. */
  setPieceRotation: (pieceId: string, rotationDeg: number) => void
  /** Drehpunkt (Pivot) setzen oder zurücksetzen (null = Bounds-Mitte). */
  setPiecePivot: (pieceId: string, pivotLocal: Point | null) => void
  /** Laufrichtungslinie (Fadenlauf) setzen. */
  setGrainLine: (pieceId: string, line: Line) => void
  /** Teil so drehen, dass der Laufrichtungspfeil senkrecht ausgerichtet ist. */
  alignPieceToGrain: (pieceId: string) => void
  /** Einzelnes Kontur-Segment um deltaMm verschieben (Außenrichtung = positiv). */
  offsetSegment: (pieceId: string, curveIndex: number, deltaMm: number) => void
  /** SeamLine eines Teils neu berechnen (nach Drag-Ende aufrufen). */
  recomputeSeamLine: (pieceId: string) => void

  startDigitize: () => void
  addDigitizeNode: (point: Point) => void
  updateDigitizeDrag: (position: Point) => void
  finishDigitizeDrag: () => void
  cancelDigitize: () => void
  finishDigitize: () => void

  /**
   * Alle aktiven Werkzeug-/UI-Modi beenden (Auswahl-Werkzeug, Dialoge zu, kein Digitalisieren usw.).
   * Teile-Auswahl und Arbeitsfläche bleiben; Hintergrundbild bleibt, nur Auswahlrahmen weg.
   */
  exitAllModes: () => void

  // --- Hintergrundbild ---
  startImageSession: (args: { dataUrl: string; widthPx: number; heightPx: number }) => void
  setImagePosition: (pos: Point) => void
  setImageRenderMmPerPixel: (mmPerPixel: number) => void
  setWorkspaceImageSelected: (selected: boolean) => void
  setWorkspaceImageLocked: (locked: boolean) => void
  cancelImageSession: () => void

  /** Teilfelder der Arbeitsfläche (Metadaten, Name, …). */
  updateWorkspace: (patch: Partial<Workspace>) => void

  /** Gespeicherte TrimTex-JSON-Projektdatei laden (ersetzt Arbeitsfläche, DXF-Einstellungen, Kerben-Voreinstellungen, ggf. Hintergrundbild). */
  loadProjectFromFile: (project: TrimTexProjectFileV1, opts?: { projectFileName?: string }) => void

  /** Fensterauswahl: Filter und Ziele (nur Editor-UI, nicht im Projekt/DXF). */
  batchSelectionFilter: BatchSelectionFilter
  batchSelectionTargets: BatchSelectionTarget[]
  /** Temporäre Markierung: CSS-Farbe pro `batchTargetKey`. */
  batchUiHighlightByTargetId: Record<string, string>
  setBatchSelectionFilter: (f: BatchSelectionFilter) => void
  setBatchSelectionTargets: (targets: BatchSelectionTarget[], merge?: boolean) => void
  clearBatchSelection: () => void
  setBatchUiHighlightForFiltered: (color: string | null) => void
  clearBatchUiHighlight: () => void
  batchSetVerticesSoft: (soft: boolean) => void
  batchDeleteFiltered: () => void
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 12)
}

function curvesBounds(curves: Curve[]): { minX: number; maxX: number } | null {
  if (curves.length === 0) return null
  let minX = Infinity
  let maxX = -Infinity
  for (const c of curves) {
    minX = Math.min(minX, c.start.x, c.end.x)
    maxX = Math.max(maxX, c.start.x, c.end.x)
    if (c.type === 'bezier') {
      minX = Math.min(minX, c.cp1.x, c.cp2.x)
      maxX = Math.max(maxX, c.cp1.x, c.cp2.x)
    }
  }
  if (minX === Infinity) return null
  return { minX, maxX }
}

function mirrorX(p: Point, cx: number): Point {
  return { x: 2 * cx - p.x, y: p.y }
}

function mirrorCurve(c: Curve, cx: number): Curve {
  if (c.type === 'line') {
    return { type: 'line', start: mirrorX(c.start, cx), end: mirrorX(c.end, cx) }
  }
  return {
    type: 'bezier',
    start: mirrorX(c.start, cx),
    end: mirrorX(c.end, cx),
    cp1: mirrorX(c.cp1, cx),
    cp2: mirrorX(c.cp2, cx),
  }
}

/** Wandelt Digitalisierungs-Nodes in eine geschlossene Curve[]-Kette um. */
export function digitizeNodesToCurves(nodes: DigitizeNode[]): Curve[] {
  if (nodes.length < 2) return []
  const curves: Curve[] = []
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]
    const b = nodes[(i + 1) % nodes.length]
    const hasHandleA = a.handleOut != null
    const hasHandleB = b.handleOut != null
    if (!hasHandleA && !hasHandleB) {
      curves.push({ type: 'line', start: { ...a.point }, end: { ...b.point } })
    } else {
      const cp1 = hasHandleA
        ? { ...a.handleOut! }
        : { ...a.point }
      const cp2 = hasHandleB
        ? { x: 2 * b.point.x - b.handleOut!.x, y: 2 * b.point.y - b.handleOut!.y }
        : { ...b.point }
      curves.push({ type: 'bezier', start: { ...a.point }, end: { ...b.point }, cp1, cp2 })
    }
  }
  return curves
}

export const useStore = create<Store>((set, get) => ({
  workspace: {
    id: 'ws1',
    name: 'Arbeitsfläche 1',
    pieces: [createDefaultPiece('p1', '001')],
    view: defaultView,
    seamAssignments: [],
  },
  selectedPieceIds: ['p1'],
  selectedPoint: null,
  tool: 'select',
  showGrid: true,
  showPoints: true,
  showGrain: true,
  showNotches: true,
  showDrills: true,
  showInternalLines: true,
  showPieceNames: true,
  showContourMeasurements: false,
  rulerMode: false,
  rulerLine: null,
  pendingNahtzugabeClick: false,
  nahtzugabeDialogPieceId: null,
  piecePropertiesDialogPieceId: null,
  nahtzuordnungMode: 'idle',
  pendingNahtzuordnungFirst: null,
  showSettingsModal: false,
  showStuecklisteModal: false,
  showHelpModal: false,
  showShortcutListModal: false,
  dxfExportScale: 1,
  dxfImportExtraCutLayers: '',
  dxfImportScale: 1,
  toastMessage: null,
  seamAdjustmentDialog: null,
  seamAssignmentMetaDialogId: null,
  massstabDialog: null,
  digitizeState: null,
  imageDigitizeSession: null,
  workspaceImageSelected: false,
  configuratorModalOpen: false,
  configuratorInstances: [],
  rockGeneratorModalOpen: false,
  batchSelectionFilter: 'all' as BatchSelectionFilter,
  batchSelectionTargets: [] as BatchSelectionTarget[],
  batchUiHighlightByTargetId: {} as Record<string, string>,
  notchSettings: Array.from({ length: 10 }, () => ({
    type: 'strich' as NotchType,
    widthMm: 6,
    depthMm: 4,
  })),

  setView: (v) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        view: { ...s.workspace.view, ...v },
      },
    })),

  addPiece: (piece) => {
    const id = piece?.id ?? generateId()
    const number = piece?.number ?? String(get().workspace.pieces.length + 1).padStart(3, '0')
    const newPiece = applySharpCornerPromotion({ ...createDefaultPiece(id, number), ...piece, id, number })
    set((s) => ({
      workspace: { ...s.workspace, pieces: [...s.workspace.pieces, newPiece] },
      selectedPieceIds: [id],
    }))
    return id
  },

  updatePiece: (id, upd) =>
    set((s) => {
      let toastMessage: string | null = null
      const pieces = s.workspace.pieces.map((p) => {
        if (p.id !== id) return p
        const next = { ...p, ...upd }
        if (next.seamAllowanceMm != null) {
          if (next.seamLine.length >= 3) {
            const derived = deriveCutLineFromSeamWithValidation(next.seamLine, next.seamAllowanceMm)
            if (!derived.ok) {
              toastMessage = `warn:${derived.message}`
              return p
            }
            next.cutLine = derived.cutLine
          } else if (next.cutLine.length >= 3) {
            // Wie applyOffset / Dialogtext: bisherige Schnittkontur wird Nahtlinie (Master), cutLine nach außen.
            // Nicht: seam = Inset(cut) bei unveränderter cutLine — das verliert die editierbare Topologie und bricht Punkt-/Vertex-Werkzeuge.
            const oldCut = p.cutLine
            const seamLine = cloneCurvesArray(next.cutLine)
            const derived = deriveCutLineFromSeamWithValidation(seamLine, next.seamAllowanceMm)
            if (!derived.ok) {
              toastMessage = `warn:${derived.message}`
              return p
            }
            next.seamLine = seamLine
            next.cutLine = derived.cutLine
            next.notches = resyncNotchesAfterCutLineRebuilt(p.notches, oldCut, derived.cutLine)
            const newCut = derived.cutLine
            const newSoft = new Set<number>()
            for (const vi of p.softVertices ?? []) {
              if (vi < 0 || vi >= oldCut.length) continue
              const pt = vi === 0 ? oldCut[0].start : oldCut[vi - 1].end
              const mapped = nearestCutVertexIndex(newCut, pt)
              if (mapped != null) newSoft.add(mapped)
            }
            next.softVertices = [...newSoft].sort((a, b) => a - b)
          }
        } else {
          next.seamLine = []
        }
        return applySharpCornerPromotion(next)
      })
      return {
        workspace: { ...s.workspace, pieces },
        ...(toastMessage ? { toastMessage } : {}),
      }
    }),

  deletePiece: (id) =>
    set((s) => ({
      workspace: { ...s.workspace, pieces: s.workspace.pieces.filter((p) => p.id !== id) },
      selectedPieceIds: s.selectedPieceIds.filter((x) => x !== id),
      piecePropertiesDialogPieceId: s.piecePropertiesDialogPieceId === id ? null : s.piecePropertiesDialogPieceId,
      nahtzugabeDialogPieceId: s.nahtzugabeDialogPieceId === id ? null : s.nahtzugabeDialogPieceId,
    })),

  selectPiece: (id, addToSelection) =>
    set((s) => ({
      selectedPieceIds:
        id == null
          ? []
          : addToSelection
            ? s.selectedPieceIds.includes(id)
              ? s.selectedPieceIds.filter((x) => x !== id)
              : [...s.selectedPieceIds, id]
            : [id],
      workspaceImageSelected: id != null ? false : s.workspaceImageSelected,
    })),

  setBatchSelectionFilter: (f) => set({ batchSelectionFilter: f }),

  setBatchSelectionTargets: (targets, merge) =>
    set((s) => ({
      batchSelectionTargets: merge ? mergeBatchTargets(s.batchSelectionTargets, targets) : targets,
    })),

  clearBatchSelection: () =>
    set({
      batchSelectionTargets: [],
      batchUiHighlightByTargetId: {},
      batchSelectionFilter: 'all',
    }),

  setBatchUiHighlightForFiltered: (color) =>
    set((s) => {
      const filtered = filterBatchTargets(s.batchSelectionTargets, s.batchSelectionFilter)
      const next = { ...s.batchUiHighlightByTargetId }
      for (const t of filtered) {
        const k = batchTargetKey(t)
        if (color == null) delete next[k]
        else next[k] = color
      }
      return { batchUiHighlightByTargetId: next }
    }),

  clearBatchUiHighlight: () => set({ batchUiHighlightByTargetId: {} }),

  batchSetVerticesSoft: (soft) => {
    const s = get()
    const filtered = filterBatchTargets(s.batchSelectionTargets, s.batchSelectionFilter)
    for (const t of filtered) {
      if (t.kind === 'vertex') get().setVertexSoft(t.pieceId, t.vertexIndex, soft)
    }
  },

  batchDeleteFiltered: () => {
    const s = get()
    const filtered = filterBatchTargets(s.batchSelectionTargets, s.batchSelectionFilter)
    type G = {
      vertices: number[]
      notches: string[]
      internalLines: number[]
      curvePoints: number[]
    }
    const byPiece = new Map<string, G>()
    for (const t of filtered) {
      if (!byPiece.has(t.pieceId)) {
        byPiece.set(t.pieceId, { vertices: [], notches: [], internalLines: [], curvePoints: [] })
      }
      const g = byPiece.get(t.pieceId)!
      if (t.kind === 'vertex') g.vertices.push(t.vertexIndex)
      else if (t.kind === 'notch') g.notches.push(t.notchId)
      else if (t.kind === 'internalLine') g.internalLines.push(t.curveIndex)
      else if (t.kind === 'curvePoint') g.curvePoints.push(t.curveIndex)
    }
    for (const [pieceId, g] of byPiece) {
      for (const ci of [...new Set(g.internalLines)].sort((a, b) => b - a)) {
        get().removeInternalLine(pieceId, ci)
      }
      for (const ci of [...new Set(g.curvePoints)]) {
        get().convertBezierSegmentToLine(pieceId, ci)
      }
      for (const nid of [...new Set(g.notches)]) {
        get().removeNotch(pieceId, nid)
      }
      for (const vi of [...new Set(g.vertices)].sort((a, b) => b - a)) {
        get().removeVertex(pieceId, vi)
      }
    }
    set({
      batchSelectionTargets: [],
      batchUiHighlightByTargetId: {},
      batchSelectionFilter: 'all',
    })
  },

  setTool: (t) => set({ tool: t }),
  setShowGrid: (v) => set({ showGrid: v }),
  setShowPoints: (v) => set({ showPoints: v }),
  setShowGrain: (v) => set({ showGrain: v }),
  setShowNotches: (v) => set({ showNotches: v }),
  setShowDrills: (v) => set({ showDrills: v }),
  setShowInternalLines: (v) => set({ showInternalLines: v }),
  setShowPieceNames: (v) => set({ showPieceNames: v }),
  setShowContourMeasurements: (v) => set({ showContourMeasurements: v }),
  setRulerMode: (v) => set({ rulerMode: v }),
  setRulerLine: (v) => set({ rulerLine: v }),
  setPendingNahtzugabeClick: (v) => set({ pendingNahtzugabeClick: v }),
  setNahtzugabeDialogPieceId: (v) => set({ nahtzugabeDialogPieceId: v }),
  setPiecePropertiesDialogPieceId: (v) => set({ piecePropertiesDialogPieceId: v }),
  setNahtzuordnungMode: (v) => set({ nahtzuordnungMode: v, pendingNahtzuordnungFirst: v === 'first' ? null : get().pendingNahtzuordnungFirst }),
  setPendingNahtzuordnungFirst: (v) => set({ pendingNahtzuordnungFirst: v }),
  setShowSettingsModal: (v) => set({ showSettingsModal: v }),
  setShowStuecklisteModal: (v) => set({ showStuecklisteModal: v }),
  setShowHelpModal: (v) => set({ showHelpModal: v }),
  setShowShortcutListModal: (v) => set({ showShortcutListModal: v }),
  setShowConfiguratorModal: (v) => set({ configuratorModalOpen: v }),
  setShowRockGeneratorModal: (v) => set({ rockGeneratorModalOpen: v }),

  createConfiguratorInstance: (kindId) => {
    const instanceId = generateId()
    const createdAt = new Date().toISOString()
    const partsDef = getDefaultConfiguratorParts(kindId)

    // Erzeugt die Workspace-Pieces (CutLine + Transform) und merkt sich dann die Zuordnung zu diesem Konfigurator-Teil.
    const parts: ConfiguratorInstance['parts'] = partsDef.map((pd) => {
      const geom = generateConfiguratorPartGeometry(kindId, pd.partId, pd.params)
      const pieceId = get().addPiece({
        name: geom.pieceName,
        transform: geom.transform,
        cutLine: geom.cutLine,
        internalLines: geom.internalLines ?? [],
      })
      return {
        id: generateId(),
        kindId,
        partId: pd.partId,
        label: pd.label,
        params: pd.params,
        pieceId,
      }
    })

    set((s) => ({
      configuratorInstances: [
        ...s.configuratorInstances,
        {
          id: instanceId,
          kindId,
          createdAt,
          parts,
        },
      ],
    }))

    return instanceId
  },

  updateConfiguratorPartParams: (instanceId, partId, patch) =>
    set((s) => ({
      configuratorInstances: s.configuratorInstances.map((inst) => {
        if (inst.id !== instanceId) return inst
        return {
          ...inst,
          parts: inst.parts.map((p) => (p.id === partId ? { ...p, params: { ...p.params, ...patch } } : p)),
        }
      }),
    })),

  regenerateConfiguratorPart: (instanceId, partId) => {
    const inst = get().configuratorInstances.find((i) => i.id === instanceId)
    if (!inst) return
    const part = inst.parts.find((p) => p.id === partId)
    if (!part) return

    const geom = generateConfiguratorPartGeometry(inst.kindId, part.partId, part.params)

    // Cut- und Zusatzinfos für dieses Teil überschreiben. SeamAssignments sind Ansichtsdaten und werden entfernt, da
    // neue Kontur-Indizes nicht mehr zu alten Zuweisungen passen.
    get().updatePiece(part.pieceId, {
      name: geom.pieceName,
      cutLine: geom.cutLine,
      transform: geom.transform,
      seamAllowanceMm: null,
      seamLine: [],
      notches: [],
      drills: [],
      internalLines: geom.internalLines ?? [],
      grainLine: null,
      softVertices: [],
    })

    set((s) => ({
      workspace: {
        ...s.workspace,
        seamAssignments: s.workspace.seamAssignments.filter((a) => a.pieceIdA !== part.pieceId && a.pieceIdB !== part.pieceId),
      },
    }))
  },

  setDxfExportScale: (v) => set({ dxfExportScale: v }),
  setDxfImportExtraCutLayers: (v) => set({ dxfImportExtraCutLayers: v }),
  setDxfImportScale: (v) => set({ dxfImportScale: v }),
  setToastMessage: (v) => set({ toastMessage: v }),
  updateNotchSetting: (index, upd) =>
    set((s) => {
      const notchSettings = [...s.notchSettings]
      notchSettings[index] = { ...notchSettings[index], ...upd }
      return { notchSettings }
    }),
  addSeamAssignment: (pieceIdA, curveIndicesA, clickedCurveA, pieceIdB, curveIndicesB, clickedCurveB) => {
    const newId = generateId()
    const afterGet = get()
    const pieceA0 = afterGet.workspace.pieces.find((p) => p.id === pieceIdA)
    const pieceB0 = afterGet.workspace.pieces.find((p) => p.id === pieceIdB)
    const normA =
      pieceA0 != null ? resolvedSeamAssignmentCurveIndices(pieceA0, curveIndicesA) : curveIndicesA
    const normB =
      pieceB0 != null ? resolvedSeamAssignmentCurveIndices(pieceB0, curveIndicesB) : curveIndicesB
    set((s) => ({
      workspace: {
        ...s.workspace,
        seamAssignments: [
          ...s.workspace.seamAssignments,
          {
            id: newId,
            pieceIdA,
            curveIndicesA: normA,
            clickedCurveA,
            pieceIdB,
            curveIndicesB: normB,
            clickedCurveB,
          },
        ],
      },
      nahtzuordnungMode: 'idle',
      pendingNahtzuordnungFirst: null,
    }))
    const after = get()
    const pieceA = after.workspace.pieces.find((p) => p.id === pieceIdA)
    const pieceB = after.workspace.pieces.find((p) => p.id === pieceIdB)
    if (!pieceA || !pieceB) return
    const trimmed = applySeamAssignmentCutTrim(pieceA, pieceB, normA, normB)
    if (trimmed) {
      set((st) => ({
        workspace: {
          ...st.workspace,
          pieces: st.workspace.pieces.map((p) => {
            if (p.id === pieceIdA) return trimmed.pieceA
            if (p.id === pieceIdB) return trimmed.pieceB
            return p
          }),
        },
        toastMessage:
          'success:Naht-Ecken: Schnittkontur an den Enden der Kanten-Zuordnung gekürzt (Nahtlinie unverändert).',
      }))
    }
    const afterTrim = get()
    const pieceA2 = afterTrim.workspace.pieces.find((p) => p.id === pieceIdA)
    const pieceB2 = afterTrim.workspace.pieces.find((p) => p.id === pieceIdB)
    if (!pieceA2 || !pieceB2) return
    const lenA = edgeTotalLength(pieceA2, normA)
    const lenB = edgeTotalLength(pieceB2, normB)
    const totalDiffMm = Math.abs(lenA - lenB)
    if (totalDiffMm >= 0.1) return
    const ncA = countNotchesOnEdge(pieceA2, normA)
    const ncB = countNotchesOnEdge(pieceB2, normB)
    if (ncA < 1) return
    let subDiff = false
    const subsA = getSubSegments(pieceA2, normA)
    const subsB = getSubSegments(pieceB2, normB)
    const pairing = bestSeamSubSegmentPairing(subsA, subsB)
    if (ncA === ncB && pairing && subsA.length >= 2 && pairing.maxSegmentMismatchMm >= 0.1) {
      subDiff = true
    }
    if (subDiff) {
      set({ seamAdjustmentDialog: newId })
    }
  },
  removeSeamAssignment: (id) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        seamAssignments: s.workspace.seamAssignments.filter((a) => a.id !== id),
      },
    })),
  setSeamAdjustmentDialog: (v) => set({ seamAdjustmentDialog: v }),
  setSeamAssignmentMetaDialogId: (v) => set({ seamAssignmentMetaDialogId: v }),
  updateSeamAssignmentMeta: (assignmentId, patch) => {
    const s = get()
    const idx = s.workspace.seamAssignments.findIndex((a) => a.id === assignmentId)
    if (idx < 0) return
    const current = s.workspace.seamAssignments[idx]
    const nextOrder =
      patch.orderNumber !== undefined ? patch.orderNumber : current.orderNumber ?? null
    if (nextOrder != null) {
      const n = Math.floor(Number(nextOrder))
      if (!Number.isFinite(n) || n < 1) {
        set({ toastMessage: 'error:Nummer muss eine ganze Zahl ≥ 1 sein (oder leer).' })
        return
      }
      const taken = s.workspace.seamAssignments.some((a, i) => i !== idx && a.orderNumber === n)
      if (taken) {
        set({ toastMessage: 'error:Jede Nummer nur einmal vergeben.' })
        return
      }
    }
    let nextKind = patch.seamKind !== undefined ? patch.seamKind : current.seamKind ?? null
    if (nextKind != null && !(SEAM_ASSIGNMENT_KIND_IDS as readonly string[]).includes(nextKind)) {
      set({ toastMessage: 'error:Unbekannte Nahtart.' })
      return
    }
    set((st) => ({
      workspace: {
        ...st.workspace,
        seamAssignments: st.workspace.seamAssignments.map((a) =>
          a.id === assignmentId
            ? {
                ...a,
                orderNumber: patch.orderNumber !== undefined ? patch.orderNumber : a.orderNumber,
                seamKind: patch.seamKind !== undefined ? patch.seamKind : a.seamKind,
              }
            : a
        ),
      },
      seamAssignmentMetaDialogId: null,
      toastMessage: 'success:Naht-Eigenschaften gespeichert.',
    }))
  },
  setMassstabDialog: (v) => set({ massstabDialog: v }),

  applyMassstab: (targetLengthMm) => {
    const s = get()
    const d = s.massstabDialog
    if (!d) return
    if (!Number.isFinite(targetLengthMm) || targetLengthMm <= 0) {
      set({ toastMessage: 'error:Ziel-Länge muss größer als 0 sein.' })
      return
    }
    const piece = s.workspace.pieces.find((p) => p.id === d.pieceId)
    if (!piece) {
      set({ massstabDialog: null, toastMessage: 'error:Teil nicht gefunden.' })
      return
    }
    const len = edgeTotalLength(piece, d.curveIndices)
    if (len < 1e-9) {
      set({ toastMessage: 'error:Kantenlänge ist zu klein.' })
      return
    }
    const pivot = getReferenceEdgePivotLocal(piece, d.curveIndices)
    if (!pivot) {
      set({ toastMessage: 'error:Ungültige Referenzkante.' })
      return
    }
    const scale = targetLengthMm / len
    const result = applyUniformScaleToPiece(piece, pivot, scale)
    if (!result.ok) {
      set({ toastMessage: 'error:' + result.message })
      return
    }
    set((st) => ({
      workspace: {
        ...st.workspace,
        pieces: st.workspace.pieces.map((p) => (p.id === d.pieceId ? result.piece : p)),
      },
      massstabDialog: null,
      tool: 'select',
    }))
  },

  adjustSeamNotches: (assignmentId, keepSide) => {
    const s = get()
    const a = s.workspace.seamAssignments.find((x) => x.id === assignmentId)
    if (!a) return

    const refPieceId = keepSide === 'A' ? a.pieceIdA : a.pieceIdB
    const rawRefIndices = keepSide === 'A' ? a.curveIndicesA : a.curveIndicesB
    const tgtPieceId = keepSide === 'A' ? a.pieceIdB : a.pieceIdA
    const rawTgtIndices = keepSide === 'A' ? a.curveIndicesB : a.curveIndicesA

    const refPiece = s.workspace.pieces.find((p) => p.id === refPieceId)
    const tgtPiece = s.workspace.pieces.find((p) => p.id === tgtPieceId)
    if (!refPiece || !tgtPiece) return

    const refIndices = resolvedSeamAssignmentCurveIndices(refPiece, rawRefIndices)
    const tgtIndices = resolvedSeamAssignmentCurveIndices(tgtPiece, rawTgtIndices)

    const refNotchCount = countNotchesOnEdge(refPiece, refIndices)
    const tgtNotchCount = countNotchesOnEdge(tgtPiece, tgtIndices)
    if (refNotchCount !== tgtNotchCount || refNotchCount === 0) {
      set({ seamAdjustmentDialog: null })
      return
    }

    const refSubs = getSubSegments(refPiece, refIndices)
    const tgtSubs = getSubSegments(tgtPiece, tgtIndices)
    const pairing = bestSeamSubSegmentPairing(refSubs, tgtSubs)
    if (!pairing) {
      set({ seamAdjustmentDialog: null })
      return
    }

    const refSubLengths = refSubs.map((ss) => ss.length)
    const order = pairing.reverseB ? [...refSubLengths].reverse() : refSubLengths

    const tgtTotalLen = edgeTotalLength(tgtPiece, tgtIndices)
    const cumPositions: number[] = []
    let cum = 0
    for (let i = 0; i < order.length - 1; i++) {
      cum += order[i]
      if (cum > tgtTotalLen + 0.01) {
        set({ seamAdjustmentDialog: null })
        return
      }
      cumPositions.push(cum)
    }

    // curveIndices in SeamAssignment beziehen sich auf die Master-Kontur (seamLine bei Nahtzugabe), nicht blind auf cutLine.
    const tgtMasterCurves = getCurvesForSeamEdge(tgtPiece)
    const tgtSubCurves = tgtIndices.map((ci) => tgtMasterCurves[ci]).filter(Boolean)
    if (tgtSubCurves.length === 0) { set({ seamAdjustmentDialog: null }); return }

    const tgtNotches = getNotchesOnEdge(tgtPiece, tgtIndices)
    if (tgtNotches.length !== cumPositions.length) { set({ seamAdjustmentDialog: null }); return }

    const targetPoints: { notchId: string; point: Point; angle: number }[] = []
    for (let i = 0; i < tgtNotches.length; i++) {
      const result = pointAtPathLength(tgtSubCurves, cumPositions[i])
      if (!result) continue
      const notchId = tgtNotches[i].notchId
      const n0 = tgtPiece.notches.find((nn) => nn.id === notchId)
      if (!n0) continue
      // Punkt liegt auf der Master-Kante; Speicherung erfolgt auf der Schnittkontur (Projektion), sonst falsche Darstellung.
      const { position, angle } = getNotchPositionAndAngleOnCutLine(
        { ...n0, position: result.point, vertexIndex: undefined },
        tgtPiece.cutLine,
        tgtPiece.seamLine
      )
      targetPoints.push({ notchId, point: position, angle })
    }
    if (targetPoints.length === 0) { set({ seamAdjustmentDialog: null }); return }

    const tpMap = new Map(targetPoints.map((tp) => [tp.notchId, tp]))

    set((st) => {
      const piece = st.workspace.pieces.find((p) => p.id === tgtPieceId)
      if (!piece) return { seamAdjustmentDialog: null }
      const notches = piece.notches.map((n) => {
        const tp = tpMap.get(n.id)
        if (!tp) return n
        const { vertexIndex: _v, ...rest } = n
        return { ...rest, position: { ...tp.point }, angle: tp.angle }
      })
      return {
        seamAdjustmentDialog: null,
        workspace: {
          ...st.workspace,
          pieces: st.workspace.pieces.map((p) =>
            p.id === tgtPieceId ? { ...p, notches } : p
          ),
        },
      }
    })
  },

  checkSeamAdjustment: () => {
    const s = get()
    if (s.seamAdjustmentDialog) return
    for (const a of s.workspace.seamAssignments) {
      const pieceA = s.workspace.pieces.find((p) => p.id === a.pieceIdA)
      const pieceB = s.workspace.pieces.find((p) => p.id === a.pieceIdB)
      if (!pieceA || !pieceB) continue
      const idxA = resolvedSeamAssignmentCurveIndices(pieceA, a.curveIndicesA)
      const idxB = resolvedSeamAssignmentCurveIndices(pieceB, a.curveIndicesB)
      const lenA = edgeTotalLength(pieceA, idxA)
      const lenB = edgeTotalLength(pieceB, idxB)
      if (Math.abs(lenA - lenB) >= 0.1) continue
      const ncA = countNotchesOnEdge(pieceA, idxA)
      const ncB = countNotchesOnEdge(pieceB, idxB)
      if (ncA !== ncB || ncA < 1) continue
      const subsA = getSubSegments(pieceA, idxA)
      const subsB = getSubSegments(pieceB, idxB)
      const pairing = bestSeamSubSegmentPairing(subsA, subsB)
      if (!pairing || subsA.length < 2) continue
      if (pairing.maxSegmentMismatchMm >= 0.1) {
        set({ seamAdjustmentDialog: a.id })
        return
      }
    }
  },

  snapSeamEdgeToMatch: (pieceId, vertexIndex, options) => {
    const s = get()
    const piece = s.workspace.pieces.find((p) => p.id === pieceId)
    if (!piece) return
    const masterCurves = getCurvesForSeamEdge(piece)
    const nM = masterCurves.length
    const vertexPosOnMaster =
      nM > 0 && vertexIndex >= 0 && vertexIndex < nM
        ? vertexIndex === 0
          ? { ...masterCurves[0].start }
          : { ...masterCurves[vertexIndex - 1].end }
        : null

    type SnapCand = { snapPt: Point; diff: number; id: string }
    const candidates: SnapCand[] = []
    for (const a of s.workspace.seamAssignments) {
      const isA = a.pieceIdA === pieceId
      const isB = a.pieceIdB === pieceId
      if (!isA && !isB) continue
      const rawThis = isA ? a.curveIndicesA : a.curveIndicesB
      const rawOther = isA ? a.curveIndicesB : a.curveIndicesA
      const curveIndices = resolvedSeamAssignmentCurveIndices(piece, rawThis)
      const refPiece = s.workspace.pieces.find((p) => p.id === (isA ? a.pieceIdB : a.pieceIdA))
      if (!refPiece) continue
      const refOtherIdx = resolvedSeamAssignmentCurveIndices(refPiece, rawOther)
      const refLen = edgeTotalLength(refPiece, refOtherIdx)
      const currLen = edgeTotalLength(piece, curveIndices)
      const diff = Math.abs(currLen - refLen)
      if (diff >= SEAM_EDGE_LENGTH_SNAP_TOLERANCE_MM) continue
      const snapPt = snapVertexToEdgeLength(piece, curveIndices, vertexIndex, refLen)
      if (snapPt) {
        candidates.push({ snapPt, diff, id: a.id })
      }
    }
    if (candidates.length === 0) return
    candidates.sort((x, y) => {
      if (x.diff !== y.diff) return x.diff - y.diff
      if (vertexPosOnMaster) {
        const dx =
          Math.hypot(x.snapPt.x - vertexPosOnMaster.x, x.snapPt.y - vertexPosOnMaster.y) -
          Math.hypot(y.snapPt.x - vertexPosOnMaster.x, y.snapPt.y - vertexPosOnMaster.y)
        if (Math.abs(dx) > 1e-9) return dx
      }
      return x.id.localeCompare(y.id)
    })
    const best = candidates[0]
    get().updateVertex(pieceId, vertexIndex, best.snapPt, false, options)
  },

  setSelectedPoint: (v) => set({ selectedPoint: v }),

  addCurveToCutLine: (pieceId, curve) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        pieces: s.workspace.pieces.map((p) =>
          p.id === pieceId ? applySharpCornerPromotion({ ...p, cutLine: [...p.cutLine, curve] }) : p
        ),
      },
    })),

  addInternalLine: (pieceId, curve) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        pieces: s.workspace.pieces.map((p) =>
          p.id === pieceId ? { ...p, internalLines: [...p.internalLines, curve] } : p
        ),
      },
    })),

  addInternalLines: (pieceId, curves) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        pieces: s.workspace.pieces.map((p) =>
          p.id === pieceId ? { ...p, internalLines: [...p.internalLines, ...curves] } : p
        ),
      },
    })),

  removeInternalLine: (pieceId, curveIndex) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        pieces: s.workspace.pieces.map((p) => {
          if (p.id !== pieceId || curveIndex < 0 || curveIndex >= p.internalLines.length) return p
          const internalLines = p.internalLines.filter((_, i) => i !== curveIndex)
          return { ...p, internalLines }
        }),
      },
    })),

  updateCurvePoint: (pieceId, curveIndex, pointKey, p) =>
    set((s) => {
      let toastMessage: string | null = null
      const pieces = s.workspace.pieces.map((piece) => {
        if (piece.id !== pieceId) return piece
        const seamPc = useSeamLineForPointCurveEditing(piece)
        const target = seamPc ? piece.seamLine : piece.cutLine
        if (curveIndex < 0 || curveIndex >= target.length) return piece
        const curve = target[curveIndex]
        const updated: Curve =
          curve.type === 'line'
            ? { ...curve, [pointKey]: p } as Curve
            : { ...curve, [pointKey]: p } as Curve
        const next = [...target]
        next[curveIndex] = updated
        if (seamPc && piece.seamAllowanceMm != null) {
          const seamLine = next
          const derived = deriveCutLineFromSeamWithValidation(seamLine, piece.seamAllowanceMm)
          if (!derived.ok) {
            toastMessage = `warn:${derived.message}`
            return piece
          }
          const cutLine = derived.cutLine
          const notches = resyncNotchesAfterCutLineRebuilt(piece.notches, piece.cutLine, cutLine)
          const softVertices = (piece.softVertices ?? []).filter((vi) => vi >= 0 && vi < cutLine.length)
          return applySharpCornerPromotion({ ...piece, cutLine, seamLine, notches, softVertices })
        }
        const cutLine = [...piece.cutLine]
        cutLine[curveIndex] = updated
        const seamLine =
          piece.seamAllowanceMm != null && cutLine.length >= 3
            ? offsetCurvesInwardForSeam(cutLine, piece.seamAllowanceMm)
            : piece.seamLine
        return applySharpCornerPromotion({ ...piece, cutLine, seamLine })
      })
      return {
        workspace: { ...s.workspace, pieces },
        ...(toastMessage ? { toastMessage } : {}),
      }
    }),

  addNotch: (pieceId, notch) =>
    set((s) => {
      const piece = s.workspace.pieces.find((p) => p.id === pieceId)
      if (!piece) return s
      if (!isNotchSpacingValidForCandidate(piece, notch)) {
        return {
          ...s,
          toastMessage:
            'error: Zwischen zwei Kerben müssen mindestens 4 mm Abstand liegen (entlang der Schnittkontur).',
        }
      }
      return {
        workspace: {
          ...s.workspace,
          pieces: s.workspace.pieces.map((p) =>
            p.id === pieceId ? { ...p, notches: [...p.notches, notch] } : p
          ),
        },
      }
    }),

  removeNotch: (pieceId, notchId) =>
    set((s) => {
      const piece = s.workspace.pieces.find((p) => p.id === pieceId)
      const notch = piece?.notches.find((n) => n.id === notchId)
      const vi = notch?.vertexIndex
      if (piece && vi != null && piece.cutLine.length > 3) {
        const oldN = piece.cutLine.length
        const prevIdx = (vi - 1 + oldN) % oldN
        const nextIdx = vi
        const newSeg = mergeAdjacentSegments(piece.cutLine[prevIdx], piece.cutLine[nextIdx])
        const cutLine = piece.cutLine.filter((_, j) => j !== prevIdx && j !== nextIdx)
        cutLine.splice(Math.min(prevIdx, nextIdx), 0, newSeg)
        const seamLine =
          piece.seamAllowanceMm != null && cutLine.length >= 3 ? offsetCurvesInwardForSeam(cutLine, piece.seamAllowanceMm) : piece.seamLine
        const notches = piece.notches
          .filter((n) => n.id !== notchId)
          .map((n) => (n.vertexIndex != null && n.vertexIndex > vi ? { ...n, vertexIndex: n.vertexIndex - 1 } : n))
        return {
          workspace: {
            ...s.workspace,
            seamAssignments: adjustSeamAfterRemove(s.workspace.seamAssignments, pieceId, vi, oldN),
            pieces: s.workspace.pieces.map((p) =>
              p.id === pieceId ? applySharpCornerPromotion({ ...p, cutLine, seamLine, notches }) : p
            ),
          },
        }
      }
      return {
        workspace: {
          ...s.workspace,
          pieces: s.workspace.pieces.map((p) =>
            p.id === pieceId ? { ...p, notches: p.notches.filter((n) => n.id !== notchId) } : p
          ),
        },
      }
    }),

  /** Entfernt nur den Kontur-Knick (Vertex) eines Notchs, ohne den Notch zu löschen (z. B. vor Verschieben). */
  removeNotchAnchor: (pieceId, notchId) =>
    set((s) => {
      const piece = s.workspace.pieces.find((p) => p.id === pieceId)
      const notch = piece?.notches.find((n) => n.id === notchId)
      const vi = notch?.vertexIndex
      if (!piece || vi == null || piece.cutLine.length <= 3) return s
      const oldN = piece.cutLine.length
      const prevIdx = (vi - 1 + oldN) % oldN
      const nextIdx = vi
      const newSeg = mergeAdjacentSegments(piece.cutLine[prevIdx], piece.cutLine[nextIdx])
      const cutLine = piece.cutLine.filter((_, j) => j !== prevIdx && j !== nextIdx)
      cutLine.splice(Math.min(prevIdx, nextIdx), 0, newSeg)
      const seamLine =
        piece.seamAllowanceMm != null && cutLine.length >= 3 ? offsetCurvesInwardForSeam(cutLine, piece.seamAllowanceMm) : piece.seamLine
      const notches = piece.notches.map((n) =>
        n.id === notchId
          ? (() => { const { vertexIndex: _v, ...rest } = n; return rest })()
          : n.vertexIndex != null && n.vertexIndex > vi
            ? { ...n, vertexIndex: n.vertexIndex - 1 }
            : n
      )
      return {
        workspace: {
          ...s.workspace,
          seamAssignments: adjustSeamAfterRemove(s.workspace.seamAssignments, pieceId, vi, oldN),
          pieces: s.workspace.pieces.map((p) =>
            p.id === pieceId ? applySharpCornerPromotion({ ...p, cutLine, seamLine, notches }) : p
          ),
        },
      }
    }),

  toggleNotchAnchor: (pieceId, notchId) =>
    set((s) => {
      const piece = s.workspace.pieces.find((p) => p.id === pieceId)
      const notch = piece?.notches.find((n) => n.id === notchId)
      if (!piece || !notch) return s

      if (notch.vertexIndex != null) {
        // Verankert → Frei: Vertex entfernen, Notch bleibt
        const vi = notch.vertexIndex
        if (piece.cutLine.length <= 3) return s
        const oldN = piece.cutLine.length
        const prevIdx = (vi - 1 + oldN) % oldN
        const nextIdx = vi
        const newSeg = mergeAdjacentSegments(piece.cutLine[prevIdx], piece.cutLine[nextIdx])
        const cutLine = piece.cutLine.filter((_, j) => j !== prevIdx && j !== nextIdx)
        cutLine.splice(Math.min(prevIdx, nextIdx), 0, newSeg)
        const seamLine =
          piece.seamAllowanceMm != null && cutLine.length >= 3 ? offsetCurvesInwardForSeam(cutLine, piece.seamAllowanceMm) : piece.seamLine
        const notches = piece.notches.map((n) => {
          if (n.id === notchId) {
            const { vertexIndex: _v, ...rest } = n
            const nr = nearestCurveIndexAndPoint(rest.position, cutLine)
            return nr ? { ...rest, position: { ...nr.point } } : rest
          }
          return n.vertexIndex != null && n.vertexIndex > vi
            ? { ...n, vertexIndex: n.vertexIndex - 1 }
            : n
        })
        const softVertices = (piece.softVertices ?? [])
          .filter((svi) => svi !== vi)
          .map((svi) => svi > vi ? svi - 1 : svi)
        return {
          workspace: {
            ...s.workspace,
            seamAssignments: adjustSeamAfterRemove(s.workspace.seamAssignments, pieceId, vi, oldN),
            pieces: s.workspace.pieces.map((p) =>
              p.id === pieceId ? applySharpCornerPromotion({ ...p, cutLine, seamLine, notches, softVertices }) : p
            ),
          },
        }
      } else {
        // Frei → Verankert: Vertex an Notch-Position einfügen
        const pos = notch.position
        const nr = nearestCurveIndexAndPoint(pos, piece.cutLine)
        if (!nr) return s
        const curveIndex = nr.curveIndex
        const curve = piece.cutLine[curveIndex]
        const t = nr.t ?? 0
        const cutLine = [...piece.cutLine]

        if (t > 1e-6 && t < 1 - 1e-6) {
          if (curve.type === 'line') {
            const seg1: Curve = { type: 'line', start: { ...curve.start }, end: { ...pos } }
            const seg2: Curve = { type: 'line', start: { ...pos }, end: { ...curve.end } }
            cutLine.splice(curveIndex, 1, seg1, seg2)
          } else if (curve.type === 'bezier') {
            const [seg1, seg2] = splitBezierAt(curve, t)
            cutLine.splice(curveIndex, 1, seg1, seg2)
          }
          const newVI = curveIndex + 1
          const seamLine =
            piece.seamAllowanceMm != null && cutLine.length >= 3 ? offsetCurvesInwardForSeam(cutLine, piece.seamAllowanceMm) : piece.seamLine
          const notches = piece.notches.map((n) => {
            if (n.id === notchId) return { ...n, vertexIndex: newVI }
            if (n.vertexIndex != null && n.vertexIndex > curveIndex) return { ...n, vertexIndex: n.vertexIndex + 1 }
            return n
          })
          const softVertices = (piece.softVertices ?? [])
            .map((svi) => svi > curveIndex ? svi + 1 : svi)
          return {
            workspace: {
              ...s.workspace,
              seamAssignments: adjustSeamAfterInsert(s.workspace.seamAssignments, pieceId, curveIndex),
              pieces: s.workspace.pieces.map((p) =>
                p.id === pieceId ? applySharpCornerPromotion({ ...p, cutLine, seamLine, notches, softVertices }) : p
              ),
            },
          }
        } else {
          const vertexIndex = t < 0.5 ? curveIndex : (curveIndex + 1) % piece.cutLine.length
          const notches = piece.notches.map((n) =>
            n.id === notchId ? { ...n, vertexIndex } : n
          )
          return {
            workspace: {
              ...s.workspace,
              pieces: s.workspace.pieces.map((p) =>
                p.id === pieceId ? { ...p, notches } : p
              ),
            },
          }
        }
      }
    }),

  updateNotch: (pieceId, notchId, upd) =>
    set((s) => {
      const piece = s.workspace.pieces.find((p) => p.id === pieceId)
      const notch = piece?.notches.find((n) => n.id === notchId)
      const isPositionUpdate = upd.position != null
      if (piece && notch && isPositionUpdate) {
        const candidate = { ...notch, ...upd }
        if (!isNotchSpacingValidForCandidate(piece, candidate, notchId)) {
          return {
            ...s,
            toastMessage:
              'error: Zwischen zwei Kerben müssen mindestens 4 mm Abstand liegen (entlang der Schnittkontur).',
          }
        }
      }
      // Kerbe entlang Kontur verschieben (notchMove): liefert position + vertexIndex: undefined.
      // Dann nur Notch-Daten ändern — niemals cutLine mergen/splitten, sonst verzieht sich die Kurve.
      const unanchorOnly =
        isPositionUpdate && 'vertexIndex' in upd && upd.vertexIndex === undefined
      if (
        piece &&
        notch &&
        notch.vertexIndex != null &&
        isPositionUpdate &&
        piece.cutLine.length > 3 &&
        !unanchorOnly
      ) {
        const vi = notch.vertexIndex
        const oldN = piece.cutLine.length
        const prevIdx = (vi - 1 + oldN) % oldN
        const nextIdx = vi
        const newSeg = mergeAdjacentSegments(piece.cutLine[prevIdx], piece.cutLine[nextIdx])
        let cutLine = piece.cutLine.filter((_, j) => j !== prevIdx && j !== nextIdx)
        cutLine.splice(Math.min(prevIdx, nextIdx), 0, newSeg)
        let sa = adjustSeamAfterRemove(s.workspace.seamAssignments, pieceId, vi, oldN)
        const pos = upd.position ?? notch.position
        const nearest = nearestCurveIndexAndPoint(pos, cutLine)
        if (nearest) {
          const curveIndex = nearest.curveIndex
          const curve = cutLine[curveIndex]
          const t = nearest.t ?? 0
          if (curve.type === 'line') {
            const seg1: Curve = { type: 'line', start: { ...curve.start }, end: { ...pos } }
            const seg2: Curve = { type: 'line', start: { ...pos }, end: { ...curve.end } }
            cutLine = [...cutLine]
            cutLine.splice(curveIndex, 1, seg1, seg2)
            sa = adjustSeamAfterInsert(sa, pieceId, curveIndex)
          } else if (curve.type === 'bezier' && t > 0 && t < 1) {
            const [seg1, seg2] = splitBezierAt(curve, t)
            cutLine = [...cutLine]
            cutLine.splice(curveIndex, 1, seg1, seg2)
            sa = adjustSeamAfterInsert(sa, pieceId, curveIndex)
          }
        }
        const seamLine =
          piece.seamAllowanceMm != null && cutLine.length >= 3 ? offsetCurvesInwardForSeam(cutLine, piece.seamAllowanceMm) : piece.seamLine
        const newVertexIndex = nearest ? nearest.curveIndex + 1 : undefined
        const notches = piece.notches.map((n) => {
          if (n.id !== notchId) {
            const v = n.vertexIndex
            if (v == null) return n
            let v2 = v > vi ? v - 1 : v
            if (newVertexIndex != null && v2 >= newVertexIndex) v2 = v2 + 1
            return v2 !== v ? { ...n, vertexIndex: v2 } : n
          }
          const { vertexIndex: _v, ...rest } = upd
          return { ...n, ...rest, vertexIndex: newVertexIndex ?? undefined }
        })
        return {
          workspace: {
            ...s.workspace,
            seamAssignments: sa,
            pieces: s.workspace.pieces.map((p) =>
              p.id === pieceId ? applySharpCornerPromotion({ ...p, cutLine, seamLine, notches }) : p
            ),
          },
        }
      }
      return {
        workspace: {
          ...s.workspace,
          pieces: s.workspace.pieces.map((p) =>
            p.id === pieceId
              ? { ...p, notches: p.notches.map((n) => (n.id === notchId ? { ...n, ...upd } : n)) }
              : p
          ),
        },
      }
    }),

  addDrill: (pieceId, drill) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        pieces: s.workspace.pieces.map((p) =>
          p.id === pieceId ? { ...p, drills: [...p.drills, drill] } : p
        ),
      },
    })),

  movePiece: (pieceId, dx, dy) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        pieces: s.workspace.pieces.map((p) =>
          p.id === pieceId
            ? { ...p, transform: { ...p.transform, x: p.transform.x + dx, y: p.transform.y + dy } }
            : p
        ),
      },
    })),

  applyOffset: (pieceId, deltaMm) =>
    set((s) => {
      let toastMessage: string | null = null
      const pieces = s.workspace.pieces.map((p) => {
        if (p.id !== pieceId || p.cutLine.length < 3) return p
        const sourceInner = p.seamLine.length >= 3 ? p.seamLine : p.cutLine
        const seamLine = cloneCurvesArray(sourceInner)
        const derived = deriveCutLineFromSeamWithValidation(seamLine, deltaMm)
        if (!derived.ok) {
          toastMessage = `warn:${derived.message}`
          return p
        }
        const cutLine = derived.cutLine
        const notches = p.notches.map((n) => ({ ...n, vertexIndex: undefined }))
        return applySharpCornerPromotion({ ...p, cutLine, seamLine, seamAllowanceMm: deltaMm, notches })
      })
      return {
        workspace: { ...s.workspace, pieces },
        ...(toastMessage ? { toastMessage } : {}),
      }
    }),

  removeSeamAllowance: (pieceId) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        pieces: s.workspace.pieces.map((p) => {
          if (p.id !== pieceId) return p
          // Nahtlinie wird wieder zur einzigen Kontur (cutLine)
          const oldCut = p.cutLine
          const newCut = p.seamLine.length >= 3 ? p.seamLine : p.cutLine
          const notches = resyncNotchesAfterCutLineRebuilt(p.notches, oldCut, newCut)
          return applySharpCornerPromotion({
            ...p,
            cutLine: newCut,
            seamLine: [],
            seamAllowanceMm: null,
            notches,
          })
        }),
      },
    })),

  insertPointOnCutLine: (pieceId, curveIndex, point, t) => {
    let inserted = false
    set((s) => {
      const pieceBefore = s.workspace.pieces.find((p) => p.id === pieceId)
      const seamPc = pieceBefore != null && useSeamLineForPointCurveEditing(pieceBefore)
      const LINE_SPLIT_MIN_MM = 0.5
      let toastMessage: string | null = null
      return {
        workspace: {
          ...s.workspace,
          seamAssignments: seamPc
            ? s.workspace.seamAssignments
            : adjustSeamAfterInsert(s.workspace.seamAssignments, pieceId, curveIndex),
          pieces: s.workspace.pieces.map((p) => {
            if (p.id !== pieceId) return p
            const master = seamPc ? p.seamLine : p.cutLine
            if (curveIndex < 0 || curveIndex >= master.length) return p
            const curve = master[curveIndex]
            let newMaster: Curve[] | null = null
            if (curve.type === 'line') {
              // Robust gegenüber Klicks nahe Segment-Enden (t≈0/1): kein degenerierter Split.
              const lineLen = Math.hypot(curve.end.x - curve.start.x, curve.end.y - curve.start.y)
              const minT = Math.min(0.49, LINE_SPLIT_MIN_MM / Math.max(lineLen, 1e-6))
              const tt = Number.isFinite(t) ? Math.min(1 - minT, Math.max(minT, t as number)) : null
              const splitPoint =
                tt == null
                  ? point
                  : {
                      x: curve.start.x + (curve.end.x - curve.start.x) * tt,
                      y: curve.start.y + (curve.end.y - curve.start.y) * tt,
                    }
              const seg1: Curve = { type: 'line', start: { ...curve.start }, end: { ...splitPoint } }
              const seg2: Curve = { type: 'line', start: { ...splitPoint }, end: { ...curve.end } }
              newMaster = [...master]
              newMaster.splice(curveIndex, 1, seg1, seg2)
            } else if (curve.type === 'bezier' && t != null && t > 0 && t < 1) {
              const [seg1, seg2] = splitBezierAt(curve, t)
              newMaster = [...master]
              newMaster.splice(curveIndex, 1, seg1, seg2)
            }
            if (!newMaster) return p

            if (seamPc && p.seamAllowanceMm != null) {
              const seamLine = newMaster
              const derived = deriveCutLineFromSeamWithValidation(seamLine, p.seamAllowanceMm)
              if (!derived.ok) {
                toastMessage = `warn:${derived.message}`
                return p
              }
              const cutLine = derived.cutLine
              const notches = resyncNotchesAfterCutLineRebuilt(p.notches, p.cutLine, cutLine)
              const insertedOnSeam = newMaster[curveIndex].end
              const insertedCutVi = nearestCutVertexIndex(cutLine, insertedOnSeam)
              const softSet = new Set((p.softVertices ?? []).filter((vi) => vi >= 0 && vi < cutLine.length))
              if (insertedCutVi != null) softSet.add(insertedCutVi)
              const softVertices = [...softSet].sort((a, b) => a - b)
              inserted = true
              return applySharpCornerPromotion({ ...p, cutLine, seamLine, notches, softVertices })
            }

            const cutLine = newMaster
            const notches = p.notches.map((n) => {
              if (n.vertexIndex != null && n.vertexIndex > curveIndex) {
                return { ...n, vertexIndex: n.vertexIndex + 1 }
              }
              return n
            })
            const newVertexIdx = curveIndex + 1
            const softVertices = [
              ...(p.softVertices ?? []).map((vi) => (vi >= newVertexIdx ? vi + 1 : vi)),
              newVertexIdx,
            ]
            const seamLine =
              p.seamAllowanceMm != null && cutLine.length >= 3 ? offsetCurvesInwardForSeam(cutLine, p.seamAllowanceMm) : p.seamLine
            inserted = true
            return applySharpCornerPromotion({ ...p, cutLine, seamLine, notches, softVertices })
          }),
        },
        ...(toastMessage ? { toastMessage } : {}),
      }
    })
    return inserted
  },

  // Vertex verschieben. Seam-as-Master: Bei Nahtzugabe wird die seamLine (Innenkontur) bearbeitet, cutLine folgt.
  updateVertex: (pieceId, vertexIndex, point, skipSeamRecalc, notchOpts) =>
    set((s) => {
      let toastMessage: string | null = null
      return {
        workspace: {
          ...s.workspace,
          pieces: s.workspace.pieces.map((p) => {
            const seamAllowance = p.seamAllowanceMm
            const useSeamMaster = useSeamLineForVertexEditing(p)
            const curves = useSeamMaster ? p.seamLine : p.cutLine
            if (p.id !== pieceId || curves.length === 0) return p
            const n = curves.length
            const nextCurves = curves.map((c) =>
              c.type === 'line'
                ? { type: 'line' as const, start: { ...c.start }, end: { ...c.end } }
                : { type: 'bezier' as const, start: { ...c.start }, end: { ...c.end }, cp1: { ...c.cp1 }, cp2: { ...c.cp2 } }
            )
            if (vertexIndex === 0) {
              nextCurves[0] = { ...nextCurves[0], start: point } as Curve
              nextCurves[n - 1] = { ...nextCurves[n - 1], end: point } as Curve
            } else {
              nextCurves[vertexIndex - 1] = { ...nextCurves[vertexIndex - 1], end: point } as Curve
              nextCurves[vertexIndex] = { ...nextCurves[vertexIndex], start: point } as Curve
            }
            const contourCheck = validateContourAfterVertexMove(nextCurves)
            if (!contourCheck.ok) {
              toastMessage = `warn:${contourCheck.message}`
              return p
            }
            let cutLine = p.cutLine
            let seamLine = p.seamLine
            const cutRebuiltFromSeam =
              useSeamMaster && !skipSeamRecalc && seamAllowance != null
            if (cutRebuiltFromSeam) {
              const newSeam = nextCurves
              const derived = deriveCutLineFromSeamWithValidation(newSeam, seamAllowance)
              if (!derived.ok) {
                toastMessage = `warn:${derived.message}`
                return p
              }
              seamLine = newSeam
              cutLine = derived.cutLine
            } else if (!useSeamMaster) {
              cutLine = nextCurves
              if (skipSeamRecalc) {
                seamLine = p.seamLine
              } else if (seamAllowance != null && cutLine.length >= 3) {
                const newSeam = offsetCurvesInwardForSeam(cutLine, seamAllowance)
                if (newSeam.length < 3) {
                  toastMessage = `warn:Nahtlinie konnte nicht berechnet werden.`
                  return p
                }
                const seamFromCutCheck = validateContourAfterVertexMove(newSeam)
                if (!seamFromCutCheck.ok) {
                  toastMessage = `warn:${seamFromCutCheck.message} (Naht aus Schnittkontur)`
                  return p
                }
                seamLine = newSeam
              } else {
                seamLine = p.seamLine
              }
            }
            const baseline = notchOpts?.notchResyncBaseline
            const notches = cutRebuiltFromSeam
              ? resyncNotchesAfterCutLineRebuilt(
                  baseline ? baseline.notches : p.notches,
                  baseline ? baseline.cutLine : p.cutLine,
                  cutLine
                )
              : p.notches
            const softVertices =
              cutRebuiltFromSeam && cutLine.length > 0
                ? (p.softVertices ?? []).filter((vi) => vi >= 0 && vi < cutLine.length)
                : p.softVertices
            return applySharpCornerPromotion({ ...p, cutLine, seamLine, notches, softVertices })
          }),
        },
        ...(toastMessage ? { toastMessage } : {}),
      }
    }),

  replaceSegmentWithBezier: (pieceId, curveIndex, cp1, cp2) =>
    set((s) => {
      let toastMessage: string | null = null
      const pieces = s.workspace.pieces.map((p) => {
        if (p.id !== pieceId) return p
        const seamPc = useSeamLineForPointCurveEditing(p)
        const target = seamPc ? p.seamLine : p.cutLine
        if (curveIndex < 0 || curveIndex >= target.length) return p
        const c = target[curveIndex]
        if (c.type !== 'line') return p
        const bezier: Curve = {
          type: 'bezier',
          start: { ...c.start },
          end: { ...c.end },
          cp1: { ...cp1 },
          cp2: { ...(cp2 ?? cp1) },
        }
        const next = [...target]
        next[curveIndex] = bezier
        const replaceBezierContourCheck = validateContourAfterVertexMove(next)
        if (!replaceBezierContourCheck.ok) {
          toastMessage = `warn:${replaceBezierContourCheck.message}`
          return p
        }
        if (seamPc && p.seamAllowanceMm != null) {
          const seamLine = next
          const derived = deriveCutLineFromSeamWithValidation(seamLine, p.seamAllowanceMm)
          if (!derived.ok) {
            toastMessage = `warn:${derived.message}`
            return p
          }
          const cutLine = derived.cutLine
          const notches = resyncNotchesAfterCutLineRebuilt(p.notches, p.cutLine, cutLine)
          const softVertices = (p.softVertices ?? []).filter((vi) => vi >= 0 && vi < cutLine.length)
          return applySharpCornerPromotion({ ...p, cutLine, seamLine, notches, softVertices })
        }
        const cutLine = [...p.cutLine]
        cutLine[curveIndex] = bezier
        const seamLine =
          p.seamAllowanceMm != null && cutLine.length >= 3 ? offsetCurvesInwardForSeam(cutLine, p.seamAllowanceMm) : p.seamLine
        return applySharpCornerPromotion({ ...p, cutLine, seamLine })
      })
      return {
        workspace: { ...s.workspace, pieces },
        ...(toastMessage ? { toastMessage } : {}),
      }
    }),

  movePointOnCurve: (pieceId, curveIndex, t, newPoint, skipSeamRecalc) =>
    set((s) => {
      let toastMessage: string | null = null
      const pieces = s.workspace.pieces.map((p) => {
        if (p.id !== pieceId) return p
        const seamPc = useSeamLineForPointCurveEditing(p)
        const target = seamPc ? p.seamLine : p.cutLine
        if (curveIndex < 0 || curveIndex >= target.length) return p
        const c = target[curveIndex]
        if (c.type !== 'bezier') return p
        const adjusted = adjustControlPointsForPointOnCurve(c, t, newPoint)
        if (!adjusted) return p
        const bezier: Curve = {
          type: 'bezier',
          start: { ...c.start },
          end: { ...c.end },
          cp1: { ...adjusted.cp1 },
          cp2: { ...adjusted.cp2 },
        }
        const next = [...target]
        next[curveIndex] = bezier
        const moveOnCurveContourCheck = validateContourAfterVertexMove(next)
        if (!moveOnCurveContourCheck.ok) {
          toastMessage = `warn:${moveOnCurveContourCheck.message}`
          return p
        }
        if (seamPc && p.seamAllowanceMm != null) {
          const seamLine = next
          const derived = deriveCutLineFromSeamWithValidation(seamLine, p.seamAllowanceMm)
          if (!derived.ok) {
            toastMessage = `warn:${derived.message}`
            return p
          }
          const cutLine = derived.cutLine
          const notches = resyncNotchesAfterCutLineRebuilt(p.notches, p.cutLine, cutLine)
          const softVertices = (p.softVertices ?? []).filter((vi) => vi >= 0 && vi < cutLine.length)
          return applySharpCornerPromotion({ ...p, cutLine, seamLine, notches, softVertices })
        }
        const cutLine = [...p.cutLine]
        cutLine[curveIndex] = bezier
        const seamLine = skipSeamRecalc
          ? p.seamLine
          : (p.seamAllowanceMm != null && cutLine.length >= 3 ? offsetCurvesInwardForSeam(cutLine, p.seamAllowanceMm) : p.seamLine)
        return applySharpCornerPromotion({ ...p, cutLine, seamLine })
      })
      return {
        workspace: { ...s.workspace, pieces },
        ...(toastMessage ? { toastMessage } : {}),
      }
    }),

  removeVertex: (pieceId, vertexIndex) =>
    set((s) => {
      const piece = s.workspace.pieces.find((p) => p.id === pieceId)
      const useSeamMaster = piece != null && useSeamLineForVertexEditing(piece)
      const master = useSeamMaster ? piece!.seamLine : piece?.cutLine ?? []
      const oldN = master.length

      const mergeContourRemoveVertex = (curves: Curve[], vi: number): Curve[] | null => {
        if (curves.length <= 3) return null
        const n = curves.length
        const prevIdx = (vi - 1 + n) % n
        const nextIdx = vi
        const newSeg: Curve = {
          type: 'line',
          start: { ...curves[prevIdx].start },
          end: { ...curves[nextIdx].end },
        }
        const merged = curves.filter((_, j) => j !== prevIdx && j !== nextIdx)
        merged.splice(Math.min(prevIdx, nextIdx), 0, newSeg)
        return merged
      }

      if (piece && useSeamMaster && piece.seamAllowanceMm != null && master.length > 3) {
        const merged = mergeContourRemoveVertex(master, vertexIndex)
        if (merged) {
          const derived = deriveCutLineFromSeamWithValidation(merged, piece.seamAllowanceMm)
          if (!derived.ok) {
            return { ...s, toastMessage: `warn:${derived.message}` }
          }
        }
      }

      return {
        workspace: {
          ...s.workspace,
          seamAssignments: oldN > 3 ? adjustSeamAfterRemove(s.workspace.seamAssignments, pieceId, vertexIndex, oldN) : s.workspace.seamAssignments,
          pieces: s.workspace.pieces.map((p) => {
            const seamAllowance = p.seamAllowanceMm
            const seamMaster = useSeamLineForVertexEditing(p)
            const curves = seamMaster ? p.seamLine : p.cutLine
            if (p.id !== pieceId || curves.length <= 3) return p
            const merged = mergeContourRemoveVertex(curves, vertexIndex)
            if (!merged) return p
            let cutLine = p.cutLine
            let seamLine = p.seamLine
            if (seamMaster && seamAllowance != null) {
              const derived = deriveCutLineFromSeamWithValidation(merged, seamAllowance)
              if (!derived.ok) return p
              seamLine = merged
              cutLine = derived.cutLine
            } else {
              cutLine = merged
              seamLine =
                seamAllowance != null && cutLine.length >= 3
                  ? offsetCurvesInwardForSeam(cutLine, seamAllowance)
                  : p.seamLine
            }
            const notches =
              seamMaster && seamAllowance != null
                ? resyncNotchesAfterCutLineRebuilt(p.notches, p.cutLine, cutLine)
                : resyncNotchesAfterCutLineRebuilt(p.notches, p.cutLine, cutLine)
            const softVertices = (p.softVertices ?? [])
              .filter((vi) => vi !== vertexIndex)
              .map((vi) => (vi > vertexIndex ? vi - 1 : vi))
            return applySharpCornerPromotion({ ...p, cutLine, seamLine, notches, softVertices })
          }),
        },
      }
    }),

  convertBezierSegmentToLine: (pieceId, curveIndex) =>
    set((s) => {
      let toastMessage: string | null = null
      const pieces = s.workspace.pieces.map((p) => {
        if (p.id !== pieceId) return p
        const seamPc = useSeamLineForPointCurveEditing(p)
        const target = seamPc ? p.seamLine : p.cutLine
        if (curveIndex < 0 || curveIndex >= target.length) return p
        const c = target[curveIndex]
        if (c.type !== 'bezier') return p
        const lineSeg: Curve = { type: 'line', start: { ...c.start }, end: { ...c.end } }
        const next = [...target]
        next[curveIndex] = lineSeg
        if (seamPc && p.seamAllowanceMm != null) {
          const seamLine = next
          const derived = deriveCutLineFromSeamWithValidation(seamLine, p.seamAllowanceMm)
          if (!derived.ok) {
            toastMessage = `warn:${derived.message}`
            return p
          }
          const cutLine = derived.cutLine
          const notches = resyncNotchesAfterCutLineRebuilt(p.notches, p.cutLine, cutLine)
          const softVertices = (p.softVertices ?? []).filter((vi) => vi >= 0 && vi < cutLine.length)
          return applySharpCornerPromotion({ ...p, cutLine, seamLine, notches, softVertices })
        }
        const cutLine = [...p.cutLine]
        cutLine[curveIndex] = lineSeg
        const seamLine =
          p.seamAllowanceMm != null && cutLine.length >= 3 ? offsetCurvesInwardForSeam(cutLine, p.seamAllowanceMm) : p.seamLine
        return applySharpCornerPromotion({ ...p, cutLine, seamLine })
      })
      return {
        workspace: { ...s.workspace, pieces },
        ...(toastMessage ? { toastMessage } : {}),
      }
    }),

  setVertexSoft: (pieceId, vertexIndex, soft) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        pieces: s.workspace.pieces.map((p) => {
          if (p.id !== pieceId) return p
          const useSeamMaster = useSeamLineForVertexEditing(p)
          const curves = useSeamMaster ? p.seamLine : p.cutLine
          const n = curves.length
          if (n <= 3 || vertexIndex < 0 || vertexIndex >= n) return p
          const notchVIs = new Set(p.notches.map((nn) => nn.vertexIndex).filter((vi): vi is number => vi != null))
          if (useSeamMaster) {
            if (seamVertexNearProjectedNotch(p, vertexIndex)) return p
          } else if (notchVIs.has(vertexIndex)) {
            return p
          }
          const cutViForSoft =
            useSeamMaster ? mapMasterVertexIndexToCutVertexIndex(p, vertexIndex) : vertexIndex
          if (cutViForSoft == null) return p
          const set = new Set(p.softVertices ?? [])
          if (soft) set.add(cutViForSoft)
          else set.delete(cutViForSoft)
          const softVertices = [...set].sort((a, b) => a - b)
          return applySharpCornerPromotion({ ...p, softVertices })
        }),
      },
    })),

  offsetSegment: (pieceId, curveIndex, deltaMm) =>
    set((s) => {
      const piece = s.workspace.pieces.find((p) => p.id === pieceId)
      if (!piece) return s
      const seamPc = useSeamLineForPointCurveEditing(piece)
      const master = seamPc ? piece.seamLine : piece.cutLine
      if (master.length === 0) return s
      const pts = offsetSegmentPoints(master, curveIndex, deltaMm)
      if (!pts) return s
      const n = master.length
      const prevIdx = (curveIndex - 1 + n) % n
      const nextIdx = (curveIndex + 1) % n
      let toastMessage: string | null = null
      const pieces = s.workspace.pieces.map((p) => {
        if (p.id !== pieceId) return p
        const seamPcP = useSeamLineForPointCurveEditing(p)
        const m = seamPcP ? p.seamLine : p.cutLine
        const nextMaster = m.map((c) =>
          c.type === 'line'
            ? { type: 'line' as const, start: { ...c.start }, end: { ...c.end } }
            : { type: 'bezier' as const, start: { ...c.start }, end: { ...c.end }, cp1: { ...c.cp1 }, cp2: { ...c.cp2 } }
        )
        const seg = nextMaster[curveIndex]
        if (seg.type === 'bezier' && pts.cp1 && pts.cp2) {
          nextMaster[curveIndex] = { type: 'bezier', start: pts.start, end: pts.end, cp1: pts.cp1, cp2: pts.cp2 }
        } else {
          nextMaster[curveIndex] = { ...nextMaster[curveIndex], start: pts.start, end: pts.end } as Curve
        }
        nextMaster[prevIdx] = { ...nextMaster[prevIdx], end: pts.start } as Curve
        nextMaster[nextIdx] = { ...nextMaster[nextIdx], start: pts.end } as Curve
        if (seamPcP && p.seamAllowanceMm != null) {
          const seamLine = nextMaster
          const derived = deriveCutLineFromSeamWithValidation(seamLine, p.seamAllowanceMm)
          if (!derived.ok) {
            toastMessage = `warn:${derived.message}`
            return p
          }
          const cutLine = derived.cutLine
          const notches = resyncNotchesAfterCutLineRebuilt(p.notches, p.cutLine, cutLine)
          const softVertices = (p.softVertices ?? []).filter((vi) => vi >= 0 && vi < cutLine.length)
          return applySharpCornerPromotion({ ...p, cutLine, seamLine, notches, softVertices })
        }
        const cutLine = nextMaster
        const seamLine =
          p.seamAllowanceMm != null && cutLine.length >= 3 ? offsetCurvesInwardForSeam(cutLine, p.seamAllowanceMm) : p.seamLine
        return applySharpCornerPromotion({ ...p, cutLine, seamLine })
      })
      return {
        workspace: { ...s.workspace, pieces },
        ...(toastMessage ? { toastMessage } : {}),
      }
    }),

  recomputeSeamLine: (pieceId) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        pieces: s.workspace.pieces.map((p) => {
          if (p.id !== pieceId || p.seamAllowanceMm == null || p.cutLine.length < 3) return p
          const seamLine = offsetCurvesInwardForSeam(p.cutLine, p.seamAllowanceMm)
          return applySharpCornerPromotion({ ...p, seamLine })
        }),
      },
    })),

  flipPieceAlongGrain: (pieceId) =>
    set((s) => {
      const piece = s.workspace.pieces.find((p) => p.id === pieceId)
      if (!piece || piece.cutLine.length < 3) return s
      const bounds = curvesBounds(piece.cutLine)
      if (!bounds) return s
      const cx = (bounds.minX + bounds.maxX) / 2
      const cutLine = piece.cutLine.map((c) => mirrorCurve(c, cx))
      // SeamLine nur aus cutLine ableiten – nie alte seamLine spiegeln (verhindert willkürliche Kontur)
      const seamLine =
        piece.seamAllowanceMm != null && cutLine.length >= 3
          ? offsetCurvesInwardForSeam(cutLine, piece.seamAllowanceMm)
          : []
      const notches = piece.notches.map((n) => ({
        ...n,
        position: mirrorX(n.position, cx),
        angle: 180 - n.angle,
      }))
      const drills = piece.drills.map((d) => ({ ...d, center: mirrorX(d.center, cx) }))
      const internalLines = piece.internalLines.map((c) => mirrorCurve(c, cx))
      const grainLine = piece.grainLine
        ? { start: mirrorX(piece.grainLine.start, cx), end: mirrorX(piece.grainLine.end, cx) }
        : null
      return {
        workspace: {
          ...s.workspace,
          pieces: s.workspace.pieces.map((p) =>
            p.id === pieceId
              ? applySharpCornerPromotion({
                  ...p,
                  cutLine,
                  seamLine,
                  notches,
                  drills,
                  internalLines,
                  grainLine,
                })
              : p
          ),
        },
      }
    }),

  setPieceRotation: (pieceId, rotationDeg) =>
    set((s) => {
      const piece = s.workspace.pieces.find((p) => p.id === pieceId)
      if (!piece || piece.cutLine.length < 3) return s
      const pivot = getPiecePivotLocal(piece)
      const t = piece.transform
      const worldCenter = pieceLocalToWorld(pivot, t)
      const lx = t.mirrored ? -pivot.x : pivot.x
      const ly = pivot.y
      const rad = (rotationDeg * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      const txNew = worldCenter.x - (lx * cos - ly * sin)
      const tyNew = worldCenter.y - (lx * sin + ly * cos)
      return {
        workspace: {
          ...s.workspace,
          pieces: s.workspace.pieces.map((p) =>
            p.id === pieceId
              ? { ...p, transform: { ...p.transform, x: txNew, y: tyNew, rotation: rotationDeg } }
              : p
          ),
        },
      }
    }),

  setPiecePivot: (pieceId, pivotLocal) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        pieces: s.workspace.pieces.map((p) => {
          if (p.id !== pieceId) return p
          const next = { ...p, transform: { ...p.transform } }
          if (pivotLocal === null) {
            delete (next.transform as { pivotLocal?: Point }).pivotLocal
          } else {
            next.transform.pivotLocal = pivotLocal
          }
          return next
        }),
      },
    })),

  rotatePiece90: (pieceId) =>
    get().setPieceRotation(pieceId, (get().workspace.pieces.find((p) => p.id === pieceId)?.transform.rotation ?? 0) + 90),

  setGrainLine: (pieceId, line) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        pieces: s.workspace.pieces.map((p) =>
          p.id === pieceId ? { ...p, grainLine: line } : p
        ),
      },
    })),

  alignPieceToGrain: (pieceId) => {
    const piece = get().workspace.pieces.find((p) => p.id === pieceId)
    if (!piece || piece.cutLine.length < 3) return
    const bounds = (() => {
      const curves = piece.cutLine
      if (curves.length === 0) return null
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const c of curves) {
        minX = Math.min(minX, c.start.x, c.end.x)
        minY = Math.min(minY, c.start.y, c.end.y)
        maxX = Math.max(maxX, c.start.x, c.end.x)
        maxY = Math.max(maxY, c.start.y, c.end.y)
        if (c.type === 'bezier') {
          minX = Math.min(minX, c.cp1.x, c.cp2.x)
          minY = Math.min(minY, c.cp1.y, c.cp2.y)
          maxX = Math.max(maxX, c.cp1.x, c.cp2.x)
          maxY = Math.max(maxY, c.cp1.y, c.cp2.y)
        }
      }
      return minX === Infinity ? null : { minX, minY, maxX, maxY }
    })()
    if (!bounds) return
    const cx = (bounds.minX + bounds.maxX) / 2
    const topY = bounds.minY + Math.max((bounds.maxY - bounds.minY) * 0.2, 3)
    const bottomY = bounds.maxY - Math.max((bounds.maxY - bounds.minY) * 0.2, 3)
    const grainCx = cx + 22
    const defaultStart = { x: grainCx, y: topY }
    const defaultEnd = { x: grainCx, y: bottomY }
    const start = piece.grainLine?.start ?? defaultStart
    const end = piece.grainLine?.end ?? defaultEnd
    const grainAngleDeg = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI
    const currentWorldAngle = piece.transform.rotation + grainAngleDeg
    const targetWorldAngle = 90
    let delta = targetWorldAngle - currentWorldAngle
    while (delta > 180) delta -= 360
    while (delta < -180) delta += 360
    get().setPieceRotation(pieceId, piece.transform.rotation + delta)
  },

  startDigitize: () => set({ digitizeState: { nodes: [], isDragging: false, dragPosition: null } }),

  addDigitizeNode: (point) =>
    set((s) => {
      if (!s.digitizeState) return s
      return {
        digitizeState: {
          ...s.digitizeState,
          nodes: [...s.digitizeState.nodes, { point, handleOut: null }],
        },
      }
    }),

  updateDigitizeDrag: (position) =>
    set((s) => {
      if (!s.digitizeState || s.digitizeState.nodes.length === 0) return s
      const nodes = [...s.digitizeState.nodes]
      const last = nodes[nodes.length - 1]
      nodes[nodes.length - 1] = { ...last, handleOut: position }
      return {
        digitizeState: { ...s.digitizeState, nodes, isDragging: true, dragPosition: position },
      }
    }),

  finishDigitizeDrag: () =>
    set((s) => {
      if (!s.digitizeState) return s
      return {
        digitizeState: { ...s.digitizeState, isDragging: false, dragPosition: null },
      }
    }),

  cancelDigitize: () => set({ digitizeState: null, tool: 'select' }),

  exitAllModes: () =>
    set(() => ({
      tool: 'select',
      selectedPoint: null,
      digitizeState: null,
      pendingNahtzugabeClick: false,
      nahtzugabeDialogPieceId: null,
      piecePropertiesDialogPieceId: null,
      nahtzuordnungMode: 'idle',
      pendingNahtzuordnungFirst: null,
      rulerMode: false,
      rulerLine: null,
      seamAdjustmentDialog: null,
      seamAssignmentMetaDialogId: null,
      massstabDialog: null,
      showHelpModal: false,
      showShortcutListModal: false,
      showSettingsModal: false,
      showStuecklisteModal: false,
      workspaceImageSelected: false,
      configuratorModalOpen: false,
      rockGeneratorModalOpen: false,
      toastMessage: null,
      batchSelectionFilter: 'all',
      batchSelectionTargets: [],
      batchUiHighlightByTargetId: {},
    })),

  finishDigitize: () => {
    const s = get()
    if (!s.digitizeState || s.digitizeState.nodes.length < 3) return

    const curves = digitizeNodesToCurves(s.digitizeState.nodes)
    if (curves.length < 3) return
    const id = generateId()
    const number = String(s.workspace.pieces.length + 1).padStart(3, '0')
    const softVertices = s.digitizeState.nodes
      .map((node, i) => node.handleOut != null ? i : -1)
      .filter((i) => i >= 0)
    const newPiece: PatternPiece = applySharpCornerPromotion({
      ...createDefaultPiece(id, number),
      cutLine: curves,
      softVertices,
    })
    set((st) => ({
      workspace: { ...st.workspace, pieces: [...st.workspace.pieces, newPiece] },
      selectedPieceIds: [id],
      digitizeState: null,
      tool: 'select',
    }))
  },

  // --- Hintergrundbild ---
  startImageSession: ({ dataUrl, widthPx, heightPx }) => {
    const VIEWBOX_WIDTH = 800
    const VIEWBOX_HEIGHT = 600
    const padding = 0.95
    const raw = Math.min((VIEWBOX_WIDTH * padding) / widthPx, (VIEWBOX_HEIGHT * padding) / heightPx)
    const renderMmPerPixel = Number.isFinite(raw) && raw > 0 ? raw : 1

    set({
      imageDigitizeSession: {
        imageDataUrl: dataUrl,
        imageSizePx: { width: widthPx, height: heightPx },
        imagePosition: { x: 0, y: 0 },
        renderMmPerPixel,
        locked: false,
      },
      tool: 'select',
      workspaceImageSelected: true,
      selectedPieceIds: [],
      digitizeState: null,
    })
  },
  setImagePosition: (pos) =>
    set((s) => {
      if (!s.imageDigitizeSession || s.imageDigitizeSession.locked) return s
      return {
        imageDigitizeSession: { ...s.imageDigitizeSession, imagePosition: pos },
      }
    }),
  setImageRenderMmPerPixel: (mmPerPixel) =>
    set((s) => {
      if (!s.imageDigitizeSession || s.imageDigitizeSession.locked) return s
      const v = Number.isFinite(mmPerPixel) ? mmPerPixel : s.imageDigitizeSession.renderMmPerPixel
      const clamped = Math.min(500, Math.max(1e-4, v))
      return {
        imageDigitizeSession: { ...s.imageDigitizeSession, renderMmPerPixel: clamped },
      }
    }),
  setWorkspaceImageSelected: (selected) => set({ workspaceImageSelected: selected }),
  setWorkspaceImageLocked: (locked) =>
    set((s) => ({
      imageDigitizeSession: s.imageDigitizeSession ? { ...s.imageDigitizeSession, locked } : null,
    })),
  cancelImageSession: () =>
    set(() => ({
      imageDigitizeSession: null,
      workspaceImageSelected: false,
      digitizeState: null,
      tool: 'select',
    })),

  updateWorkspace: (patch) =>
    set((s) => ({
      workspace: { ...s.workspace, ...patch },
    })),

  loadProjectFromFile: (project, opts) => {
    const notchSettings = Array.from({ length: 10 }, (_, i) => {
      const n = project.notchSettings[i]
      return n && (n.type === 'strich' || n.type === 'kerbe')
        ? { type: n.type, widthMm: n.widthMm, depthMm: n.depthMm }
        : { type: 'strich' as const, widthMm: 6, depthMm: 4 }
    })
    const firstId = project.workspace.pieces[0]?.id
    const ws =
      opts?.projectFileName != null
        ? { ...project.workspace, projectFileName: opts.projectFileName }
        : project.workspace
    set({
      workspace: ws,
      dxfExportScale: project.dxfExportScale,
      dxfImportExtraCutLayers: project.dxfImportExtraCutLayers,
      dxfImportScale: project.dxfImportScale,
      notchSettings,
      imageDigitizeSession: project.imageDigitizeSession,
      workspaceImageSelected: Boolean(project.imageDigitizeSession?.imageDataUrl),
      selectedPieceIds: firstId ? [firstId] : [],
      selectedPoint: null,
      tool: 'select',
      digitizeState: null,
      pendingNahtzugabeClick: false,
      nahtzugabeDialogPieceId: null,
      piecePropertiesDialogPieceId: null,
      nahtzuordnungMode: 'idle',
      pendingNahtzuordnungFirst: null,
      rulerMode: false,
      rulerLine: null,
      seamAdjustmentDialog: null,
      seamAssignmentMetaDialogId: null,
      massstabDialog: null,
      showHelpModal: false,
      showShortcutListModal: false,
      showSettingsModal: false,
      showStuecklisteModal: false,
      toastMessage: null,
      batchSelectionFilter: 'all',
      batchSelectionTargets: [],
      batchUiHighlightByTargetId: {},
    })
  },

}))

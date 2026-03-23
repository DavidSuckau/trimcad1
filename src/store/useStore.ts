import { create } from 'zustand'
import type { Workspace, PatternPiece, ViewState, Point, Line, Curve, Notch, Drill, SeamAssignment, DigitizeNode, DigitizeState } from '../types/model'
import { offsetCurvesInwardForSeam, offsetCurvesOutwardForCut, offsetSegmentPoints } from '../geometry/offset'
import { splitBezierAt, joinBezierSegments, adjustControlPointsForPointOnCurve, pointAtPathLength } from '../geometry/curveToPath'
import { nearestCurveIndexAndPoint } from '../geometry/nearestOnCurve'
import { getSubSegments, countNotchesOnEdge, getNotchesOnEdge, edgeTotalLength, snapVertexToEdgeLength } from '../geometry/seamUtils'
import { pieceLocalToWorld, getPiecePivotLocal } from '../geometry/pieceTransform'
import { applySharpCornerPromotion } from '../geometry/softVertexPromotion'
import { isNotchSpacingValidForCandidate } from '../geometry/notchMinSpacing'

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
  showHelpModal: boolean
  /** Kompakte Tastenkürzel-Übersicht (Hilfe-Menü). */
  showShortcutListModal: boolean
  dxfExportScale: number
  notchSettings: NotchSetting[]
  toastMessage: string | null
  /** ID der SeamAssignment für die das Anpassungs-Modal angezeigt wird */
  seamAdjustmentDialog: string | null
  digitizeState: DigitizeState | null
  imageDigitizeSession: ImageDigitizeSession | null
  /** Hintergrundbild ist ausgewählt (wie ein Teil). */
  workspaceImageSelected: boolean

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
  setRulerMode: (v: boolean) => void
  setRulerLine: (v: { start: Point; end: Point } | null) => void
  setPendingNahtzugabeClick: (v: boolean) => void
  setNahtzugabeDialogPieceId: (v: string | null) => void
  setPiecePropertiesDialogPieceId: (v: string | null) => void
  setNahtzuordnungMode: (v: 'idle' | 'first' | 'second') => void
  setPendingNahtzuordnungFirst: (v: { pieceId: string; curveIndices: number[]; clickedCurve: number } | null) => void
  setShowSettingsModal: (v: boolean) => void
  setShowHelpModal: (v: boolean) => void
  setShowShortcutListModal: (v: boolean) => void
  setDxfExportScale: (v: number) => void
  setToastMessage: (v: string | null) => void
  updateNotchSetting: (index: number, upd: Partial<NotchSetting>) => void
  addSeamAssignment: (pieceIdA: string, curveIndicesA: number[], clickedCurveA: number, pieceIdB: string, curveIndicesB: number[], clickedCurveB: number) => void
  removeSeamAssignment: (id: string) => void
  setSeamAdjustmentDialog: (v: string | null) => void
  /** Passt Notch-Positionen auf der Zielseite an die Referenzseite an. */
  adjustSeamNotches: (assignmentId: string, keepSide: 'A' | 'B') => void
  /** Prüft alle SeamAssignments: Gesamtlänge gleich + Notch-Abstände ungleich → Modal öffnen. */
  checkSeamAdjustment: () => void
  /** Snap bei Vertex-Drag: wenn Differenz < 5mm, Vertex exakt auf 0 setzen. */
  snapSeamEdgeToMatch: (pieceId: string, vertexIndex: number) => void

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
  insertPointOnCutLine: (pieceId: string, curveIndex: number, point: Point, t?: number) => void
  updateVertex: (pieceId: string, vertexIndex: number, point: Point, skipSeamRecalc?: boolean) => void
  replaceSegmentWithBezier: (pieceId: string, curveIndex: number, cp1: Point, cp2?: Point) => void
  movePointOnCurve: (pieceId: string, curveIndex: number, t: number, newPoint: Point, skipSeamRecalc?: boolean) => void
  removeVertex: (pieceId: string, vertexIndex: number) => void
  convertBezierSegmentToLine: (pieceId: string, curveIndex: number) => void
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
  rulerMode: false,
  rulerLine: null,
  pendingNahtzugabeClick: false,
  nahtzugabeDialogPieceId: null,
  piecePropertiesDialogPieceId: null,
  nahtzuordnungMode: 'idle',
  pendingNahtzuordnungFirst: null,
  showSettingsModal: false,
  showHelpModal: false,
  showShortcutListModal: false,
  dxfExportScale: 1,
  toastMessage: null,
  seamAdjustmentDialog: null,
  digitizeState: null,
  imageDigitizeSession: null,
  workspaceImageSelected: false,
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
    set((s) => ({
      workspace: {
        ...s.workspace,
        pieces: s.workspace.pieces.map((p) => {
          if (p.id !== id) return p
          const next = { ...p, ...upd }
          // Seam-as-Master: bei Nahtzugabe cutLine aus seamLine ableiten; sonst umgekehrt
          if (next.seamAllowanceMm != null) {
            if (next.seamLine.length >= 3) {
              next.cutLine = offsetCurvesOutwardForCut(next.seamLine, next.seamAllowanceMm)
            } else if (next.cutLine.length >= 3) {
              next.seamLine = offsetCurvesInwardForSeam(next.cutLine, next.seamAllowanceMm)
            }
          } else {
            next.seamLine = []
          }
          return applySharpCornerPromotion(next)
        }),
      },
    })),

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

  setTool: (t) => set({ tool: t }),
  setShowGrid: (v) => set({ showGrid: v }),
  setShowPoints: (v) => set({ showPoints: v }),
  setShowGrain: (v) => set({ showGrain: v }),
  setShowNotches: (v) => set({ showNotches: v }),
  setShowDrills: (v) => set({ showDrills: v }),
  setShowInternalLines: (v) => set({ showInternalLines: v }),
  setShowPieceNames: (v) => set({ showPieceNames: v }),
  setRulerMode: (v) => set({ rulerMode: v }),
  setRulerLine: (v) => set({ rulerLine: v }),
  setPendingNahtzugabeClick: (v) => set({ pendingNahtzugabeClick: v }),
  setNahtzugabeDialogPieceId: (v) => set({ nahtzugabeDialogPieceId: v }),
  setPiecePropertiesDialogPieceId: (v) => set({ piecePropertiesDialogPieceId: v }),
  setNahtzuordnungMode: (v) => set({ nahtzuordnungMode: v, pendingNahtzuordnungFirst: v === 'first' ? null : get().pendingNahtzuordnungFirst }),
  setPendingNahtzuordnungFirst: (v) => set({ pendingNahtzuordnungFirst: v }),
  setShowSettingsModal: (v) => set({ showSettingsModal: v }),
  setShowHelpModal: (v) => set({ showHelpModal: v }),
  setShowShortcutListModal: (v) => set({ showShortcutListModal: v }),
  setDxfExportScale: (v) => set({ dxfExportScale: v }),
  setToastMessage: (v) => set({ toastMessage: v }),
  updateNotchSetting: (index, upd) =>
    set((s) => {
      const notchSettings = [...s.notchSettings]
      notchSettings[index] = { ...notchSettings[index], ...upd }
      return { notchSettings }
    }),
  addSeamAssignment: (pieceIdA, curveIndicesA, clickedCurveA, pieceIdB, curveIndicesB, clickedCurveB) => {
    const newId = generateId()
    set((s) => ({
      workspace: {
        ...s.workspace,
        seamAssignments: [
          ...s.workspace.seamAssignments,
          {
            id: newId,
            pieceIdA,
            curveIndicesA,
            clickedCurveA,
            pieceIdB,
            curveIndicesB,
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
    const lenA = edgeTotalLength(pieceA, curveIndicesA)
    const lenB = edgeTotalLength(pieceB, curveIndicesB)
    const totalDiffMm = Math.abs(lenA - lenB)
    if (totalDiffMm >= 0.1) return
    const ncA = countNotchesOnEdge(pieceA, curveIndicesA)
    const ncB = countNotchesOnEdge(pieceB, curveIndicesB)
    if (ncA < 1) return
    let subDiff = false
    const subsA = getSubSegments(pieceA, curveIndicesA)
    const subsB = getSubSegments(pieceB, curveIndicesB)
    if (ncA === ncB && subsA.length === subsB.length && subsA.length >= 2) {
      for (let i = 0; i < subsA.length; i++) {
        const sb = subsB[subsB.length - 1 - i]
        if (Math.abs(subsA[i].length - sb.length) >= 0.1) { subDiff = true; break }
      }
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

  adjustSeamNotches: (assignmentId, keepSide) => {
    const s = get()
    const a = s.workspace.seamAssignments.find((x) => x.id === assignmentId)
    if (!a) return

    const refPieceId = keepSide === 'A' ? a.pieceIdA : a.pieceIdB
    const refIndices = keepSide === 'A' ? a.curveIndicesA : a.curveIndicesB
    const tgtPieceId = keepSide === 'A' ? a.pieceIdB : a.pieceIdA
    const tgtIndices = keepSide === 'A' ? a.curveIndicesB : a.curveIndicesA

    const refPiece = s.workspace.pieces.find((p) => p.id === refPieceId)
    const tgtPiece = s.workspace.pieces.find((p) => p.id === tgtPieceId)
    if (!refPiece || !tgtPiece) return

    const refNotchCount = countNotchesOnEdge(refPiece, refIndices)
    const tgtNotchCount = countNotchesOnEdge(tgtPiece, tgtIndices)
    if (refNotchCount !== tgtNotchCount || refNotchCount === 0) {
      set({ seamAdjustmentDialog: null })
      return
    }

    const refSubs = getSubSegments(refPiece, refIndices)
    const refSubLengths = refSubs.map((ss) => ss.length)
    const reversed = [...refSubLengths].reverse()

    const tgtTotalLen = edgeTotalLength(tgtPiece, tgtIndices)
    const cumPositions: number[] = []
    let cum = 0
    for (let i = 0; i < reversed.length - 1; i++) {
      cum += reversed[i]
      if (cum > tgtTotalLen + 0.01) {
        set({ seamAdjustmentDialog: null })
        return
      }
      cumPositions.push(cum)
    }

    const tgtSubCurves = tgtIndices.map((ci) => tgtPiece.cutLine[ci]).filter(Boolean)
    if (tgtSubCurves.length === 0) { set({ seamAdjustmentDialog: null }); return }

    const tgtNotches = getNotchesOnEdge(tgtPiece, tgtIndices)
    if (tgtNotches.length !== cumPositions.length) { set({ seamAdjustmentDialog: null }); return }

    const targetPoints: { notchId: string; point: Point }[] = []
    for (let i = 0; i < tgtNotches.length; i++) {
      const result = pointAtPathLength(tgtSubCurves, cumPositions[i])
      if (result) targetPoints.push({ notchId: tgtNotches[i].notchId, point: result.point })
    }
    if (targetPoints.length === 0) { set({ seamAdjustmentDialog: null }); return }

    const tpMap = new Map(targetPoints.map((tp) => [tp.notchId, tp.point]))

    set((st) => {
      const piece = st.workspace.pieces.find((p) => p.id === tgtPieceId)
      if (!piece) return { seamAdjustmentDialog: null }
      const notches = piece.notches.map((n) => {
        const newPos = tpMap.get(n.id)
        if (!newPos) return n
        const { vertexIndex: _v, ...rest } = n
        return { ...rest, position: { ...newPos } }
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
      const lenA = edgeTotalLength(pieceA, a.curveIndicesA)
      const lenB = edgeTotalLength(pieceB, a.curveIndicesB)
      if (Math.abs(lenA - lenB) >= 0.1) continue
      const ncA = countNotchesOnEdge(pieceA, a.curveIndicesA)
      const ncB = countNotchesOnEdge(pieceB, a.curveIndicesB)
      if (ncA !== ncB || ncA < 1) continue
      const subsA = getSubSegments(pieceA, a.curveIndicesA)
      const subsB = getSubSegments(pieceB, a.curveIndicesB)
      if (subsA.length !== subsB.length || subsA.length < 2) continue
      for (let i = 0; i < subsA.length; i++) {
        const sb = subsB[subsB.length - 1 - i]
        if (Math.abs(subsA[i].length - sb.length) >= 0.1) {
          set({ seamAdjustmentDialog: a.id })
          return
        }
      }
    }
  },

  snapSeamEdgeToMatch: (pieceId, vertexIndex) => {
    const s = get()
    const piece = s.workspace.pieces.find((p) => p.id === pieceId)
    if (!piece) return
    for (const a of s.workspace.seamAssignments) {
      const isA = a.pieceIdA === pieceId
      const isB = a.pieceIdB === pieceId
      if (!isA && !isB) continue
      const curveIndices = isA ? a.curveIndicesA : a.curveIndicesB
      const refPiece = s.workspace.pieces.find((p) => p.id === (isA ? a.pieceIdB : a.pieceIdA))
      if (!refPiece) continue
      const refLen = edgeTotalLength(refPiece, isA ? a.curveIndicesB : a.curveIndicesA)
      const currLen = edgeTotalLength(piece, curveIndices)
      const diff = Math.abs(currLen - refLen)
      if (diff >= 5) continue
      const snapPt = snapVertexToEdgeLength(piece, curveIndices, vertexIndex, refLen)
      if (snapPt) {
        get().updateVertex(pieceId, vertexIndex, snapPt)
        return
      }
    }
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
    set((s) => ({
      workspace: {
        ...s.workspace,
        pieces: s.workspace.pieces.map((piece) => {
          if (piece.id !== pieceId || curveIndex >= piece.cutLine.length) return piece
          const curve = piece.cutLine[curveIndex]
          const updated: Curve =
            curve.type === 'line'
              ? { ...curve, [pointKey]: p } as Curve
              : { ...curve, [pointKey]: p } as Curve
          const cutLine = [...piece.cutLine]
          cutLine[curveIndex] = updated
          const seamLine = piece.seamAllowanceMm != null && cutLine.length >= 3 ? offsetCurvesInwardForSeam(cutLine, piece.seamAllowanceMm) : piece.seamLine
          return applySharpCornerPromotion({ ...piece, cutLine, seamLine })
        }),
      },
    })),

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
      if (piece && notch && notch.vertexIndex != null && isPositionUpdate && piece.cutLine.length > 3) {
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
    set((s) => ({
      workspace: {
        ...s.workspace,
        pieces: s.workspace.pieces.map((p) => {
          if (p.id !== pieceId || p.cutLine.length < 3) return p
          // Seam-as-Master: Innere Kontur = Hauptkontur. Beim ersten Mal: cutLine wird zur Nahtlinie (Seam).
          const seamLine = p.seamLine.length >= 3 ? p.seamLine : p.cutLine
          const cutLine = offsetCurvesOutwardForCut(seamLine, deltaMm)
          if (cutLine.length === 0) return p
          const notches = p.notches.map((n) => ({ ...n, vertexIndex: undefined }))
          return applySharpCornerPromotion({ ...p, cutLine, seamLine, seamAllowanceMm: deltaMm, notches })
        }),
      },
    })),

  removeSeamAllowance: (pieceId) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        pieces: s.workspace.pieces.map((p) => {
          if (p.id !== pieceId) return p
          // Nahtlinie wird wieder zur einzigen Kontur (cutLine)
          return applySharpCornerPromotion({
            ...p,
            cutLine: p.seamLine.length >= 3 ? p.seamLine : p.cutLine,
            seamLine: [],
            seamAllowanceMm: null,
          })
        }),
      },
    })),

  insertPointOnCutLine: (pieceId, curveIndex, point, t) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        seamAssignments: adjustSeamAfterInsert(s.workspace.seamAssignments, pieceId, curveIndex),
        pieces: s.workspace.pieces.map((p) => {
          if (p.id !== pieceId || curveIndex < 0 || curveIndex >= p.cutLine.length) return p
          const curve = p.cutLine[curveIndex]
          let cutLine: Curve[] | null = null
          if (curve.type === 'line') {
            const seg1: Curve = { type: 'line', start: { ...curve.start }, end: { ...point } }
            const seg2: Curve = { type: 'line', start: { ...point }, end: { ...curve.end } }
            cutLine = [...p.cutLine]
            cutLine.splice(curveIndex, 1, seg1, seg2)
          } else if (curve.type === 'bezier' && t != null && t > 0 && t < 1) {
            const [seg1, seg2] = splitBezierAt(curve, t)
            cutLine = [...p.cutLine]
            cutLine.splice(curveIndex, 1, seg1, seg2)
          }
          if (!cutLine) return p
          const notches = p.notches.map((n) => {
            if (n.vertexIndex != null && n.vertexIndex > curveIndex) {
              return { ...n, vertexIndex: n.vertexIndex + 1 }
            }
            return n
          })
          const newVertexIdx = curveIndex + 1
          const softVertices = [
            ...(p.softVertices ?? []).map((vi) => vi >= newVertexIdx ? vi + 1 : vi),
            newVertexIdx,
          ]
          const seamLine = p.seamAllowanceMm != null && cutLine.length >= 3 ? offsetCurvesInwardForSeam(cutLine, p.seamAllowanceMm) : p.seamLine
          return applySharpCornerPromotion({ ...p, cutLine, seamLine, notches, softVertices })
        }),
      },
    })),

  // Vertex verschieben. Seam-as-Master: Bei Nahtzugabe wird die seamLine (Innenkontur) bearbeitet, cutLine folgt.
  updateVertex: (pieceId, vertexIndex, point, skipSeamRecalc) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        pieces: s.workspace.pieces.map((p) => {
          const seamAllowance = p.seamAllowanceMm
          const useSeamMaster = seamAllowance != null && p.seamLine.length >= 3
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
          let cutLine = p.cutLine
          let seamLine = p.seamLine
          if (useSeamMaster && !skipSeamRecalc && seamAllowance != null) {
            seamLine = nextCurves
            cutLine = offsetCurvesOutwardForCut(seamLine, seamAllowance)
          } else if (!useSeamMaster) {
            cutLine = nextCurves
            seamLine = skipSeamRecalc
              ? p.seamLine
              : (seamAllowance != null && cutLine.length >= 3 ? offsetCurvesInwardForSeam(cutLine, seamAllowance) : p.seamLine)
          }
          const notches = p.notches.map((notch) =>
            notch.vertexIndex === vertexIndex ? { ...notch, vertexIndex: undefined } : notch
          )
          return applySharpCornerPromotion({ ...p, cutLine, seamLine, notches })
        }),
      },
    })),

  replaceSegmentWithBezier: (pieceId, curveIndex, cp1, cp2) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        pieces: s.workspace.pieces.map((p) => {
          if (p.id !== pieceId || curveIndex < 0 || curveIndex >= p.cutLine.length) return p
          const c = p.cutLine[curveIndex]
          if (c.type !== 'line') return p
          const bezier: Curve = {
            type: 'bezier',
            start: { ...c.start },
            end: { ...c.end },
            cp1: { ...cp1 },
            cp2: { ...(cp2 ?? cp1) },
          }
          const cutLine = [...p.cutLine]
          cutLine[curveIndex] = bezier
          const seamLine = p.seamAllowanceMm != null && cutLine.length >= 3 ? offsetCurvesInwardForSeam(cutLine, p.seamAllowanceMm) : p.seamLine
          return applySharpCornerPromotion({ ...p, cutLine, seamLine })
        }),
      },
    })),

  movePointOnCurve: (pieceId, curveIndex, t, newPoint, skipSeamRecalc) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        pieces: s.workspace.pieces.map((p) => {
          if (p.id !== pieceId || curveIndex < 0 || curveIndex >= p.cutLine.length) return p
          const c = p.cutLine[curveIndex]
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
          const cutLine = [...p.cutLine]
          cutLine[curveIndex] = bezier
          const seamLine = skipSeamRecalc
            ? p.seamLine
            : (p.seamAllowanceMm != null && cutLine.length >= 3 ? offsetCurvesInwardForSeam(cutLine, p.seamAllowanceMm) : p.seamLine)
          return applySharpCornerPromotion({ ...p, cutLine, seamLine })
        }),
      },
    })),

  removeVertex: (pieceId, vertexIndex) =>
    set((s) => {
      const piece = s.workspace.pieces.find((p) => p.id === pieceId)
      const useSeamMaster =
        piece != null && piece.seamAllowanceMm != null && piece.seamLine.length >= 3
      const master = useSeamMaster ? piece!.seamLine : piece?.cutLine ?? []
      const oldN = master.length
      return {
        workspace: {
          ...s.workspace,
          seamAssignments: oldN > 3 ? adjustSeamAfterRemove(s.workspace.seamAssignments, pieceId, vertexIndex, oldN) : s.workspace.seamAssignments,
          pieces: s.workspace.pieces.map((p) => {
            const seamAllowance = p.seamAllowanceMm
            const seamMaster = seamAllowance != null && p.seamLine.length >= 3
            const curves = seamMaster ? p.seamLine : p.cutLine
            if (p.id !== pieceId || curves.length <= 3) return p
            const n = curves.length
            const prevIdx = (vertexIndex - 1 + n) % n
            const nextIdx = vertexIndex
            const newSeg: Curve = {
              type: 'line',
              start: { ...curves[prevIdx].start },
              end: { ...curves[nextIdx].end },
            }
            const merged = curves.filter((_, j) => j !== prevIdx && j !== nextIdx)
            merged.splice(Math.min(prevIdx, nextIdx), 0, newSeg)
            let cutLine = p.cutLine
            let seamLine = p.seamLine
            if (seamMaster && seamAllowance != null) {
              seamLine = merged
              cutLine = offsetCurvesOutwardForCut(seamLine, seamAllowance)
            } else {
              cutLine = merged
              seamLine =
                seamAllowance != null && cutLine.length >= 3
                  ? offsetCurvesInwardForSeam(cutLine, seamAllowance)
                  : p.seamLine
            }
            const notches = p.notches.map((n) =>
              n.vertexIndex === vertexIndex
                ? (() => { const { vertexIndex: _v, ...rest } = n; return rest })()
                : n.vertexIndex != null && n.vertexIndex > vertexIndex
                  ? { ...n, vertexIndex: n.vertexIndex - 1 }
                  : n
            )
            const softVertices = (p.softVertices ?? [])
              .filter((vi) => vi !== vertexIndex)
              .map((vi) => (vi > vertexIndex ? vi - 1 : vi))
            return applySharpCornerPromotion({ ...p, cutLine, seamLine, notches, softVertices })
          }),
        },
      }
    }),

  convertBezierSegmentToLine: (pieceId, curveIndex) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        pieces: s.workspace.pieces.map((p) => {
          if (p.id !== pieceId || curveIndex < 0 || curveIndex >= p.cutLine.length) return p
          const c = p.cutLine[curveIndex]
          if (c.type !== 'bezier') return p
          const lineSeg: Curve = { type: 'line', start: { ...c.start }, end: { ...c.end } }
          const cutLine = [...p.cutLine]
          cutLine[curveIndex] = lineSeg
          const seamLine = p.seamAllowanceMm != null && cutLine.length >= 3 ? offsetCurvesInwardForSeam(cutLine, p.seamAllowanceMm) : p.seamLine
          return applySharpCornerPromotion({ ...p, cutLine, seamLine })
        }),
      },
    })),

  offsetSegment: (pieceId, curveIndex, deltaMm) =>
    set((s) => {
      const piece = s.workspace.pieces.find((p) => p.id === pieceId)
      if (!piece || piece.cutLine.length === 0) return s
      const pts = offsetSegmentPoints(piece.cutLine, curveIndex, deltaMm)
      if (!pts) return s
      const n = piece.cutLine.length
      const prevIdx = (curveIndex - 1 + n) % n
      const nextIdx = (curveIndex + 1) % n
      return {
        workspace: {
          ...s.workspace,
          pieces: s.workspace.pieces.map((p) => {
            if (p.id !== pieceId) return p
            const cutLine = p.cutLine.map((c) =>
              c.type === 'line'
                ? { type: 'line' as const, start: { ...c.start }, end: { ...c.end } }
                : { type: 'bezier' as const, start: { ...c.start }, end: { ...c.end }, cp1: { ...c.cp1 }, cp2: { ...c.cp2 } }
            )
            const seg = cutLine[curveIndex]
            if (seg.type === 'bezier' && pts.cp1 && pts.cp2) {
              cutLine[curveIndex] = { type: 'bezier', start: pts.start, end: pts.end, cp1: pts.cp1, cp2: pts.cp2 }
            } else {
              cutLine[curveIndex] = { ...cutLine[curveIndex], start: pts.start, end: pts.end } as Curve
            }
            cutLine[prevIdx] = { ...cutLine[prevIdx], end: pts.start } as Curve
            cutLine[nextIdx] = { ...cutLine[nextIdx], start: pts.end } as Curve
            const seamLine =
              p.seamAllowanceMm != null && cutLine.length >= 3 ? offsetCurvesInwardForSeam(cutLine, p.seamAllowanceMm) : p.seamLine
            return applySharpCornerPromotion({ ...p, cutLine, seamLine })
          }),
        },
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
      showHelpModal: false,
      showShortcutListModal: false,
      showSettingsModal: false,
      workspaceImageSelected: false,
      toastMessage: null,
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

}))

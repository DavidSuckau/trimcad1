import { create } from 'zustand'
import { temporal } from 'zundo'
import type {
  Workspace,
  WorkspaceNote,
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
  ProfileAssignment,
} from '../types/model'
import { SEAM_ASSIGNMENT_KIND_IDS } from '../types/model'
import {
  offsetCurvesInwardForSeam,
  deriveCutLineFromSeamWithValidation,
  deriveCutLineFromSeamWithVariableAllowance,
  offsetSegmentPoints,
  validateContourAfterVertexMove,
} from '../geometry/offset'
import type { DeriveCutLineFromSeamResult } from '../geometry/offset'
import { hasVariableAllowance, buildCurveIndexAllowanceMap, remapEdgeSeamAllowances, remapProfileAssignmentsForPiece } from '../geometry/edgeEnumeration'
import { splitBezierAt, joinBezierSegments, adjustControlPointsForPointOnCurve, pointAtPathLength } from '../geometry/curveToPath'
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
  getEffectiveSoftVerticesCut,
  syncSoftAfterSharpCornerPromotion,
} from '../geometry/seamUtils'
import {
  materializeNotchAnchorsOnCutLine,
} from '../geometry/notchOnCurve'
import { pieceLocalToWorld, getPiecePivotLocal } from '../geometry/pieceTransform'
import { applySharpCornerPromotion } from '../geometry/softVertexPromotion'
import { useSeamLineForVertexEditing, useSeamLineForPointCurveEditing } from '../geometry/vertexMaster'
import { isNotchSpacingValidForCandidate } from '../geometry/notchMinSpacing'
import { resyncNotchesAfterCutLineRebuilt, resyncNotchesViaSeamAnchor, notchPushedToCorner } from '../geometry/notchResyncCutLine'
import { applyUniformScaleToPiece, getReferenceEdgePivotLocal } from '../geometry/scalePieceLocal'
import { applySeamAssignmentCutTrim } from '../geometry/seamAssignmentCutTrim'
import type { TrimTexProjectFileV1 } from '../persistence/trimtexProjectJson'
import type { ConfiguratorInstance, ConfiguratorKindId, ConfiguratorPartParams } from '../configurators/types'
import { generateConfiguratorPartGeometry } from '../configurators/generators'
import { getDefaultConfiguratorParts } from '../configurators/registry'
import { batchTargetKey, filterBatchTargets, mergeBatchTargets } from '../workspace/workspaceMarqueeSelection'
import { VIEWBOX_WIDTH, VIEWBOX_HEIGHT } from '../workspaceConstants'

/**
 * Wählt automatisch den richtigen Offset-Pfad: uniformer Clipper oder variabler per-Edge Offset.
 * Wenn das Teil `edgeSeamAllowances` hat die vom Default abweichen, wird der variable Algorithmus genutzt.
 */
function deriveCutLineForPiece(
  piece: PatternPiece,
  seamLine: Curve[],
  seamAllowanceMm: number
): DeriveCutLineFromSeamResult {
  if (hasVariableAllowance(piece)) {
    const allowanceMap = buildCurveIndexAllowanceMap(piece)
    let maxMm = 0
    for (const v of allowanceMap.values()) maxMm = Math.max(maxMm, v)
    maxMm = Math.max(maxMm, seamAllowanceMm)
    return deriveCutLineFromSeamWithVariableAllowance(seamLine, allowanceMap, maxMm)
  }
  return deriveCutLineFromSeamWithValidation(seamLine, seamAllowanceMm)
}

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

/**
 * Nächster Eckpunkt auf der cutLine per Distanz.
 * `maxDistMm`: Wenn gesetzt, wird null zurückgegeben wenn kein Vertex innerhalb liegt.
 */
function nearestCutVertexIndex(cutLine: Curve[], point: Point, maxDistMm?: number): number | null {
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
  if (maxDistMm != null && bestDist > maxDistMm) return null
  return bestIdx
}

/** Nach Promotion: diese Cut-Indizes bleiben weich (Nutzer/Remap), auch an spitzen Außenkontur-Winkeln. */
function forceCutVerticesSoftAfterPromotion(piece: PatternPiece, preserveCutVertexIndices: number[]): PatternPiece {
  const promoted = applySharpCornerPromotion(piece)
  const set = new Set(getEffectiveSoftVerticesCut(promoted))
  const n = promoted.cutLine.length
  for (const vi of preserveCutVertexIndices) {
    if (vi >= 0 && vi < n) set.add(vi)
  }
  return syncSoftAfterSharpCornerPromotion(promoted, [...set].sort((a, b) => a - b))
}

/** Nach „Punkt einfügen“: neuer Eckpunkt bleibt weich (blau); geometrische Spitzwinkel-Promotion greift dafür nicht. */
function forceCutVertexSoftAfterInsert(piece: PatternPiece, cutVertexIndex: number): PatternPiece {
  return forceCutVerticesSoftAfterPromotion(piece, [cutVertexIndex])
}

/**
 * softVertices von alter auf neue Schnittkontur (gleiche Weltposition → nächster Eckpunkt).
 * Mit Distanzschwelle: verhindert, dass weit entfernte Vertices fälschlich zugeordnet werden
 * (z. B. wenn Clipper die Topologie ändert und ein Vertex keinen nahen Nachbarn hat).
 */
function remapSoftVerticesToNewCutLine(oldCut: Curve[], newCut: Curve[], softVertices: number[] | undefined): number[] {
  const REMAP_MAX_DIST_MM = 50
  const out = new Set<number>()
  for (const vi of softVertices ?? []) {
    if (vi < 0 || vi >= oldCut.length) continue
    const pt = vi === 0 ? oldCut[0].start : oldCut[vi - 1].end
    const mapped = nearestCutVertexIndex(newCut, pt, REMAP_MAX_DIST_MM)
    if (mapped != null) out.add(mapped)
  }
  return [...out].sort((a, b) => a - b)
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
    softVerticesMaster: [],
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
  | 'note'
  | 'profil'

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

export type NotchType = 'keine' | 'strich' | 'kerbe'
// Hinweis: UI-Presets (`strich`/`kerbe`) sind bewusst getrennt vom Modell-NotchType
// (`single`/`double`/`v` in `types/model.ts`). Die Modellgeometrie bleibt exportnah;
// Presets steuern aktuell primär Maße/Bedienung in der Oberfläche.

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
  canvasThemeMode: 'light' | 'dark'
  showGrid: boolean
  showPoints: boolean
  showGrain: boolean
  showNotches: boolean
  showDrills: boolean
  showInternalLines: boolean
  showPieceNames: boolean
  showProfiles: boolean
  /** Bogenlängen entlang der Schnittkontur (Ecke↔Ecke, Kerbe↔Kerbe, …) auf allen Teilen. */
  showContourMeasurements: boolean
  /** Workspace-Notizzettel ein-/ausblenden (Daten bleiben erhalten). */
  showWorkspaceNotes: boolean
  /** Linke Teileliste ein-/ausklappen (mehr Platz für die Arbeitsfläche). */
  sidebarCollapsed: boolean
  rulerMode: boolean
  rulerLine: { start: Point; end: Point } | null
  pendingNahtzugabeClick: boolean
  nahtzugabeDialogPieceId: string | null
  /** Dialog „Teil-Eigenschaften“ (Name, Flächenfüllung). */
  piecePropertiesDialogPieceId: string | null
  /** Interaktiver Modus: Kante auf dem Canvas anklicken, um Nahtzugabe pro Kante festzulegen. */
  edgeSeamPickingActive: boolean
  /** Nahtzuordnung: 'first' = erste Naht anklicken, 'second' = zweite Naht (anderes Teil) anklicken */
  nahtzuordnungMode: 'idle' | 'first' | 'second'
  pendingNahtzuordnungFirst: { pieceId: string; curveIndices: number[]; clickedCurve: number } | null
  /** Profil-Dialog: ID der aktuell bearbeiteten ProfileAssignment (null = geschlossen). */
  profileDialogAssignmentId: string | null
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
  /** V-Kerben in der importierten Polyligne erkennen (Standard: an). */
  dxfImportDetectVNotches: boolean
  /** Nahtlinie beim DXF-Import erzeugen, wenn die Datei keine Naht-Polyline enthält. */
  dxfImportCreateSeamLine: boolean
  /** Nahtzugabe (mm) für „Nahtlinie beim Import erzeugen“. */
  dxfImportSeamAllowanceMm: number
  notchSettings: NotchSetting[]
  /** 0..9 = Notch 1..10; steuert welches Preset beim Notch-Werkzeug verwendet wird (Standard: 0 = Notch 1). */
  activeNotchPresetIndex: number
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
  setCanvasThemeMode: (m: 'light' | 'dark') => void
  setShowGrid: (v: boolean) => void
  setShowPoints: (v: boolean) => void
  setShowGrain: (v: boolean) => void
  setShowNotches: (v: boolean) => void
  setShowDrills: (v: boolean) => void
  setShowInternalLines: (v: boolean) => void
  setShowPieceNames: (v: boolean) => void
  setShowProfiles: (v: boolean) => void
  setShowContourMeasurements: (v: boolean) => void
  setShowWorkspaceNotes: (v: boolean) => void
  setSidebarCollapsed: (v: boolean) => void
  setRulerMode: (v: boolean) => void
  setRulerLine: (v: { start: Point; end: Point } | null) => void
  setPendingNahtzugabeClick: (v: boolean) => void
  setNahtzugabeDialogPieceId: (v: string | null) => void
  setPiecePropertiesDialogPieceId: (v: string | null) => void
  setEdgeSeamPickingActive: (v: boolean) => void
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
  setDxfImportDetectVNotches: (v: boolean) => void
  setDxfImportCreateSeamLine: (v: boolean) => void
  setDxfImportSeamAllowanceMm: (v: number) => void
  setToastMessage: (v: string | null) => void
  updateNotchSetting: (index: number, upd: Partial<NotchSetting>) => void
  setActiveNotchPresetIndex: (index: number) => void
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
    options?: { notchResyncBaseline?: { notches: Notch[]; cutLine: Curve[]; seamLine?: Curve[] } }
  ) => void

  addProfileAssignment: (assignment: Omit<ProfileAssignment, 'id'>) => string
  updateProfileAssignment: (id: string, updates: Partial<Omit<ProfileAssignment, 'id'>>) => void
  removeProfileAssignment: (id: string) => void
  setProfileDialogAssignmentId: (v: string | null) => void

  /** Legacy-Name: fügt auf der Master-Kontur ein (bei Nahtzugabe faktisch seamLine). */
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
  updateNotch: (
    pieceId: string,
    notchId: string,
    upd: Partial<Pick<Notch, 'position' | 'angle' | 'type' | 'depth' | 'width' | 'sNormalized' | 'arcLengthMm'>>
  ) => void
  addDrill: (pieceId: string, drill: Drill) => void
  movePiece: (pieceId: string, dx: number, dy: number) => void
  setSelectedPoint: (v: Store['selectedPoint']) => void
  applyOffset: (pieceId: string, deltaMm: number) => void
  removeSeamAllowance: (pieceId: string) => void
  setEdgeSeamAllowance: (pieceId: string, edgeIndex: number, allowanceMm: number) => void
  /** Legacy-Name: split auf der Master-Kontur (bei Nahtzugabe seamLine), danach Ableitung/Resync. */
  insertPointOnCutLine: (pieceId: string, curveIndex: number, point: Point, t?: number) => boolean
  updateVertex: (
    pieceId: string,
    vertexIndex: number,
    point: Point,
    skipSeamRecalc?: boolean,
    /** Seam-Master-Drag: Kerben immer von dieser CutLine/Notch-Startlage auf die neue Cut projizieren (keine Ketten-Resyncs). */
    notchOpts?: { notchResyncBaseline?: { notches: Notch[]; cutLine: Curve[]; seamLine?: Curve[] } }
  ) => void
  replaceSegmentWithBezier: (pieceId: string, curveIndex: number, cp1: Point, cp2?: Point) => void
  movePointOnCurve: (pieceId: string, curveIndex: number, t: number, newPoint: Point, skipSeamRecalc?: boolean, notchOpts?: { notchResyncBaseline?: { notches: Notch[]; cutLine: Curve[]; seamLine?: Curve[] } }) => void
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

  /** Notiz am Teil (lokale mm); liefert die neue ID. */
  addWorkspaceNote: (pieceId: string, positionLocal: Point) => string
  updateWorkspaceNote: (id: string, partial: Partial<Pick<WorkspaceNote, 'position' | 'text'>>) => void
  removeWorkspaceNote: (id: string) => void

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
  /** Nur Ziele `kind: 'piece'` aus der Fensterauswahl löschen (Rahmen hat ganzes Teil erfasst). */
  batchDeleteMarqueeCompletePieces: () => void
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 12)
}

/**
 * Bestimmt ob zwei Nahtkanten physisch gegenläufig verlaufen (Start A ↔ Ende B),
 * indem die Kantenendpunkte in Weltkoordinaten verglichen werden.
 */
function detectEdgeReverseOrientation(
  refCurves: Curve[],
  refTransform: PatternPiece['transform'],
  tgtCurves: Curve[],
  tgtTransform: PatternPiece['transform']
): boolean {
  if (refCurves.length === 0 || tgtCurves.length === 0) return false
  const toWorld = (p: Point, t: PatternPiece['transform']): Point => {
    let xx = p.x
    let yy = p.y
    if (t.mirrored) xx = -xx
    const rad = (t.rotation * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    return { x: xx * cos - yy * sin + t.x, y: xx * sin + yy * cos + t.y }
  }
  const rS = toWorld(refCurves[0].start, refTransform)
  const rE = toWorld(refCurves[refCurves.length - 1].end, refTransform)
  const tS = toWorld(tgtCurves[0].start, tgtTransform)
  const tE = toWorld(tgtCurves[tgtCurves.length - 1].end, tgtTransform)
  const dSame = Math.hypot(rS.x - tS.x, rS.y - tS.y) + Math.hypot(rE.x - tE.x, rE.y - tE.y)
  const dRev = Math.hypot(rS.x - tE.x, rS.y - tE.y) + Math.hypot(rE.x - tS.x, rE.y - tS.y)
  return dRev < dSame
}

/**
 * Berechnet Ziel-Bogenpositionen auf der Zielkante aus der Referenzkante.
 * `reverse`: physische Orientierung — true wenn die Kanten gegenläufig sind
 * (Start der Ref-Kante nahe am Ende der Zielkante).
 */
function buildNotchTargetArcPositions(
  refArcs: number[],
  refTotalLen: number,
  _tgtArcs: number[],
  tgtTotalLen: number,
  reverse: boolean
): number[] | null {
  const n = refArcs.length
  if (n === 0 || n !== _tgtArcs.length) return null
  if (refTotalLen <= 1e-9 || tgtTotalLen <= 1e-9) return null

  const refNorm = refArcs.map((v) => Math.max(0, Math.min(1, v / refTotalLen)))

  let mapped: number[]
  if (reverse) {
    mapped = refNorm.map((v) => Math.max(0, Math.min(1, 1 - v))).reverse()
  } else {
    mapped = [...refNorm]
  }

  return mapped.map((v) => v * tgtTotalLen)
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

export const useStore = create<Store>()(
  temporal(
    (set, get) => ({
  workspace: {
    id: 'ws1',
    name: 'Arbeitsfläche 1',
    pieces: [createDefaultPiece('p1', '001')],
    view: defaultView,
    seamAssignments: [],
    notes: [],
    profileAssignments: [],
  },
  selectedPieceIds: ['p1'],
  selectedPoint: null,
  tool: 'select',
  canvasThemeMode: 'light' as const,
  showGrid: true,
  showPoints: true,
  showGrain: true,
  showNotches: true,
  showDrills: true,
  showInternalLines: true,
  showPieceNames: true,
  showProfiles: true,
  showContourMeasurements: false,
  showWorkspaceNotes: true,
  sidebarCollapsed: false,
  rulerMode: false,
  rulerLine: null,
  pendingNahtzugabeClick: false,
  nahtzugabeDialogPieceId: null,
  piecePropertiesDialogPieceId: null,
  edgeSeamPickingActive: false,
  nahtzuordnungMode: 'idle',
  pendingNahtzuordnungFirst: null,
  profileDialogAssignmentId: null,
  showSettingsModal: false,
  showStuecklisteModal: false,
  showHelpModal: false,
  showShortcutListModal: false,
  dxfExportScale: 1,
  dxfImportExtraCutLayers: '',
  dxfImportScale: 1,
  dxfImportDetectVNotches: true,
  dxfImportCreateSeamLine: false,
  dxfImportSeamAllowanceMm: 8,
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
  notchSettings: Array.from({ length: 10 }, (_, i) => ({
    type: (i === 0 ? 'kerbe' : 'strich') as NotchType,
    widthMm: i === 0 ? 6 : 2.5,
    depthMm: i === 0 ? 4 : 2,
  })),
  activeNotchPresetIndex: 0,

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
            const derived = deriveCutLineForPiece(next, next.seamLine, next.seamAllowanceMm)
            if (!derived.ok) {
              toastMessage = `warn:${derived.message}`
              return p
            }
            const oldCut = p.cutLine
            next.cutLine = derived.cutLine
            next.notches = resyncNotchesAfterCutLineRebuilt(p.notches, oldCut, derived.cutLine)
            const mappedSoft = remapSoftVerticesToNewCutLine(oldCut, derived.cutLine, p.softVertices)
            next.softVertices = mappedSoft
            return forceCutVerticesSoftAfterPromotion(next, mappedSoft)
          } else if (next.cutLine.length >= 3) {
            // Wie applyOffset / Dialogtext: bisherige Schnittkontur wird Nahtlinie (Master), cutLine nach außen.
            // Nicht: seam = Inset(cut) bei unveränderter cutLine — das verliert die editierbare Topologie und bricht Punkt-/Vertex-Werkzeuge.
            const oldCut = p.cutLine
            const seamLine = cloneCurvesArray(next.cutLine)
            const derived = deriveCutLineForPiece(next, seamLine, next.seamAllowanceMm)
            if (!derived.ok) {
              toastMessage = `warn:${derived.message}`
              return p
            }
            next.seamLine = seamLine
            next.cutLine = derived.cutLine
            next.notches = resyncNotchesAfterCutLineRebuilt(p.notches, oldCut, derived.cutLine)
            const migratedSoftMaster = [...new Set((p.softVertices ?? []).filter((vi) => vi >= 0 && vi < seamLine.length))].sort((a, b) => a - b)
            next.softVerticesMaster = migratedSoftMaster
            // Beim Wechsel auf Seam-as-Master sind bisherige Soft-Vertices semantisch Master-Vertices.
            // Cut-Soft wird geleert, um doppelte/mehrdeutige Mapping-Effekte (winkelabhängig) zu vermeiden.
            next.softVertices = []
            const preserveCut = migratedSoftMaster
              .map((mvi) => mapMasterVertexIndexToCutVertexIndex(next, mvi))
              .filter((x): x is number => x != null)
            // Außenkontur hat oft spitze Winkel → applySharpCornerPromotion würde Softs sonst wieder entfernen.
            return forceCutVerticesSoftAfterPromotion(next, preserveCut)
          }
        } else {
          next.seamLine = []
          next.softVerticesMaster = []
          next.edgeSeamAllowances = undefined
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
      workspace: {
        ...s.workspace,
        pieces: s.workspace.pieces.filter((p) => p.id !== id),
        notes: (s.workspace.notes ?? []).filter((n) => n.pieceId !== id),
        profileAssignments: (s.workspace.profileAssignments ?? []).filter((pa) => pa.pieceId !== id),
        seamAssignments: (s.workspace.seamAssignments ?? []).filter(
          (sa) => sa.pieceIdA !== id && sa.pieceIdB !== id
        ),
      },
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
      const filtered = filterBatchTargets(s.batchSelectionTargets, s.batchSelectionFilter, s.workspace.pieces)
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
    const filtered = filterBatchTargets(s.batchSelectionTargets, s.batchSelectionFilter, s.workspace.pieces)
    const byPiece = new Map<string, number[]>()
    for (const t of filtered) {
      if (t.kind !== 'vertex') continue
      let arr = byPiece.get(t.pieceId)
      if (!arr) { arr = []; byPiece.set(t.pieceId, arr) }
      arr.push(t.vertexIndex)
    }
    if (byPiece.size === 0) return
    set((st) => {
      let profileAssignments = st.workspace.profileAssignments ?? []
      const pieces = st.workspace.pieces.map((p) => {
        const indices = byPiece.get(p.id)
        if (!indices) return p
        const useSeamMaster = useSeamLineForVertexEditing(p)
        const curves = useSeamMaster ? p.seamLine : p.cutLine
        const n = curves.length
        if (useSeamMaster) {
          const masterSet = new Set(p.softVerticesMaster ?? [])
          const softCut = new Set(p.softVertices ?? [])
          for (const vi of indices) {
            if (vi < 0 || vi >= n || n <= 3) continue
            if (soft) masterSet.add(vi); else masterSet.delete(vi)
            const cutVi = mapMasterVertexIndexToCutVertexIndex(p, vi)
            if (cutVi != null) softCut.delete(cutVi)
          }
          let next: PatternPiece = {
            ...p,
            softVerticesMaster: [...masterSet].sort((a, b) => a - b),
            softVertices: [...softCut].sort((a, b) => a - b),
          }
          next = { ...next, edgeSeamAllowances: remapEdgeSeamAllowances(p, next) }
          if (!soft) next = applySharpCornerPromotion(next)
          profileAssignments = remapProfileAssignmentsForPiece(p, next, profileAssignments)
          return next
        }
        const sSet = new Set(p.softVertices ?? [])
        for (const vi of indices) {
          if (vi < 0 || vi >= n || n <= 3) continue
          if (soft) sSet.add(vi); else sSet.delete(vi)
        }
        let next: PatternPiece = { ...p, softVertices: [...sSet].sort((a, b) => a - b) }
        next = { ...next, edgeSeamAllowances: remapEdgeSeamAllowances(p, next) }
        if (!soft) next = applySharpCornerPromotion(next)
        profileAssignments = remapProfileAssignmentsForPiece(p, next, profileAssignments)
        return next
      })
      return { workspace: { ...st.workspace, pieces, profileAssignments } }
    })
  },

  batchDeleteFiltered: () => {
    const s = get()
    const filtered = filterBatchTargets(s.batchSelectionTargets, s.batchSelectionFilter, s.workspace.pieces)
    const deletingSoftOnly = s.batchSelectionFilter === 'softVertices'
    const pieceIdsToDelete = new Set<string>()
    for (const t of filtered) {
      if (t.kind === 'piece') pieceIdsToDelete.add(t.pieceId)
    }
    for (const id of pieceIdsToDelete) {
      get().deletePiece(id)
    }
    type G = {
      vertices: number[]
      notches: string[]
      internalLines: number[]
      curvePoints: number[]
    }
    const byPiece = new Map<string, G>()
    for (const t of filtered) {
      if (t.kind === 'piece') continue
      if (pieceIdsToDelete.has(t.pieceId)) continue
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
      if (deletingSoftOnly) {
        for (const vi of [...new Set(g.vertices)]) {
          get().setVertexSoft(pieceId, vi, false)
        }
      } else {
        for (const vi of [...new Set(g.vertices)].sort((a, b) => b - a)) {
          get().removeVertex(pieceId, vi)
        }
      }
    }
    set({
      batchSelectionTargets: [],
      batchUiHighlightByTargetId: {},
      batchSelectionFilter: 'all',
    })
  },

  batchDeleteMarqueeCompletePieces: () => {
    const s = get()
    const idsToDelete = new Set(
      s.batchSelectionTargets
        .filter((t): t is { kind: 'piece'; pieceId: string } => t.kind === 'piece')
        .map((t) => t.pieceId)
    )
    if (idsToDelete.size === 0) {
      set({
        toastMessage:
          'warn:Keine kompletten Teile in der Fensterauswahl. Auswahlrahmen muss jedes Teil vollständig umschließen.',
      })
      return
    }
    set((prev) => ({
      workspace: {
        ...prev.workspace,
        pieces: prev.workspace.pieces.filter((p) => !idsToDelete.has(p.id)),
        notes: (prev.workspace.notes ?? []).filter((n) => !idsToDelete.has(n.pieceId)),
        profileAssignments: (prev.workspace.profileAssignments ?? []).filter((pa) => !idsToDelete.has(pa.pieceId)),
        seamAssignments: prev.workspace.seamAssignments.filter(
          (sa) => !idsToDelete.has(sa.pieceIdA) && !idsToDelete.has(sa.pieceIdB)
        ),
      },
      selectedPieceIds: prev.selectedPieceIds.filter((id) => !idsToDelete.has(id)),
      piecePropertiesDialogPieceId:
        prev.piecePropertiesDialogPieceId && idsToDelete.has(prev.piecePropertiesDialogPieceId) ? null : prev.piecePropertiesDialogPieceId,
      nahtzugabeDialogPieceId:
        prev.nahtzugabeDialogPieceId && idsToDelete.has(prev.nahtzugabeDialogPieceId) ? null : prev.nahtzugabeDialogPieceId,
      batchSelectionTargets: [],
      batchUiHighlightByTargetId: {},
      batchSelectionFilter: 'all' as const,
    }))
  },

  setTool: (t) => set({ tool: t }),
  setCanvasThemeMode: (m: 'light' | 'dark') => set({ canvasThemeMode: m }),
  setShowGrid: (v) => set({ showGrid: v }),
  setShowPoints: (v) => set({ showPoints: v }),
  setShowGrain: (v) => set({ showGrain: v }),
  setShowNotches: (v) => set({ showNotches: v }),
  setShowDrills: (v) => set({ showDrills: v }),
  setShowInternalLines: (v) => set({ showInternalLines: v }),
  setShowPieceNames: (v) => set({ showPieceNames: v }),
  setShowProfiles: (v) => set({ showProfiles: v }),
  setShowContourMeasurements: (v) => set({ showContourMeasurements: v }),
  setShowWorkspaceNotes: (v) => set({ showWorkspaceNotes: v }),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  setRulerMode: (v) => set({ rulerMode: v }),
  setRulerLine: (v) => set({ rulerLine: v }),
  setPendingNahtzugabeClick: (v) => set({ pendingNahtzugabeClick: v }),
  setNahtzugabeDialogPieceId: (v) => set({ nahtzugabeDialogPieceId: v }),
  setPiecePropertiesDialogPieceId: (v) => set({ piecePropertiesDialogPieceId: v }),
  setEdgeSeamPickingActive: (v) => set({ edgeSeamPickingActive: v }),
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
      softVerticesMaster: [],
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
  setDxfImportDetectVNotches: (v) => set({ dxfImportDetectVNotches: v }),
  setDxfImportCreateSeamLine: (v) => set({ dxfImportCreateSeamLine: v }),
  setDxfImportSeamAllowanceMm: (v) => set({ dxfImportSeamAllowanceMm: v }),
  setToastMessage: (v) => set({ toastMessage: v }),
  updateNotchSetting: (index, upd) =>
    set((s) => {
      if (index < 0 || index >= s.notchSettings.length) return s
      const notchSettings = [...s.notchSettings]
      notchSettings[index] = { ...notchSettings[index], ...upd }
      return { notchSettings }
    }),
  setActiveNotchPresetIndex: (index) =>
    set((s) => {
      const max = Math.max(0, s.notchSettings.length - 1)
      const clamped = Math.max(0, Math.min(max, Math.floor(index)))
      return { activeNotchPresetIndex: clamped }
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
    // Direkt nach dem Zuordnen denselben zentralen Check wie nach Drag-Ende ausführen,
    // damit der Dialog für Notch-Abstandsangleich sofort erscheint.
    get().checkSeamAdjustment()
  },
  removeSeamAssignment: (id) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        seamAssignments: s.workspace.seamAssignments.filter((a) => a.id !== id),
      },
    })),

  addProfileAssignment: (assignment) => {
    const id = generateId()
    set((s) => ({
      workspace: {
        ...s.workspace,
        profileAssignments: [...(s.workspace.profileAssignments ?? []), { ...assignment, id }],
      },
    }))
    return id
  },
  updateProfileAssignment: (id, updates) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        profileAssignments: (s.workspace.profileAssignments ?? []).map((pa) =>
          pa.id === id ? { ...pa, ...updates, id: pa.id } : pa
        ),
      },
    })),
  removeProfileAssignment: (id) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        profileAssignments: (s.workspace.profileAssignments ?? []).filter((pa) => pa.id !== id),
      },
      profileDialogAssignmentId:
        s.profileDialogAssignmentId === id ? null : s.profileDialogAssignmentId,
    })),
  setProfileDialogAssignmentId: (v) => set({ profileDialogAssignmentId: v }),

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

    const refTotalLen = edgeTotalLength(refPiece, refIndices)
    const tgtTotalLen = edgeTotalLength(tgtPiece, tgtIndices)

    const refMasterCurves = getCurvesForSeamEdge(refPiece)
    const tgtMasterCurves = getCurvesForSeamEdge(tgtPiece)
    const refSubCurves = refIndices.map((ci) => refMasterCurves[ci]).filter(Boolean)
    const tgtSubCurves = tgtIndices.map((ci) => tgtMasterCurves[ci]).filter(Boolean)
    if (tgtSubCurves.length === 0 || refSubCurves.length === 0) { set({ seamAdjustmentDialog: null }); return }

    const reverseOrientation = detectEdgeReverseOrientation(
      refSubCurves, refPiece.transform,
      tgtSubCurves, tgtPiece.transform
    )

    const refNotches = getNotchesOnEdge(refPiece, refIndices)
    const tgtNotches = getNotchesOnEdge(tgtPiece, tgtIndices)
    if (refNotches.length === 0 || tgtNotches.length !== refNotches.length) {
      set({ seamAdjustmentDialog: null })
      return
    }
    const targetArcPositions = buildNotchTargetArcPositions(
      refNotches.map((x) => x.arcLength),
      refTotalLen,
      tgtNotches.map((x) => x.arcLength),
      tgtTotalLen,
      reverseOrientation
    )
    if (!targetArcPositions || targetArcPositions.length !== tgtNotches.length) {
      set({ seamAdjustmentDialog: null })
      return
    }

    const targetNotches: { notchId: string; notch: Notch }[] = []
    for (let i = 0; i < tgtNotches.length; i++) {
      const result = pointAtPathLength(tgtSubCurves, targetArcPositions[i])
      if (!result) continue
      const notchId = tgtNotches[i].notchId
      const n0 = tgtPiece.notches.find((nn) => nn.id === notchId)
      if (!n0) continue
      // Beim Abstandsangleich muss der freie Cut-Anker vollständig neu materialisiert werden.
      // Sonst behalten alte sNormalized/arcLengthMm Vorrang und die Kerbe "springt" nicht sichtbar um.
      const materialized = materializeNotchAnchorsOnCutLine(
        {
          ...n0,
          position: result.point,
          vertexIndex: undefined,
          sNormalized: undefined,
          arcLengthMm: undefined,
        },
        tgtPiece.cutLine
      )
      if (!materialized) continue
      targetNotches.push({ notchId, notch: materialized })
    }
    if (targetNotches.length === 0) { set({ seamAdjustmentDialog: null }); return }

    const targetMap = new Map(targetNotches.map((tp) => [tp.notchId, tp.notch]))

    set((st) => {
      const piece = st.workspace.pieces.find((p) => p.id === tgtPieceId)
      if (!piece) return { seamAdjustmentDialog: null }
      const notches = piece.notches.map((n) => {
        const tp = targetMap.get(n.id)
        if (!tp) return n
        return tp
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
          const derived = deriveCutLineForPiece(piece, seamLine, piece.seamAllowanceMm)
          if (!derived.ok) {
            toastMessage = `warn:${derived.message}`
            return piece
          }
          const cutLine = derived.cutLine
          const notches = resyncNotchesAfterCutLineRebuilt(piece.notches, piece.cutLine, cutLine)
          const softVertices = remapSoftVerticesToNewCutLine(piece.cutLine, cutLine, piece.softVertices)
          return applySharpCornerPromotion({ ...piece, cutLine, seamLine, notches, softVertices })
        }
        // Cut-as-Master-Zweig (bewusst separat): hier wird cutLine direkt editiert und seamLine daraus abgeleitet.
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
      const toAdd = materializeNotchAnchorsOnCutLine(notch, piece.cutLine) ?? notch
      if (!isNotchSpacingValidForCandidate(piece, toAdd)) {
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
            p.id === pieceId ? { ...p, notches: [...p.notches, toAdd] } : p
          ),
        },
      }
    }),

  removeNotch: (pieceId, notchId) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        pieces: s.workspace.pieces.map((p) =>
          p.id === pieceId ? { ...p, notches: p.notches.filter((n) => n.id !== notchId) } : p
        ),
      },
    })),

  /** No-op: Notches no longer have vertex anchors. Kept for API compatibility. */
  removeNotchAnchor: (_pieceId, _notchId) =>
    set((s) => s),

  /** No-op: Notches are always free now (no vertex anchors). Kept for API compatibility. */
  toggleNotchAnchor: (_pieceId, _notchId) =>
    set((s) => s),

  updateNotch: (pieceId, notchId, upd) =>
    set((s) => {
      const piece = s.workspace.pieces.find((p) => p.id === pieceId)
      const notch = piece?.notches.find((n) => n.id === notchId)
      const isGeomUpdate =
        upd.type !== undefined || upd.depth !== undefined || upd.width !== undefined
      if (piece && notch && isGeomUpdate) {
        const merged = { ...notch, ...upd }
        const depth = merged.depth
        const w = merged.width ?? 6
        if (!Number.isFinite(depth) || depth < 0.5 || !Number.isFinite(w) || w < 0.5) {
          return {
            ...s,
            toastMessage: 'error: Kerbe: Tiefe und Breite müssen mindestens 0,5 mm sein.',
          }
        }
      }
      const isPositionUpdate = upd.position != null
      if (piece && notch && isPositionUpdate) {
        let candidate = { ...notch, ...upd }
        if (
          !Object.prototype.hasOwnProperty.call(upd, 'sNormalized') &&
          !Object.prototype.hasOwnProperty.call(upd, 'arcLengthMm')
        ) {
          candidate = { ...candidate, sNormalized: undefined, arcLengthMm: undefined }
        }
        if (!isNotchSpacingValidForCandidate(piece, candidate, notchId)) {
          return {
            ...s,
            toastMessage:
              'error: Zwischen zwei Kerben müssen mindestens 4 mm Abstand liegen (entlang der Schnittkontur).',
          }
        }
      }
      /** Neue Punktlage (z. B. Drag): ohne explizite Anker-Skalare sonst Vorrang von sNormalized/arcLengthMm. */
      const clearCutPathAnchorsForNewPosition =
        isPositionUpdate &&
        !Object.prototype.hasOwnProperty.call(upd, 'sNormalized') &&
        !Object.prototype.hasOwnProperty.call(upd, 'arcLengthMm')
      return {
        workspace: {
          ...s.workspace,
          pieces: s.workspace.pieces.map((p) => {
            if (p.id !== pieceId) return p
            return {
              ...p,
              notches: p.notches.map((n) => {
                if (n.id !== notchId) return n
                const merged = {
                  ...n,
                  ...upd,
                  ...(clearCutPathAnchorsForNewPosition
                    ? { sNormalized: undefined, arcLengthMm: undefined }
                    : {}),
                }
                return materializeNotchAnchorsOnCutLine(merged, p.cutLine) ?? merged
              }),
            }
          }),
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
        const oldCut = p.cutLine
        const sourceInner = p.seamLine.length >= 3 ? p.seamLine : p.cutLine
        const migratingFromCutMaster = !(p.seamLine.length >= 3 && p.seamAllowanceMm != null)
        const seamLine = cloneCurvesArray(sourceInner)
        const derived = deriveCutLineForPiece({ ...p, seamAllowanceMm: deltaMm }, seamLine, deltaMm)
        if (!derived.ok) {
          toastMessage = `warn:${derived.message}`
          return p
        }
        const cutLine = derived.cutLine
        const mappedSoft = remapSoftVerticesToNewCutLine(oldCut, cutLine, p.softVertices)
        // Wie updatePiece: Kerben auf neuer Außenkontur geometrisch neu einhängen (nicht nur vertexIndex löschen).
        const notches = resyncNotchesAfterCutLineRebuilt(p.notches, oldCut, cutLine)
        if (migratingFromCutMaster) {
          const migratedSoftMaster = [...new Set((p.softVertices ?? []).filter((vi) => vi >= 0 && vi < seamLine.length))].sort((a, b) => a - b)
          const nextPiece = {
            ...p,
            cutLine,
            seamLine,
            seamAllowanceMm: deltaMm,
            notches,
            softVertices: [],
            softVerticesMaster: migratedSoftMaster,
          }
          const preserveCut = migratedSoftMaster
            .map((mvi) => mapMasterVertexIndexToCutVertexIndex(nextPiece, mvi))
            .filter((x): x is number => x != null)
          return forceCutVerticesSoftAfterPromotion(nextPiece, preserveCut)
        }
        return forceCutVerticesSoftAfterPromotion(
          { ...p, cutLine, seamLine, seamAllowanceMm: deltaMm, notches, softVertices: mappedSoft },
          mappedSoft
        )
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
          const mergedCut = getEffectiveSoftVerticesCut(p)
          const softVertices = remapSoftVerticesToNewCutLine(oldCut, newCut, mergedCut)
          return applySharpCornerPromotion({
            ...p,
            cutLine: newCut,
            seamLine: [],
            seamAllowanceMm: null,
            edgeSeamAllowances: undefined,
            notches,
            softVertices,
            softVerticesMaster: [],
          })
        }),
      },
    })),

  setEdgeSeamAllowance: (pieceId, edgeIndex, allowanceMm) =>
    set((s) => {
      let toastMessage: string | null = null
      const pieces = s.workspace.pieces.map((p) => {
        if (p.id !== pieceId) return p
        if (p.seamAllowanceMm == null || p.seamLine.length < 3) return p

        const overrides = [...(p.edgeSeamAllowances ?? [])]
        const existingIdx = overrides.findIndex((o) => o.edgeIndex === edgeIndex)
        if (existingIdx >= 0) {
          if (allowanceMm === (p.seamAllowanceMm ?? 0)) {
            overrides.splice(existingIdx, 1)
          } else {
            overrides[existingIdx] = { edgeIndex, allowanceMm }
          }
        } else if (allowanceMm !== (p.seamAllowanceMm ?? 0)) {
          overrides.push({ edgeIndex, allowanceMm })
        }

        const next: PatternPiece = { ...p, edgeSeamAllowances: overrides.length > 0 ? overrides : undefined }
        const derived = deriveCutLineForPiece(next, next.seamLine, next.seamAllowanceMm!)
        if (!derived.ok) {
          toastMessage = `warn:${derived.message}`
          return p
        }
        const oldCut = p.cutLine
        next.cutLine = derived.cutLine
        next.notches = resyncNotchesAfterCutLineRebuilt(p.notches, oldCut, derived.cutLine)
        const mappedSoft = remapSoftVerticesToNewCutLine(oldCut, derived.cutLine, p.softVertices)
        next.softVertices = mappedSoft
        return forceCutVerticesSoftAfterPromotion(next, mappedSoft)
      })
      return {
        workspace: { ...s.workspace, pieces },
        ...(toastMessage ? { toastMessage } : {}),
      }
    }),

  // Legacy-API-Name: arbeitet intern auf der Master-Kontur (seamLine bei Nahtzugabe, sonst cutLine).
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
          // Bei Master-Kontur-Splits (cutLine oder seamLine) müssen die SeamAssignment-Indizes remapped werden.
          // getCurvesForSeamEdge erwartet Master-Indizes, und `curveIndex` ist auf genau dieser Master-Kontur angegeben.
          seamAssignments: adjustSeamAfterInsert(s.workspace.seamAssignments, pieceId, curveIndex),
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
              const newMasterVi = curveIndex + 1
              const softVerticesMaster = [
                ...(p.softVerticesMaster ?? []).map((vi) => (vi >= newMasterVi ? vi + 1 : vi)),
                newMasterVi,
              ].sort((a, b) => a - b)
              const tempPiece = { ...p, seamLine, softVerticesMaster }
              const derived = deriveCutLineForPiece(tempPiece, seamLine, p.seamAllowanceMm)
              if (!derived.ok) {
                toastMessage = `warn:${derived.message}`
                return p
              }
              const cutLine = derived.cutLine
              const notches = resyncNotchesAfterCutLineRebuilt(p.notches, p.cutLine, cutLine)
              const insertedOnSeam = newMaster[curveIndex].end
              const maxInsertDist = Math.max((p.seamAllowanceMm ?? 0) * 3, 20)
              const insertedCutVi = nearestCutVertexIndex(cutLine, insertedOnSeam, maxInsertDist)
              const softSet = new Set(remapSoftVerticesToNewCutLine(p.cutLine, cutLine, p.softVertices))
              if (insertedCutVi != null) softSet.add(insertedCutVi)
              const softVertices = [...softSet].sort((a, b) => a - b)
              inserted = true
              if (insertedCutVi == null) {
                return { ...p, cutLine, seamLine, notches, softVertices, softVerticesMaster }
              }
              return forceCutVertexSoftAfterInsert(
                { ...p, cutLine, seamLine, notches, softVertices, softVerticesMaster },
                insertedCutVi
              )
            }

            const cutLine = newMaster
            const notches = resyncNotchesAfterCutLineRebuilt(p.notches, p.cutLine, cutLine)
            const newVertexIdx = curveIndex + 1
            const softVertices = [
              ...(p.softVertices ?? []).map((vi) => (vi >= newVertexIdx ? vi + 1 : vi)),
              newVertexIdx,
            ]
            const seamLine =
              p.seamAllowanceMm != null && cutLine.length >= 3 ? offsetCurvesInwardForSeam(cutLine, p.seamAllowanceMm) : p.seamLine
            inserted = true
            return forceCutVertexSoftAfterInsert({ ...p, cutLine, seamLine, notches, softVertices }, newVertexIdx)
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
            if (vertexIndex < 0 || vertexIndex >= n) return p
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
              const derived = deriveCutLineForPiece(p, newSeam, seamAllowance)
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
            const oldNForResync = baseline ? baseline.notches : p.notches
            const oldCForResync = baseline ? baseline.cutLine : p.cutLine
            const oldSForResync = baseline ? baseline.seamLine ?? p.seamLine : p.seamLine
            const notches = cutRebuiltFromSeam
              ? resyncNotchesViaSeamAnchor(oldNForResync, oldCForResync, cutLine, oldSForResync, seamLine)
              : resyncNotchesAfterCutLineRebuilt(oldNForResync, oldCForResync, cutLine)
            if (p.notches.length > 0 && notchPushedToCorner(oldNForResync, oldCForResync, notches, cutLine)) {
              toastMessage = 'warn:Verschiebung würde Kerbe an Ecke schieben – bitte zuerst Kerbe löschen.'
              return p
            }
            // cutLine wird aus seam neu abgeleitet: alte cut-Indizes in softVertices wären falsch
            // (gleiche Zahl gültiger Indizes, aber andere Ecken) → geometrisch auf neue Kontur mappen.
            const softVertices =
              cutRebuiltFromSeam && cutLine.length > 0
                ? remapSoftVerticesToNewCutLine(p.cutLine, cutLine, p.softVertices)
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
          const derived = deriveCutLineForPiece(p, seamLine, p.seamAllowanceMm)
          if (!derived.ok) {
            toastMessage = `warn:${derived.message}`
            return p
          }
          const cutLine = derived.cutLine
          const notches = resyncNotchesAfterCutLineRebuilt(p.notches, p.cutLine, cutLine)
          const softVertices = remapSoftVerticesToNewCutLine(p.cutLine, cutLine, p.softVertices)
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

  movePointOnCurve: (pieceId, curveIndex, t, newPoint, skipSeamRecalc, notchOpts) =>
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
        const baseline = notchOpts?.notchResyncBaseline
        if (seamPc && p.seamAllowanceMm != null) {
          const seamLine = next
          const derived = deriveCutLineForPiece(p, seamLine, p.seamAllowanceMm)
          if (!derived.ok) {
            toastMessage = `warn:${derived.message}`
            return p
          }
          const cutLine = derived.cutLine
          const oldN = baseline ? baseline.notches : p.notches
          const oldC = baseline ? baseline.cutLine : p.cutLine
          const oldS = baseline ? baseline.seamLine ?? p.seamLine : p.seamLine
          const notches = resyncNotchesViaSeamAnchor(oldN, oldC, cutLine, oldS, seamLine)
          const softVertices = remapSoftVerticesToNewCutLine(p.cutLine, cutLine, p.softVertices)
          return applySharpCornerPromotion({ ...p, cutLine, seamLine, notches, softVertices })
        }
        const cutLine = [...p.cutLine]
        cutLine[curveIndex] = bezier
        const seamLine = skipSeamRecalc
          ? p.seamLine
          : (p.seamAllowanceMm != null && cutLine.length >= 3 ? offsetCurvesInwardForSeam(cutLine, p.seamAllowanceMm) : p.seamLine)
        if (baseline) {
          const notches = resyncNotchesAfterCutLineRebuilt(baseline.notches, baseline.cutLine, cutLine)
          return applySharpCornerPromotion({ ...p, cutLine, seamLine, notches })
        }
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
      if (piece == null || vertexIndex < 0 || vertexIndex >= oldN) return s
      let toastMessage: string | null = null

      const mergeContourRemoveVertex = (curves: Curve[], vi: number): Curve[] | null => {
        if (curves.length <= 3) return null
        const n = curves.length
        const prevIdx = (vi - 1 + n) % n
        const nextIdx = vi
        const newSeg = mergeAdjacentSegments(curves[prevIdx], curves[nextIdx])
        const merged = curves.filter((_, j) => j !== prevIdx && j !== nextIdx)
        merged.splice(Math.min(prevIdx, nextIdx), 0, newSeg)
        return merged
      }

      if (piece && useSeamMaster && piece.seamAllowanceMm != null && master.length > 3) {
        const merged = mergeContourRemoveVertex(master, vertexIndex)
        if (merged) {
          const tempSoftM = (piece.softVerticesMaster ?? [])
            .filter((vi: number) => vi !== vertexIndex)
            .map((vi: number) => (vi > vertexIndex ? vi - 1 : vi))
          const tempPiece = { ...piece, seamLine: merged, softVerticesMaster: tempSoftM }
          tempPiece.edgeSeamAllowances = remapEdgeSeamAllowances(piece, tempPiece)
          const derived = deriveCutLineForPiece(tempPiece, merged, piece.seamAllowanceMm)
          if (!derived.ok) {
            return { ...s, toastMessage: `warn:${derived.message}` }
          }
        }
      }

      const newPieces = s.workspace.pieces.map((p) => {
        const seamAllowance = p.seamAllowanceMm
        const seamMaster = useSeamLineForVertexEditing(p)
        const curves = seamMaster ? p.seamLine : p.cutLine
        if (p.id !== pieceId || curves.length <= 3 || vertexIndex < 0 || vertexIndex >= curves.length) return p
        const merged = mergeContourRemoveVertex(curves, vertexIndex)
        if (!merged) return p
        const softVerticesMaster = (p.softVerticesMaster ?? [])
          .filter((vi) => vi !== vertexIndex)
          .map((vi) => (vi > vertexIndex ? vi - 1 : vi))

        let cutLine = p.cutLine
        let seamLine = p.seamLine
        if (seamMaster && seamAllowance != null) {
          seamLine = merged
          const tempPiece = { ...p, seamLine, softVerticesMaster }
          const edgeSeamAllowances = remapEdgeSeamAllowances(p, tempPiece)
          const derived = deriveCutLineForPiece({ ...tempPiece, edgeSeamAllowances }, seamLine, seamAllowance)
          if (!derived.ok) return p
          cutLine = derived.cutLine
        } else {
          cutLine = merged
          seamLine =
            seamAllowance != null && cutLine.length >= 3
              ? offsetCurvesInwardForSeam(cutLine, seamAllowance)
              : p.seamLine
        }

        const cutCheck = validateContourAfterVertexMove(cutLine)
        if (!cutCheck.ok) {
          toastMessage = `warn:${cutCheck.message}`
          return p
        }
        const seamCheck =
          seamAllowance != null && seamLine.length >= 3 ? validateContourAfterVertexMove(seamLine) : { ok: true as const }
        if (!seamCheck.ok) {
          toastMessage = `warn:${seamCheck.message}`
          return p
        }
        const notches = resyncNotchesAfterCutLineRebuilt(p.notches, p.cutLine, cutLine)
        const oldCut = p.cutLine
        const softVertices = remapSoftVerticesToNewCutLine(oldCut, cutLine, p.softVertices)

        const newPiece = { ...p, cutLine, seamLine, notches, softVertices, softVerticesMaster }
        newPiece.edgeSeamAllowances = remapEdgeSeamAllowances(p, newPiece)
        return applySharpCornerPromotion(newPiece)
      })

      const oldP = s.workspace.pieces.find((p) => p.id === pieceId)
      const newP = newPieces.find((p) => p.id === pieceId)
      let profileAssignments = s.workspace.profileAssignments ?? []
      if (oldP && newP && oldP !== newP) {
        profileAssignments = remapProfileAssignmentsForPiece(oldP, newP, profileAssignments)
      }

      return {
        workspace: {
          ...s.workspace,
          seamAssignments: oldN > 3 ? adjustSeamAfterRemove(s.workspace.seamAssignments, pieceId, vertexIndex, oldN) : s.workspace.seamAssignments,
          pieces: newPieces,
          profileAssignments,
        },
        ...(toastMessage ? { toastMessage } : {}),
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
          const derived = deriveCutLineForPiece(p, seamLine, p.seamAllowanceMm)
          if (!derived.ok) {
            toastMessage = `warn:${derived.message}`
            return p
          }
          const cutLine = derived.cutLine
          const notches = resyncNotchesAfterCutLineRebuilt(p.notches, p.cutLine, cutLine)
          const softVertices = remapSoftVerticesToNewCutLine(p.cutLine, cutLine, p.softVertices)
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
    set((s) => {
      const oldPiece = s.workspace.pieces.find((p) => p.id === pieceId)
      const newPieces = s.workspace.pieces.map((p) => {
        if (p.id !== pieceId) return p
        const useSeamMaster = useSeamLineForVertexEditing(p)
        const curves = useSeamMaster ? p.seamLine : p.cutLine
        const n = curves.length
        if (n <= 3 || vertexIndex < 0 || vertexIndex >= n) return p
        if (useSeamMaster) {
          const masterSet = new Set(p.softVerticesMaster ?? [])
          if (soft) masterSet.add(vertexIndex)
          else masterSet.delete(vertexIndex)
          const cutVi = mapMasterVertexIndexToCutVertexIndex(p, vertexIndex)
          const softCut = new Set(p.softVertices ?? [])
          if (cutVi != null) softCut.delete(cutVi)
          const nextP = {
            ...p,
            softVerticesMaster: [...masterSet].sort((a, b) => a - b),
            softVertices: [...softCut].sort((a, b) => a - b),
          }
          nextP.edgeSeamAllowances = remapEdgeSeamAllowances(p, nextP)
          if (soft) return nextP
          return applySharpCornerPromotion(nextP)
        }
        const sSet = new Set(p.softVertices ?? [])
        if (soft) sSet.add(vertexIndex)
        else sSet.delete(vertexIndex)
        const softVertices = [...sSet].sort((a, b) => a - b)
        const nextCut = { ...p, softVertices }
        nextCut.edgeSeamAllowances = remapEdgeSeamAllowances(p, nextCut)
        if (soft) return nextCut
        return applySharpCornerPromotion(nextCut)
      })
      const newPiece = newPieces.find((p) => p.id === pieceId)
      let profileAssignments = s.workspace.profileAssignments ?? []
      if (oldPiece && newPiece && oldPiece !== newPiece) {
        profileAssignments = remapProfileAssignmentsForPiece(oldPiece, newPiece, profileAssignments)
      }
      return {
        workspace: { ...s.workspace, pieces: newPieces, profileAssignments },
      }
    }),

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
          const derived = deriveCutLineForPiece(p, seamLine, p.seamAllowanceMm)
          if (!derived.ok) {
            toastMessage = `warn:${derived.message}`
            return p
          }
          const cutLine = derived.cutLine
          const notches = resyncNotchesAfterCutLineRebuilt(p.notches, p.cutLine, cutLine)
          const softVertices = remapSoftVerticesToNewCutLine(p.cutLine, cutLine, p.softVertices)
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
          // Schutz gegen versehentliches Überschreiben der Master-Naht:
          // Bei Seam-as-Master wird seamLine direkt bearbeitet und darf hier nicht aus cutLine neu entstehen.
          if (useSeamLineForVertexEditing(p)) return p
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
      let cutLine: Curve[]
      let seamLine: Curve[]
      if (useSeamLineForVertexEditing(piece) && piece.seamLine.length >= 3) {
        seamLine = piece.seamLine.map((c) => mirrorCurve(c, cx))
        const derived = deriveCutLineForPiece({ ...piece, seamLine }, seamLine, piece.seamAllowanceMm!)
        cutLine = derived.ok ? derived.cutLine : piece.cutLine.map((c) => mirrorCurve(c, cx))
      } else {
        cutLine = piece.cutLine.map((c) => mirrorCurve(c, cx))
        seamLine = piece.seamAllowanceMm != null && cutLine.length >= 3
          ? offsetCurvesInwardForSeam(cutLine, piece.seamAllowanceMm)
          : []
      }
      const mirroredNotches = piece.notches.map((n) => ({
        ...n,
        position: mirrorX(n.position, cx),
        angle: 180 - n.angle,
        sNormalized: undefined as number | undefined,
        arcLengthMm: undefined as number | undefined,
      }))
      const notches = mirroredNotches
        .map((n) => materializeNotchAnchorsOnCutLine(n, cutLine))
        .filter((n): n is Notch => n != null)
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
      const persistPivot = piece.transform.pivotLocal == null ? pivot : piece.transform.pivotLocal
      return {
        workspace: {
          ...s.workspace,
          pieces: s.workspace.pieces.map((p) =>
            p.id === pieceId
              ? { ...p, transform: { ...p.transform, x: txNew, y: tyNew, rotation: rotationDeg, pivotLocal: persistPivot } }
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
      edgeSeamPickingActive: false,
      nahtzuordnungMode: 'idle',
      pendingNahtzuordnungFirst: null,
      profileDialogAssignmentId: null,
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
    // Index-Mapping Dokumentation:
    // - `digitizeNodesToCurves(nodes)` erzeugt ein geschlossenes Kurvenarray in derselben Node-Reihenfolge.
    // - Node-Index i entspricht damit dem Vertex-Index i der neuen `cutLine`.
    // - handleOut != null markiert diesen Vertex als "weich" (blauer Punkt).
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

  addWorkspaceNote: (pieceId, positionLocal) => {
    const id = generateId()
    set((s) => ({
      workspace: {
        ...s.workspace,
        notes: [
          ...(s.workspace.notes ?? []),
          { id, pieceId, position: { ...positionLocal }, text: '' },
        ],
      },
    }))
    return id
  },

  updateWorkspaceNote: (id, partial) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        notes: (s.workspace.notes ?? []).map((n) => (n.id === id ? { ...n, ...partial } : n)),
      },
    })),

  removeWorkspaceNote: (id) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        notes: (s.workspace.notes ?? []).filter((n) => n.id !== id),
      },
    })),

  loadProjectFromFile: (project, opts) => {
    const notchSettings = Array.from({ length: 10 }, (_, i) => {
      const n = project.notchSettings[i]
      return n && (n.type === 'keine' || n.type === 'strich' || n.type === 'kerbe')
        ? { type: n.type, widthMm: n.widthMm, depthMm: n.depthMm }
        : { type: (i === 0 ? 'kerbe' : 'strich') as NotchType, widthMm: i === 0 ? 6 : 2.5, depthMm: i === 0 ? 4 : 2 }
    })
    const firstId = project.workspace.pieces[0]?.id
    const ws =
      opts?.projectFileName != null
        ? { ...project.workspace, projectFileName: opts.projectFileName }
        : project.workspace
    set({
      workspace: { ...ws, notes: ws.notes ?? [], profileAssignments: ws.profileAssignments ?? [] },
      dxfExportScale: project.dxfExportScale,
      dxfImportExtraCutLayers: project.dxfImportExtraCutLayers,
      dxfImportScale: project.dxfImportScale,
      dxfImportDetectVNotches: project.dxfImportDetectVNotches,
      dxfImportCreateSeamLine: project.dxfImportCreateSeamLine,
      dxfImportSeamAllowanceMm: project.dxfImportSeamAllowanceMm,
      notchSettings,
      activeNotchPresetIndex: 0,
      imageDigitizeSession: project.imageDigitizeSession,
      workspaceImageSelected: Boolean(project.imageDigitizeSession?.imageDataUrl),
      selectedPieceIds: firstId ? [firstId] : [],
      selectedPoint: null,
      tool: 'select',
      digitizeState: null,
      pendingNahtzugabeClick: false,
      nahtzugabeDialogPieceId: null,
      piecePropertiesDialogPieceId: null,
      edgeSeamPickingActive: false,
      nahtzuordnungMode: 'idle',
      pendingNahtzuordnungFirst: null,
      rulerMode: false,
      rulerLine: null,
      seamAdjustmentDialog: null,
      seamAssignmentMetaDialogId: null,
      profileDialogAssignmentId: null,
      massstabDialog: null,
      showHelpModal: false,
      showShortcutListModal: false,
      showSettingsModal: false,
      showStuecklisteModal: false,
      configuratorModalOpen: false,
      rockGeneratorModalOpen: false,
      toastMessage: null,
      batchSelectionFilter: 'all',
      batchSelectionTargets: [],
      batchUiHighlightByTargetId: {},
    })
  },

}),
    {
      limit: 20,
      partialize: (state) => ({
        workspace: state.workspace,
      }),
      equality: (pastState, currentState) => {
        const pw = pastState.workspace
        const cw = currentState.workspace
        if (pw === cw) return true
        return (
          pw.id === cw.id &&
          pw.name === cw.name &&
          pw.pieces === cw.pieces &&
          pw.seamAssignments === cw.seamAssignments &&
          pw.notes === cw.notes &&
          pw.profileAssignments === cw.profileAssignments &&
          pw.projectFileName === cw.projectFileName &&
          pw.bomDocumentVersion === cw.bomDocumentVersion &&
          pw.bomDeveloperName === cw.bomDeveloperName &&
          pw.bomEngineerName === cw.bomEngineerName
        )
      },
    },
  ),
)

export function undoAction() {
  const currentView = useStore.getState().workspace.view
  useStore.temporal.getState().undo()
  useStore.setState((s) => ({
    workspace: { ...s.workspace, view: currentView },
  }))
}

export function redoAction() {
  const currentView = useStore.getState().workspace.view
  useStore.temporal.getState().redo()
  useStore.setState((s) => ({
    workspace: { ...s.workspace, view: currentView },
  }))
}

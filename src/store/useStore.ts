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
  InternalCircle,
  NotchRole,
  RoundedCorner,
} from '../types/model'
import {
  ROUND_CORNER_MIN_RADIUS_MM,
  ROUND_CORNER_MAX_RADIUS_MM,
  validateCornerRound,
} from '../geometry/cornerRounding'
import { SEAM_ASSIGNMENT_KIND_IDS } from '../types/model'
import {
  offsetCurvesInwardForSeam,
  offsetSegmentPoints,
  validateContourAfterVertexMove,
  closedPointsToLineCurves,
} from '../geometry/offset'
import { remapEdgeSeamAllowances, remapProfileAssignmentsForPiece, enumerateEdges } from '../geometry/edgeEnumeration'
import { deriveInternalSeamNotchRangeAtClick, isInternalSeamAssignment } from '../geometry/internalSeamAssignment'
import { deltaMinimalDegToHorizontal, masterEdgeIsStraightLine } from '../geometry/horizontalLevelEdge'
import {
  splitBezierAt,
  joinBezierSegments,
  lineSegmentToCollinearBezier,
  adjustControlPointsForPointOnCurve,
} from '../geometry/curveToPath'
import {
  getSubSegments,
  getNotchesOnEdge,
  getNotchesOnEdgeInRange,
  edgeTotalLength,
  edgeLengthInNotchRange,
  getCurvesForSeamEdge,
  resolvedSeamAssignmentCurveIndices,
  bestSeamSubSegmentPairing,
  buildNotchTargetArcPositionsFromSubLengths,
  materializeNotchAtEdgeArcLengthExact,
  deriveNotchRoleRangeOnEdge,
  snapVertexToEdgeLength,
  SEAM_EDGE_LENGTH_SNAP_TOLERANCE_MM,
  mapMasterVertexIndexToCutVertexIndex,
  getEffectiveSoftVerticesCut,
  syncSoftAfterSharpCornerPromotion,
} from '../geometry/seamUtils'
import {
  evaluateSeamAdjustment,
  seamAdjustmentFingerprint,
  SEAM_ADJUSTMENT_NOTCH_ALIGNED_EPS_MM,
} from '../geometry/seamAdjustmentCheck'
import { materializeNotchAnchorsOnCutLine } from '../geometry/notchOnCurve'
import {
  isNotchOnInternalLine,
  materializeNotchAnchorsOnInternalLine,
  remapNotchesAfterInternalLineRemove,
  remapNotchesAfterInternalLineSplit,
} from '../geometry/notchOnInternalLine'
import { pieceLocalToWorld, getPiecePivotLocal } from '../geometry/pieceTransform'
import { applySharpCornerPromotion } from '../geometry/softVertexPromotion'
import { useSeamLineForVertexEditing, useSeamLineForPointCurveEditing } from '../geometry/vertexMaster'
import { isNotchSpacingValidForCandidate } from '../geometry/notchMinSpacing'
import { resyncNotchesAfterCutLineRebuilt, resyncNotchesViaSeamAnchor, notchPushedToCorner, rematerializeNotchesAfterGeometricMirror } from '../geometry/notchResyncCutLine'
import { applyUniformScaleToPiece, getReferenceEdgePivotLocal } from '../geometry/scalePieceLocal'
import { withDefaultGrainLine } from '../geometry/grainArrowLayout'
import { reapplySeamAssignmentCutTrimsForAllPieces } from '../geometry/seamAssignmentCutTrim'
import {
  remapInternalSeamAssignmentsAfterInternalLineRemove,
  remapProfileAssignmentsAfterInternalLineRemove,
} from '../geometry/internalSeamAssignment'
import type { TrimTexProjectFileV1 } from '../persistence/trimtexProjectJson'
import type { ConfiguratorInstance, ConfiguratorKindId, ConfiguratorPartParams } from '../configurators/types'
import { generateConfiguratorPartGeometry } from '../configurators/generators'
import { getDefaultConfiguratorParts } from '../configurators/registry'
import { batchTargetKey, filterBatchTargets, mergeBatchTargets } from '../workspace/workspaceMarqueeSelection'
import { VIEWBOX_WIDTH, VIEWBOX_HEIGHT } from '../workspaceConstants'
import {
  computeMmPerPixelXYFromRightAngle,
  effectiveMmPerPixelXY,
  IMAGE_SCALE_REF_MM,
  worldToImagePixel,
} from '../utils/imageCalibration'
import { deriveCutLineForPiece } from '../geometry/deriveCutLineForPiece'
import { preferStableCutAfterGeometricMirror } from '../geometry/seamAllowanceInvariants'
import { formatProfileEdgeGeometryWarnings, mergeWarnToasts } from '../profile/profileEdgeWarnings'
import {
  computeProfileFitAdjustTarget,
  computeProfileFitPreviewsForPiece,
  snapProfileLengthMm,
  type ProfileFitAdjustTarget,
} from '../geometry/profileLengthFit'
import { profileAssignmentLengthMm } from '../geometry/internalLineProfile'
import { applyPieceSymmetryToPiece } from '../symmetry/applyPieceSymmetryToPiece'
import {
  buildFacingGeometryFromParent,
  facingChildIds,
  facingOffsetBesideParent,
  isFacingDerivedPiece,
  syncFacingPiecesFromParents,
} from '../geometry/facingPiece'
import {
  finalizePieceContourEdit,
  mapContourVertexEditForSymmetry,
  mapCurveEditForSymmetry,
  mirrorSymmetricContourPointInsert,
  appendSymmetricMirroredNotches,
  symmetryConstraintFromAxis,
  getContourVertexPosition,
} from '../symmetry/reconcilePieceSymmetry'
import type { PieceSymmetryKeepSide } from '../geometry/pieceSymmetry'
import type { PieceSymmetryUiState } from '../symmetry/types'
import { trimPieceCutLineByOtherPieceOverlap } from '../geometry/seamTrimByOverlap'
import {
  internalLineEndpointsTouch,
  remapSoftJunctionsAfterRemoveCurve,
  remapSoftJunctionsAfterSplitCurve,
} from '../geometry/internalLineJunctions'
import { clampUiTextScale } from '../ui/uiTextScale'
import type { NestingPlan, NestingWorkerStatus } from '../nesting/nestingTypes'
import { piecesForMaterial } from '../nesting/nestingMaterial'

export type { PieceSymmetryPhase, PieceSymmetryUiState } from '../symmetry/types'

const defaultView: ViewState = { zoom: 1, panX: 0, panY: 0 }
const NOTCH_ROLES: readonly NotchRole[] = ['nahtanfang', 'nahtende', 'beides'] as const

/** Einstellungen: Dreh-UI und Digitalisier-Punkte (0.5–2.5, Zoom-unabhängige Darstellung). */
function clampCanvasOverlayScale(v: number): number {
  if (!Number.isFinite(v)) return 1
  return Math.min(2.5, Math.max(0.5, v))
}

/** Nahtlinie geändert → Außenkontur wieder aus Nahtzugabe; manuelles „Naht trimmen“ geht verloren. */
const TOAST_MANUAL_SEAM_TRIM_RESET_PARALLEL =
  'warn:Nahtlinie geändert: Manuelles Naht-Trimmen an der Außenkontur wurde zurückgesetzt. Schnittkontur wird wieder parallel zur Nahtlinie (Nahtzugabe) berechnet.'

function isValidNotchRole(value: unknown): value is NotchRole {
  return typeof value === 'string' && (NOTCH_ROLES as readonly string[]).includes(value)
}

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
  if (prev.type === 'line' && next.type === 'bezier') {
    const asBez = lineSegmentToCollinearBezier(prev)
    const joined = joinBezierSegments(asBez, next)
    if (joined) return joined
  }
  if (prev.type === 'bezier' && next.type === 'line') {
    const asBez = lineSegmentToCollinearBezier(next)
    const joined = joinBezierSegments(prev, asBez)
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

const FACING_GEOMETRY_LOCKED_TOAST =
  'info:Kaschierungen werden nur von der Mutter synchronisiert – Geometrie hier nicht editierbar.'

const FACING_GEOMETRY_UPDATE_KEYS: (keyof PatternPiece)[] = [
  'cutLine',
  'seamLine',
  'seamAllowanceMm',
  'edgeSeamAllowances',
  'notches',
  'drills',
  'internalLines',
  'internalCircles',
  'internalLineSoftJunctions',
  'softVertices',
  'softVerticesMaster',
  'roundedCorners',
  'cutLineDeviatesFromSeamAllowanceOffset',
  'symmetryConstraint',
]

function updateTouchesFacingGeometry(upd: Partial<PatternPiece>): boolean {
  return FACING_GEOMETRY_UPDATE_KEYS.some((k) => Object.prototype.hasOwnProperty.call(upd, k))
}

/** Blockiert manuelle Geometrie-Edits an abgeleiteten Kaschierungen (Position/Drehung bleiben erlaubt). */
function facingGeometryEditBlocked(
  pieces: PatternPiece[],
  pieceId: string
): { toastMessage: string } | null {
  const p = pieces.find((x) => x.id === pieceId)
  if (!isFacingDerivedPiece(p)) return null
  return { toastMessage: FACING_GEOMETRY_LOCKED_TOAST }
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
 * Verschiebt Indizes in `roundedCorners` nach einem Vertex-Insert auf der Master-Kontur.
 * Wenn der eingefügte Vertex genau auf einer gerundeten Ecke landet, bleibt diese Rundung erhalten,
 * der Index wird +1 verschoben (der eingefügte Vertex schiebt nachfolgende Indizes nach hinten).
 */
function remapRoundedCornersOnVertexInsert(
  rc: RoundedCorner[] | undefined,
  insertedAtVertexIndex: number
): RoundedCorner[] | undefined {
  if (!rc || rc.length === 0) return rc
  return rc.map((r) =>
    r.masterVertexIndex >= insertedAtVertexIndex ? { ...r, masterVertexIndex: r.masterVertexIndex + 1 } : r
  )
}

/**
 * Verschiebt Indizes in `roundedCorners` nach einem Vertex-Remove. Eintrag mit
 * removedVertexIndex wird gelöscht (gerundete Ecke verschwindet zusammen mit der Ecke).
 */
function remapRoundedCornersOnVertexRemove(
  rc: RoundedCorner[] | undefined,
  removedVertexIndex: number
): RoundedCorner[] | undefined {
  if (!rc || rc.length === 0) return rc
  const out: RoundedCorner[] = []
  for (const r of rc) {
    if (r.masterVertexIndex === removedVertexIndex) continue
    if (r.masterVertexIndex > removedVertexIndex) out.push({ ...r, masterVertexIndex: r.masterVertexIndex - 1 })
    else out.push(r)
  }
  return out.length > 0 ? out : undefined
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
    internalCircles: [],
    layer: 'CUT',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    softVertices: [],
    softVerticesMaster: [],
    fillInterior: true,
    material: '',
    description: '',
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
  | 'roundcorner'

type NahtTrimMode = 'full' | '45'

/** Hintergrundbild auf der Arbeitsfläche. */
type ImageDigitizeSession = {
  imageDataUrl: string | null
  imageSizePx: { width: number; height: number } | null
  /** Bildposition im Workspace (mm), Mittelpunkt entspricht dem Bildzentrum. */
  imagePosition: Point
  /**
   * mm pro Bildpixel (isotrop / Legacy). Bei X/Y-Kalibrierung geometrisches Mittel
   * bzw. Fallback, wenn renderMmPerPixelX/Y fehlen.
   */
  renderMmPerPixel: number
  /** mm pro Bildpixel horizontal (nach 10×10-cm-Winkel-Kalibrierung). */
  renderMmPerPixelX?: number
  /** mm pro Bildpixel vertikal (nach 10×10-cm-Winkel-Kalibrierung). */
  renderMmPerPixelY?: number
  /** true: Bild nicht mehr verschieben/skalieren (nur Auswahl aufheben / wieder freigeben). */
  locked?: boolean
}

/** 3-Punkt-Kalibrierung: Ecke + zwei Schenkelenden eines 10×10-cm-Winkels auf dem Foto. */
type ImageScaleCalibrationState = {
  /** Weltkoordinaten der gesetzten Punkte (0..2). */
  pointsWorld: Point[]
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
  /** Ausgewählte Teile: vorherige Kontur(en) aus Undo-Verlauf halbtransparent unterlegen. */
  showContourChangePreview: boolean
  /** Live-Anzeige Stückliste (Fläche, Materialkosten) unten rechts auf der Arbeitsfläche. */
  showLiveBomCost: boolean
  /**
   * Nahtzuordnungen auf der Arbeitsfläche: Verbinder, Längen-Δ, Kerben-Warnung, grüne ✓ bei Übereinstimmung.
   */
  showSeamPruefanzeigen: boolean
  /** Linke Teileliste ein-/ausklappen (mehr Platz für die Arbeitsfläche). */
  sidebarCollapsed: boolean
  /**
   * true: volle Konturbearbeitung (Punkte, Kerben, …); Fadenlauf-Geometrie nicht per Ziehen ändern.
   * false: nur Teil verschieben, drehen, Drehpunkt und Fadenlauf anpassen (Layout-Modus).
   */
  contourEditEnabled: boolean
  rulerMode: boolean
  rulerLine: { start: Point; end: Point } | null
  pendingNahtzugabeClick: boolean
  nahtzugabeDialogPieceId: string | null
  /** Dialog „Teil-Eigenschaften“ (Name, Flächenfüllung). */
  piecePropertiesDialogPieceId: string | null
  /** Interaktiver Modus: Kante auf dem Canvas anklicken, um Nahtzugabe pro Kante festzulegen. */
  edgeSeamPickingActive: boolean
  /** Gerade Master-Kante wählen → Teil drehen, bis die Kante waagerecht ist. */
  horizontalLevelPickingActive: boolean
  /** Zwei Punkte Spiegelachse, dann Seitenwahl für symmetrische Kontur. */
  pieceSymmetryState: PieceSymmetryUiState
  /** Nahtzuordnung: zwei Teile oder Einzelnaht auf interner Linie */
  nahtzuordnungMode: 'idle' | 'first' | 'second' | 'internal'
  pendingNahtzuordnungFirst: { pieceId: string; curveIndices: number[]; clickedCurve: number } | null
  /** Manuell „Naht trimmen“: nach Menüwahl Ecke an der Schnittkontur anklicken. */
  nahtTrimPickCutVertexActive: boolean
  /** Modus für manuellen Eck-Trim auf der Außenkontur. */
  nahtTrimMode: NahtTrimMode
  /** Profil-Dialog: ID der aktuell bearbeiteten ProfileAssignment (null = geschlossen). */
  profileDialogAssignmentId: string | null
  showSettingsModal: boolean
  showStuecklisteModal: boolean
  showMaterialCatalogModal: boolean
  showNestingModal: boolean
  nestingSelectedMaterialKey: string | null
  /** Stückzahl pro Teil nur für Nesting (pieceId → qty). */
  nestingInputs: Record<string, number>
  nestingSpacingMm: number
  nestingMaxRollLengthMm: number | null
  nestingPlan: NestingPlan | null
  nestingStatus: NestingWorkerStatus
  nestingError: string | null
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
  canvasRotationUiScale: number
  canvasDigitizeUiScale: number
  canvasVertexPointUiScale: number
  /** 0.75–1.75: Schriftgröße für Beschriftungen auf Teilen (Profil, Nähte, Namen, Maße). */
  uiTextScale: number
  showPivotRotationUi: boolean
  notchSettings: NotchSetting[]
  /** 0..9 = Notch 1..10; steuert welches Preset beim Notch-Werkzeug verwendet wird (Standard: 0 = Notch 1). */
  activeNotchPresetIndex: number
  toastMessage: string | null
  /** ID der SeamAssignment für die das Anpassungs-Modal angezeigt wird */
  seamAdjustmentDialog: string | null
  /** Temporäres Hover-Highlight im Nahtanpassungsdialog (rein visuell, nicht persistent). */
  seamAdjustmentHoverPieceId: string | null
  /** Naht-Zuordnung → Fingerprint der zuletzt bestätigten/übersprungenen Abweichung (Session). */
  seamAdjustmentAcknowledged: Record<string, string>
  /** Nahtzuordnung: Eigenschaften (Nummer, Nahtart), Leertaste bei Hover */
  seamAssignmentMetaDialogId: string | null
  /** Maßstab: Referenzkante gewählt, Ziel-Länge eingeben. */
  massstabDialog: { pieceId: string; curveIndices: number[]; currentLengthMm: number } | null
  digitizeState: DigitizeState | null
  imageDigitizeSession: ImageDigitizeSession | null
  /** 10×10-cm-Winkel auf dem Foto: Punkte setzen bis 3, dann Maßstab anwenden. */
  imageScaleCalibration: ImageScaleCalibrationState | null
  /** Hintergrundbild ist ausgewählt (wie ein Teil). */
  workspaceImageSelected: boolean
  /** Konfigurator-Modale/Instanzen sind rein UI-Staat (noch nicht im Projekt persistiert). */
  configuratorModalOpen: boolean
  configuratorInstances: ConfiguratorInstance[]
  rockGeneratorModalOpen: boolean
  showScan3dModal: boolean

  setView: (v: Partial<ViewState>) => void
  addPiece: (piece?: Partial<PatternPiece>) => string
  updatePiece: (id: string, upd: Partial<PatternPiece>) => void
  deletePiece: (id: string) => void
  /** Erzeugt eine abhängige Kaschierung (Tochter) aus dem Mutterteil. */
  createFacingPiece: (parentId: string) => string | null
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
  setShowContourChangePreview: (v: boolean) => void
  setShowLiveBomCost: (v: boolean) => void
  setShowSeamPruefanzeigen: (v: boolean) => void
  setSidebarCollapsed: (v: boolean) => void
  setContourEditEnabled: (v: boolean) => void
  setRulerMode: (v: boolean) => void
  setRulerLine: (v: { start: Point; end: Point } | null) => void
  setPendingNahtzugabeClick: (v: boolean) => void
  setNahtzugabeDialogPieceId: (v: string | null) => void
  setPiecePropertiesDialogPieceId: (v: string | null) => void
  setEdgeSeamPickingActive: (v: boolean) => void
  setHorizontalLevelPickingActive: (v: boolean) => void
  setPieceSymmetryState: (v: PieceSymmetryUiState) => void
  setNahtzuordnungMode: (v: 'idle' | 'first' | 'second' | 'internal') => void
  setPendingNahtzuordnungFirst: (v: { pieceId: string; curveIndices: number[]; clickedCurve: number } | null) => void
  setShowSettingsModal: (v: boolean) => void
  setShowStuecklisteModal: (v: boolean) => void
  setShowMaterialCatalogModal: (v: boolean) => void
  setShowNestingModal: (v: boolean) => void
  setNestingSelectedMaterialKey: (key: string | null) => void
  setNestingInputQuantity: (pieceId: string, quantity: number) => void
  importNestingQuantitiesFromBom: () => void
  setNestingSpacingMm: (mm: number) => void
  setNestingMaxRollLengthMm: (mm: number | null) => void
  setNestingPlan: (plan: NestingPlan | null) => void
  setNestingStatus: (status: NestingWorkerStatus) => void
  setNestingError: (msg: string | null) => void
  setShowHelpModal: (v: boolean) => void
  setShowShortcutListModal: (v: boolean) => void
  setShowConfiguratorModal: (v: boolean) => void
  setShowRockGeneratorModal: (v: boolean) => void
  setShowScan3dModal: (v: boolean) => void
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
  setCanvasRotationUiScale: (v: number) => void
  setCanvasDigitizeUiScale: (v: number) => void
  setCanvasVertexPointUiScale: (v: number) => void
  setUiTextScale: (v: number) => void
  setShowPivotRotationUi: (v: boolean) => void
  setToastMessage: (v: string | null) => void
  updateNotchSetting: (index: number, upd: Partial<NotchSetting>) => void
  setActiveNotchPresetIndex: (index: number) => void
  addSeamAssignment: (pieceIdA: string, curveIndicesA: number[], clickedCurveA: number, pieceIdB: string, curveIndicesB: number[], clickedCurveB: number) => void
  /** Einzelnaht auf interner Linie (ein Teil, kein Partner). */
  addInternalSeamAssignment: (
    pieceId: string,
    curveIndices: number[],
    clickedCurve: number,
    tOnCurve: number
  ) => void
  removeSeamAssignment: (id: string) => void
  setSeamAdjustmentDialog: (v: string | null) => void
  setSeamAdjustmentHoverPieceId: (v: string | null) => void
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
  /** Merkt die aktuelle Nahtabweichung als bestätigt/übersprungen (kein erneuter Dialog bei gleicher Signatur). */
  acknowledgeSeamAdjustment: (assignmentId: string) => void
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
  /** Passt Geometrie an 5-mm-Profillänge an und speichert `targetLengthMm`. */
  fitProfileAssignmentGeometry: (assignmentId: string) => number | null
  /** Korrigiert Profil-Enden nach Geometrie-Bearbeitung (End-Notch/Ecke). */
  applyProfileLengthFitPreviews: (pieceId: string) => void

  /** Legacy-Name: fügt auf der Master-Kontur ein (bei Nahtzugabe faktisch seamLine). */
  addCurveToCutLine: (pieceId: string, curve: Curve) => void
  addInternalLine: (pieceId: string, curve: Curve) => void
  addInternalCircle: (pieceId: string, circle: Omit<InternalCircle, 'id'> & { id?: string }) => void
  updateInternalCircle: (
    pieceId: string,
    circleId: string,
    patch: Partial<Pick<InternalCircle, 'center' | 'radius' | 'mode'>>
  ) => void
  removeInternalCircle: (pieceId: string, circleId: string) => void
  addInternalLines: (pieceId: string, curves: Curve[]) => void
  removeInternalLine: (pieceId: string, curveIndex: number) => void
  /** Punkt auf internem Segment einfügen (Linie teilen oder Bézier an t); weiche Ecke an neuer Verbindung. */
  insertPointOnInternalLine: (pieceId: string, curveIndex: number, point: Point, t?: number) => boolean
  replaceInternalLineSegmentWithBezier: (pieceId: string, curveIndex: number, cp1: Point, cp2?: Point) => void
  moveInternalLinePointOnCurve: (pieceId: string, curveIndex: number, t: number, newPoint: Point) => void
  moveInternalLineVertex: (
    pieceId: string,
    target:
      | { kind: 'junction'; j: number }
      | { kind: 'terminal'; curveIndex: number; end: 'start' | 'end' },
    p: Point
  ) => void
  convertInternalLineBezierToLine: (pieceId: string, curveIndex: number) => void
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
    upd: Partial<
      Pick<
        Notch,
        | 'position'
        | 'angle'
        | 'type'
        | 'depth'
        | 'width'
        | 'sNormalized'
        | 'arcLengthMm'
        | 'role'
        | 'internalLineIndex'
        | 'internalSNormalized'
        | 'internalArcLengthMm'
      >
    >
  ) => void
  addDrill: (pieceId: string, drill: Drill) => void
  movePiece: (pieceId: string, dx: number, dy: number) => void
  setSelectedPoint: (v: Store['selectedPoint']) => void
  applyOffset: (pieceId: string, deltaMm: number) => void
  /** Naht trimmen (manuell): Modus starten → Ecke an Schnittkontur klicken. */
  startNahtTrimVertexPick: (mode?: NahtTrimMode) => void
  cancelNahtTrimVertexPick: () => void
  /** Führt Trim aus (nur bei aktivem Pick-Modus); `cutVertexIndex` = Index auf cutLine. */
  completeNahtTrimAtCutVertex: (pieceId: string, cutVertexIndex: number) => void
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
  /**
   * Rundet einen roten Eckpunkt der Master-Kontur (seamLine bei Naht, sonst cutLine) mit dem
   * angegebenen Radius. radiusMm <= 0 entfernt eine bestehende Rundung am Vertex.
   * Liefert true bei Erfolg, false bei Validierungsfehler (Toast wird gesetzt).
   */
  roundCorner: (pieceId: string, masterVertexIndex: number, radiusMm: number) => boolean
  convertBezierSegmentToLine: (pieceId: string, curveIndex: number) => void
  /** Eckpunkt weich (blau) / fest (rot); gleiche Index-Basis wie updateVertex/removeVertex. */
  setVertexSoft: (pieceId: string, vertexIndex: number, soft: boolean) => void
  flipPieceAlongGrain: (pieceId: string) => void
  flipPieceAlongAxis: (pieceId: string, axisA: Point, axisB: Point) => void
  /** Behält eine Halbebene, spiegelt sie auf die andere Seite (Master-Kontur wie bei Spiegeln entlang Fadenlauf). */
  applyPieceSymmetry: (pieceId: string, axisA: Point, axisB: Point, keepSide: PieceSymmetryKeepSide) => void
  /** Teil auf der Arbeitsfläche um 90° im Uhrzeigersinn drehen (um Teilmittelpunkt). */
  rotatePiece90: (pieceId: string) => void
  /** Rotation eines Teils setzen (Grad), Pivot bleibt fest. Für freie Drehung. */
  setPieceRotation: (pieceId: string, rotationDeg: number) => void
  /** Drehpunkt (Pivot) setzen oder zurücksetzen (null = Bounds-Mitte). */
  setPiecePivot: (pieceId: string, pivotLocal: Point | null) => void
  /** Laufrichtungslinie (Fadenlauf) setzen. */
  setGrainLine: (pieceId: string, line: Line) => void
  /** Einmalige Standard-Laufrichtung für Teile ohne gespeicherte `grainLine`. */
  materializeMissingGrainLines: () => void
  /** Teil so drehen, dass der Laufrichtungspfeil senkrecht ausgerichtet ist. */
  alignPieceToGrain: (pieceId: string) => void
  /**
   * Teil so drehen, dass die angegebene Master-Kante (nur gerade Linienkette) waagerecht liegt.
   * @returns true bei Erfolg
   */
  alignPieceEdgeHorizontal: (pieceId: string, edgeIndex: number) => boolean
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
  setImageScaleCalibration: (v: ImageScaleCalibrationState | null) => void
  beginImageScaleCalibration: () => void
  addImageScaleCalibrationPoint: (world: Point) => void
  applyImageScaleCalibration: () => void
  setImageRenderMmPerPixelXY: (mmPerPixelX: number, mmPerPixelY: number) => void

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

function mirrorPointAcrossAxis(p: Point, axisA: Point, axisB: Point): Point {
  const dx = axisB.x - axisA.x
  const dy = axisB.y - axisA.y
  const len2 = dx * dx + dy * dy
  if (len2 <= 1e-9) return { ...p }
  const apx = p.x - axisA.x
  const apy = p.y - axisA.y
  const t = (apx * dx + apy * dy) / len2
  const projX = axisA.x + t * dx
  const projY = axisA.y + t * dy
  return { x: 2 * projX - p.x, y: 2 * projY - p.y }
}

function mirrorCurveAcrossAxis(c: Curve, axisA: Point, axisB: Point): Curve {
  if (c.type === 'line') {
    return {
      type: 'line',
      start: mirrorPointAcrossAxis(c.start, axisA, axisB),
      end: mirrorPointAcrossAxis(c.end, axisA, axisB),
    }
  }
  return {
    type: 'bezier',
    start: mirrorPointAcrossAxis(c.start, axisA, axisB),
    end: mirrorPointAcrossAxis(c.end, axisA, axisB),
    cp1: mirrorPointAcrossAxis(c.cp1, axisA, axisB),
    cp2: mirrorPointAcrossAxis(c.cp2, axisA, axisB),
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

type StoreGet = () => Store

function applyProfileFitTargetInStore(get: StoreGet, pieceId: string, target: ProfileFitAdjustTarget): void {
  if (target.kind === 'endVertex') {
    get().updateVertex(pieceId, target.vertexIndex, target.position, false)
    const piece = get().workspace.pieces.find((p) => p.id === pieceId)
    if (piece && !useSeamLineForVertexEditing(piece)) {
      get().recomputeSeamLine(pieceId)
    }
    return
  }
  if (target.kind === 'endNotch') {
    get().updateNotch(pieceId, target.notchId, {
      position: target.position,
      angle: target.angle,
      ...(target.onInternalLine
        ? {
            internalLineIndex: target.internalLineIndex,
            internalSNormalized: target.internalSNormalized,
            sNormalized: undefined,
            arcLengthMm: undefined,
          }
        : {
            sNormalized: target.sNormalized,
            arcLengthMm: target.arcLengthMm,
            internalLineIndex: undefined,
            internalSNormalized: undefined,
          }),
    })
    return
  }
  get().moveInternalLineVertex(pieceId, {
    kind: 'terminal',
    curveIndex: target.curveIndex,
    end: target.end,
  }, target.position)
}

export const useStore = create<Store>()(
  temporal(
    (set, get) => ({
  workspace: {
    id: 'ws1',
    name: 'Arbeitsfläche 1',
    pieces: [],
    view: defaultView,
    seamAssignments: [],
    autoAdjustSeamAssignmentCorners: true,
    notes: [],
    profileAssignments: [],
  },
  selectedPieceIds: [],
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
  showContourChangePreview: false,
  showLiveBomCost: false,
  showSeamPruefanzeigen: true,
  sidebarCollapsed: false,
  contourEditEnabled: true,
  rulerMode: false,
  rulerLine: null,
  pendingNahtzugabeClick: false,
  nahtzugabeDialogPieceId: null,
  piecePropertiesDialogPieceId: null,
  edgeSeamPickingActive: false,
  horizontalLevelPickingActive: false,
  pieceSymmetryState: null,
  nahtzuordnungMode: 'idle',
  pendingNahtzuordnungFirst: null,
  nahtTrimPickCutVertexActive: false,
  nahtTrimMode: 'full',
  profileDialogAssignmentId: null,
  showSettingsModal: false,
  showStuecklisteModal: false,
  showMaterialCatalogModal: false,
  showNestingModal: false,
  nestingSelectedMaterialKey: null,
  nestingInputs: {},
  nestingSpacingMm: 4,
  nestingMaxRollLengthMm: null,
  nestingPlan: null,
  nestingStatus: 'idle',
  nestingError: null,
  showHelpModal: false,
  showShortcutListModal: false,
  dxfExportScale: 1,
  dxfImportExtraCutLayers: '',
  dxfImportScale: 1,
  dxfImportDetectVNotches: true,
  dxfImportCreateSeamLine: false,
  dxfImportSeamAllowanceMm: 8,
  canvasRotationUiScale: 1,
  canvasDigitizeUiScale: 1,
  canvasVertexPointUiScale: 1,
  uiTextScale: 1,
  showPivotRotationUi: true,
  toastMessage: null,
  seamAdjustmentDialog: null,
  seamAdjustmentHoverPieceId: null,
  seamAdjustmentAcknowledged: {},
  seamAssignmentMetaDialogId: null,
  massstabDialog: null,
  digitizeState: null,
  imageDigitizeSession: null,
  imageScaleCalibration: null,
  workspaceImageSelected: false,
  configuratorModalOpen: false,
  configuratorInstances: [],
  rockGeneratorModalOpen: false,
  showScan3dModal: false,
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
    const newPiece = withDefaultGrainLine(
      applySharpCornerPromotion({ ...createDefaultPiece(id, number), ...piece, id, number }),
    )
    set((s) => ({
      workspace: { ...s.workspace, pieces: [...s.workspace.pieces, newPiece] },
      selectedPieceIds: [id],
    }))
    return id
  },

  updatePiece: (id, upd) =>
    set((s) => {
      if (isFacingDerivedPiece(s.workspace.pieces.find((p) => p.id === id)) && updateTouchesFacingGeometry(upd)) {
        return { toastMessage: FACING_GEOMETRY_LOCKED_TOAST }
      }
      let toastMessage: string | null = null
      let didDeriveCutLineFromSeam = false
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
            next.cutLineDeviatesFromSeamAllowanceOffset = false
            next.notches = resyncNotchesAfterCutLineRebuilt(p.notches, oldCut, derived.cutLine)
            const mappedSoft = remapSoftVerticesToNewCutLine(oldCut, derived.cutLine, p.softVertices)
            next.softVertices = mappedSoft
            didDeriveCutLineFromSeam = true
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
            didDeriveCutLineFromSeam = true
            next.seamLine = seamLine
            next.cutLine = derived.cutLine
            next.cutLineDeviatesFromSeamAllowanceOffset = false
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
          // Nahtzugabe entfernt: wie removeSeamAllowance — seamLine wird wieder die alleinige Schnittkontur
          const oldCut = p.cutLine
          const newCut = next.seamLine.length >= 3 ? cloneCurvesArray(next.seamLine) : next.cutLine
          const notchesRm = resyncNotchesAfterCutLineRebuilt(p.notches, oldCut, newCut)
          const mergedCutRm = getEffectiveSoftVerticesCut(p)
          const softVerticesRm = remapSoftVerticesToNewCutLine(oldCut, newCut, mergedCutRm)
          next.cutLine = newCut
          next.seamLine = []
          next.seamAllowanceMm = null
          next.edgeSeamAllowances = undefined
          next.notches = notchesRm
          next.softVertices = softVerticesRm
          next.softVerticesMaster = []
          next.cutLineDeviatesFromSeamAllowanceOffset = false
          return applySharpCornerPromotion(next)
        }
        return applySharpCornerPromotion(next)
      })
      const seamAsg = s.workspace.seamAssignments ?? []
      const piecesAfterSeamTrim =
        didDeriveCutLineFromSeam && seamAsg.length > 0
          ? reapplySeamAssignmentCutTrimsForAllPieces(pieces, seamAsg, {
              enabled: s.workspace.autoAdjustSeamAssignmentCorners !== false,
            }).pieces
          : pieces
      return {
        workspace: { ...s.workspace, pieces: syncFacingPiecesFromParents(piecesAfterSeamTrim) },
        ...(toastMessage ? { toastMessage } : {}),
      }
    }),

  deletePiece: (id) =>
    set((s) => {
      const removeIds = new Set([id, ...facingChildIds(s.workspace.pieces, id)])
      return {
        workspace: {
          ...s.workspace,
          pieces: s.workspace.pieces.filter((p) => !removeIds.has(p.id)),
          notes: (s.workspace.notes ?? []).filter((n) => !removeIds.has(n.pieceId ?? '')),
          profileAssignments: (s.workspace.profileAssignments ?? []).filter(
            (pa) => !removeIds.has(pa.pieceId)
          ),
          seamAssignments: (s.workspace.seamAssignments ?? []).filter(
            (sa) => !removeIds.has(sa.pieceIdA) && !removeIds.has(sa.pieceIdB)
          ),
        },
        selectedPieceIds: s.selectedPieceIds.filter((x) => !removeIds.has(x)),
        piecePropertiesDialogPieceId:
          s.piecePropertiesDialogPieceId != null && removeIds.has(s.piecePropertiesDialogPieceId)
            ? null
            : s.piecePropertiesDialogPieceId,
        nahtzugabeDialogPieceId:
          s.nahtzugabeDialogPieceId != null && removeIds.has(s.nahtzugabeDialogPieceId)
            ? null
            : s.nahtzugabeDialogPieceId,
      }
    }),

  createFacingPiece: (parentId) => {
    const parent = get().workspace.pieces.find((p) => p.id === parentId)
    if (!parent) return null
    if (parent.facingParentId || parent.kind === 'facing') {
      set({ toastMessage: 'warn:Aus einer Kaschierung kann keine weitere Kaschierung erzeugt werden.' })
      return null
    }
    if (parent.cutLine.length < 3) {
      set({ toastMessage: 'warn:Teil hat keine gültige Kontur für eine Kaschierung.' })
      return null
    }
    const geom = buildFacingGeometryFromParent(parent)
    const offset = facingOffsetBesideParent(parent)
    const nameBase = parent.name?.trim() || `Teil ${parent.number}`
    const id = get().addPiece({
      ...geom,
      name: `${nameBase} Kaschierung`,
      facingParentId: parent.id,
      kind: 'facing',
      fillInterior: false,
      transform: {
        x: parent.transform.x + offset.x,
        y: parent.transform.y + offset.y,
        rotation: parent.transform.rotation,
        mirrored: parent.transform.mirrored,
        ...(parent.transform.pivotLocal
          ? { pivotLocal: { ...parent.transform.pivotLocal } }
          : {}),
      },
      symmetryConstraint: undefined,
    })
    return id
  },

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
      internalCircleIds: string[]
      curvePoints: number[]
    }
    const byPiece = new Map<string, G>()
    for (const t of filtered) {
      if (t.kind === 'piece') continue
      if (pieceIdsToDelete.has(t.pieceId)) continue
      if (!byPiece.has(t.pieceId)) {
        byPiece.set(t.pieceId, { vertices: [], notches: [], internalLines: [], internalCircleIds: [], curvePoints: [] })
      }
      const g = byPiece.get(t.pieceId)!
      if (t.kind === 'vertex') g.vertices.push(t.vertexIndex)
      else if (t.kind === 'notch') g.notches.push(t.notchId)
      else if (t.kind === 'internalLine') g.internalLines.push(t.curveIndex)
      else if (t.kind === 'internalCircle') g.internalCircleIds.push(t.circleId)
      else if (t.kind === 'curvePoint') g.curvePoints.push(t.curveIndex)
    }
    for (const [pieceId, g] of byPiece) {
      for (const cid of [...new Set(g.internalCircleIds)]) {
        get().removeInternalCircle(pieceId, cid)
      }
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
  setShowContourChangePreview: (v) => set({ showContourChangePreview: v }),
  setShowLiveBomCost: (v) => set({ showLiveBomCost: v }),
  setShowSeamPruefanzeigen: (v) => set({ showSeamPruefanzeigen: v }),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  setContourEditEnabled: (v) => set({ contourEditEnabled: v }),
  setRulerMode: (v) => set({ rulerMode: v }),
  setRulerLine: (v) => set({ rulerLine: v }),
  setPendingNahtzugabeClick: (v) => set({ pendingNahtzugabeClick: v }),
  setNahtzugabeDialogPieceId: (v) => set({ nahtzugabeDialogPieceId: v }),
  setPiecePropertiesDialogPieceId: (v) => set({ piecePropertiesDialogPieceId: v }),
  setEdgeSeamPickingActive: (v) => set({ edgeSeamPickingActive: v }),
  setHorizontalLevelPickingActive: (v) => set({ horizontalLevelPickingActive: v }),
  setPieceSymmetryState: (v) => set({ pieceSymmetryState: v }),
  setNahtzuordnungMode: (v) =>
    set({
      nahtzuordnungMode: v,
      pendingNahtzuordnungFirst: v === 'first' || v === 'internal' ? null : get().pendingNahtzuordnungFirst,
    }),
  setPendingNahtzuordnungFirst: (v) => set({ pendingNahtzuordnungFirst: v }),
  setShowSettingsModal: (v) => set({ showSettingsModal: v }),
  setShowStuecklisteModal: (v) => set({ showStuecklisteModal: v }),
  setShowMaterialCatalogModal: (v) => set({ showMaterialCatalogModal: v }),
  setShowNestingModal: (v) => set({ showNestingModal: v }),
  setNestingSelectedMaterialKey: (key) => set({ nestingSelectedMaterialKey: key, nestingPlan: null, nestingStatus: 'idle', nestingError: null }),
  setNestingInputQuantity: (pieceId, quantity) =>
    set((s) => ({
      nestingInputs: { ...s.nestingInputs, [pieceId]: Math.max(0, Math.floor(quantity) || 0) },
    })),
  importNestingQuantitiesFromBom: () =>
    set((s) => {
      const key = s.nestingSelectedMaterialKey
      if (!key) return s
      const next = { ...s.nestingInputs }
      for (const p of piecesForMaterial(s.workspace.pieces, key)) {
        next[p.id] = Math.max(1, Math.floor(Number(p.bomQuantity)) || 1)
      }
      return { nestingInputs: next }
    }),
  setNestingSpacingMm: (mm) => set({ nestingSpacingMm: Math.max(0, mm) }),
  setNestingMaxRollLengthMm: (mm) => set({ nestingMaxRollLengthMm: mm }),
  setNestingPlan: (plan) => set({ nestingPlan: plan }),
  setNestingStatus: (status) => set({ nestingStatus: status }),
  setNestingError: (msg) => set({ nestingError: msg }),
  setShowHelpModal: (v) => set({ showHelpModal: v }),
  setShowShortcutListModal: (v) => set({ showShortcutListModal: v }),
  setShowConfiguratorModal: (v) => set({ configuratorModalOpen: v }),
  setShowRockGeneratorModal: (v) => set({ rockGeneratorModalOpen: v }),
  setShowScan3dModal: (v) => set({ showScan3dModal: v }),

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
      internalCircles: [],
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
  setCanvasRotationUiScale: (v) => set({ canvasRotationUiScale: clampCanvasOverlayScale(v) }),
  setCanvasDigitizeUiScale: (v) => set({ canvasDigitizeUiScale: clampCanvasOverlayScale(v) }),
  setCanvasVertexPointUiScale: (v) => set({ canvasVertexPointUiScale: clampCanvasOverlayScale(v) }),
  setUiTextScale: (v) => set({ uiTextScale: clampUiTextScale(v) }),
  setShowPivotRotationUi: (v) => set({ showPivotRotationUi: v }),
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
    const notchRangeA = pieceA0 != null ? deriveNotchRoleRangeOnEdge(pieceA0, normA) ?? undefined : undefined
    const notchRangeB = pieceB0 != null ? deriveNotchRoleRangeOnEdge(pieceB0, normB) ?? undefined : undefined
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
            notchRangeA,
            notchRangeB,
          },
        ],
      },
      nahtzuordnungMode: 'idle',
      pendingNahtzuordnungFirst: null,
    }))
    const after = get()
    const seamAsg = after.workspace.seamAssignments ?? []
    const { pieces: trimmedPieces, changed: seamTrimChanged } = reapplySeamAssignmentCutTrimsForAllPieces(
      after.workspace.pieces,
      seamAsg,
      { enabled: after.workspace.autoAdjustSeamAssignmentCorners !== false }
    )
    if (seamTrimChanged) {
      set((st) => ({
        workspace: {
          ...st.workspace,
          pieces: trimmedPieces,
        },
        toastMessage:
          'success:Naht-Ecken: Überstehende Miter-Spitzen an der Schnittkontur zur Zuordnung angeglichen (Nahtlinie und parallele Nahtzugabe unverändert).',
      }))
    }
    // Direkt nach dem Zuordnen denselben zentralen Check wie nach Drag-Ende ausführen,
    // damit der Dialog für Notch-Abstandsangleich sofort erscheint.
    get().checkSeamAdjustment()
  },

  addInternalSeamAssignment: (pieceId, curveIndices, clickedCurve, tOnCurve) => {
    const newId = generateId()
    const piece = get().workspace.pieces.find((p) => p.id === pieceId)
    if (!piece || piece.internalLines.length === 0) {
      set({ toastMessage: 'error:Keine internen Linien am Teil – zuerst interne Linie anlegen.' })
      return
    }
    const ci =
      clickedCurve >= 0 && clickedCurve < piece.internalLines.length
        ? clickedCurve
        : curveIndices[0] ?? 0
    const notchRange = deriveInternalSeamNotchRangeAtClick(piece, ci, tOnCurve)
    const notchRangeA =
      notchRange?.startNotchId && notchRange?.endNotchId
        ? { startNotchId: notchRange.startNotchId, endNotchId: notchRange.endNotchId }
        : undefined
    set((s) => ({
      workspace: {
        ...s.workspace,
        seamAssignments: [
          ...s.workspace.seamAssignments,
          {
            id: newId,
            pieceIdA: pieceId,
            curveIndicesA: [ci],
            clickedCurveA: ci,
            pieceIdB: pieceId,
            curveIndicesB: [],
            clickedCurveB: 0,
            isInternalSingle: true,
            ...(notchRangeA ? { notchRangeA } : {}),
          },
        ],
      },
      nahtzuordnungMode: 'idle',
      pendingNahtzuordnungFirst: null,
    }))
  },

  removeSeamAssignment: (id) =>
    set((s) => {
      const { [id]: _removed, ...restAck } = s.seamAdjustmentAcknowledged
      return {
        workspace: {
          ...s.workspace,
          seamAssignments: s.workspace.seamAssignments.filter((a) => a.id !== id),
        },
        seamAdjustmentAcknowledged: restAck,
      }
    }),

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

  fitProfileAssignmentGeometry: (assignmentId) => {
    const s = get()
    const pa = (s.workspace.profileAssignments ?? []).find((a) => a.id === assignmentId)
    if (!pa) return null
    const piece = s.workspace.pieces.find((p) => p.id === pa.pieceId)
    if (!piece) return null
    const rawLen = profileAssignmentLengthMm(piece, pa)
    const targetLengthMm = snapProfileLengthMm(rawLen)
    const adjust = computeProfileFitAdjustTarget(piece, pa, targetLengthMm)
    if (adjust) {
      applyProfileFitTargetInStore(get, pa.pieceId, adjust)
    }
    get().updateProfileAssignment(assignmentId, { targetLengthMm })
    return targetLengthMm
  },

  applyProfileLengthFitPreviews: (pieceId) => {
    const s = get()
    const piece = s.workspace.pieces.find((p) => p.id === pieceId)
    if (!piece) return
    const previews = computeProfileFitPreviewsForPiece(piece, s.workspace.profileAssignments ?? [])
    if (previews.length === 0) return
    for (const preview of previews) {
      applyProfileFitTargetInStore(get, pieceId, preview.adjust)
    }
  },

  setSeamAdjustmentDialog: (v) => {
    const s = get()
    if (v === null && s.seamAdjustmentDialog) {
      get().acknowledgeSeamAdjustment(s.seamAdjustmentDialog)
    }
    set({ seamAdjustmentDialog: v, seamAdjustmentHoverPieceId: null })
  },
  setSeamAdjustmentHoverPieceId: (v) => set({ seamAdjustmentHoverPieceId: v }),
  acknowledgeSeamAdjustment: (assignmentId) => {
    const s = get()
    const a = s.workspace.seamAssignments.find((x) => x.id === assignmentId)
    if (!a) return
    const pieceA = s.workspace.pieces.find((p) => p.id === a.pieceIdA)
    const pieceB = s.workspace.pieces.find((p) => p.id === a.pieceIdB)
    if (!pieceA || !pieceB) return
    const fp = seamAdjustmentFingerprint(a, pieceA, pieceB)
    set({
      seamAdjustmentAcknowledged: { ...s.seamAdjustmentAcknowledged, [assignmentId]: fp },
    })
  },
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
    const nextKind = patch.seamKind !== undefined ? patch.seamKind : current.seamKind ?? null
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
    const refRange = keepSide === 'A' ? a.notchRangeA : a.notchRangeB
    const tgtRange = keepSide === 'A' ? a.notchRangeB : a.notchRangeA

    const refNotchCount = getNotchesOnEdgeInRange(refPiece, refIndices, refRange).length
    const tgtNotchCount = getNotchesOnEdgeInRange(tgtPiece, tgtIndices, tgtRange).length
    if (refNotchCount !== tgtNotchCount || refNotchCount === 0) {
      set({ seamAdjustmentDialog: null, seamAdjustmentHoverPieceId: null })
      return
    }

    const refSubs = getSubSegments(refPiece, refIndices, undefined, refRange)
    const tgtSubs = getSubSegments(tgtPiece, tgtIndices, undefined, tgtRange)
    const pairing = bestSeamSubSegmentPairing(refSubs, tgtSubs)
    if (!pairing) {
      set({ seamAdjustmentDialog: null, seamAdjustmentHoverPieceId: null })
      return
    }

    const tgtTotalLen = edgeLengthInNotchRange(tgtPiece, tgtIndices, tgtRange)
    if (tgtIndices.length === 0 || tgtTotalLen <= 0) {
      set({ seamAdjustmentDialog: null, seamAdjustmentHoverPieceId: null })
      return
    }

    // Gleiche Orientierung wie evaluateSeamAdjustment (Längenpaarung), nicht Welt-Endpunkt-Abstand.
    const reverseOrientation = pairing.reverseB

    const allTgtNotches = getNotchesOnEdge(tgtPiece, tgtIndices)
    const tgtRangeStartArc = tgtRange
      ? allTgtNotches.find((n) => n.notchId === tgtRange.startNotchId)?.arcLength
      : undefined
    const tgtRangeEndArc = tgtRange
      ? allTgtNotches.find((n) => n.notchId === tgtRange.endNotchId)?.arcLength
      : undefined
    const rangeOrigin =
      tgtRangeStartArc != null &&
      tgtRangeEndArc != null &&
      tgtRangeEndArc > tgtRangeStartArc + 1e-9
        ? tgtRangeStartArc
        : 0

    const refNotches = getNotchesOnEdgeInRange(refPiece, refIndices, refRange)
    const tgtNotches = getNotchesOnEdgeInRange(tgtPiece, tgtIndices, tgtRange)
    if (refNotches.length === 0 || tgtNotches.length !== refNotches.length) {
      set({ seamAdjustmentDialog: null, seamAdjustmentHoverPieceId: null })
      return
    }
    const relativeTargets = buildNotchTargetArcPositionsFromSubLengths(
      refSubs.map((s) => s.length),
      tgtTotalLen,
      reverseOrientation,
    )
    if (!relativeTargets || relativeTargets.length !== tgtNotches.length) {
      set({ seamAdjustmentDialog: null, seamAdjustmentHoverPieceId: null })
      return
    }
    const targetArcPositions = relativeTargets.map((p) => p + rangeOrigin)

    const needsMove = tgtNotches.some(
      (n, i) => Math.abs(n.arcLength - targetArcPositions[i]) > SEAM_ADJUSTMENT_NOTCH_ALIGNED_EPS_MM
    )
    if (!needsMove) {
      get().acknowledgeSeamAdjustment(assignmentId)
      set({ seamAdjustmentDialog: null, seamAdjustmentHoverPieceId: null })
      return
    }

    const targetNotches: { notchId: string; notch: Notch }[] = []
    for (let i = 0; i < tgtNotches.length; i++) {
      const notchId = tgtNotches[i].notchId
      const n0 = tgtPiece.notches.find((nn) => nn.id === notchId)
      if (!n0 || i >= targetArcPositions.length) continue
      const materialized = materializeNotchAtEdgeArcLengthExact(
        {
          ...n0,
          vertexIndex: undefined,
          sNormalized: undefined,
          arcLengthMm: undefined,
        },
        tgtPiece,
        tgtIndices,
        targetArcPositions[i],
        SEAM_ADJUSTMENT_NOTCH_ALIGNED_EPS_MM,
      )
      if (!materialized) continue
      targetNotches.push({ notchId, notch: materialized })
    }
    if (targetNotches.length === 0) { set({ seamAdjustmentDialog: null, seamAdjustmentHoverPieceId: null }); return }

    const targetMap = new Map(targetNotches.map((tp) => [tp.notchId, tp.notch]))

    set((st) => {
      const piece = st.workspace.pieces.find((p) => p.id === tgtPieceId)
      if (!piece) return { seamAdjustmentDialog: null, seamAdjustmentHoverPieceId: null }
      const notches = piece.notches.map((n) => {
        const tp = targetMap.get(n.id)
        if (!tp) return n
        return tp
      })
      return {
        seamAdjustmentDialog: null,
        seamAdjustmentHoverPieceId: null,
        workspace: {
          ...st.workspace,
          pieces: st.workspace.pieces.map((p) =>
            p.id === tgtPieceId ? { ...p, notches } : p
          ),
        },
      }
    })
    // Fingerprint der *neuen* Geometrie merken — sonst öffnet sich der Dialog bei Restabweichung sofort wieder.
    get().acknowledgeSeamAdjustment(assignmentId)
  },

  checkSeamAdjustment: () => {
    const s = get()
    if (s.seamAdjustmentDialog) return
    for (const a of s.workspace.seamAssignments) {
      const pieceA = s.workspace.pieces.find((p) => p.id === a.pieceIdA)
      const pieceB = s.workspace.pieces.find((p) => p.id === a.pieceIdB)
      if (!pieceA || !pieceB) continue
      const ev = evaluateSeamAdjustment(a, pieceA, pieceB)
      if (!ev?.needsDialog) continue
      if (s.seamAdjustmentAcknowledged[a.id] === ev.fingerprint) continue
      set({ seamAdjustmentDialog: a.id })
      return
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
      if (isInternalSeamAssignment(a)) continue
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
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      return {
      workspace: {
        ...s.workspace,
        pieces: syncFacingPiecesFromParents(
          s.workspace.pieces.map((p) =>
            p.id === pieceId ? { ...p, internalLines: [...p.internalLines, curve] } : p
          )
        ),
      },
    }
    }),

  addInternalLines: (pieceId, curves) =>
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      return {
      workspace: {
        ...s.workspace,
        pieces: syncFacingPiecesFromParents(
          s.workspace.pieces.map((p) =>
            p.id === pieceId ? { ...p, internalLines: [...p.internalLines, ...curves] } : p
          )
        ),
      },
    }
    }),

  addInternalCircle: (pieceId, circle) =>
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      return {
      workspace: {
        ...s.workspace,
        pieces: syncFacingPiecesFromParents(
          s.workspace.pieces.map((p) => {
            if (p.id !== pieceId) return p
            const id = circle.id ?? 'ic' + Math.random().toString(36).slice(2, 10)
            const next: InternalCircle = {
              id,
              center: { ...circle.center },
              radius: circle.radius,
              ...(circle.mode === 'hole' ? { mode: 'hole' as const } : {}),
            }
            return { ...p, internalCircles: [...p.internalCircles, next] }
          })
        ),
      },
    }
    }),

  updateInternalCircle: (pieceId, circleId, patch) =>
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      return {
      workspace: {
        ...s.workspace,
        pieces: syncFacingPiecesFromParents(
          s.workspace.pieces.map((p) => {
            if (p.id !== pieceId) return p
            return {
              ...p,
              internalCircles: p.internalCircles.map((c) =>
                c.id !== circleId
                  ? c
                  : {
                      ...c,
                      ...(patch.radius !== undefined ? { radius: patch.radius } : {}),
                      ...(patch.center !== undefined ? { center: { ...patch.center } } : {}),
                      ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
                    }
              ),
            }
          })
        ),
      },
    }
    }),

  removeInternalCircle: (pieceId, circleId) =>
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      return {
      workspace: {
        ...s.workspace,
        pieces: syncFacingPiecesFromParents(
          s.workspace.pieces.map((p) =>
            p.id !== pieceId ? p : { ...p, internalCircles: p.internalCircles.filter((c) => c.id !== circleId) }
          )
        ),
      },
    }
    }),

  removeInternalLine: (pieceId, curveIndex) =>
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      return {
      workspace: {
        ...s.workspace,
        pieces: syncFacingPiecesFromParents(
          s.workspace.pieces.map((p) => {
            if (p.id !== pieceId || curveIndex < 0 || curveIndex >= p.internalLines.length) return p
            const internalLines = p.internalLines.filter((_, i) => i !== curveIndex)
            const internalLineSoftJunctions = remapSoftJunctionsAfterRemoveCurve(
              p.internalLineSoftJunctions,
              curveIndex,
              internalLines.length
            )
            const notches = remapNotchesAfterInternalLineRemove(p.notches, curveIndex)
            return { ...p, internalLines, internalLineSoftJunctions, notches }
          })
        ),
        profileAssignments: remapProfileAssignmentsAfterInternalLineRemove(
          s.workspace.profileAssignments ?? [],
          pieceId,
          curveIndex
        ),
        seamAssignments: remapInternalSeamAssignmentsAfterInternalLineRemove(
          s.workspace.seamAssignments,
          pieceId,
          curveIndex
        ),
      },
    }
    }),

  insertPointOnInternalLine: (pieceId, curveIndex, point, t) => {
    let inserted = false
    set((s) => {
      const LINE_SPLIT_MIN_MM = 0.5
      const pieces = s.workspace.pieces.map((p) => {
        if (p.id !== pieceId) return p
        const master = p.internalLines
        if (curveIndex < 0 || curveIndex >= master.length) return p
        const curve = master[curveIndex]
        let newLines: Curve[] | null = null
        if (curve.type === 'line') {
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
          newLines = [...master]
          newLines.splice(curveIndex, 1, seg1, seg2)
        } else if (curve.type === 'bezier' && t != null && t > 0 && t < 1) {
          const [seg1, seg2] = splitBezierAt(curve, t)
          newLines = [...master]
          newLines.splice(curveIndex, 1, seg1, seg2)
        }
        if (!newLines) return p
        inserted = true
        const internalLineSoftJunctions = remapSoftJunctionsAfterSplitCurve(
          p.internalLineSoftJunctions,
          curveIndex,
          newLines.length
        )
        const notches = remapNotchesAfterInternalLineSplit(p.notches, curveIndex, newLines)
        return { ...p, internalLines: newLines, internalLineSoftJunctions, notches }
      })
      return { workspace: { ...s.workspace, pieces: syncFacingPiecesFromParents(pieces) } }
    })
    return inserted
  },

  replaceInternalLineSegmentWithBezier: (pieceId, curveIndex, cp1, cp2) =>
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      return {
      workspace: {
        ...s.workspace,
        pieces: syncFacingPiecesFromParents(
          s.workspace.pieces.map((p) => {
            if (p.id !== pieceId) return p
            if (curveIndex < 0 || curveIndex >= p.internalLines.length) return p
            const c = p.internalLines[curveIndex]
            if (c.type !== 'line') return p
            const bezier: Curve = {
              type: 'bezier',
              start: { ...c.start },
              end: { ...c.end },
              cp1: { ...cp1 },
              cp2: { ...(cp2 ?? cp1) },
            }
            const next = [...p.internalLines]
            next[curveIndex] = bezier
            return { ...p, internalLines: next }
          })
        ),
      },
    }
    }),

  moveInternalLinePointOnCurve: (pieceId, curveIndex, t, newPoint) =>
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      return {
      workspace: {
        ...s.workspace,
        pieces: syncFacingPiecesFromParents(
          s.workspace.pieces.map((p) => {
            if (p.id !== pieceId) return p
            const il = p.internalLines
            if (curveIndex < 0 || curveIndex >= il.length) return p
            const c = il[curveIndex]
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
            const next = [...il]
            next[curveIndex] = bezier
            return { ...p, internalLines: next }
          })
        ),
      },
    }
    }),

  moveInternalLineVertex: (pieceId, target, p) =>
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      return {
      workspace: {
        ...s.workspace,
        pieces: syncFacingPiecesFromParents(
          s.workspace.pieces.map((piece) => {
            if (piece.id !== pieceId) return piece
            const lines = piece.internalLines.map((c) =>
              c.type === 'line'
                ? { type: 'line' as const, start: { ...c.start }, end: { ...c.end } }
                : {
                    type: 'bezier' as const,
                    start: { ...c.start },
                    end: { ...c.end },
                    cp1: { ...c.cp1 },
                    cp2: { ...c.cp2 },
                  }
            )
            if (target.kind === 'junction') {
              const j = target.j
              if (j < 1 || j >= lines.length) return piece
              const prev = lines[j - 1]
              const cur = lines[j]
              if (!internalLineEndpointsTouch(prev.end, cur.start)) return piece
              lines[j - 1] = { ...prev, end: { ...p } } as Curve
              lines[j] = { ...cur, start: { ...p } } as Curve
            } else {
              const { curveIndex, end } = target
              if (curveIndex < 0 || curveIndex >= lines.length) return piece
              const c = lines[curveIndex]
              lines[curveIndex] = (end === 'start' ? { ...c, start: { ...p } } : { ...c, end: { ...p } }) as Curve
            }
            return { ...piece, internalLines: lines }
          })
        ),
      },
    }
    }),

  convertInternalLineBezierToLine: (pieceId, curveIndex) =>
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      return {
      workspace: {
        ...s.workspace,
        pieces: syncFacingPiecesFromParents(
          s.workspace.pieces.map((p) => {
            if (p.id !== pieceId) return p
            if (curveIndex < 0 || curveIndex >= p.internalLines.length) return p
            const c = p.internalLines[curveIndex]
            if (c.type !== 'bezier') return p
            const lineSeg: Curve = { type: 'line', start: { ...c.start }, end: { ...c.end } }
            const next = [...p.internalLines]
            next[curveIndex] = lineSeg
            return { ...p, internalLines: next }
          })
        ),
      },
    }
    }),

  updateCurvePoint: (pieceId, curveIndex, pointKey, p) =>
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      let toastMessage: string | null = null
      let manualSeamTrimReset = false
      let didDeriveCutLineFromSeam = false
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
          if (piece.cutLineDeviatesFromSeamAllowanceOffset === true) {
            manualSeamTrimReset = true
          }
          const derived = deriveCutLineForPiece(
            { ...piece, cutLineDeviatesFromSeamAllowanceOffset: false },
            seamLine,
            piece.seamAllowanceMm
          )
          if (!derived.ok) {
            toastMessage = `warn:${derived.message}`
            return piece
          }
          didDeriveCutLineFromSeam = true
          const cutLine = derived.cutLine
          const notches = resyncNotchesAfterCutLineRebuilt(piece.notches, piece.cutLine, cutLine)
          const softVertices = remapSoftVerticesToNewCutLine(piece.cutLine, cutLine, piece.softVertices)
          return applySharpCornerPromotion({
            ...piece,
            cutLine,
            seamLine,
            notches,
            softVertices,
            cutLineDeviatesFromSeamAllowanceOffset: false,
          })
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
      const seamAsg = s.workspace.seamAssignments ?? []
      const piecesAfterSeamTrim =
        didDeriveCutLineFromSeam && seamAsg.length > 0
          ? reapplySeamAssignmentCutTrimsForAllPieces(pieces, seamAsg, {
              enabled: s.workspace.autoAdjustSeamAssignmentCorners !== false,
            }).pieces
          : pieces
      const mergedCurvePointToast = mergeWarnToasts(
        toastMessage,
        manualSeamTrimReset ? TOAST_MANUAL_SEAM_TRIM_RESET_PARALLEL : null
      )
      return {
        workspace: { ...s.workspace, pieces: syncFacingPiecesFromParents(piecesAfterSeamTrim) },
        ...(mergedCurvePointToast ? { toastMessage: mergedCurvePointToast } : {}),
      }
    }),

  addNotch: (pieceId, notch) =>
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      const piece = s.workspace.pieces.find((p) => p.id === pieceId)
      if (!piece) return s
      const toAdd = isNotchOnInternalLine(notch)
        ? materializeNotchAnchorsOnInternalLine(notch, piece.internalLines) ?? notch
        : materializeNotchAnchorsOnCutLine(notch, piece.cutLine) ?? notch
      if (!isNotchSpacingValidForCandidate(piece, toAdd)) {
        return {
          ...s,
          toastMessage: isNotchOnInternalLine(toAdd)
            ? 'error: Zwischen zwei Kerben auf internen Linien müssen mindestens 4 mm Abstand liegen.'
            : 'error: Zwischen zwei Kerben müssen mindestens 4 mm Abstand liegen (entlang der Schnittkontur).',
        }
      }
      if (piece.symmetryConstraint && !isNotchOnInternalLine(toAdd)) {
        const mirroredOnly = appendSymmetricMirroredNotches(piece, toAdd)
        if (mirroredOnly.length > piece.notches.length + 1) {
          const mirrored = mirroredOnly[mirroredOnly.length - 1]!
          if (!isNotchSpacingValidForCandidate({ ...piece, notches: [...piece.notches, toAdd] }, mirrored)) {
            return {
              ...s,
              toastMessage:
                'error: Zwischen zwei Kerben müssen mindestens 4 mm Abstand liegen (entlang der Schnittkontur).',
            }
          }
        }
      }
      return {
        workspace: {
          ...s.workspace,
          pieces: syncFacingPiecesFromParents(
            s.workspace.pieces.map((p) => {
              if (p.id !== pieceId) return p
              const candidates = appendSymmetricMirroredNotches(p, toAdd)
              return { ...p, notches: candidates }
            })
          ),
        },
      }
    }),

  removeNotch: (pieceId, notchId) =>
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      return {
      workspace: {
        ...s.workspace,
        pieces: syncFacingPiecesFromParents(
          s.workspace.pieces.map((p) =>
            p.id === pieceId ? { ...p, notches: p.notches.filter((n) => n.id !== notchId) } : p
          )
        ),
      },
    }
    }),

  /** No-op: Notches no longer have vertex anchors. Kept for API compatibility. */
  removeNotchAnchor: (_pieceId, _notchId) =>
    set((s) => s),

  /** No-op: Notches are always free now (no vertex anchors). Kept for API compatibility. */
  toggleNotchAnchor: (_pieceId, _notchId) =>
    set((s) => s),

  updateNotch: (pieceId, notchId, upd) =>
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      const piece = s.workspace.pieces.find((p) => p.id === pieceId)
      const notch = piece?.notches.find((n) => n.id === notchId)
      if (Object.prototype.hasOwnProperty.call(upd, 'role') && upd.role !== undefined && !isValidNotchRole(upd.role)) {
        return {
          ...s,
          toastMessage: 'error: Ungültige Kerben-Rolle (erlaubt: nahtanfang, nahtende, beides).',
        }
      }
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
            toastMessage: isNotchOnInternalLine(candidate)
              ? 'error: Zwischen zwei Kerben auf internen Linien müssen mindestens 4 mm Abstand liegen.'
              : 'error: Zwischen zwei Kerben müssen mindestens 4 mm Abstand liegen (entlang der Schnittkontur).',
          }
        }
      }
      /** Neue Punktlage (z. B. Drag): ohne explizite Anker-Skalare sonst Vorrang von sNormalized/arcLengthMm. */
      const clearCutPathAnchorsForNewPosition =
        isPositionUpdate &&
        !Object.prototype.hasOwnProperty.call(upd, 'sNormalized') &&
        !Object.prototype.hasOwnProperty.call(upd, 'arcLengthMm')
      const clearInternalPathAnchorsForNewPosition =
        isPositionUpdate &&
        !Object.prototype.hasOwnProperty.call(upd, 'internalSNormalized') &&
        !Object.prototype.hasOwnProperty.call(upd, 'internalArcLengthMm')
      return {
        workspace: {
          ...s.workspace,
          pieces: syncFacingPiecesFromParents(
            s.workspace.pieces.map((p) => {
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
                    ...(clearInternalPathAnchorsForNewPosition
                      ? { internalSNormalized: undefined, internalArcLengthMm: undefined }
                      : {}),
                  }
                  if (isNotchOnInternalLine(merged)) {
                    return materializeNotchAnchorsOnInternalLine(merged, p.internalLines) ?? merged
                  }
                  return materializeNotchAnchorsOnCutLine(merged, p.cutLine) ?? merged
                }),
              }
            })
          ),
        },
      }
    }),

  addDrill: (pieceId, drill) =>
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      return {
      workspace: {
        ...s.workspace,
        pieces: syncFacingPiecesFromParents(
          s.workspace.pieces.map((p) =>
            p.id === pieceId ? { ...p, drills: [...p.drills, drill] } : p
          )
        ),
      },
    }
    }),

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
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      let toastMessage: string | null = null
      const pieces = s.workspace.pieces.map((p) => {
        if (p.id !== pieceId || p.cutLine.length < 3) return p
        const oldCut = p.cutLine
        const sourceInner = p.seamLine.length >= 3 ? p.seamLine : p.cutLine
        const migratingFromCutMaster = !(p.seamLine.length >= 3 && p.seamAllowanceMm != null)
        const seamLine = cloneCurvesArray(sourceInner)
        const pieceForDerive: PatternPiece = { ...p, seamAllowanceMm: deltaMm }
        const derived = deriveCutLineForPiece(pieceForDerive, seamLine, deltaMm)
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
            ...pieceForDerive,
            cutLine,
            seamLine,
            notches,
            softVertices: [],
            softVerticesMaster: migratedSoftMaster,
            cutLineDeviatesFromSeamAllowanceOffset: false,
          }
          const preserveCut = migratedSoftMaster
            .map((mvi) => mapMasterVertexIndexToCutVertexIndex(nextPiece, mvi))
            .filter((x): x is number => x != null)
          return forceCutVerticesSoftAfterPromotion(nextPiece, preserveCut)
        }
        return forceCutVerticesSoftAfterPromotion(
          {
            ...pieceForDerive,
            cutLine,
            seamLine,
            notches,
            softVertices: mappedSoft,
            cutLineDeviatesFromSeamAllowanceOffset: false,
          },
          mappedSoft
        )
      })
      return {
        workspace: { ...s.workspace, pieces: syncFacingPiecesFromParents(pieces) },
        ...(toastMessage ? { toastMessage } : {}),
      }
    }),

  startNahtTrimVertexPick: (mode = 'full') =>
    set((s) => {
      if (s.selectedPieceIds.length === 0) {
        return { toastMessage: 'error:Bitte zuerst ein Zielteil auswählen.' }
      }
      const targetId = s.selectedPieceIds[0]
      const target = s.workspace.pieces.find((p) => p.id === targetId)
      if (!target || target.cutLine.length < 3) {
        return { toastMessage: 'error:Zielteil hat keine gültige Schnittkontur.' }
      }
      const seamMasterHint =
        useSeamLineForVertexEditing(target) && target.seamLine.length >= 3
          ? mode === '45'
            ? 'Eckpunkt auf der Nahtlinie anklicken (Außenkontur wird dort als 45°-Fase beschnitten)'
            : 'Eckpunkt auf der Nahtlinie anklicken (Außenkontur wird bis zur Nahtlinie beschnitten)'
          : 'Ecke an der Schnittkontur anklicken, die beschnitten werden soll'
      return {
        nahtTrimPickCutVertexActive: true,
        nahtTrimMode: mode,
        toastMessage: `info:${seamMasterHint} (Zielteil). Abbrechen: Hinweis-Leiste oder Escape.`,
      }
    }),

  cancelNahtTrimVertexPick: () => set({ nahtTrimPickCutVertexActive: false }),

  completeNahtTrimAtCutVertex: (pieceId, cutVertexIndex) =>
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      if (!s.nahtTrimPickCutVertexActive) return {}
      const targetId = s.selectedPieceIds[0]
      if (!targetId || pieceId !== targetId) {
        return { toastMessage: 'warn:Bitte eine Ecke am ausgewählten Zielteil (erste Auswahl) anklicken.' }
      }
      const target = s.workspace.pieces.find((p) => p.id === targetId)
      if (!target || target.cutLine.length < 3) {
        return { nahtTrimPickCutVertexActive: false, toastMessage: 'error:Zielteil ungültig.' }
      }
      if (cutVertexIndex < 0 || cutVertexIndex >= target.cutLine.length) {
        return { toastMessage: 'warn:Ungültige Ecke.' }
      }
      if ((target.notches ?? []).some((n) => n.vertexIndex === cutVertexIndex)) {
        return {
          toastMessage: 'warn:Kerbe auf diesem Eckpunkt – bitte zuerst Kerbe löschen oder verschieben.',
        }
      }
      const trimMode = s.nahtTrimMode
      const seamMaster = target.seamAllowanceMm != null && target.seamLine.length >= 3
      if (seamMaster) {
        const cutVertices = target.cutLine.map((c) => ({ ...c.start }))
        const n = cutVertices.length
        if (cutVertexIndex < 0 || cutVertexIndex >= n) {
          return { toastMessage: 'warn:Ungültige Ecke.' }
        }
        const corner = cutVertices[cutVertexIndex]
        const seamVertices = target.seamLine.map((c) => c.start)
        let seamCorner = seamVertices[0]
        let best = Infinity
        for (const p of seamVertices) {
          const d = Math.hypot(p.x - corner.x, p.y - corner.y)
          if (d < best) {
            best = d
            seamCorner = p
          }
        }
        let nextVertices = cutVertices
        if (trimMode === '45') {
          const prevIdx = (cutVertexIndex - 1 + n) % n
          const nextIdx = (cutVertexIndex + 1) % n
          const prev = cutVertices[prevIdx]
          const next = cutVertices[nextIdx]
          const distToSeam = Math.hypot(seamCorner.x - corner.x, seamCorner.y - corner.y)
          if (!Number.isFinite(distToSeam) || distToSeam <= 1e-6) {
            return { toastMessage: 'warn:Für diese Ecke konnte keine 45°-Fase zur Nahtlinie abgeleitet werden.' }
          }
          const lenPrev = Math.hypot(prev.x - corner.x, prev.y - corner.y)
          const lenNext = Math.hypot(next.x - corner.x, next.y - corner.y)
          if (lenPrev <= 1e-6 || lenNext <= 1e-6) {
            return { toastMessage: 'warn:Gewählte Ecke ist geometrisch zu kurz für eine 45°-Fase.' }
          }
          const tPrev = Math.max(0.02, Math.min(0.49, distToSeam / lenPrev))
          const tNext = Math.max(0.02, Math.min(0.49, distToSeam / lenNext))
          const pPrev = {
            x: corner.x + (prev.x - corner.x) * tPrev,
            y: corner.y + (prev.y - corner.y) * tPrev,
          }
          const pNext = {
            x: corner.x + (next.x - corner.x) * tNext,
            y: corner.y + (next.y - corner.y) * tNext,
          }
          const out: Point[] = []
          for (let i = 0; i < n; i++) {
            if (i === cutVertexIndex) continue
            out.push(cutVertices[i])
            if (i === prevIdx) {
              out.push(pPrev, pNext)
            }
          }
          nextVertices = out
        } else {
          nextVertices = cutVertices.map((p, i) => (i === cutVertexIndex ? { ...seamCorner } : p))
        }

        const nextCut = closedPointsToLineCurves(nextVertices, 0)
        if (nextCut.length < 3) {
          return { toastMessage: 'error:Getrimmte Kontur ist ungültig.' }
        }
        const valid = validateContourAfterVertexMove(nextCut)
        if (!valid.ok) {
          return { toastMessage: `error:${valid.message}` }
        }
        const oldCut = target.cutLine
        const mappedSoft = remapSoftVerticesToNewCutLine(oldCut, nextCut, target.softVertices)
        const notches = resyncNotchesAfterCutLineRebuilt(target.notches, oldCut, nextCut)
        const updatedTarget = forceCutVerticesSoftAfterPromotion(
          applySharpCornerPromotion({
            ...target,
            cutLine: nextCut,
            notches,
            softVertices: mappedSoft,
            cutLineDeviatesFromSeamAllowanceOffset: true as const,
          }),
          mappedSoft
        )
        return {
          nahtTrimPickCutVertexActive: false,
          workspace: {
            ...s.workspace,
            pieces: syncFacingPiecesFromParents(s.workspace.pieces.map((p) => (p.id === targetId ? updatedTarget : p))),
          },
          toastMessage:
            trimMode === '45'
              ? 'success:45°-Eckfase ausgeführt: Nur die Außenkontur wurde angepasst, Nahtlinie blieb unverändert.'
              : 'success:Eck-Trim bis Nahtlinie ausgeführt: Nur die Außenkontur wurde angepasst, Nahtlinie blieb unverändert.',
        }
      }

      const explicitOtherId = s.selectedPieceIds.length >= 2 ? s.selectedPieceIds[1] : null
      const candidates = explicitOtherId
        ? s.workspace.pieces.filter((p) => p.id === explicitOtherId)
        : s.workspace.pieces.filter((p) => p.id !== target.id)
      if (candidates.length === 0) {
        return { nahtTrimPickCutVertexActive: false, toastMessage: 'error:Kein Referenzteil verfügbar.' }
      }

      const opts = { chosenCutVertexIndex: cutVertexIndex } as const
      let trimmed: ReturnType<typeof trimPieceCutLineByOtherPieceOverlap> | null = null
      for (const other of candidates) {
        const probe = trimPieceCutLineByOtherPieceOverlap(target, other, opts)
        if (probe.ok && probe.changed) {
          trimmed = probe
          break
        }
        if (trimmed == null) trimmed = probe
      }
      if (trimmed == null) {
        return { toastMessage: 'warn:Kein passender Überlappungsbereich gefunden.' }
      }
      if (!trimmed.ok) {
        return { toastMessage: `error:${trimmed.message}` }
      }
      if (!trimmed.changed) {
        return { toastMessage: `warn:${trimmed.reason}` }
      }
      const oldCut = target.cutLine
      const mappedSoft = remapSoftVerticesToNewCutLine(oldCut, trimmed.cutLine, target.softVertices)
      const notches = resyncNotchesAfterCutLineRebuilt(target.notches, oldCut, trimmed.cutLine)
      const seamAsMaster = target.seamAllowanceMm != null && target.seamLine.length >= 3
      const updatedTarget = forceCutVerticesSoftAfterPromotion(
        applySharpCornerPromotion({
          ...target,
          cutLine: trimmed.cutLine,
          notches,
          softVertices: mappedSoft,
          ...(seamAsMaster ? { cutLineDeviatesFromSeamAllowanceOffset: true as const } : {}),
        }),
        mappedSoft
      )
      return {
        nahtTrimPickCutVertexActive: false,
        workspace: {
          ...s.workspace,
          pieces: syncFacingPiecesFromParents(s.workspace.pieces.map((p) => (p.id === targetId ? updatedTarget : p))),
        },
        toastMessage:
          'success:Naht trimmen ausgeführt: Nur die Außenkontur wurde beschnitten, Nahtlinie blieb unverändert.',
      }
    }),

  removeSeamAllowance: (pieceId) =>
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      return {
      workspace: {
        ...s.workspace,
        pieces: syncFacingPiecesFromParents(
          s.workspace.pieces.map((p) => {
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
              cutLineDeviatesFromSeamAllowanceOffset: false,
            })
          })
        ),
      },
    }
    }),

  setEdgeSeamAllowance: (pieceId, edgeIndex, allowanceMm) =>
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
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
        next.cutLineDeviatesFromSeamAllowanceOffset = false
        next.notches = resyncNotchesAfterCutLineRebuilt(p.notches, oldCut, derived.cutLine)
        const mappedSoft = remapSoftVerticesToNewCutLine(oldCut, derived.cutLine, p.softVertices)
        next.softVertices = mappedSoft
        return forceCutVerticesSoftAfterPromotion(next, mappedSoft)
      })
      return {
        workspace: { ...s.workspace, pieces: syncFacingPiecesFromParents(pieces) },
        ...(toastMessage ? { toastMessage } : {}),
      }
    }),

  // Legacy-API-Name: arbeitet intern auf der Master-Kontur (seamLine bei Nahtzugabe, sonst cutLine).
  insertPointOnCutLine: (pieceId, curveIndex, point, t) => {
    let inserted = false
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      const pieceBefore = s.workspace.pieces.find((p) => p.id === pieceId)
      const seamPc = pieceBefore != null && useSeamLineForPointCurveEditing(pieceBefore)
      const LINE_SPLIT_MIN_MM = 0.5
      let toastMessage: string | null = null
      let manualSeamTrimReset = false
      const workspaceInsert = {
        workspace: {
          ...s.workspace,
          // Bei Master-Kontur-Splits (cutLine oder seamLine) müssen die SeamAssignment-Indizes remapped werden.
          // getCurvesForSeamEdge erwartet Master-Indizes, und `curveIndex` ist auf genau dieser Master-Kontur angegeben.
          seamAssignments: adjustSeamAfterInsert(s.workspace.seamAssignments, pieceId, curveIndex),
          pieces: syncFacingPiecesFromParents(s.workspace.pieces.map((p) => {
            if (p.id !== pieceId) return p
            const mappedInsert = mapCurveEditForSymmetry(p, curveIndex, point)
            const editCurveIndex = mappedInsert.curveIndex
            const editPoint = mappedInsert.point
            const master = seamPc ? p.seamLine : p.cutLine
            if (editCurveIndex < 0 || editCurveIndex >= master.length) return p
            const curve = master[editCurveIndex]
            const finishSymmetryInsert = (
              out: PatternPiece,
              insertedVertexIndex: number,
              insertedPoint: Point
            ): PatternPiece => {
              if (!out.symmetryConstraint) return out
              const mirrored = mirrorSymmetricContourPointInsert(out, insertedVertexIndex, insertedPoint)
              if (!mirrored.ok) {
                toastMessage = mirrored.toastMessage
                return p
              }
              return mirrored.piece
            }
            let newMaster: Curve[] | null = null
            if (curve.type === 'line') {
              // Robust gegenüber Klicks nahe Segment-Enden (t≈0/1): kein degenerierter Split.
              const lineLen = Math.hypot(curve.end.x - curve.start.x, curve.end.y - curve.start.y)
              const minT = Math.min(0.49, LINE_SPLIT_MIN_MM / Math.max(lineLen, 1e-6))
              const tt = Number.isFinite(t) ? Math.min(1 - minT, Math.max(minT, t as number)) : null
              const splitPoint =
                tt == null
                  ? editPoint
                  : {
                      x: curve.start.x + (curve.end.x - curve.start.x) * tt,
                      y: curve.start.y + (curve.end.y - curve.start.y) * tt,
                    }
              const seg1: Curve = { type: 'line', start: { ...curve.start }, end: { ...splitPoint } }
              const seg2: Curve = { type: 'line', start: { ...splitPoint }, end: { ...curve.end } }
              newMaster = [...master]
              newMaster.splice(editCurveIndex, 1, seg1, seg2)
            } else if (curve.type === 'bezier' && t != null && t > 0 && t < 1) {
              const [seg1, seg2] = splitBezierAt(curve, t)
              newMaster = [...master]
              newMaster.splice(editCurveIndex, 1, seg1, seg2)
            }
            if (!newMaster) return p
            const insertedVertexIndex = editCurveIndex + 1
            const insertedPoint = { ...newMaster[editCurveIndex].end }

            if (seamPc && p.seamAllowanceMm != null) {
              const seamLine = newMaster
              const newMasterVi = editCurveIndex + 1
              const softVerticesMaster = [
                ...(p.softVerticesMaster ?? []).map((vi) => (vi >= newMasterVi ? vi + 1 : vi)),
                newMasterVi,
              ].sort((a, b) => a - b)
              const roundedCorners = remapRoundedCornersOnVertexInsert(p.roundedCorners, newMasterVi)
              if (p.cutLineDeviatesFromSeamAllowanceOffset === true) {
                manualSeamTrimReset = true
              }
              const tempPiece = {
                ...p,
                seamLine,
                softVerticesMaster,
                roundedCorners,
                cutLineDeviatesFromSeamAllowanceOffset: false as const,
              }
              const derived = deriveCutLineForPiece(tempPiece, seamLine, p.seamAllowanceMm)
              if (!derived.ok) {
                toastMessage = `warn:${derived.message}`
                return p
              }
              const cutLine = derived.cutLine
              const notches = resyncNotchesAfterCutLineRebuilt(p.notches, p.cutLine, cutLine)
              const insertedOnSeam = newMaster[editCurveIndex].end
              const maxInsertDist = Math.max((p.seamAllowanceMm ?? 0) * 3, 20)
              const insertedCutVi = nearestCutVertexIndex(cutLine, insertedOnSeam, maxInsertDist)
              const softSet = new Set(remapSoftVerticesToNewCutLine(p.cutLine, cutLine, p.softVertices))
              if (insertedCutVi != null) softSet.add(insertedCutVi)
              const softVertices = [...softSet].sort((a, b) => a - b)
              inserted = true
              if (insertedCutVi == null) {
                return finishSymmetryInsert(
                  {
                    ...p,
                    cutLine,
                    seamLine,
                    notches,
                    softVertices,
                    softVerticesMaster,
                    roundedCorners,
                    cutLineDeviatesFromSeamAllowanceOffset: false,
                  },
                  insertedVertexIndex,
                  insertedPoint
                )
              }
              return finishSymmetryInsert(
                forceCutVertexSoftAfterInsert(
                  {
                    ...p,
                    cutLine,
                    seamLine,
                    notches,
                    softVertices,
                    softVerticesMaster,
                    roundedCorners,
                    cutLineDeviatesFromSeamAllowanceOffset: false,
                  },
                  insertedCutVi
                ),
                insertedVertexIndex,
                insertedPoint
              )
            }

            const cutLine = newMaster
            const notches = resyncNotchesAfterCutLineRebuilt(p.notches, p.cutLine, cutLine)
            const newVertexIdx = insertedVertexIndex
            const softVertices = [
              ...(p.softVertices ?? []).map((vi) => (vi >= newVertexIdx ? vi + 1 : vi)),
              newVertexIdx,
            ]
            const seamLine =
              p.seamAllowanceMm != null && cutLine.length >= 3 ? offsetCurvesInwardForSeam(cutLine, p.seamAllowanceMm) : p.seamLine
            const roundedCorners = remapRoundedCornersOnVertexInsert(p.roundedCorners, newVertexIdx)
            inserted = true
            return finishSymmetryInsert(
              forceCutVertexSoftAfterInsert({ ...p, cutLine, seamLine, notches, softVertices, roundedCorners }, newVertexIdx),
              insertedVertexIndex,
              insertedPoint
            )
          })),
        },
      }
      const mergedInsertToast = mergeWarnToasts(
        toastMessage,
        manualSeamTrimReset ? TOAST_MANUAL_SEAM_TRIM_RESET_PARALLEL : null
      )
      return {
        ...workspaceInsert,
        ...(mergedInsertToast ? { toastMessage: mergedInsertToast } : {}),
      }
    })
    return inserted
  },

  // Vertex verschieben. Seam-as-Master: Bei Nahtzugabe wird die seamLine (Innenkontur) bearbeitet, cutLine folgt.
  updateVertex: (pieceId, vertexIndex, point, skipSeamRecalc, notchOpts) =>
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      let toastMessage: string | null = null
      let profileToast: string | null = null
      let manualSeamTrimReset = false
      const profileList = s.workspace.profileAssignments ?? []
      return {
        workspace: {
          ...s.workspace,
          pieces: syncFacingPiecesFromParents(s.workspace.pieces.map((p) => {
            const seamAllowance = p.seamAllowanceMm
            const useSeamMaster = useSeamLineForVertexEditing(p)
            const curves = useSeamMaster ? p.seamLine : p.cutLine
            if (p.id !== pieceId || curves.length === 0) return p
            const mapped = mapContourVertexEditForSymmetry(p, vertexIndex, point)
            const editVertexIndex = mapped.vertexIndex
            const editPoint = mapped.point
            const n = curves.length
            if (editVertexIndex < 0 || editVertexIndex >= n) return p
            const nextCurves = curves.map((c) =>
              c.type === 'line'
                ? { type: 'line' as const, start: { ...c.start }, end: { ...c.end } }
                : { type: 'bezier' as const, start: { ...c.start }, end: { ...c.end }, cp1: { ...c.cp1 }, cp2: { ...c.cp2 } }
            )
            if (editVertexIndex === 0) {
              nextCurves[0] = { ...nextCurves[0], start: editPoint } as Curve
              nextCurves[n - 1] = { ...nextCurves[n - 1], end: editPoint } as Curve
            } else {
              nextCurves[editVertexIndex - 1] = { ...nextCurves[editVertexIndex - 1], end: editPoint } as Curve
              nextCurves[editVertexIndex] = { ...nextCurves[editVertexIndex], start: editPoint } as Curve
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
              if (p.cutLineDeviatesFromSeamAllowanceOffset === true) {
                manualSeamTrimReset = true
              }
              const newSeam = nextCurves
              const derived = deriveCutLineForPiece(
                { ...p, cutLineDeviatesFromSeamAllowanceOffset: false },
                newSeam,
                seamAllowance
              )
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
            const promoted = applySharpCornerPromotion({
              ...p,
              cutLine,
              seamLine,
              notches,
              softVertices,
              ...(cutRebuiltFromSeam ? { cutLineDeviatesFromSeamAllowanceOffset: false as const } : {}),
            })
            if (p.symmetryConstraint) {
              const reconciled = finalizePieceContourEdit(promoted)
              if (!reconciled.ok) {
                toastMessage = reconciled.toastMessage
                return p
              }
              if (p.id === pieceId) {
                profileToast = formatProfileEdgeGeometryWarnings(p, reconciled.piece, profileList, profileList)
              }
              return reconciled.piece
            }
            if (p.id === pieceId) {
              profileToast = formatProfileEdgeGeometryWarnings(p, promoted, profileList, profileList)
            }
            return promoted
          })),
        },
        ...(() => {
          const mergedToast = mergeWarnToasts(
            mergeWarnToasts(toastMessage, profileToast),
            manualSeamTrimReset ? TOAST_MANUAL_SEAM_TRIM_RESET_PARALLEL : null
          )
          return mergedToast ? { toastMessage: mergedToast } : {}
        })(),
      }
    }),

  replaceSegmentWithBezier: (pieceId, curveIndex, cp1, cp2) =>
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      let toastMessage: string | null = null
      let manualSeamTrimReset = false
      const pieces = s.workspace.pieces.map((p) => {
        if (p.id !== pieceId) return p
        const seamPc = useSeamLineForPointCurveEditing(p)
        const target = seamPc ? p.seamLine : p.cutLine
        if (curveIndex < 0 || curveIndex >= target.length) return p
        const c = target[curveIndex]
        if (c.type !== 'line') return p
        const ref = { x: (c.start.x + c.end.x) / 2, y: (c.start.y + c.end.y) / 2 }
        const mapped = mapCurveEditForSymmetry(p, curveIndex, ref)
        const editCurveIndex = mapped.curveIndex
        const editSeg = target[editCurveIndex]
        if (!editSeg || editSeg.type !== 'line') return p
        const bezier: Curve = {
          type: 'bezier',
          start: { ...editSeg.start },
          end: { ...editSeg.end },
          cp1: { ...cp1 },
          cp2: { ...(cp2 ?? cp1) },
        }
        const next = [...target]
        next[editCurveIndex] = bezier
        const replaceBezierContourCheck = validateContourAfterVertexMove(next)
        if (!replaceBezierContourCheck.ok) {
          toastMessage = `warn:${replaceBezierContourCheck.message}`
          return p
        }
        if (seamPc && p.seamAllowanceMm != null) {
          const seamLine = next
          if (p.cutLineDeviatesFromSeamAllowanceOffset === true) {
            manualSeamTrimReset = true
          }
          const derived = deriveCutLineForPiece(
            { ...p, cutLineDeviatesFromSeamAllowanceOffset: false },
            seamLine,
            p.seamAllowanceMm
          )
          if (!derived.ok) {
            toastMessage = `warn:${derived.message}`
            return p
          }
          const cutLine = derived.cutLine
          const notches = resyncNotchesViaSeamAnchor(p.notches, p.cutLine, cutLine, p.seamLine, seamLine)
          const softVertices = remapSoftVerticesToNewCutLine(p.cutLine, cutLine, p.softVertices)
          const promoted = applySharpCornerPromotion({
            ...p,
            cutLine,
            seamLine,
            notches,
            softVertices,
            cutLineDeviatesFromSeamAllowanceOffset: false,
          })
          if (p.symmetryConstraint) {
            const reconciled = finalizePieceContourEdit(promoted)
            if (!reconciled.ok) {
              toastMessage = reconciled.toastMessage
              return p
            }
            return reconciled.piece
          }
          return promoted
        }
        const cutLine = [...p.cutLine]
        cutLine[editCurveIndex] = bezier
        const seamLine =
          p.seamAllowanceMm != null && cutLine.length >= 3 ? offsetCurvesInwardForSeam(cutLine, p.seamAllowanceMm) : p.seamLine
        const notches = resyncNotchesAfterCutLineRebuilt(p.notches, p.cutLine, cutLine)
        const promoted = applySharpCornerPromotion({ ...p, cutLine, seamLine, notches })
        if (p.symmetryConstraint) {
          const reconciled = finalizePieceContourEdit(promoted)
          if (!reconciled.ok) {
            toastMessage = reconciled.toastMessage
            return p
          }
          return reconciled.piece
        }
        return promoted
      })
      const profileList = s.workspace.profileAssignments ?? []
      const oldP = s.workspace.pieces.find((x) => x.id === pieceId)
      const newP = pieces.find((x) => x.id === pieceId)
      const profileToast = oldP && newP ? formatProfileEdgeGeometryWarnings(oldP, newP, profileList, profileList) : null
      const mergedToast = mergeWarnToasts(
        mergeWarnToasts(toastMessage, profileToast),
        manualSeamTrimReset ? TOAST_MANUAL_SEAM_TRIM_RESET_PARALLEL : null
      )
      return {
        workspace: { ...s.workspace, pieces: syncFacingPiecesFromParents(pieces) },
        ...(mergedToast ? { toastMessage: mergedToast } : {}),
      }
    }),

  movePointOnCurve: (pieceId, curveIndex, t, newPoint, skipSeamRecalc, notchOpts) =>
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      let toastMessage: string | null = null
      let manualSeamTrimReset = false
      const pieces = s.workspace.pieces.map((p) => {
        if (p.id !== pieceId) return p
        const mappedCurve = mapCurveEditForSymmetry(p, curveIndex, newPoint)
        const editCurveIndex = mappedCurve.curveIndex
        const editPoint = mappedCurve.point
        const seamPc = useSeamLineForPointCurveEditing(p)
        const target = seamPc ? p.seamLine : p.cutLine
        if (editCurveIndex < 0 || editCurveIndex >= target.length) return p
        const c = target[editCurveIndex]
        if (c.type !== 'bezier') return p
        const adjusted = adjustControlPointsForPointOnCurve(c, t, editPoint)
        if (!adjusted) return p
        const bezier: Curve = {
          type: 'bezier',
          start: { ...c.start },
          end: { ...c.end },
          cp1: { ...adjusted.cp1 },
          cp2: { ...adjusted.cp2 },
        }
        const next = [...target]
        next[editCurveIndex] = bezier
        const moveOnCurveContourCheck = validateContourAfterVertexMove(next)
        if (!moveOnCurveContourCheck.ok) {
          toastMessage = `warn:${moveOnCurveContourCheck.message}`
          return p
        }
        const baseline = notchOpts?.notchResyncBaseline
        if (seamPc && p.seamAllowanceMm != null) {
          const seamLine = next
          if (p.cutLineDeviatesFromSeamAllowanceOffset === true) {
            manualSeamTrimReset = true
          }
          const derived = deriveCutLineForPiece(
            { ...p, cutLineDeviatesFromSeamAllowanceOffset: false },
            seamLine,
            p.seamAllowanceMm
          )
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
          const promotedSeam = applySharpCornerPromotion({
            ...p,
            cutLine,
            seamLine,
            notches,
            softVertices,
            cutLineDeviatesFromSeamAllowanceOffset: false,
          })
          if (p.symmetryConstraint) {
            const reconciled = finalizePieceContourEdit(promotedSeam)
            if (!reconciled.ok) {
              toastMessage = reconciled.toastMessage
              return p
            }
            return reconciled.piece
          }
          return promotedSeam
        }
        const cutLine = [...p.cutLine]
        cutLine[editCurveIndex] = bezier
        const seamLine = skipSeamRecalc
          ? p.seamLine
          : (p.seamAllowanceMm != null && cutLine.length >= 3 ? offsetCurvesInwardForSeam(cutLine, p.seamAllowanceMm) : p.seamLine)
        const oldN = baseline ? baseline.notches : p.notches
        const oldC = baseline ? baseline.cutLine : p.cutLine
        const notches = resyncNotchesAfterCutLineRebuilt(oldN, oldC, cutLine)
        const promotedMove = applySharpCornerPromotion({ ...p, cutLine, seamLine, notches })
        if (p.symmetryConstraint) {
          const reconciled = finalizePieceContourEdit(promotedMove)
          if (!reconciled.ok) {
            toastMessage = reconciled.toastMessage
            return p
          }
          return reconciled.piece
        }
        return promotedMove
      })
      const profileListMove = s.workspace.profileAssignments ?? []
      const oldPmove = s.workspace.pieces.find((x) => x.id === pieceId)
      const newPmove = pieces.find((x) => x.id === pieceId)
      const profileToastMove =
        oldPmove && newPmove ? formatProfileEdgeGeometryWarnings(oldPmove, newPmove, profileListMove, profileListMove) : null
      const mergedToastMove = mergeWarnToasts(
        mergeWarnToasts(toastMessage, profileToastMove),
        manualSeamTrimReset ? TOAST_MANUAL_SEAM_TRIM_RESET_PARALLEL : null
      )
      return {
        workspace: { ...s.workspace, pieces: syncFacingPiecesFromParents(pieces) },
        ...(mergedToastMove ? { toastMessage: mergedToastMove } : {}),
      }
    }),

  removeVertex: (pieceId, vertexIndex) =>
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      const piece = s.workspace.pieces.find((p) => p.id === pieceId)
      const useSeamMaster = piece != null && useSeamLineForVertexEditing(piece)
      const master = useSeamMaster ? piece!.seamLine : piece?.cutLine ?? []
      const oldN = master.length
      if (piece == null || vertexIndex < 0 || vertexIndex >= oldN) return s
      const mappedRemove = mapContourVertexEditForSymmetry(
        piece,
        vertexIndex,
        vertexIndex === 0 ? master[0].start : master[vertexIndex].start
      )
      const editVertexIndex = mappedRemove.vertexIndex
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
        const merged = mergeContourRemoveVertex(master, editVertexIndex)
        if (merged) {
          const tempSoftM = (piece.softVerticesMaster ?? [])
            .filter((vi: number) => vi !== editVertexIndex)
            .map((vi: number) => (vi > editVertexIndex ? vi - 1 : vi))
          const tempRC = remapRoundedCornersOnVertexRemove(piece.roundedCorners, editVertexIndex)
          const tempPiece = {
            ...piece,
            seamLine: merged,
            softVerticesMaster: tempSoftM,
            roundedCorners: tempRC,
            cutLineDeviatesFromSeamAllowanceOffset: false,
          }
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
        if (p.id !== pieceId || curves.length <= 3 || editVertexIndex < 0 || editVertexIndex >= curves.length) return p
        const merged = mergeContourRemoveVertex(curves, editVertexIndex)
        if (!merged) return p
        const softVerticesMaster = (p.softVerticesMaster ?? [])
          .filter((vi) => vi !== editVertexIndex)
          .map((vi) => (vi > editVertexIndex ? vi - 1 : vi))
        const roundedCorners = remapRoundedCornersOnVertexRemove(p.roundedCorners, editVertexIndex)

        let cutLine = p.cutLine
        let seamLine = p.seamLine
        if (seamMaster && seamAllowance != null) {
          seamLine = merged
          const tempPiece = { ...p, seamLine, softVerticesMaster, roundedCorners }
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

        const newPiece = { ...p, cutLine, seamLine, notches, softVertices, softVerticesMaster, roundedCorners }
        newPiece.edgeSeamAllowances = remapEdgeSeamAllowances(p, newPiece)
        const promoted = applySharpCornerPromotion(newPiece)
        if (p.symmetryConstraint) {
          const reconciled = finalizePieceContourEdit(promoted)
          if (!reconciled.ok) {
            toastMessage = reconciled.toastMessage
            return p
          }
          return reconciled.piece
        }
        return promoted
      })

      const oldP = s.workspace.pieces.find((p) => p.id === pieceId)
      const newP = newPieces.find((p) => p.id === pieceId)
      let profileAssignments = s.workspace.profileAssignments ?? []
      if (oldP && newP && oldP !== newP) {
        profileAssignments = remapProfileAssignmentsForPiece(oldP, newP, profileAssignments)
      }

      const prevProf = s.workspace.profileAssignments ?? []
      const profileToast =
        oldP && newP ? formatProfileEdgeGeometryWarnings(oldP, newP, prevProf, profileAssignments) : null
      const mergedToast = mergeWarnToasts(toastMessage, profileToast)

      return {
        workspace: {
          ...s.workspace,
          seamAssignments: oldN > 3 ? adjustSeamAfterRemove(s.workspace.seamAssignments, pieceId, editVertexIndex, oldN) : s.workspace.seamAssignments,
          pieces: syncFacingPiecesFromParents(newPieces),
          profileAssignments,
        },
        ...(mergedToast ? { toastMessage: mergedToast } : {}),
      }
    }),

  roundCorner: (pieceId, masterVertexIndex, radiusMm) => {
    let success = false
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      const piece = s.workspace.pieces.find((p) => p.id === pieceId)
      if (!piece) return s
      const useSeamMaster = useSeamLineForVertexEditing(piece)
      const master = useSeamMaster ? piece.seamLine : piece.cutLine
      if (master.length < 3) {
        return { ...s, toastMessage: 'warn:Kontur unvollständig.' }
      }
      const mappedVertex = mapContourVertexEditForSymmetry(
        piece,
        masterVertexIndex,
        getContourVertexPosition(master, masterVertexIndex),
      )
      const effectiveVertexIndex = mappedVertex.vertexIndex
      if (effectiveVertexIndex < 0 || effectiveVertexIndex >= master.length) {
        return { ...s, toastMessage: 'warn:Ungültiger Eckpunkt.' }
      }
      // Soft-Vertices (blau) sind keine roten Eckpunkte – Rundung nicht erlaubt.
      const softSet = useSeamMaster
        ? new Set(piece.softVerticesMaster ?? [])
        : new Set(piece.softVertices ?? [])
      if (softSet.has(effectiveVertexIndex)) {
        return { ...s, toastMessage: 'warn:Rundung nur auf roten Eckpunkten möglich.' }
      }

      const applyReconciled = (candidate: PatternPiece) => {
        const reconciled = finalizePieceContourEdit(candidate)
        if (!reconciled.ok) {
          return { ok: false as const, toastMessage: reconciled.toastMessage }
        }
        return { ok: true as const, piece: reconciled.piece }
      }

      // Negativer/zu kleiner Radius → bestehende Rundung entfernen.
      if (!Number.isFinite(radiusMm) || radiusMm < ROUND_CORNER_MIN_RADIUS_MM) {
        const existing = piece.roundedCorners ?? []
        const filtered = existing.filter((rc) => rc.masterVertexIndex !== effectiveVertexIndex)
        if (filtered.length === existing.length) {
          // Keine Änderung – kein Update notwendig.
          return s
        }
        let next: PatternPiece = {
          ...piece,
          roundedCorners: filtered.length > 0 ? filtered : undefined,
        }
        if (useSeamMaster && piece.seamAllowanceMm != null) {
          const derived = deriveCutLineForPiece(next, piece.seamLine, piece.seamAllowanceMm)
          if (!derived.ok) {
            return { ...s, toastMessage: `warn:${derived.message}` }
          }
          const oldCut = piece.cutLine
          const cutLine = derived.cutLine
          const notches = resyncNotchesViaSeamAnchor(piece.notches, oldCut, cutLine, piece.seamLine, piece.seamLine)
          const softVertices = remapSoftVerticesToNewCutLine(oldCut, cutLine, piece.softVertices)
          next.cutLine = cutLine
          next.notches = notches
          next.softVertices = softVertices
          next.cutLineDeviatesFromSeamAllowanceOffset = false
        }
        const reconciled = applyReconciled(next)
        if (!reconciled.ok) {
          return { ...s, toastMessage: reconciled.toastMessage }
        }
        success = true
        return {
          workspace: {
            ...s.workspace,
            pieces: syncFacingPiecesFromParents(
              s.workspace.pieces.map((p) => (p.id === pieceId ? reconciled.piece : p)),
            ),
          },
        }
      }

      const clampedRadius = Math.min(ROUND_CORNER_MAX_RADIUS_MM, Math.max(ROUND_CORNER_MIN_RADIUS_MM, radiusMm))
      // Validation gegen die SCHARFE Master (mit der bereits ggf. anderen Rundungen, die wir
      // aber gerade nicht stören wollen → reine Punkt-Validation).
      const validation = validateCornerRound(master, effectiveVertexIndex, clampedRadius)
      if (!validation.ok) {
        let msg = 'warn:Rundung nicht möglich.'
        switch (validation.reason) {
          case 'NON_LINE_NEIGHBOR':
            msg = 'warn:Rundung nur an Ecken zwischen geraden Linien möglich.'
            break
          case 'PHI_OUT_OF_RANGE':
            msg = 'warn:Eckenwinkel zu spitz oder zu flach für eine Rundung.'
            break
          case 'RADIUS_TOO_LARGE': {
            const max = validation.maxRadiusMm
            msg = max != null
              ? `warn:Radius zu groß. Maximal möglich: ${max.toFixed(1)} mm.`
              : 'warn:Radius zu groß für diese Ecke.'
            break
          }
          case 'RADIUS_TOO_SMALL':
            msg = 'warn:Radius zu klein.'
            break
          case 'DEGENERATE_EDGE':
            msg = 'warn:Kantenlänge zu klein.'
            break
        }
        return { ...s, toastMessage: msg }
      }

      const existing = piece.roundedCorners ?? []
      const without = existing.filter((rc) => rc.masterVertexIndex !== effectiveVertexIndex)
      const nextRC: RoundedCorner[] = [
        ...without,
        { masterVertexIndex: effectiveVertexIndex, radiusMm: clampedRadius },
      ].sort((a, b) => a.masterVertexIndex - b.masterVertexIndex)

      let next: PatternPiece = { ...piece, roundedCorners: nextRC }

      let toastMessage: string | null = null
      if (useSeamMaster && piece.seamAllowanceMm != null) {
        const derived = deriveCutLineForPiece(next, piece.seamLine, piece.seamAllowanceMm)
        if (!derived.ok) {
          return { ...s, toastMessage: `warn:${derived.message}` }
        }
        const oldCut = piece.cutLine
        const cutLine = derived.cutLine
        const notches = resyncNotchesViaSeamAnchor(piece.notches, oldCut, cutLine, piece.seamLine, piece.seamLine)
        if (piece.notches.length > 0 && notchPushedToCorner(piece.notches, oldCut, notches, cutLine)) {
          toastMessage = 'warn:Rundung würde Kerbe an Ecke schieben – bitte Kerbe verschieben oder löschen.'
          return { ...s, toastMessage }
        }
        const softVertices = remapSoftVerticesToNewCutLine(oldCut, cutLine, piece.softVertices)
        next.cutLine = cutLine
        next.notches = notches
        next.softVertices = softVertices
        next.cutLineDeviatesFromSeamAllowanceOffset = false
      }
      const reconciled = applyReconciled(next)
      if (!reconciled.ok) {
        return { ...s, toastMessage: reconciled.toastMessage }
      }
      success = true
      return {
        workspace: {
          ...s.workspace,
          pieces: syncFacingPiecesFromParents(
            s.workspace.pieces.map((p) => (p.id === pieceId ? reconciled.piece : p)),
          ),
        },
        ...(toastMessage ? { toastMessage } : {}),
      }
    })
    return success
  },

  convertBezierSegmentToLine: (pieceId, curveIndex) =>
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      let toastMessage: string | null = null
      let manualSeamTrimReset = false
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
          if (p.cutLineDeviatesFromSeamAllowanceOffset === true) {
            manualSeamTrimReset = true
          }
          const derived = deriveCutLineForPiece(
            { ...p, cutLineDeviatesFromSeamAllowanceOffset: false },
            seamLine,
            p.seamAllowanceMm
          )
          if (!derived.ok) {
            toastMessage = `warn:${derived.message}`
            return p
          }
          const cutLine = derived.cutLine
          const notches = resyncNotchesAfterCutLineRebuilt(p.notches, p.cutLine, cutLine)
          const softVertices = remapSoftVerticesToNewCutLine(p.cutLine, cutLine, p.softVertices)
          return applySharpCornerPromotion({
            ...p,
            cutLine,
            seamLine,
            notches,
            softVertices,
            cutLineDeviatesFromSeamAllowanceOffset: false,
          })
        }
        const cutLine = [...p.cutLine]
        cutLine[curveIndex] = lineSeg
        const seamLine =
          p.seamAllowanceMm != null && cutLine.length >= 3 ? offsetCurvesInwardForSeam(cutLine, p.seamAllowanceMm) : p.seamLine
        return applySharpCornerPromotion({ ...p, cutLine, seamLine })
      })
      const profileListConv = s.workspace.profileAssignments ?? []
      const oldPconv = s.workspace.pieces.find((x) => x.id === pieceId)
      const newPconv = pieces.find((x) => x.id === pieceId)
      const profileToastConv =
        oldPconv && newPconv ? formatProfileEdgeGeometryWarnings(oldPconv, newPconv, profileListConv, profileListConv) : null
      const mergedToastConv = mergeWarnToasts(
        mergeWarnToasts(toastMessage, profileToastConv),
        manualSeamTrimReset ? TOAST_MANUAL_SEAM_TRIM_RESET_PARALLEL : null
      )
      return {
        workspace: { ...s.workspace, pieces: syncFacingPiecesFromParents(pieces) },
        ...(mergedToastConv ? { toastMessage: mergedToastConv } : {}),
      }
    }),

  setVertexSoft: (pieceId, vertexIndex, soft) =>
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
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
        workspace: { ...s.workspace, pieces: syncFacingPiecesFromParents(newPieces), profileAssignments },
      }
    }),

  offsetSegment: (pieceId, curveIndex, deltaMm) =>
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
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
      let manualSeamTrimReset = false
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
          if (p.cutLineDeviatesFromSeamAllowanceOffset === true) {
            manualSeamTrimReset = true
          }
          const derived = deriveCutLineForPiece(
            { ...p, cutLineDeviatesFromSeamAllowanceOffset: false },
            seamLine,
            p.seamAllowanceMm
          )
          if (!derived.ok) {
            toastMessage = `warn:${derived.message}`
            return p
          }
          const cutLine = derived.cutLine
          const notches = resyncNotchesAfterCutLineRebuilt(p.notches, p.cutLine, cutLine)
          const softVertices = remapSoftVerticesToNewCutLine(p.cutLine, cutLine, p.softVertices)
          return applySharpCornerPromotion({
            ...p,
            cutLine,
            seamLine,
            notches,
            softVertices,
            cutLineDeviatesFromSeamAllowanceOffset: false,
          })
        }
        const cutLine = nextMaster
        const seamLine =
          p.seamAllowanceMm != null && cutLine.length >= 3 ? offsetCurvesInwardForSeam(cutLine, p.seamAllowanceMm) : p.seamLine
        return applySharpCornerPromotion({ ...p, cutLine, seamLine })
      })
      const mergedOffsetToast = mergeWarnToasts(
        toastMessage,
        manualSeamTrimReset ? TOAST_MANUAL_SEAM_TRIM_RESET_PARALLEL : null
      )
      return {
        workspace: { ...s.workspace, pieces: syncFacingPiecesFromParents(pieces) },
        ...(mergedOffsetToast ? { toastMessage: mergedOffsetToast } : {}),
      }
    }),

  recomputeSeamLine: (pieceId) =>
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      return {
      workspace: {
        ...s.workspace,
        pieces: syncFacingPiecesFromParents(
          s.workspace.pieces.map((p) => {
            if (p.id !== pieceId || p.seamAllowanceMm == null || p.cutLine.length < 3) return p
            // Schutz gegen versehentliches Überschreiben der Master-Naht:
            // Bei Seam-as-Master wird seamLine direkt bearbeitet und darf hier nicht aus cutLine neu entstehen.
            if (useSeamLineForVertexEditing(p)) return p
            const seamLine = offsetCurvesInwardForSeam(p.cutLine, p.seamAllowanceMm)
            return applySharpCornerPromotion({ ...p, seamLine })
          })
        ),
      },
    }
    }),

  flipPieceAlongGrain: (pieceId) =>
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      const piece = s.workspace.pieces.find((p) => p.id === pieceId)
      if (!piece || piece.cutLine.length < 3) return s
      const bounds = curvesBounds(piece.cutLine)
      if (!bounds) return s
      const cx = (bounds.minX + bounds.maxX) / 2
      const oldCutLine = piece.cutLine
      const oldInternalLines = piece.internalLines
      const mirroredCutLine = oldCutLine.map((c) => mirrorCurve(c, cx))
      let cutLine: Curve[]
      let seamLine: Curve[]
      if (useSeamLineForVertexEditing(piece) && piece.seamLine.length >= 3) {
        seamLine = piece.seamLine.map((c) => mirrorCurve(c, cx))
        if (piece.cutLineDeviatesFromSeamAllowanceOffset === true) {
          const derived = deriveCutLineForPiece({ ...piece, seamLine }, seamLine, piece.seamAllowanceMm!)
          cutLine = preferStableCutAfterGeometricMirror(
            seamLine,
            mirroredCutLine,
            derived.ok ? derived.cutLine : null,
            piece.seamAllowanceMm!
          )
        } else {
          const derived = deriveCutLineForPiece({ ...piece, seamLine }, seamLine, piece.seamAllowanceMm!)
          cutLine = derived.ok ? derived.cutLine : mirroredCutLine
        }
      } else {
        cutLine = mirroredCutLine
        seamLine = piece.seamAllowanceMm != null && cutLine.length >= 3
          ? offsetCurvesInwardForSeam(cutLine, piece.seamAllowanceMm)
          : []
      }
      const internalLines = oldInternalLines.map((c) => mirrorCurve(c, cx))
      const notches = rematerializeNotchesAfterGeometricMirror({
        notches: piece.notches,
        oldCutLine,
        mirroredCutLine,
        finalCutLine: cutLine,
        oldInternalLines,
        mirroredInternalLines: internalLines,
        mapPoint: (p) => mirrorX(p, cx),
      })
      const drills = piece.drills.map((d) => ({ ...d, center: mirrorX(d.center, cx) }))
      const internalCircles = piece.internalCircles.map((ic) => ({
        ...ic,
        center: mirrorX(ic.center, cx),
      }))
      const grainLine = piece.grainLine
        ? { start: mirrorX(piece.grainLine.start, cx), end: mirrorX(piece.grainLine.end, cx) }
        : null
      return {
        workspace: {
          ...s.workspace,
          pieces: syncFacingPiecesFromParents(
            s.workspace.pieces.map((p) =>
              p.id === pieceId
                ? applySharpCornerPromotion({
                    ...p,
                    cutLine,
                    seamLine,
                    notches,
                    drills,
                    internalLines,
                    internalCircles,
                    grainLine,
                  })
                : p
            )
          ),
        },
      }
    }),

  flipPieceAlongAxis: (pieceId, axisA, axisB) =>
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      const piece = s.workspace.pieces.find((p) => p.id === pieceId)
      if (!piece || piece.cutLine.length < 3) return s
      const axisLen = Math.hypot(axisB.x - axisA.x, axisB.y - axisA.y)
      if (axisLen < 0.5) return { toastMessage: 'warn:Spiegelachse ist zu kurz.' }
      const oldCutLine = piece.cutLine
      const oldInternalLines = piece.internalLines
      const mirroredCutLine = oldCutLine.map((c) => mirrorCurveAcrossAxis(c, axisA, axisB))
      let cutLine: Curve[]
      let seamLine: Curve[]
      if (useSeamLineForVertexEditing(piece) && piece.seamLine.length >= 3) {
        seamLine = piece.seamLine.map((c) => mirrorCurveAcrossAxis(c, axisA, axisB))
        if (piece.cutLineDeviatesFromSeamAllowanceOffset === true) {
          const derived = deriveCutLineForPiece({ ...piece, seamLine }, seamLine, piece.seamAllowanceMm!)
          cutLine = preferStableCutAfterGeometricMirror(
            seamLine,
            mirroredCutLine,
            derived.ok ? derived.cutLine : null,
            piece.seamAllowanceMm!
          )
        } else {
          const derived = deriveCutLineForPiece({ ...piece, seamLine }, seamLine, piece.seamAllowanceMm!)
          cutLine = derived.ok ? derived.cutLine : mirroredCutLine
        }
      } else {
        cutLine = mirroredCutLine
        seamLine = piece.seamAllowanceMm != null && cutLine.length >= 3
          ? offsetCurvesInwardForSeam(cutLine, piece.seamAllowanceMm)
          : []
      }
      const internalLines = oldInternalLines.map((c) => mirrorCurveAcrossAxis(c, axisA, axisB))
      const notches = rematerializeNotchesAfterGeometricMirror({
        notches: piece.notches,
        oldCutLine,
        mirroredCutLine,
        finalCutLine: cutLine,
        oldInternalLines,
        mirroredInternalLines: internalLines,
        mapPoint: (p) => mirrorPointAcrossAxis(p, axisA, axisB),
      })
      const drills = piece.drills.map((d) => ({ ...d, center: mirrorPointAcrossAxis(d.center, axisA, axisB) }))
      const internalCircles = piece.internalCircles.map((ic) => ({
        ...ic,
        center: mirrorPointAcrossAxis(ic.center, axisA, axisB),
      }))
      const grainLine = piece.grainLine
        ? {
            start: mirrorPointAcrossAxis(piece.grainLine.start, axisA, axisB),
            end: mirrorPointAcrossAxis(piece.grainLine.end, axisA, axisB),
          }
        : null
      return {
        workspace: {
          ...s.workspace,
          pieces: syncFacingPiecesFromParents(
            s.workspace.pieces.map((p) =>
              p.id === pieceId
                ? applySharpCornerPromotion({
                    ...p,
                    cutLine,
                    seamLine,
                    notches,
                    drills,
                    internalLines,
                    internalCircles,
                    grainLine,
                  })
                : p
            )
          ),
        },
      }
    }),

  applyPieceSymmetry: (pieceId, axisA, axisB, keepSide) =>
    set((s) => {
      const facingBlock = facingGeometryEditBlocked(s.workspace.pieces, pieceId)
      if (facingBlock) return facingBlock
      const piece = s.workspace.pieces.find((p) => p.id === pieceId)
      if (!piece) return { toastMessage: 'warn:Teil nicht gefunden.' }
      const r = applyPieceSymmetryToPiece(piece, axisA, axisB, keepSide)
      if (!r.ok) return { toastMessage: r.toastMessage }
      const symmetryConstraint = symmetryConstraintFromAxis(axisA, axisB, keepSide)
      return {
        workspace: {
          ...s.workspace,
          pieces: syncFacingPiecesFromParents(
            s.workspace.pieces.map((p) =>
              p.id === pieceId ? { ...r.piece, symmetryConstraint } : p
            )
          ),
        },
        pieceSymmetryState: null,
        toastMessage: 'success:Teil symmetrisch gemacht.',
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

  materializeMissingGrainLines: () =>
    set((s) => {
      let changed = false
      const pieces = s.workspace.pieces.map((p) => {
        if (p.grainLine != null || p.cutLine.length < 3) return p
        changed = true
        return withDefaultGrainLine(p)
      })
      if (!changed) return s
      return { workspace: { ...s.workspace, pieces } }
    }),

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

  alignPieceEdgeHorizontal: (pieceId, edgeIndex) => {
    const piece = get().workspace.pieces.find((p) => p.id === pieceId)
    if (!piece || piece.cutLine.length < 3) return false
    const curves = getCurvesForSeamEdge(piece)
    const edges = enumerateEdges(piece)
    const edge = edges.find((ed) => ed.edgeIndex === edgeIndex)
    if (!edge || !masterEdgeIsStraightLine(curves, edge)) return false
    const firstCi = edge.curveIndices[0]
    const lastCi = edge.curveIndices[edge.curveIndices.length - 1]
    const startLocal = curves[firstCi]?.start
    const endLocal = curves[lastCi]?.end
    if (!startLocal || !endLocal) return false
    const t = piece.transform
    const p0 = pieceLocalToWorld(startLocal, t)
    const p1 = pieceLocalToWorld(endLocal, t)
    const dx = p1.x - p0.x
    const dy = p1.y - p0.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-9) return false
    const thetaDeg = (Math.atan2(dy, dx) * 180) / Math.PI
    const delta = deltaMinimalDegToHorizontal(thetaDeg)
    get().setPieceRotation(pieceId, piece.transform.rotation + delta)
    return true
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
      horizontalLevelPickingActive: false,
      pieceSymmetryState: null,
      nahtzuordnungMode: 'idle',
      pendingNahtzuordnungFirst: null,
      nahtTrimPickCutVertexActive: false,
      nahtTrimMode: 'full',
      profileDialogAssignmentId: null,
      rulerMode: false,
      rulerLine: null,
      seamAdjustmentDialog: null,
      seamAdjustmentHoverPieceId: null,
      seamAdjustmentAcknowledged: {},
      seamAssignmentMetaDialogId: null,
      massstabDialog: null,
      showHelpModal: false,
      showShortcutListModal: false,
      showSettingsModal: false,
      showStuecklisteModal: false,
      showMaterialCatalogModal: false,
      showNestingModal: false,
      workspaceImageSelected: false,
      configuratorModalOpen: false,
      rockGeneratorModalOpen: false,
      showScan3dModal: false,
      toastMessage: null,
      imageScaleCalibration: null,
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
    const newPiece: PatternPiece = withDefaultGrainLine(
      applySharpCornerPromotion({
        ...createDefaultPiece(id, number),
        cutLine: curves,
        softVertices,
      }),
    )
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
        renderMmPerPixelX: renderMmPerPixel,
        renderMmPerPixelY: renderMmPerPixel,
        locked: false,
      },
      tool: 'select',
      workspaceImageSelected: true,
      selectedPieceIds: [],
      digitizeState: null,
      imageScaleCalibration: null,
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
      const prev = effectiveMmPerPixelXY(s.imageDigitizeSession)
      const ratio = clamped / Math.max(1e-9, Math.sqrt(prev.x * prev.y))
      return {
        imageDigitizeSession: {
          ...s.imageDigitizeSession,
          renderMmPerPixel: clamped,
          renderMmPerPixelX: prev.x * ratio,
          renderMmPerPixelY: prev.y * ratio,
        },
      }
    }),
  setImageRenderMmPerPixelXY: (mmPerPixelX, mmPerPixelY) =>
    set((s) => {
      if (!s.imageDigitizeSession) return s
      const cx = Math.min(500, Math.max(1e-4, mmPerPixelX))
      const cy = Math.min(500, Math.max(1e-4, mmPerPixelY))
      return {
        imageDigitizeSession: {
          ...s.imageDigitizeSession,
          renderMmPerPixelX: cx,
          renderMmPerPixelY: cy,
          renderMmPerPixel: Math.sqrt(cx * cy),
        },
        imageScaleCalibration: null,
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
      imageScaleCalibration: null,
      tool: 'select',
    })),
  setImageScaleCalibration: (v) => set({ imageScaleCalibration: v }),
  beginImageScaleCalibration: () =>
    set((s) => {
      if (!s.imageDigitizeSession?.imageDataUrl || !s.imageDigitizeSession.imageSizePx) {
        return { toastMessage: 'warn:Bitte zuerst ein Bild einfügen.' }
      }
      return {
        imageScaleCalibration: { pointsWorld: [] },
        tool: 'select',
        workspaceImageSelected: true,
        selectedPieceIds: [],
        toastMessage: 'info:Maßstab 10×10 cm: 1) Ecke des Winkels · 2) Ende waagerecht · 3) Ende senkrecht.',
      }
    }),
  addImageScaleCalibrationPoint: (world) => {
    const s = get()
    if (!s.imageScaleCalibration || !s.imageDigitizeSession?.imageSizePx) return
    const pts = [...s.imageScaleCalibration.pointsWorld, { ...world }]
    if (pts.length < 3) {
      const nextHint =
        pts.length === 1
          ? 'info:2/3: Ende des waagerechten 10-cm-Schenkels klicken.'
          : 'info:3/3: Ende des senkrechten 10-cm-Schenkels klicken.'
      set({ imageScaleCalibration: { pointsWorld: pts }, toastMessage: nextHint })
      return
    }
    set({ imageScaleCalibration: { pointsWorld: pts.slice(0, 3) } })
    get().applyImageScaleCalibration()
  },
  applyImageScaleCalibration: () => {
    const s = get()
    const cal = s.imageScaleCalibration
    const session = s.imageDigitizeSession
    if (!cal || cal.pointsWorld.length < 3 || !session?.imageSizePx) {
      set({ toastMessage: 'warn:Bitte drei Punkte setzen (Ecke + zwei Schenkel).' })
      return
    }
    const size = session.imageSizePx
    const xy = effectiveMmPerPixelXY({
      imagePosition: session.imagePosition,
      imageSizePx: size,
      renderMmPerPixel: session.renderMmPerPixel,
      renderMmPerPixelX: session.renderMmPerPixelX,
      renderMmPerPixelY: session.renderMmPerPixelY,
    })
    const toPx = (w: Point) =>
      worldToImagePixel({
        world: w,
        imagePosition: session.imagePosition,
        imageSizePx: size,
        mmPerPixelEffective: session.renderMmPerPixel,
        mmPerPixelX: xy.x,
        mmPerPixelY: xy.y,
      })
    const [c, a, b] = cal.pointsWorld
    const result = computeMmPerPixelXYFromRightAngle({
      cornerPx: toPx(c),
      armAPx: toPx(a),
      armBPx: toPx(b),
      refMm: IMAGE_SCALE_REF_MM,
    })
    if (!result) {
      set({ toastMessage: 'warn:Winkel ungültig — Punkte zu nah beieinander?' })
      return
    }
    const cx = Math.min(500, Math.max(1e-4, result.mmPerPixelX))
    const cy = Math.min(500, Math.max(1e-4, result.mmPerPixelY))
    set({
      imageDigitizeSession: {
        ...session,
        renderMmPerPixelX: cx,
        renderMmPerPixelY: cy,
        renderMmPerPixel: Math.sqrt(cx * cy),
        locked: true,
      },
      imageScaleCalibration: null,
      toastMessage: `success:Maßstab gesetzt (${IMAGE_SCALE_REF_MM}×${IMAGE_SCALE_REF_MM} mm): X ${cx.toFixed(3)} / Y ${cy.toFixed(3)} mm/px.`,
    })
  },

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
      workspace: {
        ...ws,
        notes: ws.notes ?? [],
        profileAssignments: ws.profileAssignments ?? [],
        pieces: ws.pieces.map((p) => withDefaultGrainLine(p)),
      },
      dxfExportScale: project.dxfExportScale,
      dxfImportExtraCutLayers: project.dxfImportExtraCutLayers,
      dxfImportScale: project.dxfImportScale,
      dxfImportDetectVNotches: project.dxfImportDetectVNotches,
      dxfImportCreateSeamLine: project.dxfImportCreateSeamLine,
      dxfImportSeamAllowanceMm: project.dxfImportSeamAllowanceMm,
      canvasRotationUiScale: clampCanvasOverlayScale(
        typeof project.canvasRotationUiScale === 'number' ? project.canvasRotationUiScale : 1,
      ),
      canvasDigitizeUiScale: clampCanvasOverlayScale(
        typeof project.canvasDigitizeUiScale === 'number' ? project.canvasDigitizeUiScale : 1,
      ),
      canvasVertexPointUiScale: clampCanvasOverlayScale(
        typeof project.canvasVertexPointUiScale === 'number' ? project.canvasVertexPointUiScale : 1,
      ),
      uiTextScale: clampUiTextScale(typeof project.uiTextScale === 'number' ? project.uiTextScale : 1),
      showPivotRotationUi: project.showPivotRotationUi === false ? false : true,
      notchSettings,
      activeNotchPresetIndex: 0,
      imageDigitizeSession: project.imageDigitizeSession,
      workspaceImageSelected: Boolean(project.imageDigitizeSession?.imageDataUrl),
      imageScaleCalibration: null,
      selectedPieceIds: firstId ? [firstId] : [],
      selectedPoint: null,
      tool: 'select',
      digitizeState: null,
      pendingNahtzugabeClick: false,
      nahtzugabeDialogPieceId: null,
      piecePropertiesDialogPieceId: null,
      edgeSeamPickingActive: false,
      horizontalLevelPickingActive: false,
      pieceSymmetryState: null,
      nahtzuordnungMode: 'idle',
      pendingNahtzuordnungFirst: null,
      nahtTrimPickCutVertexActive: false,
      nahtTrimMode: 'full',
      rulerMode: false,
      rulerLine: null,
      seamAdjustmentDialog: null,
      seamAdjustmentHoverPieceId: null,
      seamAdjustmentAcknowledged: {},
      seamAssignmentMetaDialogId: null,
      profileDialogAssignmentId: null,
      massstabDialog: null,
      showHelpModal: false,
      showShortcutListModal: false,
      showSettingsModal: false,
      showStuecklisteModal: false,
      showMaterialCatalogModal: false,
      showNestingModal: false,
      nestingPlan: null,
      nestingStatus: 'idle',
      nestingError: null,
      configuratorModalOpen: false,
      rockGeneratorModalOpen: false,
      showScan3dModal: false,
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

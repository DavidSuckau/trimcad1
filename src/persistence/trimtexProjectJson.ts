import type {
  Point,
  Workspace,
  WorkspaceNote,
  PatternPiece,
  Curve,
  ViewState,
  SeamAssignment,
  SeamAssignmentKindId,
} from '../types/model'
import { SEAM_ASSIGNMENT_KIND_IDS } from '../types/model'
import { applySharpCornerPromotion } from '../geometry/softVertexPromotion'

export const TRIMTEX_PROJECT_FORMAT = 'trimtex-project' as const
export const TRIMTEX_PROJECT_VERSION = 1 as const

/** Entspricht `NotchSetting` im Store (ohne Import-Zyklus). */
export type ProjectNotchSetting = {
  type: 'strich' | 'kerbe'
  widthMm: number
  depthMm: number
}

export type TrimTexProjectImageSession = {
  imageDataUrl: string | null
  imageSizePx: { width: number; height: number } | null
  imagePosition: Point
  renderMmPerPixel: number
  locked?: boolean
}

export type TrimTexProjectFileV1 = {
  format: typeof TRIMTEX_PROJECT_FORMAT
  version: typeof TRIMTEX_PROJECT_VERSION
  /** ISO-8601 Zeitstempel beim Speichern */
  savedAt: string
  workspace: Workspace
  dxfExportScale: number
  dxfImportExtraCutLayers: string
  dxfImportScale: number
  dxfImportDetectVNotches: boolean
  dxfImportCreateSeamLine: boolean
  dxfImportSeamAllowanceMm: number
  notchSettings: ProjectNotchSetting[]
  imageDigitizeSession: TrimTexProjectImageSession | null
}

function isPoint(v: unknown): v is Point {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Point).x === 'number' &&
    Number.isFinite((v as Point).x) &&
    typeof (v as Point).y === 'number' &&
    Number.isFinite((v as Point).y)
  )
}

function isCurve(v: unknown): v is Curve {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (o.type === 'line') {
    return isPoint(o.start) && isPoint(o.end)
  }
  if (o.type === 'bezier') {
    return isPoint(o.start) && isPoint(o.end) && isPoint(o.cp1) && isPoint(o.cp2)
  }
  return false
}

function isViewState(v: unknown): v is ViewState {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.zoom === 'number' &&
    Number.isFinite(o.zoom) &&
    typeof o.panX === 'number' &&
    typeof o.panY === 'number'
  )
}

function normalizePiece(raw: PatternPiece): PatternPiece {
  const cutLine = Array.isArray(raw.cutLine) ? raw.cutLine.filter(isCurve) : []
  const seamLine = Array.isArray(raw.seamLine) ? raw.seamLine.filter(isCurve) : []
  const internalLines = Array.isArray(raw.internalLines) ? raw.internalLines.filter(isCurve) : []
  const base: PatternPiece = {
    id: typeof raw.id === 'string' ? raw.id : 'p1',
    number: typeof raw.number === 'string' ? raw.number : '001',
    name: typeof raw.name === 'string' ? raw.name : 'Teil',
    cutLine,
    seamLine,
    seamAllowanceMm:
      raw.seamAllowanceMm === undefined || raw.seamAllowanceMm === null
        ? null
        : (() => {
            const v = Number(raw.seamAllowanceMm)
            return Number.isFinite(v) ? v : null
          })(),
    notches: Array.isArray(raw.notches) ? raw.notches : [],
    drills: Array.isArray(raw.drills) ? raw.drills : [],
    grainLine: raw.grainLine && isPoint((raw.grainLine as { start?: unknown }).start) && isPoint((raw.grainLine as { end?: unknown }).end)
      ? { start: { ...(raw.grainLine as { start: Point }).start }, end: { ...(raw.grainLine as { end: Point }).end } }
      : null,
    internalLines,
    layer: typeof raw.layer === 'string' ? raw.layer : 'CUT',
    transform: {
      x: typeof raw.transform?.x === 'number' ? raw.transform.x : 0,
      y: typeof raw.transform?.y === 'number' ? raw.transform.y : 0,
      rotation: typeof raw.transform?.rotation === 'number' ? raw.transform.rotation : 0,
      mirrored: Boolean(raw.transform?.mirrored),
      ...(raw.transform?.pivotLocal && isPoint(raw.transform.pivotLocal) ? { pivotLocal: { ...raw.transform.pivotLocal } } : {}),
    },
    softVertices: Array.isArray(raw.softVertices) ? raw.softVertices.filter((n): n is number => typeof n === 'number') : [],
    softVerticesMaster: Array.isArray((raw as { softVerticesMaster?: unknown }).softVerticesMaster)
      ? (raw as { softVerticesMaster: unknown[] }).softVerticesMaster.filter((n): n is number => typeof n === 'number')
      : [],
    fillInterior: raw.fillInterior === undefined ? true : Boolean(raw.fillInterior),
    material: typeof raw.material === 'string' ? raw.material : '',
    bomQuantity: (() => {
      const q = Number(raw.bomQuantity)
      if (!Number.isFinite(q)) return 1
      return Math.max(1, Math.floor(q))
    })(),
  }
  return applySharpCornerPromotion(base)
}

function normalizeSeamAssignments(raw: unknown): SeamAssignment[] {
  if (!Array.isArray(raw)) return []
  const out: SeamAssignment[] = []
  for (const a of raw) {
    if (typeof a !== 'object' || a === null) continue
    const o = a as Record<string, unknown>
    if (
      typeof o.id !== 'string' ||
      typeof o.pieceIdA !== 'string' ||
      typeof o.pieceIdB !== 'string' ||
      typeof o.clickedCurveA !== 'number' ||
      typeof o.clickedCurveB !== 'number' ||
      !Array.isArray(o.curveIndicesA) ||
      !Array.isArray(o.curveIndicesB)
    ) {
      continue
    }
    let orderNumber: number | null | undefined
    if (o.orderNumber === null || o.orderNumber === undefined) {
      orderNumber = o.orderNumber === null ? null : undefined
    } else if (typeof o.orderNumber === 'number' && Number.isFinite(o.orderNumber)) {
      orderNumber = Math.floor(o.orderNumber)
    }
    let seamKind: SeamAssignmentKindId | null | undefined
    if (o.seamKind === null || o.seamKind === undefined) {
      seamKind = o.seamKind === null ? null : undefined
    } else if (
      typeof o.seamKind === 'string' &&
      (SEAM_ASSIGNMENT_KIND_IDS as readonly string[]).includes(o.seamKind)
    ) {
      seamKind = o.seamKind as SeamAssignmentKindId
    }
    out.push({
      id: o.id,
      pieceIdA: o.pieceIdA,
      curveIndicesA: o.curveIndicesA.filter((n): n is number => typeof n === 'number'),
      clickedCurveA: o.clickedCurveA,
      pieceIdB: o.pieceIdB,
      curveIndicesB: o.curveIndicesB.filter((n): n is number => typeof n === 'number'),
      clickedCurveB: o.clickedCurveB,
      ...(orderNumber !== undefined ? { orderNumber } : {}),
      ...(seamKind !== undefined ? { seamKind } : {}),
    })
  }
  return out
}

function normalizeWorkspaceNotes(raw: unknown): WorkspaceNote[] {
  if (!Array.isArray(raw)) return []
  const out: WorkspaceNote[] = []
  for (const n of raw) {
    if (typeof n !== 'object' || n === null) continue
    const o = n as Record<string, unknown>
    if (typeof o.id !== 'string') continue
    const pos = o.position
    if (!isPoint(pos)) continue
    const text = typeof o.text === 'string' ? o.text : ''
    out.push({
      id: o.id,
      position: { x: pos.x, y: pos.y },
      text,
    })
  }
  return out
}

export function normalizeWorkspaceForLoad(w: Workspace): Workspace {
  const pieces = Array.isArray(w.pieces) ? w.pieces.map((p) => normalizePiece(p as PatternPiece)) : []
  const view = isViewState(w.view) ? w.view : { zoom: 1, panX: 0, panY: 0 }
  return {
    id: typeof w.id === 'string' ? w.id : 'ws1',
    name: typeof w.name === 'string' ? w.name : 'Arbeitsfläche',
    pieces,
    view,
    seamAssignments: normalizeSeamAssignments(w.seamAssignments),
    notes: normalizeWorkspaceNotes((w as { notes?: unknown }).notes),
    ...(typeof w.projectFileName === 'string' ? { projectFileName: w.projectFileName } : {}),
    ...(typeof w.bomDocumentVersion === 'string' ? { bomDocumentVersion: w.bomDocumentVersion } : {}),
    ...(typeof w.bomDeveloperName === 'string' ? { bomDeveloperName: w.bomDeveloperName } : {}),
    ...(typeof w.bomEngineerName === 'string' ? { bomEngineerName: w.bomEngineerName } : {}),
  }
}

export function buildTrimTexProjectFile(args: {
  workspace: Workspace
  dxfExportScale: number
  dxfImportExtraCutLayers: string
  dxfImportScale: number
  dxfImportDetectVNotches: boolean
  dxfImportCreateSeamLine: boolean
  dxfImportSeamAllowanceMm: number
  notchSettings: ProjectNotchSetting[]
  imageDigitizeSession: TrimTexProjectImageSession | null
}): TrimTexProjectFileV1 {
  const workspace = JSON.parse(JSON.stringify(args.workspace)) as Workspace
  return {
    format: TRIMTEX_PROJECT_FORMAT,
    version: TRIMTEX_PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    workspace,
    dxfExportScale: args.dxfExportScale,
    dxfImportExtraCutLayers: args.dxfImportExtraCutLayers,
    dxfImportScale: args.dxfImportScale,
    dxfImportDetectVNotches: args.dxfImportDetectVNotches,
    dxfImportCreateSeamLine: args.dxfImportCreateSeamLine,
    dxfImportSeamAllowanceMm: args.dxfImportSeamAllowanceMm,
    notchSettings: args.notchSettings.map((n) => ({ ...n })),
    imageDigitizeSession: args.imageDigitizeSession
      ? { ...args.imageDigitizeSession, imageSizePx: args.imageDigitizeSession.imageSizePx ? { ...args.imageDigitizeSession.imageSizePx } : null }
      : null,
  }
}

export function stringifyTrimTexProject(file: TrimTexProjectFileV1): string {
  return JSON.stringify(file, null, 2)
}

export type ParseProjectResult =
  | { ok: true; data: TrimTexProjectFileV1 }
  | { ok: false; error: string }

export function parseTrimTexProjectJson(json: string): ParseProjectResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { ok: false, error: 'Kein gültiges JSON.' }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: 'Ungültige Projektdatei.' }
  }
  const o = parsed as Record<string, unknown>
  if (o.format !== TRIMTEX_PROJECT_FORMAT) {
    return { ok: false, error: 'Keine TrimTex-Projektdatei (format fehlt oder falsch).' }
  }
  if (o.version !== TRIMTEX_PROJECT_VERSION) {
    return { ok: false, error: `Projektversion ${String(o.version)} wird nicht unterstützt.` }
  }
  if (typeof o.workspace !== 'object' || o.workspace === null) {
    return { ok: false, error: 'Projekt enthält keine Arbeitsfläche.' }
  }
  const ws = o.workspace as Workspace
  const workspace = normalizeWorkspaceForLoad(ws)
  if (workspace.pieces.length === 0) {
    return { ok: false, error: 'Projekt enthält keine Schnittteile.' }
  }

  const notchSettings: ProjectNotchSetting[] = Array.isArray(o.notchSettings)
    ? o.notchSettings.map((n) => {
        const x = n as Record<string, unknown>
        return {
          type: x.type === 'kerbe' ? 'kerbe' : 'strich',
          widthMm: typeof x.widthMm === 'number' && Number.isFinite(x.widthMm) ? x.widthMm : 6,
          depthMm: typeof x.depthMm === 'number' && Number.isFinite(x.depthMm) ? x.depthMm : 4,
        }
      })
    : []

  const dxfExportScale =
    typeof o.dxfExportScale === 'number' && Number.isFinite(o.dxfExportScale) && o.dxfExportScale > 0 ? o.dxfExportScale : 1
  const dxfImportExtraCutLayers = typeof o.dxfImportExtraCutLayers === 'string' ? o.dxfImportExtraCutLayers : ''
  const dxfImportScale =
    typeof o.dxfImportScale === 'number' && Number.isFinite(o.dxfImportScale) && o.dxfImportScale > 0 ? o.dxfImportScale : 1
  const dxfImportDetectVNotches = o.dxfImportDetectVNotches === false ? false : true
  const dxfImportCreateSeamLine = Boolean(o.dxfImportCreateSeamLine)
  const dxfImportSeamAllowanceMm =
    typeof o.dxfImportSeamAllowanceMm === 'number' &&
    Number.isFinite(o.dxfImportSeamAllowanceMm) &&
    o.dxfImportSeamAllowanceMm > 0
      ? o.dxfImportSeamAllowanceMm
      : 8

  let imageDigitizeSession: TrimTexProjectImageSession | null = null
  if (o.imageDigitizeSession !== undefined && o.imageDigitizeSession !== null) {
    const img = o.imageDigitizeSession as Record<string, unknown>
    if (
      typeof img.renderMmPerPixel === 'number' &&
      Number.isFinite(img.renderMmPerPixel) &&
      img.imagePosition &&
      isPoint(img.imagePosition)
    ) {
      imageDigitizeSession = {
        imageDataUrl: typeof img.imageDataUrl === 'string' ? img.imageDataUrl : null,
        imageSizePx:
          img.imageSizePx &&
          typeof img.imageSizePx === 'object' &&
          typeof (img.imageSizePx as { width?: unknown }).width === 'number' &&
          typeof (img.imageSizePx as { height?: unknown }).height === 'number'
            ? {
                width: (img.imageSizePx as { width: number }).width,
                height: (img.imageSizePx as { height: number }).height,
              }
            : null,
        imagePosition: { ...(img.imagePosition as Point) },
        renderMmPerPixel: img.renderMmPerPixel,
        locked: Boolean(img.locked),
      }
    }
  }

  const data: TrimTexProjectFileV1 = {
    format: TRIMTEX_PROJECT_FORMAT,
    version: TRIMTEX_PROJECT_VERSION,
    savedAt: typeof o.savedAt === 'string' ? o.savedAt : new Date().toISOString(),
    workspace,
    dxfExportScale,
    dxfImportExtraCutLayers,
    dxfImportScale,
    dxfImportDetectVNotches,
    dxfImportCreateSeamLine,
    dxfImportSeamAllowanceMm,
    notchSettings: notchSettings.length >= 10 ? notchSettings : Array.from({ length: 10 }, (_, i) => notchSettings[i] ?? { type: 'strich', widthMm: 6, depthMm: 4 }),
    imageDigitizeSession,
  }

  return { ok: true, data }
}

/** Dateiname aus Arbeitsflächennamen ableiten (nur sichere Zeichen). */
export function suggestedTrimTexProjectFilename(workspaceName: string): string {
  const safe = workspaceName.replace(/[^\w\u00C0-\u024f\-]+/g, '_').replace(/_+/g, '_').slice(0, 80) || 'trimtex-projekt'
  return `${safe}.json`
}

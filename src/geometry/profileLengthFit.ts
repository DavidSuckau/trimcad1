import type { Curve, PatternPiece, Point, ProfileAssignment } from '../types/model'
import {
  curveSegmentArcLength,
  outwardNormalAngleAt,
  pathLengthAt,
  pointAtPathLength,
  totalPathLength,
} from './curveToPath'
import { enumerateEdges } from './edgeEnumeration'
import {
  getNotchesOnInternalProfilePath,
  getProfileAssignmentInternalCurveIndices,
  profileAssignmentLengthMm,
} from './internalLineProfile'
import { materializeNotchAnchorsOnInternalLine } from './notchOnInternalLine'
import { materializeNotchAnchorsOnCutLine } from './notchOnCurve'
import {
  edgeTotalLength,
  getCurvesForSeamEdge,
  getNotchesOnEdge,
  snapVertexToEdgeLength,
  type NotchBoundaryRange,
} from './seamUtils'
import { useSeamLineForVertexEditing } from './vertexMaster'

/** Profillängen-Raster: 0, 5, 10, 15, … mm */
export const PROFILE_LENGTH_STEP_MM = 5

/** Mindest-Profillänge (mm). */
export const PROFILE_LENGTH_MIN_MM = 5

/** Auf 5-mm-Raster runden (0, 5, 10, 15, …). */
export function snapProfileLengthMm(rawLengthMm: number): number {
  if (!Number.isFinite(rawLengthMm) || rawLengthMm <= 0) return PROFILE_LENGTH_MIN_MM
  const snapped = Math.round(rawLengthMm / PROFILE_LENGTH_STEP_MM) * PROFILE_LENGTH_STEP_MM
  return Math.max(PROFILE_LENGTH_MIN_MM, snapped)
}

export type ProfileFitAdjustTarget =
  | { kind: 'endVertex'; vertexIndex: number; position: Point }
  | {
      kind: 'endNotch'
      notchId: string
      position: Point
      angle: number
      onInternalLine: boolean
      internalLineIndex?: number
      curveIndex: number
      t: number
      sNormalized?: number
      arcLengthMm?: number
      internalSNormalized?: number
    }
  | { kind: 'internalLineEnd'; curveIndex: number; end: 'start' | 'end'; position: Point }

export type ProfileFitPreview = {
  assignmentId: string
  profileKey: string
  targetLengthMm: number
  currentLengthMm: number
  adjust: ProfileFitAdjustTarget
}

type ProfilePathContext = {
  curveIndices: number[]
  curves: Curve[]
  onInternalLine: boolean
  range: NotchBoundaryRange | null
  getNotches: (piece: PatternPiece, curveIndices: number[], curves: Curve[]) => { notchId: string; arcLength: number }[]
}

function profilePathContext(piece: PatternPiece, pa: ProfileAssignment): ProfilePathContext | null {
  const range: NotchBoundaryRange | null =
    pa.startNotchId || pa.endNotchId
      ? { startNotchId: pa.startNotchId, endNotchId: pa.endNotchId }
      : null

  if (pa.onInternalLine) {
    const curveIndices = getProfileAssignmentInternalCurveIndices(piece, pa)
    if (curveIndices.length === 0) return null
    return {
      curveIndices,
      curves: piece.internalLines,
      onInternalLine: true,
      range,
      getNotches: getNotchesOnInternalProfilePath,
    }
  }

  const edges = enumerateEdges(piece)
  const edge = edges.find((e) => e.edgeIndex === pa.edgeIndex)
  if (!edge) return null
  return {
    curveIndices: edge.curveIndices,
    curves: getCurvesForSeamEdge(piece),
    onInternalLine: false,
    range,
    getNotches: getNotchesOnEdge,
  }
}

function pathTotalLength(curveIndices: number[], curves: Curve[]): number {
  let total = 0
  for (const ci of curveIndices) {
    const seg = curves[ci]
    if (seg) total += curveSegmentArcLength(seg, 0, 1)
  }
  return total
}

function pointAtArcOnPath(
  curveIndices: number[],
  curves: Curve[],
  arcLength: number
): { curveIndex: number; t: number; point: Point } | null {
  const segs: Curve[] = []
  const cis: number[] = []
  for (const ci of curveIndices) {
    const seg = curves[ci]
    if (seg) {
      segs.push(seg)
      cis.push(ci)
    }
  }
  if (segs.length === 0) return null
  const total = totalPathLength(segs)
  const L = Math.max(0, Math.min(total, arcLength))
  const pt = pointAtPathLength(segs, L)
  if (!pt) return null
  const curveIndex = cis[pt.curveIndex]
  if (curveIndex == null) return null
  return { curveIndex, t: pt.t, point: pt.point }
}

function startArcOnPath(
  piece: PatternPiece,
  ctx: ProfilePathContext
): number {
  const all = ctx.getNotches(piece, ctx.curveIndices, ctx.curves)
  if (ctx.range?.startNotchId) {
    const start = all.find((n) => n.notchId === ctx.range!.startNotchId)
    if (start) return start.arcLength
  }
  return 0
}

function buildNotchAdjustTarget(
  piece: PatternPiece,
  ctx: ProfilePathContext,
  notchId: string,
  targetEndArc: number
): ProfileFitAdjustTarget | null {
  const pt = pointAtArcOnPath(ctx.curveIndices, ctx.curves, targetEndArc)
  if (!pt) return null

  if (ctx.onInternalLine) {
    const segLen = curveSegmentArcLength(ctx.curves[pt.curveIndex], 0, 1)
    const angle = outwardNormalAngleAt(ctx.curves, pt.curveIndex, pt.t) + 180
    const internalSNormalized = segLen > 0 ? pt.t : 0
    const notch = piece.notches.find((n) => n.id === notchId)
    const draft = {
      ...(notch ?? {
        id: notchId,
        position: pt.point,
        angle,
        type: 'single' as const,
        depth: 3,
      }),
      position: pt.point,
      angle,
      internalLineIndex: pt.curveIndex,
      internalSNormalized,
    }
    const materialized = materializeNotchAnchorsOnInternalLine(draft, ctx.curves)
    const pos = materialized?.position ?? pt.point
    const ang = materialized?.angle ?? angle
    return {
      kind: 'endNotch',
      notchId,
      position: pos,
      angle: ang,
      onInternalLine: true,
      internalLineIndex: pt.curveIndex,
      curveIndex: pt.curveIndex,
      t: pt.t,
      internalSNormalized,
    }
  }

  const angle = outwardNormalAngleAt(ctx.curves, pt.curveIndex, pt.t) + 180
  const cutLine = piece.cutLine
  const cutArc =
    cutLine.length >= 3 ? pathLengthAt(cutLine, pt.curveIndex, pt.t) : undefined
  const cutTotal = cutLine.length >= 3 ? totalPathLength(cutLine) : 0
  const cutAnchor =
    cutArc != null && cutTotal > 0
      ? { sNormalized: cutArc / cutTotal, arcLengthMm: cutArc }
      : {}

  return {
    kind: 'endNotch',
    notchId,
    position: { ...pt.point },
    angle,
    onInternalLine: false,
    curveIndex: pt.curveIndex,
    t: pt.t,
    ...cutAnchor,
  }
}

/**
 * Berechnet, welches Ende (Ecke oder End-Notch) verschoben werden muss,
 * damit die Profilstrecke exakt `targetLengthMm` hat.
 */
export function computeProfileFitAdjustTarget(
  piece: PatternPiece,
  pa: ProfileAssignment,
  targetLengthMm: number
): ProfileFitAdjustTarget | null {
  if (!Number.isFinite(targetLengthMm) || targetLengthMm <= 0) return null
  const ctx = profilePathContext(piece, pa)
  if (!ctx) return null

  const total = pathTotalLength(ctx.curveIndices, ctx.curves)
  if (total <= 0) return null

  const startArc = startArcOnPath(piece, ctx)
  const targetEndArc = startArc + targetLengthMm

  if (ctx.range?.endNotchId) {
    if (targetEndArc > total + 1e-6) return null
    return buildNotchAdjustTarget(piece, ctx, ctx.range.endNotchId, targetEndArc)
  }

  if (ctx.onInternalLine) {
    const ci = ctx.curveIndices[0]
    const seg = ctx.curves[ci]
    if (!seg || seg.type === 'bezier') return null
    let pt: { curveIndex: number; t: number; point: Point } | null
    if (targetEndArc > total + 1e-6) {
      const dx = seg.end.x - seg.start.x
      const dy = seg.end.y - seg.start.y
      const len = Math.hypot(dx, dy) || 1
      const extra = targetEndArc - total
      pt = {
        curveIndex: ci,
        t: 1,
        point: { x: seg.end.x + (dx / len) * extra, y: seg.end.y + (dy / len) * extra },
      }
    } else {
      pt = pointAtArcOnPath(ctx.curveIndices, ctx.curves, targetEndArc)
    }
    if (!pt) return null
    return { kind: 'internalLineEnd', curveIndex: ci, end: 'end', position: { ...pt.point } }
  }

  const masterK = ctx.curves
  const n = masterK.length
  const lastCi = ctx.curveIndices[ctx.curveIndices.length - 1]
  const endVi = (lastCi + 1) % n
  const totalEdgeLen =
    ctx.range?.startNotchId && !ctx.range?.endNotchId ? startArc + targetLengthMm : targetLengthMm
  const currentLen = edgeTotalLength(piece, ctx.curveIndices, masterK)
  const snapPt =
    totalEdgeLen > currentLen + 1e-6
      ? extendVertexToEdgeLength(ctx.curveIndices, masterK, endVi, totalEdgeLen)
      : snapVertexToEdgeLength(piece, ctx.curveIndices, endVi, totalEdgeLen, masterK)
  if (!snapPt) return null
  return { kind: 'endVertex', vertexIndex: endVi, position: snapPt }
}

/** End-Eckpunkt entlang der letzten Kante verlängern, wenn `snapVertexToEdgeLength` nur kürzt. */
function extendVertexToEdgeLength(
  curveIndices: number[],
  curves: Curve[],
  endVi: number,
  targetLength: number
): Point | null {
  const n = curves.length
  if (n === 0 || curveIndices.length === 0) return null
  const lastCi = curveIndices[curveIndices.length - 1]
  if (endVi !== (lastCi + 1) % n) return null
  const segs = curveIndices.map((ci) => curves[ci]).filter(Boolean)
  if (segs.length === 0) return null
  const segLast = segs[segs.length - 1]
  if (segLast.type !== 'line') return null
  let fixed = 0
  for (let i = 0; i < segs.length - 1; i++) {
    fixed += curveSegmentArcLength(segs[i], 0, 1)
  }
  const segLen = curveSegmentArcLength(segLast, 0, 1)
  const currentLen = fixed + segLen
  if (targetLength <= currentLen + 1e-6) {
    return null
  }
  const extra = targetLength - currentLen
  const dx = segLast.end.x - segLast.start.x
  const dy = segLast.end.y - segLast.start.y
  const len = Math.hypot(dx, dy) || 1
  return {
    x: segLast.end.x + (dx / len) * extra,
    y: segLast.end.y + (dy / len) * extra,
  }
}

export function computeProfileFitPreview(
  piece: PatternPiece,
  pa: ProfileAssignment
): ProfileFitPreview | null {
  const targetLengthMm = pa.targetLengthMm
  if (targetLengthMm == null || !Number.isFinite(targetLengthMm)) return null
  const currentLengthMm = profileAssignmentLengthMm(piece, pa)
  const adjust = computeProfileFitAdjustTarget(piece, pa, targetLengthMm)
  if (!adjust) return null

  const tol = 0.05
  const needsAdjust = Math.abs(currentLengthMm - targetLengthMm) > tol
  if (!needsAdjust) return null

  return {
    assignmentId: pa.id,
    profileKey: pa.profileKey,
    targetLengthMm,
    currentLengthMm,
    adjust,
  }
}

export function computeProfileFitPreviewsForPiece(
  piece: PatternPiece,
  assignments: ProfileAssignment[]
): ProfileFitPreview[] {
  return assignments
    .filter((pa) => pa.pieceId === piece.id && pa.targetLengthMm != null)
    .map((pa) => computeProfileFitPreview(piece, pa))
    .filter((p): p is ProfileFitPreview => p != null)
}

function applyNotchTarget(piece: PatternPiece, target: Extract<ProfileFitAdjustTarget, { kind: 'endNotch' }>): PatternPiece {
  const notches = piece.notches.map((n) => {
    if (n.id !== target.notchId) return n
    const next = {
      ...n,
      position: { ...target.position },
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
    }
    if (target.onInternalLine && piece.internalLines.length > 0) {
      return materializeNotchAnchorsOnInternalLine(next, piece.internalLines) ?? next
    }
    if (piece.cutLine.length >= 3) {
      const withAnchors =
        target.sNormalized != null || target.arcLengthMm != null
          ? next
          : materializeNotchAnchorsOnCutLine(next, piece.cutLine) ?? next
      return withAnchors
    }
    return next
  })
  return { ...piece, notches }
}

function applyInternalLineEnd(piece: PatternPiece, target: Extract<ProfileFitAdjustTarget, { kind: 'internalLineEnd' }>): PatternPiece {
  const internalLines = piece.internalLines.map((c, i) => {
    if (i !== target.curveIndex || c.type !== 'line') return c
    if (target.end === 'start') {
      return { ...c, start: { ...target.position } }
    }
    return { ...c, end: { ...target.position } }
  })
  const notches = piece.notches.map((n) => {
    if (!n.internalLineIndex || n.internalLineIndex !== target.curveIndex) return n
    return materializeNotchAnchorsOnInternalLine(n, internalLines) ?? n
  })
  return { ...piece, internalLines, notches }
}

function applyEndVertex(piece: PatternPiece, target: Extract<ProfileFitAdjustTarget, { kind: 'endVertex' }>): PatternPiece {
  const useSeam = useSeamLineForVertexEditing(piece)
  const masterKey = useSeam ? 'seamLine' : 'cutLine'
  const master = piece[masterKey]
  const vi = target.vertexIndex
  if (vi < 0 || vi >= master.length) return piece

  const nextMaster = master.map((c, i) => {
    if (i === vi) return { ...c, start: { ...target.position } }
    const prev = (i - 1 + master.length) % master.length
    if (prev === vi) return { ...c, start: { ...target.position } }
    if (i === (vi - 1 + master.length) % master.length) return { ...c, end: { ...target.position } }
    return c
  }) as Curve[]

  if (useSeam) {
    return { ...piece, seamLine: nextMaster }
  }
  return { ...piece, cutLine: nextMaster }
}

/** Wendet eine Fit-Korrektur auf ein Teil an (reine Geometrie, ohne Store-Nebenwirkungen). */
export function applyProfileFitAdjustTarget(piece: PatternPiece, target: ProfileFitAdjustTarget): PatternPiece {
  switch (target.kind) {
    case 'endNotch':
      return applyNotchTarget(piece, target)
    case 'internalLineEnd':
      return applyInternalLineEnd(piece, target)
    case 'endVertex':
      return applyEndVertex(piece, target)
  }
}

/** Passt Geometrie an und liefert Ziel-Länge (5-mm-Raster). */
export function fitPieceToProfileAssignment(
  piece: PatternPiece,
  pa: ProfileAssignment
): { piece: PatternPiece; targetLengthMm: number; adjusted: boolean } {
  const rawLen = profileAssignmentLengthMm(piece, pa)
  const targetLengthMm = snapProfileLengthMm(rawLen)
  const adjust = computeProfileFitAdjustTarget(piece, pa, targetLengthMm)
  if (!adjust) {
    return { piece, targetLengthMm, adjusted: false }
  }
  const nextPiece = applyProfileFitAdjustTarget(piece, adjust)
  return { piece: nextPiece, targetLengthMm, adjusted: true }
}

/** Wendet alle Fit-Vorschau-Korrekturen nacheinander an. */
export function applyProfileFitPreviews(piece: PatternPiece, previews: ProfileFitPreview[]): PatternPiece {
  let next = piece
  for (const preview of previews) {
    next = applyProfileFitAdjustTarget(next, preview.adjust)
  }
  return next
}

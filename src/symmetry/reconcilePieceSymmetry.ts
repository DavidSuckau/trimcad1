import type { Curve, Notch, PatternPiece, Point } from '../types/model'
import { useSeamLineForVertexEditing } from '../geometry/vertexMaster'
import { deriveCutLineForPiece } from '../geometry/deriveCutLineForPiece'
import { preferStableCutAfterGeometricMirror } from '../geometry/seamAllowanceInvariants'
import { offsetCurvesInwardForSeam } from '../geometry/offset'
import { applySharpCornerPromotion } from '../geometry/softVertexPromotion'
import { splitBezierAt } from '../geometry/curveToPath'
import { nearestCurveIndexAndPoint } from '../geometry/nearestOnCurve'
import { materializeNotchAnchorsOnCutLine } from '../geometry/notchOnCurve'
import { isNotchOnInternalLine } from '../geometry/notchOnInternalLine'
import {
  crossZ,
  curveReferencePoint,
  mirrorAngleDegrees,
  mirrorCurveAcrossLine,
  mirrorPointAcrossLine,
  pointInKeepHalfPlane,
  type PieceSymmetryKeepSide,
} from '../geometry/pieceSymmetry'
import type { PieceSymmetryConstraint } from '../types/model'

const AXIS_CROSS_EPS = 0.8
const VERTEX_MATCH_MM = 0.25
const CURVE_PAIR_MAX_MM = 20
const LINE_SPLIT_MIN_MM = 0.5

export function getContourVertexPosition(curves: Curve[], vertexIndex: number): Point {
  if (vertexIndex === 0) return { ...curves[0].start }
  return { ...curves[vertexIndex].start }
}

function cloneCurve(c: Curve): Curve {
  if (c.type === 'line') {
    return { type: 'line', start: { ...c.start }, end: { ...c.end } }
  }
  return {
    type: 'bezier',
    start: { ...c.start },
    end: { ...c.end },
    cp1: { ...c.cp1 },
    cp2: { ...c.cp2 },
  }
}

function curveHalfPlane(
  c: Curve,
  axisA: Point,
  axisB: Point,
  keepSide: PieceSymmetryKeepSide
): 'keep' | 'mirror' | 'axis' {
  const ref = curveReferencePoint(c)
  const cz = crossZ(axisA, axisB, ref)
  if (Math.abs(cz) < AXIS_CROSS_EPS) return 'axis'
  return pointInKeepHalfPlane(ref, axisA, axisB, keepSide) ? 'keep' : 'mirror'
}

function vertexHalfPlane(
  p: Point,
  axisA: Point,
  axisB: Point,
  keepSide: PieceSymmetryKeepSide
): 'keep' | 'mirror' | 'axis' {
  const cz = crossZ(axisA, axisB, p)
  if (Math.abs(cz) < AXIS_CROSS_EPS) return 'axis'
  return pointInKeepHalfPlane(p, axisA, axisB, keepSide) ? 'keep' : 'mirror'
}

export function findKeepSidePartnerVertex(
  curves: Curve[],
  fromIndex: number,
  axisA: Point,
  axisB: Point,
  keepSide: PieceSymmetryKeepSide
): number {
  const n = curves.length
  if (n === 0) return fromIndex
  const fromPos = getContourVertexPosition(curves, fromIndex)
  const partnerIdeal = mirrorPointAcrossLine(fromPos, axisA, axisB)
  let best = fromIndex
  let bestD = Infinity
  for (let i = 0; i < n; i++) {
    const pi = getContourVertexPosition(curves, i)
    if (vertexHalfPlane(pi, axisA, axisB, keepSide) !== 'keep') continue
    const d = Math.hypot(pi.x - partnerIdeal.x, pi.y - partnerIdeal.y)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

export function findMirrorSidePartnerVertex(
  curves: Curve[],
  fromIndex: number,
  axisA: Point,
  axisB: Point,
  keepSide: PieceSymmetryKeepSide
): number {
  const n = curves.length
  if (n === 0) return fromIndex
  const fromPos = getContourVertexPosition(curves, fromIndex)
  const partnerIdeal = mirrorPointAcrossLine(fromPos, axisA, axisB)
  let best = fromIndex
  let bestD = Infinity
  for (let i = 0; i < n; i++) {
    const pi = getContourVertexPosition(curves, i)
    if (vertexHalfPlane(pi, axisA, axisB, keepSide) !== 'mirror') continue
    const d = Math.hypot(pi.x - partnerIdeal.x, pi.y - partnerIdeal.y)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

export function findKeepSidePartnerCurve(
  curves: Curve[],
  fromCurveIndex: number,
  axisA: Point,
  axisB: Point,
  keepSide: PieceSymmetryKeepSide
): number {
  const n = curves.length
  if (n === 0) return fromCurveIndex
  const fromRef = curveReferencePoint(curves[fromCurveIndex])
  const partnerIdeal = mirrorPointAcrossLine(fromRef, axisA, axisB)
  let best = fromCurveIndex
  let bestD = Infinity
  for (let i = 0; i < n; i++) {
    const ri = curveReferencePoint(curves[i])
    if (curveHalfPlane(curves[i], axisA, axisB, keepSide) !== 'keep') continue
    const d = Math.hypot(ri.x - partnerIdeal.x, ri.y - partnerIdeal.y)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

export function findMirrorSidePartnerCurve(
  curves: Curve[],
  fromCurveIndex: number,
  axisA: Point,
  axisB: Point,
  keepSide: PieceSymmetryKeepSide
): number {
  const n = curves.length
  if (n === 0) return fromCurveIndex
  const fromRef = curveReferencePoint(curves[fromCurveIndex])
  const partnerIdeal = mirrorPointAcrossLine(fromRef, axisA, axisB)
  let best = fromCurveIndex
  let bestD = Infinity
  for (let i = 0; i < n; i++) {
    const ri = curveReferencePoint(curves[i])
    if (curveHalfPlane(curves[i], axisA, axisB, keepSide) !== 'mirror') continue
    const d = Math.hypot(ri.x - partnerIdeal.x, ri.y - partnerIdeal.y)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

function masterCurvesForPiece(piece: PatternPiece): Curve[] {
  return useSeamLineForVertexEditing(piece) && piece.seamLine.length >= 3 ? piece.seamLine : piece.cutLine
}

/** Spiegelt keep-Kurven auf die Partner-Kurven der anderen Seite – ohne Clipper/Tessellation. */
export function syncMasterCurvesByMirroring(
  curves: Curve[],
  axisA: Point,
  axisB: Point,
  keepSide: PieceSymmetryKeepSide
): Curve[] {
  const next = curves.map(cloneCurve)
  const keepIndices: number[] = []
  const mirrorIndices: number[] = []
  for (let i = 0; i < next.length; i++) {
    const hp = curveHalfPlane(next[i], axisA, axisB, keepSide)
    if (hp === 'keep') keepIndices.push(i)
    else if (hp === 'mirror') mirrorIndices.push(i)
  }
  const usedMirror = new Set<number>()
  for (const ki of keepIndices) {
    const mirrored = mirrorCurveAcrossLine(next[ki], axisA, axisB)
    const targetRef = curveReferencePoint(mirrored)
    let bestMi = -1
    let bestD = Infinity
    for (const mi of mirrorIndices) {
      if (usedMirror.has(mi)) continue
      const ref = curveReferencePoint(next[mi])
      const d = Math.hypot(ref.x - targetRef.x, ref.y - targetRef.y)
      if (d < bestD) {
        bestD = d
        bestMi = mi
      }
    }
    if (bestMi >= 0 && bestD < CURVE_PAIR_MAX_MM) {
      next[bestMi] = mirrored
      usedMirror.add(bestMi)
    }
  }
  return next
}

function syncSoftVerticesForSymmetry(
  piece: PatternPiece,
  masterCurves: Curve[],
  sc: PieceSymmetryConstraint
): Pick<PatternPiece, 'softVertices' | 'softVerticesMaster'> {
  const seamMaster = useSeamLineForVertexEditing(piece) && piece.seamLine.length >= 3
  const existing = seamMaster ? piece.softVerticesMaster ?? [] : piece.softVertices ?? []
  const soft = new Set(existing)
  const n = masterCurves.length
  for (let i = 0; i < n; i++) {
    if (!soft.has(i)) continue
    const pos = getContourVertexPosition(masterCurves, i)
    const hp = vertexHalfPlane(pos, sc.axisA, sc.axisB, sc.keepSide)
    if (hp === 'axis') continue
    const partner =
      hp === 'keep'
        ? findMirrorSidePartnerVertex(masterCurves, i, sc.axisA, sc.axisB, sc.keepSide)
        : findKeepSidePartnerVertex(masterCurves, i, sc.axisA, sc.axisB, sc.keepSide)
    if (partner >= 0 && partner < n) soft.add(partner)
  }
  const sorted = [...soft].sort((a, b) => a - b)
  if (seamMaster) {
    return { softVerticesMaster: sorted, softVertices: piece.softVertices }
  }
  return { softVertices: sorted, softVerticesMaster: piece.softVerticesMaster }
}

function splitMasterCurveAtPoint(
  curves: Curve[],
  curveIndex: number,
  splitPoint: Point,
  t?: number
): { curves: Curve[]; newVertexIndex: number } | null {
  if (curveIndex < 0 || curveIndex >= curves.length) return null
  const curve = curves[curveIndex]
  const next = curves.map(cloneCurve)
  if (curve.type === 'line') {
    const lineLen = Math.hypot(curve.end.x - curve.start.x, curve.end.y - curve.start.y)
    const minT = Math.min(0.49, LINE_SPLIT_MIN_MM / Math.max(lineLen, 1e-6))
    const tt = Number.isFinite(t) ? Math.min(1 - minT, Math.max(minT, t as number)) : null
    const pt =
      tt == null
        ? splitPoint
        : {
            x: curve.start.x + (curve.end.x - curve.start.x) * tt,
            y: curve.start.y + (curve.end.y - curve.start.y) * tt,
          }
    const seg1: Curve = { type: 'line', start: { ...curve.start }, end: { ...pt } }
    const seg2: Curve = { type: 'line', start: { ...pt }, end: { ...curve.end } }
    next.splice(curveIndex, 1, seg1, seg2)
    return { curves: next, newVertexIndex: curveIndex + 1 }
  }
  if (curve.type === 'bezier' && t != null && t > 0 && t < 1) {
    const [seg1, seg2] = splitBezierAt(curve, t)
    next.splice(curveIndex, 1, seg1, seg2)
    return { curves: next, newVertexIndex: curveIndex + 1 }
  }
  return null
}

function applyMasterContourToPiece(piece: PatternPiece, masterCurves: Curve[]): PatternPiece {
  const seamMaster = useSeamLineForVertexEditing(piece) && piece.seamLine.length >= 3
  if (seamMaster && piece.seamAllowanceMm != null) {
    const seamLine = masterCurves
    if (piece.cutLineDeviatesFromSeamAllowanceOffset === true && piece.cutLine.length >= 3) {
      const sc = piece.symmetryConstraint!
      const mirroredCut = syncMasterCurvesByMirroring(piece.cutLine, sc.axisA, sc.axisB, sc.keepSide)
      const derived = deriveCutLineForPiece({ ...piece, seamLine }, seamLine, piece.seamAllowanceMm)
      const cutLine = preferStableCutAfterGeometricMirror(
        seamLine,
        mirroredCut,
        derived.ok ? derived.cutLine : null,
        piece.seamAllowanceMm
      )
      return { ...piece, seamLine, cutLine }
    }
    const derived = deriveCutLineForPiece({ ...piece, seamLine }, seamLine, piece.seamAllowanceMm)
    if (!derived.ok) return piece
    return { ...piece, seamLine, cutLine: derived.cutLine }
  }
  const cutLine = masterCurves
  const seamLine =
    piece.seamAllowanceMm != null && cutLine.length >= 3
      ? offsetCurvesInwardForSeam(cutLine, piece.seamAllowanceMm)
      : piece.seamLine
  return { ...piece, cutLine, seamLine }
}

export function syncPieceSymmetryGeometry(
  piece: PatternPiece
): { ok: true; piece: PatternPiece } | { ok: false; toastMessage: string } {
  const sc = piece.symmetryConstraint
  if (!sc) return { ok: true, piece }

  const masterIn = masterCurvesForPiece(piece)
  if (masterIn.length < 3) {
    return { ok: false, toastMessage: 'warn:Kontur zu kurz für Symmetrie.' }
  }

  const syncedMaster = syncMasterCurvesByMirroring(masterIn, sc.axisA, sc.axisB, sc.keepSide)
  let updated = applyMasterContourToPiece(piece, syncedMaster)
  const masterOut = masterCurvesForPiece(updated)
  const soft = syncSoftVerticesForSymmetry(updated, masterOut, sc)

  const promoted = applySharpCornerPromotion({
    ...updated,
    ...soft,
    symmetryConstraint: sc,
  })

  return { ok: true, piece: promoted }
}

export function mapContourVertexEditForSymmetry(
  piece: PatternPiece,
  vertexIndex: number,
  point: Point
): { vertexIndex: number; point: Point } {
  const sc = piece.symmetryConstraint
  if (!sc) return { vertexIndex, point }
  const curves = masterCurvesForPiece(piece)
  if (curves.length === 0) return { vertexIndex, point }
  const vtxPos = getContourVertexPosition(curves, vertexIndex)
  if (vertexHalfPlane(vtxPos, sc.axisA, sc.axisB, sc.keepSide) !== 'mirror') {
    return { vertexIndex, point }
  }
  return {
    vertexIndex: findKeepSidePartnerVertex(curves, vertexIndex, sc.axisA, sc.axisB, sc.keepSide),
    point: mirrorPointAcrossLine(point, sc.axisA, sc.axisB),
  }
}

export function mapCurveEditForSymmetry(
  piece: PatternPiece,
  curveIndex: number,
  point: Point
): { curveIndex: number; point: Point } {
  const sc = piece.symmetryConstraint
  if (!sc) return { curveIndex, point }
  const curves = masterCurvesForPiece(piece)
  const c = curves[curveIndex]
  if (!c) return { curveIndex, point }
  if (curveHalfPlane(c, sc.axisA, sc.axisB, sc.keepSide) !== 'mirror') {
    return { curveIndex, point }
  }
  return {
    curveIndex: findKeepSidePartnerCurve(curves, curveIndex, sc.axisA, sc.axisB, sc.keepSide),
    point: mirrorPointAcrossLine(point, sc.axisA, sc.axisB),
  }
}

/** Nach Punkt-Einfügen auf der Vorlagen-Seite: Partner-Punkt auf der Gegenseite (blau). */
export function mirrorSymmetricContourPointInsert(
  piece: PatternPiece,
  insertedVertexIndex: number,
  insertedPoint: Point
): { ok: true; piece: PatternPiece } | { ok: false; toastMessage: string } {
  const sc = piece.symmetryConstraint
  if (!sc) return { ok: true, piece }

  const master = masterCurvesForPiece(piece)
  const mirroredPoint = mirrorPointAcrossLine(insertedPoint, sc.axisA, sc.axisB)

  for (let i = 0; i < master.length; i++) {
    const vi = getContourVertexPosition(master, i)
    if (Math.hypot(vi.x - mirroredPoint.x, vi.y - mirroredPoint.y) < VERTEX_MATCH_MM) {
      const soft = syncSoftVerticesForSymmetry(piece, master, sc)
      const withSoft = applySharpCornerPromotion({ ...piece, ...soft, symmetryConstraint: sc })
      return syncPieceSymmetryGeometry(withSoft)
    }
  }

  const mirrorCurves = master
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => curveHalfPlane(c, sc.axisA, sc.axisB, sc.keepSide) === 'mirror')
  if (mirrorCurves.length === 0) {
    return syncPieceSymmetryGeometry(piece)
  }

  const hit = nearestCurveIndexAndPoint(mirroredPoint, mirrorCurves.map((x) => x.c))
  if (!hit || !Number.isFinite(hit.distance) || hit.distance > CURVE_PAIR_MAX_MM) {
    return syncPieceSymmetryGeometry(piece)
  }

  const localCurveIndex = mirrorCurves[hit.curveIndex]?.i
  if (localCurveIndex == null) return syncPieceSymmetryGeometry(piece)

  const split = splitMasterCurveAtPoint(master, localCurveIndex, hit.point, hit.t)
  if (!split) return syncPieceSymmetryGeometry(piece)

  let updated = applyMasterContourToPiece(piece, split.curves)
  const seamMaster = useSeamLineForVertexEditing(updated) && updated.seamLine.length >= 3
  const newVi = split.newVertexIndex
  if (seamMaster) {
    const softVerticesMaster = [
      ...(updated.softVerticesMaster ?? []).map((vi) => (vi >= newVi ? vi + 1 : vi)),
      newVi,
      insertedVertexIndex,
    ].sort((a, b) => a - b)
    updated = { ...updated, softVerticesMaster }
  } else {
    const softVertices = [
      ...(updated.softVertices ?? []).map((vi) => (vi >= newVi ? vi + 1 : vi)),
      newVi,
      insertedVertexIndex,
    ].sort((a, b) => a - b)
    updated = { ...updated, softVertices }
  }

  return syncPieceSymmetryGeometry(updated)
}

export function appendSymmetricMirroredNotches(piece: PatternPiece, notch: Notch): Notch[] {
  const sc = piece.symmetryConstraint
  if (!sc || isNotchOnInternalLine(notch)) {
    return [...piece.notches, notch]
  }

  const primary = materializeNotchAnchorsOnCutLine(notch, piece.cutLine) ?? notch
  const onAxis = Math.abs(crossZ(sc.axisA, sc.axisB, primary.position)) < AXIS_CROSS_EPS
  if (onAxis) return [...piece.notches, primary]

  const mirroredRaw: Notch = {
    ...primary,
    id: `n${Math.random().toString(36).slice(2, 10)}`,
    position: mirrorPointAcrossLine(primary.position, sc.axisA, sc.axisB),
    angle: mirrorAngleDegrees(primary.angle, sc.axisA, sc.axisB),
    sNormalized: undefined,
    arcLengthMm: undefined,
  }
  const mirrored = materializeNotchAnchorsOnCutLine(mirroredRaw, piece.cutLine) ?? mirroredRaw
  return [...piece.notches, primary, mirrored]
}

export function finalizePieceContourEdit(
  piece: PatternPiece
): { ok: true; piece: PatternPiece } | { ok: false; toastMessage: string } {
  return syncPieceSymmetryGeometry(piece)
}

export function symmetryConstraintFromAxis(
  axisA: Point,
  axisB: Point,
  keepSide: PieceSymmetryKeepSide
): PieceSymmetryConstraint {
  return {
    axisA: { ...axisA },
    axisB: { ...axisB },
    keepSide,
  }
}

import type { PatternPiece } from '../types/model'
import { offsetCurvesInwardForSeam } from '../geometry/offset'
import { materializeNotchAnchorsOnCutLine } from '../geometry/notchOnCurve'
import {
  isNotchOnInternalLine,
  materializeNotchAnchorsOnInternalLine,
} from '../geometry/notchOnInternalLine'
import { applySharpCornerPromotion } from '../geometry/softVertexPromotion'
import { useSeamLineForVertexEditing } from '../geometry/vertexMaster'
import { deriveCutLineForPiece } from '../geometry/deriveCutLineForPiece'
import {
  buildSymmetricContour,
  mirrorPointAcrossLine,
  mirrorCurveAcrossLine,
  pointInKeepHalfPlane,
  curveReferencePoint,
  mirrorAngleDegrees,
  type PieceSymmetryKeepSide,
} from '../geometry/pieceSymmetry'

export type ApplyPieceSymmetryToPieceResult =
  | { ok: true; piece: PatternPiece }
  | { ok: false; toastMessage: string }

/**
 * Wendet Teil-Symmetrie auf ein einzelnes Stück an (reine Logik, kein Workspace/Store).
 */
export function applyPieceSymmetryToPiece(
  piece: PatternPiece,
  axisA: { x: number; y: number },
  axisB: { x: number; y: number },
  keepSide: PieceSymmetryKeepSide
): ApplyPieceSymmetryToPieceResult {
  const seamMaster = useSeamLineForVertexEditing(piece) && piece.seamLine.length >= 3
  const masterCurves = seamMaster ? piece.seamLine : piece.cutLine
  if (masterCurves.length < 3) {
    return { ok: false, toastMessage: 'warn:Kontur zu kurz für Symmetrie.' }
  }
  const sym = buildSymmetricContour(masterCurves, axisA, axisB, keepSide)
  if (!sym.ok) {
    return { ok: false, toastMessage: `warn:${sym.message}` }
  }
  let cutLine: PatternPiece['cutLine']
  let seamLine: PatternPiece['seamLine']
  if (seamMaster && piece.seamAllowanceMm != null) {
    if (piece.cutLineDeviatesFromSeamAllowanceOffset === true && piece.cutLine.length >= 3) {
      const symCut = buildSymmetricContour(piece.cutLine, axisA, axisB, keepSide)
      if (!symCut.ok) {
        return { ok: false, toastMessage: `warn:${symCut.message}` }
      }
      seamLine = sym.curves
      cutLine = symCut.curves
    } else {
      seamLine = sym.curves
      const derived = deriveCutLineForPiece({ ...piece, seamLine }, seamLine, piece.seamAllowanceMm)
      if (!derived.ok) {
        return {
          ok: false,
          toastMessage: `warn:${derived.message ?? 'Schnittkontur konnte nicht abgeleitet werden.'}`,
        }
      }
      cutLine = derived.cutLine
    }
  } else {
    cutLine = sym.curves
    seamLine =
      piece.seamAllowanceMm != null && cutLine.length >= 3
        ? offsetCurvesInwardForSeam(cutLine, piece.seamAllowanceMm)
        : []
  }

  const mirroredNotches = piece.notches.map((n) => ({
    ...n,
    position: mirrorPointAcrossLine(n.position, axisA, axisB),
    angle: mirrorAngleDegrees(n.angle, axisA, axisB),
    sNormalized: undefined as number | undefined,
    arcLengthMm: undefined as number | undefined,
    ...(isNotchOnInternalLine(n)
      ? { internalSNormalized: undefined as number | undefined, internalArcLengthMm: undefined as number | undefined }
      : {}),
  }))

  const drills = piece.drills.map((d) => ({
    ...d,
    center: mirrorPointAcrossLine(d.center, axisA, axisB),
  }))

  const internalLines: PatternPiece['internalLines'] = []
  for (const c of piece.internalLines) {
    const ref = curveReferencePoint(c)
    if (pointInKeepHalfPlane(ref, axisA, axisB, keepSide)) {
      internalLines.push(c)
      internalLines.push(mirrorCurveAcrossLine(c, axisA, axisB))
    }
  }

  const internalCircles: PatternPiece['internalCircles'] = []
  for (const ic of piece.internalCircles) {
    const ref = ic.center
    if (pointInKeepHalfPlane(ref, axisA, axisB, keepSide)) {
      internalCircles.push(ic)
      internalCircles.push({
        id: 'ic' + Math.random().toString(36).slice(2, 10),
        center: mirrorPointAcrossLine(ic.center, axisA, axisB),
        radius: ic.radius,
      })
    }
  }

  const grainLine = piece.grainLine
    ? {
        start: mirrorPointAcrossLine(piece.grainLine.start, axisA, axisB),
        end: mirrorPointAcrossLine(piece.grainLine.end, axisA, axisB),
      }
    : null

  const notches = mirroredNotches.map((n) => {
    if (isNotchOnInternalLine(n)) {
      return materializeNotchAnchorsOnInternalLine(n, internalLines) ?? n
    }
    return materializeNotchAnchorsOnCutLine(n, cutLine) ?? n
  })

  const pieceOut = applySharpCornerPromotion({
    ...piece,
    cutLine,
    seamLine,
    notches,
    drills,
    internalLines,
    internalCircles,
    grainLine,
    internalLineSoftJunctions: undefined,
  })

  return { ok: true, piece: pieceOut }
}

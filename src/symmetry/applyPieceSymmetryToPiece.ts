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
import { preferStableCutAfterGeometricMirror } from '../geometry/seamAllowanceInvariants'
import {
  buildSymmetricContour,
  buildSymmetricContourPreservingCurves,
  mirrorPointAcrossLine,
  mirrorCurveAcrossLine,
  pointInKeepHalfPlane,
  curveReferencePoint,
  mirrorAngleDegrees,
  type PieceSymmetryKeepSide,
} from '../geometry/pieceSymmetry'
import type { Curve } from '../types/model'

export type ApplyPieceSymmetryToPieceResult =
  | { ok: true; piece: PatternPiece }
  | { ok: false; toastMessage: string }

function symmetrizeCurves(
  curves: Curve[],
  axisA: { x: number; y: number },
  axisB: { x: number; y: number },
  keepSide: PieceSymmetryKeepSide
): { ok: true; curves: Curve[]; softFromAxisSplit: number[] } | { ok: false; message: string } {
  const preserved = buildSymmetricContourPreservingCurves(curves, axisA, axisB, keepSide)
  if (preserved && preserved.curves.length >= 3) {
    return { ok: true, curves: preserved.curves, softFromAxisSplit: preserved.softFromAxisSplit }
  }
  const clipper = buildSymmetricContour(curves, axisA, axisB, keepSide)
  if (!clipper.ok) return clipper
  return { ok: true, curves: clipper.curves, softFromAxisSplit: [] }
}

/**
 * Wendet Teil-Symmetrie auf ein einzelnes Stück an (reine Logik, kein Workspace/Store).
 * Bevorzugt kurven-erhaltende Spiegelung (Bézier bleiben Bézier).
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
  const sym = symmetrizeCurves(masterCurves, axisA, axisB, keepSide)
  if (!sym.ok) {
    return { ok: false, toastMessage: `warn:${sym.message}` }
  }

  let cutLine: PatternPiece['cutLine']
  let seamLine: PatternPiece['seamLine']
  if (seamMaster && piece.seamAllowanceMm != null) {
    if (piece.cutLineDeviatesFromSeamAllowanceOffset === true && piece.cutLine.length >= 3) {
      const symCut = symmetrizeCurves(piece.cutLine, axisA, axisB, keepSide)
      if (!symCut.ok) {
        return { ok: false, toastMessage: `warn:${symCut.message}` }
      }
      seamLine = sym.curves
      const derived = deriveCutLineForPiece({ ...piece, seamLine }, seamLine, piece.seamAllowanceMm)
      cutLine = preferStableCutAfterGeometricMirror(
        seamLine,
        symCut.curves,
        derived.ok ? derived.cutLine : null,
        piece.seamAllowanceMm
      )
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

  // Achsen-Schnittpunkte = weiche (blaue) Punkte, keine neuen roten Ecken
  const softSorted = [...new Set(sym.softFromAxisSplit)].sort((a, b) => a - b)

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
    ...(seamMaster
      ? { softVerticesMaster: softSorted, softVertices: [] }
      : { softVertices: softSorted, softVerticesMaster: [] }),
  })

  return { ok: true, piece: pieceOut }
}

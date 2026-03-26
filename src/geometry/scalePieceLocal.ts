import type { Curve, Drill, Line, Notch, PatternPiece, Point } from '../types/model'
import { deriveCutLineFromSeamWithValidation, offsetCurvesInwardForSeam } from './offset'
import { resyncNotchesAfterCutLineRebuilt } from './notchResyncCutLine'
import { applySharpCornerPromotion } from './softVertexPromotion'
import { getCurvesForSeamEdge } from './seamUtils'

export function scalePointAbout(p: Point, pivot: Point, s: number): Point {
  return {
    x: pivot.x + (p.x - pivot.x) * s,
    y: pivot.y + (p.y - pivot.y) * s,
  }
}

function scaleCurve(c: Curve, pivot: Point, s: number): Curve {
  const sp = (pt: Point) => scalePointAbout(pt, pivot, s)
  if (c.type === 'line') {
    return { type: 'line', start: sp(c.start), end: sp(c.end) }
  }
  return {
    type: 'bezier',
    start: sp(c.start),
    end: sp(c.end),
    cp1: sp(c.cp1),
    cp2: sp(c.cp2),
  }
}

export function scaleCurvesLocal(curves: Curve[], pivot: Point, s: number): Curve[] {
  return curves.map((c) => scaleCurve(c, pivot, s))
}

function scaleGrainLine(line: Line | null, pivot: Point, s: number): Line | null {
  if (!line) return null
  return {
    start: scalePointAbout(line.start, pivot, s),
    end: scalePointAbout(line.end, pivot, s),
  }
}

function scaleDrillsLocal(drills: Drill[], pivot: Point, s: number): Drill[] {
  return drills.map((d) => ({
    ...d,
    center: scalePointAbout(d.center, pivot, s),
    radius: d.radius * s,
  }))
}

function scaleNotchDimensions(notches: Notch[], s: number): Notch[] {
  return notches.map((n) => ({
    ...n,
    depth: n.depth * s,
    ...(n.width != null ? { width: n.width * s } : {}),
  }))
}

/**
 * Einheitliche Skalierung des Teils in Teilkoordinaten um `pivot`; `s` = Faktor.
 * Seam-as-Master: zuerst seamLine, dann cutLine aus Nahtzugabe; sonst cutLine (+ ggf. seamLine aus Offset).
 */
export function applyUniformScaleToPiece(
  piece: PatternPiece,
  pivot: Point,
  s: number
): { ok: true; piece: PatternPiece } | { ok: false; message: string } {
  if (!Number.isFinite(s) || s <= 0) {
    return { ok: false, message: 'Ungültiger Maßstab.' }
  }

  const seamMaster = piece.seamAllowanceMm != null && piece.seamLine.length >= 3

  if (seamMaster) {
    const scaledSeam = scaleCurvesLocal(piece.seamLine, pivot, s)
    const derived = deriveCutLineFromSeamWithValidation(scaledSeam, piece.seamAllowanceMm!)
    if (!derived.ok) {
      return { ok: false, message: derived.message }
    }
    let notches = resyncNotchesAfterCutLineRebuilt(piece.notches, piece.cutLine, derived.cutLine)
    notches = scaleNotchDimensions(notches, s)
    const next: PatternPiece = {
      ...piece,
      seamLine: scaledSeam,
      cutLine: derived.cutLine,
      notches,
      grainLine: scaleGrainLine(piece.grainLine, pivot, s),
      internalLines: scaleCurvesLocal(piece.internalLines, pivot, s),
      drills: scaleDrillsLocal(piece.drills, pivot, s),
    }
    return { ok: true, piece: applySharpCornerPromotion(next) }
  }

  if (piece.cutLine.length === 0) {
    return { ok: false, message: 'Keine Schnittkontur.' }
  }

  const scaledCut = scaleCurvesLocal(piece.cutLine, pivot, s)
  const seamLine =
    piece.seamAllowanceMm != null && scaledCut.length >= 3
      ? offsetCurvesInwardForSeam(scaledCut, piece.seamAllowanceMm)
      : piece.seamLine

  let notches = resyncNotchesAfterCutLineRebuilt(piece.notches, piece.cutLine, scaledCut)
  notches = scaleNotchDimensions(notches, s)

  const next: PatternPiece = {
    ...piece,
    cutLine: scaledCut,
    seamLine,
    notches,
    grainLine: scaleGrainLine(piece.grainLine, pivot, s),
    internalLines: scaleCurvesLocal(piece.internalLines, pivot, s),
    drills: scaleDrillsLocal(piece.drills, pivot, s),
  }
  return { ok: true, piece: applySharpCornerPromotion(next) }
}

/** Erster Eckpunkt der Referenzkante (Master-Kontur) als fester Punkt beim Skalieren. */
export function getReferenceEdgePivotLocal(piece: PatternPiece, curveIndices: number[]): Point | null {
  if (curveIndices.length === 0) return null
  const master = getCurvesForSeamEdge(piece)
  const ci = curveIndices[0]
  if (ci < 0 || ci >= master.length) return null
  return { ...master[ci].start }
}

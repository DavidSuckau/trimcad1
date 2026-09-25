import type { Curve, Drill, Line, Notch, PatternPiece, Point } from '../types/model'
import { deriveCutLineFromSeamWithValidation, offsetCurvesInwardForSeam } from './offset'
import { getNotchPositionAndAngle, materializeNotchAnchorsOnCutLine } from './notchOnCurve'
import {
  getNotchPositionAndAngleOnInternalLine,
  isNotchOnInternalLine,
  materializeNotchAnchorsOnInternalLine,
} from './notchOnInternalLine'
import { applySharpCornerPromotion } from './softVertexPromotion'
import { getCurvesForSeamEdge } from './seamUtils'

export function scalePointAbout(p: Point, pivot: Point, s: number): Point {
  return {
    x: pivot.x + (p.x - pivot.x) * s,
    y: pivot.y + (p.y - pivot.y) * s,
  }
}

function scaleInternalCirclesLocal(
  circles: PatternPiece['internalCircles'],
  pivot: Point,
  s: number
): PatternPiece['internalCircles'] {
  return circles.map((ic) => ({
    ...ic,
    center: scalePointAbout(ic.center, pivot, s),
    radius: ic.radius * s,
  }))
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

/**
 * Kerben mit demselben Pivot/Faktor wie die Kontur skalieren.
 * Nicht `resyncNotchesAfterCutLineRebuilt`: dessen Sprunglimit verwirft große Maßstab-Verschiebungen.
 *
 * - `sNormalized` / `internalSNormalized` bleiben (maßstabsinvariant)
 * - `arcLengthMm` / `internalArcLengthMm` × s
 * - Position um Pivot skalieren, dann auf neue Kontur/Internals rematerialisieren
 * - depth/width × s
 */
export function scaleNotchesWithPiece(
  notches: Notch[],
  pivot: Point,
  s: number,
  oldCutLine: Curve[],
  newCutLine: Curve[],
  oldInternalLines: Curve[],
  newInternalLines: Curve[],
): Notch[] {
  return notches.map((n) => {
    const depth = n.depth * s
    const width = n.width != null ? n.width * s : undefined

    if (isNotchOnInternalLine(n)) {
      const oldPos =
        getNotchPositionAndAngleOnInternalLine(n, oldInternalLines)?.position ?? n.position
      const draft: Notch = {
        ...n,
        depth,
        ...(width != null ? { width } : {}),
        position: scalePointAbout(oldPos, pivot, s),
        // sNormalized auf Internals: invariant; Bogenlänge skaliert
        internalSNormalized: n.internalSNormalized,
        internalArcLengthMm:
          n.internalArcLengthMm != null && Number.isFinite(n.internalArcLengthMm)
            ? n.internalArcLengthMm * s
            : undefined,
        sNormalized: undefined,
        arcLengthMm: undefined,
        vertexIndex: undefined,
      }
      return materializeNotchAnchorsOnInternalLine(draft, newInternalLines) ?? draft
    }

    const oldPos = getNotchPositionAndAngle(n, oldCutLine).position
    const draft: Notch = {
      ...n,
      depth,
      ...(width != null ? { width } : {}),
      position: scalePointAbout(oldPos, pivot, s),
      // Relativer Konturanteil bleibt; absolute Bogenlänge skaliert
      sNormalized: n.sNormalized,
      arcLengthMm:
        n.arcLengthMm != null && Number.isFinite(n.arcLengthMm) ? n.arcLengthMm * s : undefined,
      vertexIndex: undefined,
    }
    return materializeNotchAnchorsOnCutLine(draft, newCutLine) ?? draft
  })
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
  const oldInternal = piece.internalLines

  if (seamMaster) {
    const scaledSeam = scaleCurvesLocal(piece.seamLine, pivot, s)
    const derived = deriveCutLineFromSeamWithValidation(scaledSeam, piece.seamAllowanceMm!)
    if (!derived.ok) {
      return { ok: false, message: derived.message }
    }
    const scaledInternal = scaleCurvesLocal(oldInternal, pivot, s)
    const notches = scaleNotchesWithPiece(
      piece.notches,
      pivot,
      s,
      piece.cutLine,
      derived.cutLine,
      oldInternal,
      scaledInternal,
    )
    const next: PatternPiece = {
      ...piece,
      seamLine: scaledSeam,
      cutLine: derived.cutLine,
      notches,
      grainLine: scaleGrainLine(piece.grainLine, pivot, s),
      internalLines: scaledInternal,
      internalCircles: scaleInternalCirclesLocal(piece.internalCircles, pivot, s),
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
      : piece.seamLine.length >= 3
        ? scaleCurvesLocal(piece.seamLine, pivot, s)
        : piece.seamLine
  const scaledInternal = scaleCurvesLocal(oldInternal, pivot, s)
  const notches = scaleNotchesWithPiece(
    piece.notches,
    pivot,
    s,
    piece.cutLine,
    scaledCut,
    oldInternal,
    scaledInternal,
  )

  const next: PatternPiece = {
    ...piece,
    cutLine: scaledCut,
    seamLine,
    notches,
    grainLine: scaleGrainLine(piece.grainLine, pivot, s),
    internalLines: scaledInternal,
    internalCircles: scaleInternalCirclesLocal(piece.internalCircles, pivot, s),
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

/** Startpunkt einer internen Referenzlinie (ein oder mehrere Segmente in `internalLines`). */
export function getReferenceInternalLinePivotLocal(
  piece: PatternPiece,
  curveIndices: number[],
): Point | null {
  if (curveIndices.length === 0) return null
  const ci = curveIndices[0]
  if (ci < 0 || ci >= piece.internalLines.length) return null
  return { ...piece.internalLines[ci].start }
}

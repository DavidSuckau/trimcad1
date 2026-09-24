/**
 * DXF-Import-Orientierung: CAD/DXF-Teile erscheinen in TrimTex systematisch um 180° verdreht.
 * Alle Teile gemeinsam um den gemeinsamen Bounding-Box-Mittelpunkt drehen —
 * so bleiben angrenzende Teile korrekt aneinander (rechte Kante an linker, oben an unten).
 * Laufrichtung dreht mit der Geometrie mit; Teilename bleibt auf dem Canvas lesbar (kein Text-Rotate).
 */

import type { Curve, Drill, Line, Notch, PatternPiece, Point } from '../types/model'
import { resyncNotchesAfterCutLineRebuilt } from '../geometry/notchResyncCutLine'
import { materializeNotchAnchorsOnInternalLine } from '../geometry/notchOnInternalLine'
import { isNotchOnInternalLine } from '../geometry/notchOnInternalLine'

function boundsOfCurves(curves: Curve[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (curves.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const consider = (p: Point) => {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  for (const c of curves) {
    consider(c.start)
    consider(c.end)
    if (c.type === 'bezier') {
      consider(c.cp1)
      consider(c.cp2)
    }
  }
  if (!Number.isFinite(minX)) return null
  return { minX, minY, maxX, maxY }
}

function pivotOfCurves(curves: Curve[]): { cx: number; cy: number } | null {
  const b = boundsOfCurves(curves)
  if (!b) return null
  return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2 }
}

/** Gemeinsamer Mittelpunkt aller Schnittkonturen (Fallback: Naht/Intern). */
export function commonPivotOfPieces(pieces: PatternPiece[]): { cx: number; cy: number } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let any = false
  for (const piece of pieces) {
    const b =
      boundsOfCurves(piece.cutLine) ??
      boundsOfCurves(piece.seamLine) ??
      boundsOfCurves(piece.internalLines)
    if (!b) continue
    any = true
    minX = Math.min(minX, b.minX)
    minY = Math.min(minY, b.minY)
    maxX = Math.max(maxX, b.maxX)
    maxY = Math.max(maxY, b.maxY)
  }
  if (!any) return null
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }
}

function rot180(p: Point, cx: number, cy: number): Point {
  return { x: 2 * cx - p.x, y: 2 * cy - p.y }
}

function rotCurve180(c: Curve, cx: number, cy: number): Curve {
  if (c.type === 'line') {
    return { type: 'line', start: rot180(c.start, cx, cy), end: rot180(c.end, cx, cy) }
  }
  return {
    type: 'bezier',
    start: rot180(c.start, cx, cy),
    end: rot180(c.end, cx, cy),
    cp1: rot180(c.cp1, cx, cy),
    cp2: rot180(c.cp2, cx, cy),
  }
}

function rotLine180(line: Line | null | undefined, cx: number, cy: number): Line | null {
  if (!line) return null
  return { start: rot180(line.start, cx, cy), end: rot180(line.end, cx, cy) }
}

function rotDrills180(drills: Drill[], cx: number, cy: number): Drill[] {
  return drills.map((d) => ({
    ...d,
    center: rot180(d.center, cx, cy),
  }))
}

function rotNotches180(notches: Notch[], cx: number, cy: number): Notch[] {
  return notches.map((n) => ({
    ...n,
    position: rot180(n.position, cx, cy),
    angle: (Number.isFinite(n.angle) ? n.angle : 0) + 180,
    // Scalar-Anker ungültig nach Rotation — Resync/Materialize setzt neu.
    sNormalized: undefined,
    arcLengthMm: undefined,
    vertexIndex: undefined,
  }))
}

/**
 * Dreht die lokale Geometrie eines importierten Teils um 180° um den gegebenen Pivot.
 * Transform (Platzierung) bleibt unverändert.
 */
export function rotateImportedPieceGeometry180(
  piece: PatternPiece,
  pivot?: { cx: number; cy: number },
): PatternPiece {
  const resolved =
    pivot ??
    pivotOfCurves(piece.cutLine) ??
    pivotOfCurves(piece.seamLine) ??
    pivotOfCurves(piece.internalLines)
  if (!resolved) return piece
  const { cx, cy } = resolved

  const cutLine = piece.cutLine.map((c) => rotCurve180(c, cx, cy))
  const seamLine = piece.seamLine.map((c) => rotCurve180(c, cx, cy))
  const internalLines = piece.internalLines.map((c) => rotCurve180(c, cx, cy))
  const internalCircles = piece.internalCircles.map((ic) => ({
    ...ic,
    center: rot180(ic.center, cx, cy),
  }))
  const grainLine = rotLine180(piece.grainLine, cx, cy)
  const drills = rotDrills180(piece.drills, cx, cy)
  let notches = rotNotches180(piece.notches, cx, cy)

  if (cutLine.length >= 3) {
    notches = resyncNotchesAfterCutLineRebuilt(notches, cutLine, cutLine)
  }
  notches = notches.map((n) => {
    if (!isNotchOnInternalLine(n) || internalLines.length === 0) return n
    return materializeNotchAnchorsOnInternalLine(n, internalLines) ?? n
  })

  return {
    ...piece,
    cutLine,
    seamLine,
    internalLines,
    internalCircles,
    grainLine,
    drills,
    notches,
  }
}

/**
 * Dreht alle importierten Teile gemeinsam um 180° um den gemeinsamen Mittelpunkt.
 * So bleiben Teile korrekt aneinander (wie in CAD).
 */
export function rotateImportedPiecesGeometry180(pieces: PatternPiece[]): PatternPiece[] {
  const pivot = commonPivotOfPieces(pieces)
  if (!pivot) return pieces
  return pieces.map((p) => rotateImportedPieceGeometry180(p, pivot))
}

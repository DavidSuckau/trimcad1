import type { PatternPiece } from '../types/model'

/**
 * Ob Eckpunkte (Vertex-Indizes, Ziehen, Löschen) sich auf die **Nahtlinie** beziehen.
 * Bei Nahtzugabe entsteht die Naht oft per Clipper mit viel mehr Segmenten als die
 * Schnittkontur (Bézier-Abtastung) — dann müssen Indizes zur **cutLine** passen
 * (softVertices). Punkt-/Kurvenpunkt-Werkzeug nutzt dagegen `useSeamLineForPointCurveEditing`.
 */
export function useSeamLineForVertexEditing(piece: PatternPiece): boolean {
  if (piece.seamAllowanceMm == null || piece.seamLine.length < 3 || piece.cutLine.length < 3) {
    return false
  }
  if (piece.seamLine.length > piece.cutLine.length) {
    return false
  }
  return true
}

/**
 * Punkt-Werkzeug, Kurvenpunkt (Bézier) und Punkt-auf-Kurve ziehen: auf der **Nahtlinie**,
 * sobald Nahtzugabe aktiv ist und eine Nahtlinie existiert (unabhängig von cut/seam in der Ansicht).
 */
export function useSeamLineForPointCurveEditing(piece: PatternPiece): boolean {
  return piece.seamAllowanceMm != null && piece.seamLine.length >= 3
}

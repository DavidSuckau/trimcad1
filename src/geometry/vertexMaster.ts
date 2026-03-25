import type { PatternPiece } from '../types/model'

/**
 * Ob Eckpunkte (Vertex-Indizes, Ziehen, Löschen) sich auf die **Nahtlinie** beziehen.
 *
 * **Formal:** Bei Nahtzugabe wird `cutLine` bei jeder Ableitung **vollständig** aus dem Offset neu
 * erzeugt; es gibt **kein** Segment-Mapping seam↔cut. `SeamAssignment`-Indizes beziehen sich auf
 * `getCurvesForSeamEdge` (Naht als Master → **seamLine**); Notch-`vertexIndex` auf **cutLine**
 * (nach Rebuild: `resyncNotchesAfterCutLineRebuilt`). Siehe `docs/TRIMTEX-SOFTWARE-DOKUMENTATION.md` 6.1.
 *
 * **Hier:** Wenn `seamLine.length > cutLine.length`, liefern wir false — Eckpunkte folgen dann der
 * **cutLine**, damit die Indexbasis zur dichten Kontur passt. Punkt-/Kurvenpunkt-Werkzeug:
 * `useSeamLineForPointCurveEditing`.
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

import type { PatternPiece } from '../types/model'

/**
 * Ob Eckpunkte (Vertex-Indizes, Ziehen, Löschen) sich auf die **Nahtlinie** beziehen.
 *
 * **Kanonische Regel (identisch zu `getCurvesForSeamEdge` / `getEditingContour`):** Nahtzugabe
 * gesetzt und `seamLine` geschlossen (`length >= 3`) → Master ist **seamLine**; sonst **cutLine**.
 * Es gibt **keine** zusätzliche Abhängigkeit von `cutLine.length`: die Außenkontur ist abgeleitet;
 * ein kurzzeitig ungültiger Cut-Zustand soll nicht die Bearbeitungsbasis von Seam auf Cut umschalten.
 *
 * **Formal:** Bei Nahtzugabe wird `cutLine` bei jeder Ableitung **vollständig** aus dem Offset neu
 * erzeugt; es gibt **kein** Segment-Mapping seam↔cut. `SeamAssignment`-Indizes beziehen sich auf
 * `getCurvesForSeamEdge` (Naht als Master → **seamLine**); Notch-`vertexIndex` auf **cutLine**
 * (nach Rebuild: `resyncNotchesAfterCutLineRebuilt`). Siehe `docs/TRIMTEX-SOFTWARE-DOKUMENTATION.md` 6.1.
 *
 * **Hier:** Sobald Nahtzugabe gesetzt ist und eine gültige Nahtlinie existiert, ist die **Innenkontur
 * (seamLine)** die Bearbeitungsbasis — unabhängig von Schnitt/Naht-Ansicht (welche Linie durchgezogen
 * gezeichnet wird) und unabhängig von der Segmentanzahl der abgeleiteten `cutLine`.
 */
export function useSeamLineForVertexEditing(piece: PatternPiece): boolean {
  return piece.seamAllowanceMm != null && piece.seamLine.length >= 3
}

/**
 * Punkt-Werkzeug, Kurvenpunkt (Bézier), Punkt einfügen: dieselbe Master-Kontur wie Eckpunkte.
 */
export function useSeamLineForPointCurveEditing(piece: PatternPiece): boolean {
  return useSeamLineForVertexEditing(piece)
}

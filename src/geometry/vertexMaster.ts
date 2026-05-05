import type { Curve, PatternPiece } from '../types/model'
import type { AppliedRounding } from './cornerRounding'
import { applyCornerRoundings } from './cornerRounding'

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

/** Scharfe Master-Kurven (ohne Rundungen). seamLine bei Naht, sonst cutLine. */
export function getSharpMasterCurves(piece: PatternPiece): Curve[] {
  return useSeamLineForVertexEditing(piece) ? piece.seamLine : piece.cutLine
}

/**
 * Master-Kontur (seamLine bei Naht, sonst cutLine) **mit angewandten Rundungen** – fürs Rendering
 * und Hit-Testing der gerundeten Bögen. Vertex-/Soft-/Edge-Editing arbeitet weiter gegen die scharfe Master.
 */
export function getDisplayedMasterCurves(piece: PatternPiece): {
  curves: Curve[]
  applied: AppliedRounding[]
} {
  const sharp = getSharpMasterCurves(piece)
  const rounded = piece.roundedCorners ?? []
  if (rounded.length === 0) return { curves: sharp, applied: [] }
  const r = applyCornerRoundings(sharp, rounded)
  return { curves: r.curves, applied: r.applied }
}

/** seamLine fürs Display – mit Rundungen, falls Naht-Master. Sonst unverändert. */
export function getDisplayedSeamLine(piece: PatternPiece): {
  curves: Curve[]
  applied: AppliedRounding[]
} {
  if (!useSeamLineForVertexEditing(piece)) {
    return { curves: piece.seamLine, applied: [] }
  }
  return getDisplayedMasterCurves(piece)
}

/**
 * cutLine fürs Display. Bei Naht-Master ist `piece.cutLine` bereits aus der gerundeten Naht abgeleitet,
 * also unverändert zurückgegeben. Bei Cut-Master werden Rundungen direkt auf cutLine angewandt.
 */
export function getDisplayedCutLine(piece: PatternPiece): {
  curves: Curve[]
  applied: AppliedRounding[]
} {
  if (useSeamLineForVertexEditing(piece)) {
    return { curves: piece.cutLine, applied: [] }
  }
  return getDisplayedMasterCurves(piece)
}

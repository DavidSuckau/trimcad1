import type { Curve, Point } from '../types/model'

/**
 * Zentrale Toleranzen / Epsilon-Werte für die Geometrie-Module.
 * Alle Geometry-Dateien sollen hier importieren statt eigene Konstanten zu definieren.
 */

/** Punkt-Gleichheit: Standardtoleranz in mm. */
export const POINT_EPS_MM = 1e-6

/** Punkt auf gleicher Position: großzügigere Toleranz für Notch-Resync (Clipper-Drift). */
export const ENDPOINT_EPS_MM = 1.0

/** Parameter t ∈ [0,1] nahe Vertex: Threshold für Notch-Resync (Ecke erkannt). */
export const CORNER_T_EPS = 0.01

/** Parameter t ∈ [0,1] nahe Vertex: Threshold für Notch-Winkelhalbierende. */
export const VERTEX_T_EPS = 0.05

/** Prüft ob zwei Punkte innerhalb einer Toleranz gleich sind. */
export function samePoint(a: Point, b: Point, eps: number = POINT_EPS_MM): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps
}

/** Lineares Interpolieren zweier Punkte. */
export function lerpPt(a: Point, b: Point, t: number): Point {
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }
}

/** Position des Vertex (Eckpunkt) an Index `vi` auf einer geschlossenen Kontur. */
export function vertexPosition(curves: Curve[], vi: number): Point {
  const n = curves.length
  const i = ((vi % n) + n) % n
  return i === 0 ? { ...curves[0].start } : { ...curves[i - 1].end }
}

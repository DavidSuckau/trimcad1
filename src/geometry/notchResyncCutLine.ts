import type { Curve, Notch, PatternPiece } from '../types/model'
import { outwardNormalAngleAt } from './curveToPath'
import { getNotchPositionAndAngle } from './notchOnCurve'
import { nearestCurveIndexAndPoint } from './nearestOnCurve'

const VERTEX_ANCHOR_T_EPS = 0.04
const VERTEX_ANCHOR_DIST_MM = 0.55

/** Naht-Ecke ausblenden, wenn eine Kerbe (über ihre CutLine-Position) dort „sitzt“. */
const SEAM_VERTEX_NOTCH_OCCLUSION_MM = 5.5

/**
 * Nach **topologischer oder geometrischer** Änderung der `cutLine` (Offset, Vertex löschen, …):
 *
 * - Ausgang: kanonische Punktlage auf der **alten** cutLine (`getNotchPositionAndAngle` → berücksichtigt
 *   `vertexIndex` vor `position`).
 * - Ziel: **eine** neue Darstellung auf der **neuen** cutLine: nächstgelegener Punkt; optional wieder
 *   `vertexIndex`, wenn t nahe 0/1 und Abstand zur Ecke klein („re-snap“ an Ecke). Sonst freie Kerbe:
 *   `vertexIndex: undefined`, `position`/`angle` auf Fußpunkt/Normale.
 *
 * Damit ist die Strategie **parametrisch** (implizit über Projektion), nicht „mm absolut losgelöst“.
 */
export function resyncNotchesAfterCutLineRebuilt(
  notches: Notch[],
  oldCutLine: Curve[],
  newCutLine: Curve[]
): Notch[] {
  if (newCutLine.length === 0) return notches
  const oldLen = oldCutLine.length
  const newLen = newCutLine.length
  return notches.map((notch) => {
    const hadVertexIndex = notch.vertexIndex != null
    const oldPos = getNotchPositionAndAngle(notch, oldCutLine).position

    /**
     * Wichtiger Spezialfall:
     * Wenn die Vertex-Anzahl erhalten bleibt (Offset/Nahtzugabe mit gleicher Topologie),
     * dann soll eine zuvor verankerte Kerbe auch nach dem Rebuild wieder als verankert gelten,
     * damit die UI-Eckpunkt-Ausblendung zuverlässig funktioniert (masterNotchVertexIndexSet).
     *
     * Ansonsten wird die Kerbe ggf. "frei" (vertexIndex = undefined), weil die geometrische Distanz
     * Cut→(neu)Cut durch den Offset größer als `VERTEX_ANCHOR_DIST_MM` ist.
     * Die (topologische) Korrektheit ist hier wichtiger als das strikte t≈0/1 Kriterium.
     */
    if (hadVertexIndex && oldLen === newLen && notch.vertexIndex != null) {
      // Bei erhaltener Topologie (gleiche Vertex-Anzahl) ist die Indexbasis stabil genug,
      // um die verankerte Kerbe auch nach dem Rebuild wieder als verankert zu behandeln.
      const vi = ((notch.vertexIndex % newLen) + newLen) % newLen
      const pos = vi === 0 ? { ...newCutLine[0].start } : { ...newCutLine[vi - 1].end }
      return { ...notch, vertexIndex: vi, position: pos, angle: notch.angle }
    }

    const nr = nearestCurveIndexAndPoint(oldPos, newCutLine)
    if (!nr) {
      return { ...notch, vertexIndex: undefined }
    }
    const t = nr.t ?? 0
    let vertexIndex: number | undefined

    if (t <= VERTEX_ANCHOR_T_EPS) {
      const vi = nr.curveIndex
      const vPt = newCutLine[vi].start
      // Wenn die Kerbe vorher explizit an einer Ecke verankert war, soll sie
      // bei Nahtzugabe (Offset) nicht "unanchor'ed" werden, nur weil die Euclid-Distanz
      // alt->neu groß ist. Dann reicht die parametrische Ecke-Nähe (t) als Kriterium.
      if (hadVertexIndex) {
        vertexIndex = vi
      } else if (Math.hypot(nr.point.x - vPt.x, nr.point.y - vPt.y) <= VERTEX_ANCHOR_DIST_MM) {
        vertexIndex = vi
      }
    } else if (t >= 1 - VERTEX_ANCHOR_T_EPS) {
      const vi = (nr.curveIndex + 1) % newCutLine.length
      const vPt = vi === 0 ? newCutLine[0].start : newCutLine[vi - 1].end
      if (hadVertexIndex) {
        vertexIndex = vi
      } else if (Math.hypot(nr.point.x - vPt.x, nr.point.y - vPt.y) <= VERTEX_ANCHOR_DIST_MM) {
        vertexIndex = vi
      }
    }

    if (vertexIndex != null) {
      const pos =
        vertexIndex === 0 ? { ...newCutLine[0].start } : { ...newCutLine[vertexIndex - 1].end }
      return { ...notch, vertexIndex, position: pos, angle: notch.angle }
    }

    // Fallback: Wenn die Kerbe vorher explizit an einer Ecke verankert war, aber unsere
    // Parametrik-Kriteri(en) für (t nahe 0/1) bei starken Offset/Segment-Änderungen nicht triggern,
    // wähle trotzdem die nächstgelegene Ecke (Endpoint) der neuen cutLine als vertexIndex.
    if (hadVertexIndex) {
      let bestVi = 0
      let bestD = Infinity
      for (let vi = 0; vi < newCutLine.length; vi++) {
        const vPt = vi === 0 ? newCutLine[0].start : newCutLine[vi - 1].end
        const d = Math.hypot(oldPos.x - vPt.x, oldPos.y - vPt.y)
        if (d < bestD) {
          bestD = d
          bestVi = vi
        }
      }
      const pos = bestVi === 0 ? { ...newCutLine[0].start } : { ...newCutLine[bestVi - 1].end }
      return { ...notch, vertexIndex: bestVi, position: pos, angle: notch.angle }
    }

    const angle = outwardNormalAngleAt(newCutLine, nr.curveIndex, t) + 180
    return {
      ...notch,
      vertexIndex: undefined,
      position: { ...nr.point },
      angle,
    }
  })
}

/** Für Seam-as-Master: Eckpunkt-Hit nicht per cutLine-vertexIndex maskieren (falsche Indexbasis). */
export function seamVertexNearProjectedNotch(piece: PatternPiece, seamVertexIndex: number): boolean {
  const seam = piece.seamLine
  if (seam.length < 3) return false
  const n = seam.length
  const vi = ((seamVertexIndex % n) + n) % n
  const seamPos = vi === 0 ? seam[0].start : seam[vi - 1].end
  for (const notch of piece.notches) {
    const cutPos = getNotchPositionAndAngle(notch, piece.cutLine).position
    const nr = nearestCurveIndexAndPoint(cutPos, seam)
    if (!nr) continue
    if (Math.hypot(nr.point.x - seamPos.x, nr.point.y - seamPos.y) <= SEAM_VERTEX_NOTCH_OCCLUSION_MM) {
      return true
    }
  }
  return false
}

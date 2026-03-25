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
  return notches.map((notch) => {
    const oldPos = getNotchPositionAndAngle(notch, oldCutLine).position
    const nr = nearestCurveIndexAndPoint(oldPos, newCutLine)
    if (!nr) {
      return { ...notch, vertexIndex: undefined }
    }
    const t = nr.t ?? 0
    let vertexIndex: number | undefined

    if (t <= VERTEX_ANCHOR_T_EPS) {
      const vi = nr.curveIndex
      const vPt = newCutLine[vi].start
      if (Math.hypot(nr.point.x - vPt.x, nr.point.y - vPt.y) <= VERTEX_ANCHOR_DIST_MM) {
        vertexIndex = vi
      }
    } else if (t >= 1 - VERTEX_ANCHOR_T_EPS) {
      const vi = (nr.curveIndex + 1) % newCutLine.length
      const vPt = vi === 0 ? newCutLine[0].start : newCutLine[vi - 1].end
      if (Math.hypot(nr.point.x - vPt.x, nr.point.y - vPt.y) <= VERTEX_ANCHOR_DIST_MM) {
        vertexIndex = vi
      }
    }

    if (vertexIndex != null) {
      const pos =
        vertexIndex === 0 ? { ...newCutLine[0].start } : { ...newCutLine[vertexIndex - 1].end }
      return { ...notch, vertexIndex, position: pos, angle: notch.angle }
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

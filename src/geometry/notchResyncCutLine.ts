import type { Curve, Notch, PatternPiece, Point } from '../types/model'
import { outwardNormalAngleAt, totalPathLength, pointAtPathLength } from './curveToPath'
import {
  getNotchPositionAndAngle,
  getNotchCutLineParameter,
  materializeNotchAnchorsOnCutLine,
} from './notchOnCurve'
import { nearestCurveIndexAndPoint } from './nearestOnCurve'

type Nr = { point: Point; curveIndex: number; t: number }

function isTopologyCompatibleForIndexT(oldCutLine: Curve[], newCutLine: Curve[]): boolean {
  if (oldCutLine.length !== newCutLine.length) return false
  for (let i = 0; i < oldCutLine.length; i++) {
    if (oldCutLine[i].type !== newCutLine[i].type) return false
  }
  return true
}

const ENDPOINT_EPS_MM = 1.0

/**
 * Prüft ob altes und neues Segment mindestens einen gemeinsamen Endpunkt haben.
 * Bei Vertex-Drag ändert sich nur ein Endpunkt pro Segment – der andere bleibt gleich.
 * Bei zyklischem Shift stimmen beide Endpunkte nicht überein.
 */
function segmentsShareEndpoint(a: Curve, b: Curve): boolean {
  return (
    Math.hypot(a.start.x - b.start.x, a.start.y - b.start.y) < ENDPOINT_EPS_MM ||
    Math.hypot(a.end.x - b.end.x, a.end.y - b.end.y) < ENDPOINT_EPS_MM
  )
}

/**
 * Projiziert einen Punkt nur auf ein einzelnes Segment (nicht auf die gesamte Kontur).
 * Gibt (curveIndex, t, point) zurück – curveIndex ist der übergebene `ci`.
 */
function projectOntoSingleSegment(pos: Point, curves: Curve[], ci: number): Nr | null {
  if (ci < 0 || ci >= curves.length) return null
  const hit = nearestCurveIndexAndPoint(pos, [curves[ci]])
  if (!hit) return null
  return { point: hit.point, curveIndex: ci, t: hit.t ?? 0 }
}

/**
 * Nach Änderung der `cutLine`: auf die neue Kontur abbilden.
 *
 * Kerben bleiben **frei auf der Kontur** (`vertexIndex` wird nicht gesetzt).
 *
 * **Strategie:**
 * 1. Topologie kompatibel (gleiche Segmentzahl/-typen, z. B. Vertex-Drag):
 *    a) Segment teilt mindestens einen Endpunkt → Projektion NUR auf dieses Segment.
 *       Kerbe darf **nie** auf ein anderes Segment springen.
 *    b) Kein gemeinsamer Endpunkt (zyklischer Shift) → volle Euklidische Projektion.
 * 2. Topologie inkompatibel (z. B. Offset/Nahtzugabe):
 *    `sNormalized` übertragen → gleicher Konturanteil auf der neuen Kontur.
 * 3. Fallback: Euklidische Projektion der alten Position.
 *
 * `materializeNotchAnchorsOnCutLine` setzt `sNormalized` / `arcLengthMm` neu.
 */
export function resyncNotchesAfterCutLineRebuilt(
  notches: Notch[],
  oldCutLine: Curve[],
  newCutLine: Curve[]
): Notch[] {
  if (newCutLine.length === 0) return notches
  const topoCompat = isTopologyCompatibleForIndexT(oldCutLine, newCutLine)

  return notches.map((notch) => {
    const oldPos = getNotchPositionAndAngle(notch, oldCutLine).position

    let nr: Nr | null = null

    if (topoCompat) {
      const oldParam = getNotchCutLineParameter(notch, oldCutLine)
      if (oldParam != null && oldParam.curveIndex >= 0 && oldParam.curveIndex < newCutLine.length) {
        const ci = oldParam.curveIndex
        if (segmentsShareEndpoint(oldCutLine[ci], newCutLine[ci])) {
          nr = projectOntoSingleSegment(oldPos, newCutLine, ci)
        }
      }
      if (!nr) {
        const nearest = nearestCurveIndexAndPoint(oldPos, newCutLine)
        if (nearest) {
          nr = { point: nearest.point, curveIndex: nearest.curveIndex, t: nearest.t ?? 0 }
        }
      }
    }

    if (!nr) {
      const sn = notch.sNormalized
      const newTotal = totalPathLength(newCutLine)
      if (sn != null && Number.isFinite(sn) && newTotal > 0) {
        const pt = pointAtPathLength(newCutLine, Math.max(0, Math.min(1, sn)) * newTotal)
        if (pt) {
          nr = { curveIndex: pt.curveIndex, t: pt.t, point: pt.point }
        }
      }
    }

    if (!nr) {
      const nearest = nearestCurveIndexAndPoint(oldPos, newCutLine)
      if (!nearest) {
        return {
          ...notch,
          vertexIndex: undefined,
          sNormalized: undefined,
          arcLengthMm: undefined,
        }
      }
      nr = { point: nearest.point, curveIndex: nearest.curveIndex, t: nearest.t ?? 0 }
    }

    const nextFree: Notch = {
      ...notch,
      vertexIndex: undefined,
      sNormalized: undefined,
      arcLengthMm: undefined,
      position: { ...nr.point },
      angle: outwardNormalAngleAt(newCutLine, nr.curveIndex, nr.t) + 180,
    }

    return materializeNotchAnchorsOnCutLine(nextFree, newCutLine) ?? nextFree
  })
}

/**
 * Seam-as-Master Vertex-Drag: Die cutLine kommt von Clipper und hat bei jedem Drag
 * eine andere Segmentzahl. Die seamLine hingegen hat stabile Topologie (gleiche Segmente,
 * nur ein Vertex verschoben). Diese Funktion nutzt die seamLine als Anker:
 *
 * 1. Kerben-Position auf alte seamLine projizieren → SeamLine-Segment identifizieren.
 * 2. Segment-gesperrt: Position auf DASSELBE Segment der neuen seamLine projizieren.
 * 3. Punkt von der neuen seamLine nach außen auf die neue cutLine projizieren.
 *
 * So kann eine Kerbe nie auf ein anderes logisches Segment springen,
 * obwohl die Clipper-cutLine sich strukturell ändert.
 */
export function resyncNotchesViaSeamAnchor(
  notches: Notch[],
  oldCutLine: Curve[],
  newCutLine: Curve[],
  oldSeamLine: Curve[],
  newSeamLine: Curve[]
): Notch[] {
  if (newCutLine.length === 0) return notches

  const seamStable =
    oldSeamLine.length > 0 &&
    oldSeamLine.length === newSeamLine.length &&
    oldSeamLine.every((c, i) => c.type === newSeamLine[i].type)

  if (!seamStable) {
    return resyncNotchesAfterCutLineRebuilt(notches, oldCutLine, newCutLine)
  }

  return notches.map((notch) => {
    const oldPos = getNotchPositionAndAngle(notch, oldCutLine).position

    const seamProj = nearestCurveIndexAndPoint(oldPos, oldSeamLine)
    if (!seamProj) {
      return fallbackResync(notch, oldPos, newCutLine)
    }

    const ci = seamProj.curveIndex
    if (ci >= newSeamLine.length || !segmentsShareEndpoint(oldSeamLine[ci], newSeamLine[ci])) {
      return fallbackResync(notch, oldPos, newCutLine)
    }

    const lockedSeam = projectOntoSingleSegment(oldPos, newSeamLine, ci)
    if (!lockedSeam) {
      return fallbackResync(notch, oldPos, newCutLine)
    }

    const cutProj = nearestCurveIndexAndPoint(lockedSeam.point, newCutLine)
    if (!cutProj) {
      return fallbackResync(notch, oldPos, newCutLine)
    }

    const nr: Nr = { point: cutProj.point, curveIndex: cutProj.curveIndex, t: cutProj.t ?? 0 }
    return finalizeNotch(notch, nr, newCutLine)
  })
}

function fallbackResync(notch: Notch, oldPos: Point, newCutLine: Curve[]): Notch {
  const nearest = nearestCurveIndexAndPoint(oldPos, newCutLine)
  if (!nearest) {
    return { ...notch, vertexIndex: undefined, sNormalized: undefined, arcLengthMm: undefined }
  }
  return finalizeNotch(
    notch,
    { point: nearest.point, curveIndex: nearest.curveIndex, t: nearest.t ?? 0 },
    newCutLine
  )
}

function finalizeNotch(notch: Notch, nr: Nr, cutLine: Curve[]): Notch {
  const nextFree: Notch = {
    ...notch,
    vertexIndex: undefined,
    sNormalized: undefined,
    arcLengthMm: undefined,
    position: { ...nr.point },
    angle: outwardNormalAngleAt(cutLine, nr.curveIndex, nr.t) + 180,
  }
  return materializeNotchAnchorsOnCutLine(nextFree, cutLine) ?? nextFree
}

const CORNER_T_EPS = 0.01

/**
 * Prüft ob eine Konturänderung (z. B. Vertex-Drag) eine Kerbe an einen Eckpunkt geschoben hat.
 * Gibt `true` zurück, wenn mindestens eine Kerbe NEU an einer Ecke liegt (t < ε oder t > 1−ε),
 * die vorher NICHT an einer Ecke war. Kerben, die schon vorher an einer Ecke lagen, blockieren nicht.
 */
export function notchPushedToCorner(
  oldNotches: Notch[],
  oldCutLine: Curve[],
  newNotches: Notch[],
  newCutLine: Curve[]
): boolean {
  for (let i = 0; i < newNotches.length; i++) {
    const np = getNotchCutLineParameter(newNotches[i], newCutLine)
    if (!np) continue
    const newAtCorner = np.t < CORNER_T_EPS || np.t > 1 - CORNER_T_EPS
    if (!newAtCorner) continue
    if (i < oldNotches.length) {
      const op = getNotchCutLineParameter(oldNotches[i], oldCutLine)
      if (op && (op.t < CORNER_T_EPS || op.t > 1 - CORNER_T_EPS)) continue
    }
    return true
  }
  return false
}

/**
 * @deprecated Nicht mehr für Treffer/Eckpunkt-Logik verwenden: jede freie Kerbe in Projektionsnähe
 * blockierte fälschlich Ecken. Stattdessen `masterNotchVertexIndexSet` (nur verankerte Kerben).
 * Behalten für Referenz / ggf. Debug.
 */
export function seamVertexNearProjectedNotch(piece: PatternPiece, seamVertexIndex: number): boolean {
  const seam = piece.seamLine
  if (seam.length < 3) return false
  const n = seam.length
  const vi = ((seamVertexIndex % n) + n) % n
  const seamPos = vi === 0 ? seam[0].start : seam[vi - 1].end
  for (const notch of piece.notches) {
    const cutPos = getNotchPositionAndAngle(notch, piece.cutLine).position
    const nrr = nearestCurveIndexAndPoint(cutPos, seam)
    if (!nrr) continue
    if (Math.hypot(nrr.point.x - seamPos.x, nrr.point.y - seamPos.y) <= 5.5) {
      return true
    }
  }
  return false
}

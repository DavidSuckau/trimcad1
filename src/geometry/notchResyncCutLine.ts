import type { Curve, Notch, Point } from '../types/model'
import { outwardNormalAngleAt, totalPathLength, pointAtPathLength } from './curveToPath'
import {
  getNotchPositionAndAngle,
  getNotchCutLineParameter,
  materializeNotchAnchorsOnCutLine,
} from './notchOnCurve'
import { isNotchOnInternalLine } from './notchOnInternalLine'
import { nearestCurveIndexAndPoint } from './nearestOnCurve'
import { ENDPOINT_EPS_MM, CORNER_T_EPS } from './geometryConstants'

type Nr = { point: Point; curveIndex: number; t: number }

/** Maximaler Positions-Sprung einer Kerbe beim Kontur-Resync (mm). */
export const MAX_NOTCH_RESYNC_JUMP_MM = 10
/** Zusätzlich: Anteil des Umfangs, höherer Wert bei großen Teilen. */
export const MAX_NOTCH_RESYNC_JUMP_PERIMETER_FRAC = 0.015

function isTopologyCompatibleForIndexT(oldCutLine: Curve[], newCutLine: Curve[]): boolean {
  if (oldCutLine.length !== newCutLine.length) return false
  for (let i = 0; i < oldCutLine.length; i++) {
    if (oldCutLine[i].type !== newCutLine[i].type) return false
  }
  return true
}

function segmentsShareEndpoint(a: Curve, b: Curve): boolean {
  return (
    Math.hypot(a.start.x - b.start.x, a.start.y - b.start.y) < ENDPOINT_EPS_MM ||
    Math.hypot(a.end.x - b.end.x, a.end.y - b.end.y) < ENDPOINT_EPS_MM
  )
}

/** Gleiche logische Kante: Start- und Endpunkt passen (z. B. Linie → degenerierte Bezier beim Kurvenpunkt-Tool). */
function segmentsSameEndpoints(a: Curve, b: Curve): boolean {
  return (
    Math.hypot(a.start.x - b.start.x, a.start.y - b.start.y) < ENDPOINT_EPS_MM &&
    Math.hypot(a.end.x - b.end.x, a.end.y - b.end.y) < ENDPOINT_EPS_MM
  )
}

function projectOntoSingleSegment(pos: Point, curves: Curve[], ci: number): Nr | null {
  if (ci < 0 || ci >= curves.length) return null
  const hit = nearestCurveIndexAndPoint(pos, [curves[ci]])
  if (!hit) return null
  return { point: hit.point, curveIndex: ci, t: hit.t ?? 0 }
}

function distMm(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function maxResyncJumpMm(cutLine: Curve[]): number {
  const total = totalPathLength(cutLine)
  return Math.max(MAX_NOTCH_RESYNC_JUMP_MM, MAX_NOTCH_RESYNC_JUMP_PERIMETER_FRAC * total)
}

/** Bogenlänge entlang der neuen Kontur aus gespeichertem Scalar-Anker. */
export function tryAnchorFromScalar(notch: Notch, cutLine: Curve[]): Nr | null {
  const total = totalPathLength(cutLine)
  if (total <= 0) return null

  let L: number | null = null
  const sn = notch.sNormalized
  if (sn != null && Number.isFinite(sn)) {
    L = Math.max(0, Math.min(1, sn)) * total
  } else {
    const al = notch.arcLengthMm
    if (al != null && Number.isFinite(al)) {
      L = Math.max(0, Math.min(total, al))
    }
  }
  if (L == null) return null

  const pt = pointAtPathLength(cutLine, L)
  if (!pt) return null
  return { curveIndex: pt.curveIndex, t: pt.t, point: pt.point }
}

type ResyncCandidate = { nr: Nr; priority: number }

/** Wählt den Kandidaten mit kleinstem Sprung; bevorzugt Kandidaten unter `maxJump` in Prioritätsreihenfolge. */
function selectResyncAnchor(
  candidates: ResyncCandidate[],
  oldCanon: Point,
  maxJump: number
): Nr | null {
  if (candidates.length === 0) return null
  const sorted = [...candidates].sort((a, b) => a.priority - b.priority)
  for (const c of sorted) {
    if (distMm(c.nr.point, oldCanon) <= maxJump) return c.nr
  }
  let best = sorted[0].nr
  let bestD = distMm(best.point, oldCanon)
  for (let i = 1; i < sorted.length; i++) {
    const d = distMm(sorted[i].nr.point, oldCanon)
    if (d < bestD) {
      bestD = d
      best = sorted[i].nr
    }
  }
  return best
}

function collectResyncCandidates(
  notch: Notch,
  oldCutLine: Curve[],
  newCutLine: Curve[],
  oldCanon: Point
): ResyncCandidate[] {
  const candidates: ResyncCandidate[] = []
  const topoCompat = isTopologyCompatibleForIndexT(oldCutLine, newCutLine)
  const oldParam = getNotchCutLineParameter(notch, oldCutLine)

  if (topoCompat && oldParam != null && oldParam.curveIndex >= 0 && oldParam.curveIndex < newCutLine.length) {
    const ci = oldParam.curveIndex
    if (segmentsShareEndpoint(oldCutLine[ci], newCutLine[ci])) {
      const seg = projectOntoSingleSegment(oldCanon, newCutLine, ci)
      if (seg) candidates.push({ nr: seg, priority: 0 })
    }
  }

  const scalar = tryAnchorFromScalar(notch, newCutLine)
  if (scalar) candidates.push({ nr: scalar, priority: topoCompat ? 1 : 0 })

  const nearest = nearestCurveIndexAndPoint(oldCanon, newCutLine)
  if (nearest) {
    candidates.push({
      nr: { point: nearest.point, curveIndex: nearest.curveIndex, t: nearest.t ?? 0 },
      priority: topoCompat ? 2 : 1,
    })
  }

  return candidates
}

/**
 * Nach Änderung der `cutLine`: auf die neue Kontur abbilden.
 * Kerben bleiben frei auf der Kontur; Sprünge sind begrenzt (s. MAX_NOTCH_RESYNC_*).
 */
export function resyncNotchesAfterCutLineRebuilt(
  notches: Notch[],
  oldCutLine: Curve[],
  newCutLine: Curve[]
): Notch[] {
  if (newCutLine.length === 0) return notches
  const maxJump = maxResyncJumpMm(newCutLine)

  return notches.map((notch) => {
    if (isNotchOnInternalLine(notch)) return notch

    const oldCanon = getNotchPositionAndAngle(notch, oldCutLine).position
    const candidates = collectResyncCandidates(notch, oldCutLine, newCutLine, oldCanon)
    const nr = selectResyncAnchor(candidates, oldCanon, maxJump)

    if (!nr) {
      return {
        ...notch,
        vertexIndex: undefined,
        sNormalized: undefined,
        arcLengthMm: undefined,
      }
    }

    return finalizeNotch(notch, nr, newCutLine)
  })
}

/**
 * Seam-as-Master: Nahtlinie als logischer Anker; CutLine oft mit anderer Clipper-Topologie.
 * Bevorzugt gespeichertes sNormalized auf der CutLine, um falsche Segment-Sprünge zu vermeiden.
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
    oldSeamLine.every((c, i) => {
      const d = newSeamLine[i]
      if (!d) return false
      if (c.type === d.type) return true
      return segmentsSameEndpoints(c, d)
    })

  if (!seamStable) {
    return resyncNotchesAfterCutLineRebuilt(notches, oldCutLine, newCutLine)
  }

  const maxJump = maxResyncJumpMm(newCutLine)

  return notches.map((notch) => {
    if (isNotchOnInternalLine(notch)) return notch

    const oldCanon = getNotchPositionAndAngle(notch, oldCutLine).position
    const scalarCut = tryAnchorFromScalar(notch, newCutLine)

    const seamProj = nearestCurveIndexAndPoint(oldCanon, oldSeamLine)
    if (!seamProj) {
      return scalarCut ? finalizeNotch(notch, scalarCut, newCutLine) : fallbackResync(notch, oldCanon, oldCutLine, newCutLine)
    }

    const ci = seamProj.curveIndex
    if (ci >= newSeamLine.length || !segmentsShareEndpoint(oldSeamLine[ci], newSeamLine[ci])) {
      return scalarCut ? finalizeNotch(notch, scalarCut, newCutLine) : fallbackResync(notch, oldCanon, oldCutLine, newCutLine)
    }

    const lockedSeam = projectOntoSingleSegment(oldCanon, newSeamLine, ci)
    if (!lockedSeam) {
      return scalarCut ? finalizeNotch(notch, scalarCut, newCutLine) : fallbackResync(notch, oldCanon, oldCutLine, newCutLine)
    }

    const cutProj = nearestCurveIndexAndPoint(lockedSeam.point, newCutLine)
    if (!cutProj) {
      return scalarCut ? finalizeNotch(notch, scalarCut, newCutLine) : fallbackResync(notch, oldCanon, oldCutLine, newCutLine)
    }

    const nrSeam: Nr = { point: cutProj.point, curveIndex: cutProj.curveIndex, t: cutProj.t ?? 0 }
    const jumpSeam = distMm(nrSeam.point, oldCanon)

    if (scalarCut) {
      const jumpScalar = distMm(scalarCut.point, oldCanon)
      if (jumpScalar <= maxJump && jumpScalar <= jumpSeam + 1e-6) {
        return finalizeNotch(notch, scalarCut, newCutLine)
      }
      if (jumpSeam > maxJump && jumpScalar < jumpSeam) {
        return finalizeNotch(notch, scalarCut, newCutLine)
      }
    }

    if (jumpSeam > maxJump) {
      const fallback = resyncNotchesAfterCutLineRebuilt([notch], oldCutLine, newCutLine)[0]
      return fallback
    }

    return finalizeNotch(notch, nrSeam, newCutLine)
  })
}

function fallbackResync(notch: Notch, oldCanon: Point, oldCutLine: Curve[], newCutLine: Curve[]): Notch {
  const candidates = collectResyncCandidates(notch, oldCutLine, newCutLine, oldCanon)
  const maxJump = maxResyncJumpMm(newCutLine)
  const nr = selectResyncAnchor(candidates, oldCanon, maxJump)
  if (!nr) {
    return { ...notch, vertexIndex: undefined, sNormalized: undefined, arcLengthMm: undefined }
  }
  return finalizeNotch(notch, nr, newCutLine)
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

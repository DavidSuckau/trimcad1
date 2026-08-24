import type { Curve, Notch, Point } from '../types/model'
import { bezierAt, outwardNormalAngleAt, totalPathLength, pointAtPathLength } from './curveToPath'
import {
  getNotchPositionAndAngle,
  getNotchCutLineParameter,
  materializeNotchAnchorsOnCutLine,
} from './notchOnCurve'
import {
  isNotchOnInternalLine,
  materializeNotchAnchorsOnInternalLine,
  resolveNotchInternalLineAnchor,
} from './notchOnInternalLine'
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

function endpointsMatch(a: Point, b: Point): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < ENDPOINT_EPS_MM
}

/**
 * Gleiche logische Kante (beide Endpunkte), ggf. umgekehrte Laufrichtung.
 * Ein gemeinsamer Eckpunkt allein reicht nicht — sonst springen Kerben nahe Ecken auf die Nachbarkante.
 */
function segmentsSameLogicalEdge(
  a: Curve,
  b: Curve
): { ok: true; reversed: boolean } | { ok: false } {
  if (endpointsMatch(a.start, b.start) && endpointsMatch(a.end, b.end)) {
    return { ok: true, reversed: false }
  }
  if (endpointsMatch(a.start, b.end) && endpointsMatch(a.end, b.start)) {
    return { ok: true, reversed: true }
  }
  return { ok: false }
}

/** Lockern: gemeinsamer Endpunkt (nur Seam-Fallback). */
function segmentsShareEndpoint(a: Curve, b: Curve): boolean {
  return (
    endpointsMatch(a.start, b.start) ||
    endpointsMatch(a.end, b.end) ||
    endpointsMatch(a.start, b.end) ||
    endpointsMatch(a.end, b.start)
  )
}

/** Gleiche logische Kante: Start- und Endpunkt passen (z. B. Linie → degenerierte Bezier beim Kurvenpunkt-Tool). */
function segmentsSameEndpoints(a: Curve, b: Curve): boolean {
  return endpointsMatch(a.start, b.start) && endpointsMatch(a.end, b.end)
}

function pointOnCurveAt(curves: Curve[], curveIndex: number, t: number): Point | null {
  if (curveIndex < 0 || curveIndex >= curves.length) return null
  const c = curves[curveIndex]
  const tt = Math.max(0, Math.min(1, t))
  if (c.type === 'line') {
    return {
      x: c.start.x + tt * (c.end.x - c.start.x),
      y: c.start.y + tt * (c.end.y - c.start.y),
    }
  }
  return bezierAt(c, tt)
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

/** Wählt unter `maxJump` den Kandidaten mit kleinstem Abstand zu oldCanon (Priorität nur als Tie-Break). */
function selectResyncAnchor(
  candidates: ResyncCandidate[],
  oldCanon: Point,
  maxJump: number
): Nr | null {
  if (candidates.length === 0) return null
  const within = candidates
    .map((c) => ({ c, d: distMm(c.nr.point, oldCanon) }))
    .filter((x) => x.d <= maxJump)
  if (within.length > 0) {
    within.sort((a, b) => a.d - b.d || a.c.priority - b.c.priority)
    return within[0].c.nr
  }
  let best = candidates[0].nr
  let bestD = distMm(best.point, oldCanon)
  let bestPri = candidates[0].priority
  for (let i = 1; i < candidates.length; i++) {
    const d = distMm(candidates[i].nr.point, oldCanon)
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && candidates[i].priority < bestPri)) {
      bestD = d
      best = candidates[i].nr
      bestPri = candidates[i].priority
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
    const edge = segmentsSameLogicalEdge(oldCutLine[ci], newCutLine[ci])
    if (edge.ok) {
      const t = edge.reversed ? 1 - oldParam.t : oldParam.t
      const point = pointOnCurveAt(newCutLine, ci, t)
      if (point) candidates.push({ nr: { point, curveIndex: ci, t }, priority: 0 })
    }
  }

  // sNormalized/arcLength nur bei stabiler Topologie — sonst driftet der Konturstart (Clipper) und Kerben springen.
  const scalar = tryAnchorFromScalar(notch, newCutLine)
  if (scalar && topoCompat) candidates.push({ nr: scalar, priority: 1 })

  const nearest = nearestCurveIndexAndPoint(oldCanon, newCutLine)
  if (nearest) {
    candidates.push({
      nr: { point: nearest.point, curveIndex: nearest.curveIndex, t: nearest.t ?? 0 },
      priority: topoCompat ? 2 : 0,
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
 * Nach geometrischem Spiegeln der Kontur: Kerben per Segmentindex+t auf die gespiegelte CutLine legen,
 * danach ggf. auf eine neu abgeleitete CutLine resyncen (Sprungbegrenzung).
 * Verhindert willkürliche Nearest-Point-Sprünge beim Flip.
 */
export function rematerializeNotchesAfterGeometricMirror(args: {
  notches: Notch[]
  oldCutLine: Curve[]
  mirroredCutLine: Curve[]
  finalCutLine: Curve[]
  oldInternalLines: Curve[]
  mirroredInternalLines: Curve[]
  mapPoint: (p: Point) => Point
}): Notch[] {
  const {
    notches,
    oldCutLine,
    mirroredCutLine,
    finalCutLine,
    oldInternalLines,
    mirroredInternalLines,
    mapPoint,
  } = args

  const onMirrored = notches.map((notch) => {
    if (isNotchOnInternalLine(notch)) {
      const anchor = resolveNotchInternalLineAnchor(notch, oldInternalLines)
      if (
        anchor &&
        mirroredInternalLines.length === oldInternalLines.length &&
        anchor.curveIndex < mirroredInternalLines.length
      ) {
        const point = pointOnCurveAt(mirroredInternalLines, anchor.curveIndex, anchor.t)
        if (point) {
          return (
            materializeNotchAnchorsOnInternalLine(
              {
                ...notch,
                position: point,
                internalSNormalized: undefined,
                internalArcLengthMm: undefined,
              },
              mirroredInternalLines
            ) ?? notch
          )
        }
      }
      return (
        materializeNotchAnchorsOnInternalLine(
          {
            ...notch,
            position: mapPoint(notch.position),
            internalSNormalized: undefined,
            internalArcLengthMm: undefined,
          },
          mirroredInternalLines
        ) ?? { ...notch, position: mapPoint(notch.position) }
      )
    }

    const param = getNotchCutLineParameter(notch, oldCutLine)
    if (
      param &&
      mirroredCutLine.length === oldCutLine.length &&
      param.curveIndex < mirroredCutLine.length &&
      oldCutLine[param.curveIndex]?.type === mirroredCutLine[param.curveIndex]?.type
    ) {
      const point = pointOnCurveAt(mirroredCutLine, param.curveIndex, param.t)
      if (point) {
        return finalizeNotch(notch, { point, curveIndex: param.curveIndex, t: param.t }, mirroredCutLine)
      }
    }

    const mappedPos = mapPoint(getNotchPositionAndAngle(notch, oldCutLine).position)
    return (
      materializeNotchAnchorsOnCutLine(
        {
          ...notch,
          position: mappedPos,
          vertexIndex: undefined,
          sNormalized: undefined,
          arcLengthMm: undefined,
        },
        mirroredCutLine
      ) ?? { ...notch, position: mappedPos, vertexIndex: undefined, sNormalized: undefined, arcLengthMm: undefined }
    )
  })

  if (finalCutLine === mirroredCutLine) return onMirrored
  if (
    finalCutLine.length === mirroredCutLine.length &&
    finalCutLine.every((c, i) => segmentsSameLogicalEdge(c, mirroredCutLine[i]).ok)
  ) {
    return onMirrored
  }
  return resyncNotchesAfterCutLineRebuilt(onMirrored, mirroredCutLine, finalCutLine)
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
    const seamEdge =
      ci < newSeamLine.length ? segmentsSameLogicalEdge(oldSeamLine[ci], newSeamLine[ci]) : ({ ok: false } as const)
    if (!seamEdge.ok && (ci >= newSeamLine.length || !segmentsShareEndpoint(oldSeamLine[ci], newSeamLine[ci]))) {
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

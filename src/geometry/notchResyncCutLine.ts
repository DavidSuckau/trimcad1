import type { Curve, Notch, Point } from '../types/model'
import { bezierAt, outwardNormalAngleAt, totalPathLength } from './curveToPath'
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

/**
 * Weiter als das darf ein Resync die gesetzte Kerbe nicht von ihrem Punkt wegziehen.
 * Nahtzugabe und kleine Kantenkorrekturen bleiben darunter; ein Sprung an eine andere Station nicht.
 */
export const MAX_NOTCH_RESYNC_JUMP_MM = 40
/** Zusätzlich: Anteil des Umfangs, höherer Wert bei großen Teilen. */
export const MAX_NOTCH_RESYNC_JUMP_PERIMETER_FRAC = 0.02

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

/** Unter dieser Verschiebung gilt der gesetzte Punkt als unverändert — Kerbe wird nicht umgeschrieben. */
const NOTCH_RESYNC_STICK_MM = 0.05
/** Gleiche Kante behalten, wenn sie höchstens so viel weiter weg ist als der globale nächste Punkt. */
const SAME_EDGE_BIAS_MM = 1

function committedPoint(notch: Notch, cutLine: Curve[]): Point {
  if (Number.isFinite(notch.position.x) && Number.isFinite(notch.position.y)) return notch.position
  return getNotchPositionAndAngle(notch, cutLine).position
}

function withoutVertexIndex(notch: Notch): Notch {
  if (notch.vertexIndex === undefined) return notch
  return { ...notch, vertexIndex: undefined }
}

/**
 * Nächster Punkt der gesetzten Position auf der neuen Kontur.
 * `sNormalized` wird nicht gelesen. Liegt kein Punkt nah genug, bleibt die Kerbe exakt stehen.
 */
function reseatNotchOnNewCut(notch: Notch, oldCutLine: Curve[], newCutLine: Curve[]): Notch {
  if (isNotchOnInternalLine(notch)) return notch
  if (newCutLine.length === 0) return notch

  const oldCanon = committedPoint(notch, oldCutLine)
  const maxJump = maxResyncJumpMm(newCutLine)
  const oldHit = oldCutLine.length > 0 ? nearestCurveIndexAndPoint(oldCanon, oldCutLine) : null

  let sameEdge: Nr | null = null
  if (
    oldHit &&
    isTopologyCompatibleForIndexT(oldCutLine, newCutLine) &&
    oldHit.curveIndex < newCutLine.length &&
    segmentsSameLogicalEdge(oldCutLine[oldHit.curveIndex], newCutLine[oldHit.curveIndex]).ok
  ) {
    sameEdge = projectOntoSingleSegment(oldCanon, newCutLine, oldHit.curveIndex)
  }

  const nearest = nearestCurveIndexAndPoint(oldCanon, newCutLine)
  const nearestNr: Nr | null = nearest
    ? { point: nearest.point, curveIndex: nearest.curveIndex, t: nearest.t ?? 0 }
    : null

  let pick: Nr | null = null
  if (sameEdge && nearestNr) {
    const stay = distMm(sameEdge.point, oldCanon) <= distMm(nearestNr.point, oldCanon) + SAME_EDGE_BIAS_MM
    pick = stay ? sameEdge : nearestNr
  } else {
    pick = sameEdge ?? nearestNr
  }
  if (!pick) return withoutVertexIndex(notch)
  const jump = distMm(pick.point, oldCanon)
  if (jump > maxJump || jump <= NOTCH_RESYNC_STICK_MM) return withoutVertexIndex(notch)
  return finalizeNotch(notch, pick, newCutLine)
}

/**
 * Nach Änderung der `cutLine`: Kerbe am gesetzten Punkt lassen.
 * Nur wenn die neue Kontur direkt daneben liegt, wird sie auf diesen nächsten Punkt gesetzt
 * und der neue Punkt gespeichert. Ein Bogenlängen-Anteil darf sie nicht woanders hinziehen.
 */
export function resyncNotchesAfterCutLineRebuilt(
  notches: Notch[],
  oldCutLine: Curve[],
  newCutLine: Curve[]
): Notch[] {
  if (newCutLine.length === 0) return notches
  return notches.map((notch) => reseatNotchOnNewCut(notch, oldCutLine, newCutLine))
}

/**
 * Nach geometrischem Spiegeln/Skalieren der Kontur: Kerben auf die Ziel-CutLine legen.
 *
 * - Bei gleicher Topologie (mirroredCutLine ≡ finalCutLine): Segmentindex+t (kein Nearest-Sprung).
 * - Wenn die finale CutLine abweicht (Naht→Schnitt neu abgeleitet): Position per `mapPoint`
 *   direkt auf `finalCutLine` materialisieren — kein Sprunglimit-Resync, der Kerben verlieren kann.
 * Typ/Tiefe/Breite/Rolle bleiben erhalten; Winkel wird neu aus der Zielkontur berechnet.
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

  const targetCut =
    finalCutLine.length >= 3 ? finalCutLine : mirroredCutLine.length >= 3 ? mirroredCutLine : oldCutLine

  const finalMatchesMirrored =
    targetCut === mirroredCutLine ||
    (finalCutLine.length === mirroredCutLine.length &&
      finalCutLine.length > 0 &&
      finalCutLine.every((c, i) => segmentsSameLogicalEdge(c, mirroredCutLine[i]!).ok))

  const useIndexT =
    finalMatchesMirrored &&
    mirroredCutLine.length === oldCutLine.length &&
    mirroredCutLine.every((c, i) => oldCutLine[i]?.type === c.type)

  return notches.map((notch) => {
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

    if (useIndexT) {
      const param = getNotchCutLineParameter(notch, oldCutLine)
      if (param && param.curveIndex < mirroredCutLine.length) {
        const point = pointOnCurveAt(mirroredCutLine, param.curveIndex, param.t)
        if (point) {
          return finalizeNotch(notch, { point, curveIndex: param.curveIndex, t: param.t }, targetCut)
        }
      }
    }

    // Abweichende Cut-Topologie oder Index+t nicht möglich: gespiegelte Weltposition → finalCutLine.
    const mappedPos = mapPoint(getNotchPositionAndAngle(notch, oldCutLine).position)
    const draft: Notch = {
      ...notch,
      position: mappedPos,
      vertexIndex: undefined,
      sNormalized: undefined,
      arcLengthMm: undefined,
    }
    const placed = materializeNotchAnchorsOnCutLine(draft, targetCut)
    if (placed) return placed
    const nearest = nearestCurveIndexAndPoint(mappedPos, targetCut)
    if (nearest) {
      return finalizeNotch(
        notch,
        { point: nearest.point, curveIndex: nearest.curveIndex, t: nearest.t ?? 0 },
        targetCut
      )
    }
    return draft
  })
}

/**
 * Seam-as-Master: dieselbe Regel wie `resyncNotchesAfterCutLineRebuilt`.
 * Die gesetzte Cut-Position bleibt der Anker. Die Nahtlinien werden nicht benutzt,
 * um die Kerbe über einen Bogenlängen-Anteil an eine andere Station zu schieben.
 */
export function resyncNotchesViaSeamAnchor(
  notches: Notch[],
  oldCutLine: Curve[],
  newCutLine: Curve[],
  oldSeamLine: Curve[],
  newSeamLine: Curve[]
): Notch[] {
  void oldSeamLine
  void newSeamLine
  return resyncNotchesAfterCutLineRebuilt(notches, oldCutLine, newCutLine)
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

import type { Curve, PatternPiece, Point } from '../types/model'
import {
  closedPointsToLineCurves,
  tessellateCurvesToPoints,
  validateContourAfterVertexMove,
  clipperOffsetClosedPolygon,
} from './offset'
import { pieceLocalToWorld, worldToPieceLocal } from './pieceTransform'
import { samePoint } from './geometryConstants'
// @ts-expect-error clipper-lib has no types
import ClipperLib from 'clipper-lib'

const SCALE = 100000

/** Eck-/Schnittpunkte-Toleranz: Teile liegen selten exakt deckungsgleich (mm). */
const CUT_TRIM_VERTEX_MATCH_MM = 2.8

/** Partner-Kontur leicht nach außen offsetten, damit nahezu berührende Flächen noch schneiden. */
const OTHER_CLIP_INFLATE_MM = 1.1

type IntPoint = { X: number; Y: number }

type SeamTrimByOverlapResult =
  | { ok: true; changed: false; reason: string }
  | { ok: true; changed: true; cutLine: Curve[]; intersectionPointsWorld: Point[] }
  | { ok: false; message: string }

/** Eckpunkt-Index auf der **cutLine** (wie `updateVertex` / Schnittkontur-Ecken). */
export type TrimPieceCutOverlapOptions = {
  chosenCutVertexIndex: number
}

function toIntPoint(p: Point): IntPoint {
  return new ClipperLib.IntPoint2(Math.round(p.x * SCALE), Math.round(p.y * SCALE))
}

function fromIntPoint(ip: IntPoint): Point {
  return { x: ip.X / SCALE, y: ip.Y / SCALE }
}

function signedAreaRing(pts: Point[]): number {
  let a = 0
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return a / 2
}

function openRing(pts: Point[]): Point[] {
  const out = [...pts]
  if (out.length > 1 && samePoint(out[0], out[out.length - 1])) out.pop()
  return out
}

function largestPathByAbsArea(paths: IntPoint[][]): Point[] | null {
  let best: Point[] | null = null
  let bestArea = -1
  for (const path of paths) {
    if (path.length < 3) continue
    const pts = path.map(fromIntPoint)
    const ring = openRing(pts)
    if (ring.length < 3) continue
    const area = Math.abs(signedAreaRing(ring))
    if (area > bestArea) {
      bestArea = area
      best = ring
    }
  }
  return best
}

function distPointToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const apx = p.x - a.x
  const apy = p.y - a.y
  const ab2 = abx * abx + aby * aby
  if (ab2 < 1e-18) return Math.hypot(apx, apy)
  let t = (apx * abx + apy * aby) / ab2
  t = Math.max(0, Math.min(1, t))
  const cx = a.x + t * abx
  const cy = a.y + t * aby
  return Math.hypot(p.x - cx, p.y - cy)
}

function minDistPointToClosedPolyline(ring: Point[], p: Point): number {
  const n = ring.length
  if (n < 2) return Infinity
  let m = Infinity
  for (let i = 0; i < n; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % n]
    const d = distPointToSegment(p, a, b)
    if (d < m) m = d
  }
  return m
}

/** Punkt strikt innerhalb geschlossener Polylinie (ohne doppelten Schlusspunkt). */
function pointInPolygon(pt: Point, ring: Point[]): boolean {
  let inside = false
  const n = ring.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i].x
    const yi = ring[i].y
    const xj = ring[j].x
    const yj = ring[j].y
    const intersect = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-15) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/** Eckpunkt gilt als Teil des Trim-Ergebnisses: auf Rand nahe genug oder im Inneren. */
function vertexOnOrInsideTrimmedRegion(v: Point, resultRing: Point[], epsMm: number): boolean {
  if (resultRing.length < 3) return false
  if (minDistPointToClosedPolyline(resultRing, v) <= epsMm) return true
  return pointInPolygon(v, resultRing)
}

function alignRingStartNearReference(ring: Point[], reference: Point): Point[] {
  if (ring.length <= 1) return ring
  let bestIdx = 0
  let bestDist = Infinity
  for (let i = 0; i < ring.length; i++) {
    const d = Math.hypot(ring[i].x - reference.x, ring[i].y - reference.y)
    if (d < bestDist) {
      bestDist = d
      bestIdx = i
    }
  }
  if (bestIdx === 0) return ring
  return [...ring.slice(bestIdx), ...ring.slice(0, bestIdx)]
}

/** Nur echte Eckpunkte der cutLine (Segment-Starts) in Weltkoordinaten — nicht jede Tessellations-Stufe. */
function cutLineVerticesWorld(piece: PatternPiece): Point[] {
  const out: Point[] = []
  for (const c of piece.cutLine) {
    out.push(pieceLocalToWorld(c.start, piece.transform))
  }
  return out
}

function worldRingFromPieceCutLine(piece: PatternPiece): Point[] {
  const tess = tessellateCurvesToPoints(piece.cutLine, 64)
  return openRing(tess).map((p) => pieceLocalToWorld(p, piece.transform))
}

/**
 * Clip-Polygon für das andere Teil: leicht aufblasen, damit minimale Lücken zur Zielkontur
 * trotzdem eine Schnittmenge liefern (Ecken nicht exakt deckungsgleich).
 */
function otherClipPolygonWorldInflated(otherPiece: PatternPiece): Point[] {
  const base = worldRingFromPieceCutLine(otherPiece)
  if (base.length < 3) return base
  const curves = closedPointsToLineCurves(base, 0)
  const off = clipperOffsetClosedPolygon(curves, OTHER_CLIP_INFLATE_MM, {
    joinType: 'miter',
    miterLimit: 3,
    simplifyTolerance: 0,
  })
  if (off.solutionPathCount !== 1 || off.lineCurves.length < 3) return base
  const inflated = openRing(tessellateCurvesToPoints(off.lineCurves, 48))
  return inflated.length >= 3 ? inflated : base
}

/**
 * Manuelles "Naht trimmen":
 * Zielteil wird auf die Schnittmenge mit dem Referenzteil reduziert (nur cutLine).
 * seamLine bleibt unverändert und wird außerhalb dieser Funktion nicht verändert.
 */
export function trimPieceCutLineByOtherPieceOverlap(
  targetPiece: PatternPiece,
  otherPiece: PatternPiece,
  options?: TrimPieceCutOverlapOptions
): SeamTrimByOverlapResult {
  if (targetPiece.cutLine.length < 3 || otherPiece.cutLine.length < 3) {
    return { ok: false, message: 'Teilkontur ist zu kurz für Naht trimmen.' }
  }
  const targetWorld = worldRingFromPieceCutLine(targetPiece)
  const otherClipWorld = otherClipPolygonWorldInflated(otherPiece)
  const targetVertsWorld = cutLineVerticesWorld(targetPiece)
  if (targetWorld.length < 3 || otherClipWorld.length < 3 || targetVertsWorld.length < 3) {
    return { ok: false, message: 'Kontur konnte nicht ausgewertet werden.' }
  }

  const clip = new ClipperLib.Clipper()
  clip.StrictlySimple = true
  clip.AddPath(targetWorld.map(toIntPoint), ClipperLib.PolyType.ptSubject, true)
  clip.AddPath(otherClipWorld.map(toIntPoint), ClipperLib.PolyType.ptClip, true)
  const solution: IntPoint[][] = []
  clip.Execute(
    ClipperLib.ClipType.ctIntersection,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero
  )

  if (solution.length === 0) {
    return { ok: true, changed: false, reason: 'Kein Überlappungsbereich gefunden.' }
  }
  if (solution.length > 1) {
    return {
      ok: false,
      message: 'Naht trimmen ist mehrdeutig (mehrere getrennte Überlappungsflächen).',
    }
  }

  const outWorldRaw = largestPathByAbsArea(solution)
  if (!outWorldRaw || outWorldRaw.length < 3) {
    return { ok: false, message: 'Naht trimmen ergab keine gültige Zielkontur.' }
  }

  const eps = CUT_TRIM_VERTEX_MATCH_MM

  const unchanged =
    targetWorld.length === outWorldRaw.length &&
    targetWorld.every((p) => minDistPointToClosedPolyline(outWorldRaw, p) <= eps)
  if (unchanged) {
    return { ok: true, changed: false, reason: 'Keine überstehenden Außenbereiche gefunden.' }
  }

  const removedTargetCorners = targetVertsWorld.filter((v) => !vertexOnOrInsideTrimmedRegion(v, outWorldRaw, eps))
  const chosenIdx = options?.chosenCutVertexIndex
  if (chosenIdx != null) {
    if (!Number.isInteger(chosenIdx) || chosenIdx < 0 || chosenIdx >= targetVertsWorld.length) {
      return { ok: false, message: 'Ungültiger Eckpunkt-Index für Naht trimmen.' }
    }
    const chosenWorld = targetVertsWorld[chosenIdx]
    if (removedTargetCorners.length === 0) {
      return { ok: false, message: 'An der gewählten Ecke ist kein trimmbarer Überstand.' }
    }
    const chosenIsRemoved = removedTargetCorners.some(
      (v) => Math.hypot(v.x - chosenWorld.x, v.y - chosenWorld.y) <= eps
    )
    if (!chosenIsRemoved) {
      return { ok: false, message: 'Die Überlappung schneidet eine andere Ecke als die angeklickte.' }
    }
  } else if (removedTargetCorners.length !== 1) {
    return {
      ok: false,
      message:
        'Naht trimmen unterstützt hier nur einen einzelnen Eck-Trim. Mehrere Außenbereiche (z. B. oben und unten) wurden erkannt.',
    }
  }

  const retainedCorners = targetVertsWorld.filter((v) => vertexOnOrInsideTrimmedRegion(v, outWorldRaw, eps))
  if (retainedCorners.length < 2) {
    return {
      ok: false,
      message: 'Naht trimmen benötigt mindestens zwei erhaltene Ecken der Zielkontur (Abstand/Toleranz prüfen).',
    }
  }

  const startRefWorld = pieceLocalToWorld(targetPiece.cutLine[0].start, targetPiece.transform)
  const alignedWorld = alignRingStartNearReference(outWorldRaw, startRefWorld)
  const alignedLocal = alignedWorld.map((p) => worldToPieceLocal(p, targetPiece.transform))
  const cutLine = closedPointsToLineCurves(alignedLocal, 0)
  if (cutLine.length < 3) {
    return { ok: false, message: 'Getrimmte Kontur ist ungültig.' }
  }

  const valid = validateContourAfterVertexMove(cutLine)
  if (!valid.ok) {
    return { ok: false, message: valid.message }
  }

  if (cutLine.length === targetPiece.cutLine.length) {
    let equal = true
    for (let i = 0; i < cutLine.length; i++) {
      const a = cutLine[i]
      const b = targetPiece.cutLine[i]
      if (a.type !== 'line' || b.type !== 'line') {
        equal = false
        break
      }
      if (
        Math.hypot(a.start.x - b.start.x, a.start.y - b.start.y) > 1e-4 ||
        Math.hypot(a.end.x - b.end.x, a.end.y - b.end.y) > 1e-4
      ) {
        equal = false
        break
      }
    }
    if (equal) return { ok: true, changed: false, reason: 'Keine überstehenden Außenbereiche gefunden.' }
  }

  const intersectionPointsWorld = outWorldRaw.filter((p) =>
    targetVertsWorld.some((q) => Math.hypot(p.x - q.x, p.y - q.y) <= eps)
  )
  return { ok: true, changed: true, cutLine, intersectionPointsWorld }
}

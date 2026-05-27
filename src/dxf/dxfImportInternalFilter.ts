/**
 * Entfernt Innenlinien, die geometrisch Schnitt- oder Nahtkontur duplizieren (DXF-Import).
 */

import type { Curve, PatternPiece, Point } from '../types/model'
import {
  areNearDuplicateContourRings,
  closedRingPointsRaw,
  DUPLICATE_THRESHOLD_DXF,
  dxfVertexRingClosed,
  type DxfPoint,
} from './dxfCollectCutDrafts'
import { dist } from './dxfShared'
export type PieceCutRing = DxfPoint[] | null

export type ContourRef = { verts: DxfPoint[]; closed: boolean }

export function lineCurvesToVertexRing(curves: Curve[]): ContourRef | null {
  const verts: DxfPoint[] = []
  for (const c of curves) {
    if (c.type !== 'line') return null
    verts.push({ x: c.start.x, y: c.start.y })
  }
  if (verts.length < 3) return null
  const last = curves[curves.length - 1]
  if (last.type !== 'line') return null
  const closed =
    dxfVertexRingClosed(verts) || dist(verts[0], last.end) < DUPLICATE_THRESHOLD_DXF
  return { verts, closed }
}

export function collectPieceContourRefs(
  piece: PatternPiece,
  cutRing: PieceCutRing,
  seamRing: PieceCutRing,
): ContourRef[] {
  const refs: ContourRef[] = []
  if (cutRing && cutRing.length >= 3) refs.push({ verts: cutRing, closed: true })
  if (seamRing && seamRing.length >= 3) refs.push({ verts: seamRing, closed: true })
  const cutC = lineCurvesToVertexRing(piece.cutLine)
  if (cutC) refs.push(cutC)
  const seamC = lineCurvesToVertexRing(piece.seamLine)
  if (seamC) refs.push(seamC)
  return refs
}

export function isPolylineDuplicateOfAnyContour(
  vertices: DxfPoint[],
  closed: boolean,
  refs: ContourRef[],
): boolean {
  for (const r of refs) {
    if (r.verts.length < 3) continue
    if (areNearDuplicateContourRings(vertices, closed, r.verts, r.closed)) return true
  }
  return false
}

function pointsNear(a: Point, b: Point): boolean {
  return dist(a, b) < DUPLICATE_THRESHOLD_DXF
}

/** Geschlossene Ketten aus Liniensegmenten (z. B. mehrere importierte Kontur-Dubletten hintereinander). */
export function extractConnectedClosedRingsFromLineCurves(
  curves: Curve[],
): Array<{ curveIndices: number[]; vertices: DxfPoint[] }> {
  const segs: Array<{ curveIndex: number; a: Point; b: Point }> = []
  for (let i = 0; i < curves.length; i++) {
    const c = curves[i]
    if (c.type !== 'line') return []
    segs.push({ curveIndex: i, a: c.start, b: c.end })
  }
  if (segs.length === 0) return []

  const used = new Set<number>()
  const rings: Array<{ curveIndices: number[]; vertices: DxfPoint[] }> = []

  for (let s = 0; s < segs.length; s++) {
    if (used.has(s)) continue
    const chain: number[] = [s]
    used.add(s)
    const head = segs[s].a
    let tail = segs[s].b

    for (let guard = 0; guard <= segs.length; guard++) {
      if (chain.length >= 3 && pointsNear(tail, head)) {
        const vertices: DxfPoint[] = [{ x: head.x, y: head.y }]
        for (const si of chain) {
          vertices.push({ x: segs[si].b.x, y: segs[si].b.y })
        }
        if (vertices.length > 1 && pointsNear(vertices[vertices.length - 1], vertices[0])) {
          vertices.pop()
        }
        if (vertices.length >= 3) {
          rings.push({
            curveIndices: chain.map((si) => segs[si].curveIndex),
            vertices,
          })
        }
        break
      }
      let extended = false
      for (let j = 0; j < segs.length; j++) {
        if (used.has(j)) continue
        const seg = segs[j]
        if (pointsNear(seg.a, tail)) {
          chain.push(j)
          used.add(j)
          tail = seg.b
          extended = true
          break
        }
        if (pointsNear(seg.b, tail)) {
          chain.push(j)
          used.add(j)
          tail = seg.a
          extended = true
          break
        }
      }
      if (!extended) break
    }
  }
  return rings
}

export function stripDuplicateContourInternalLines(
  internalLines: Curve[],
  contourRefs: ContourRef[],
): Curve[] {
  if (internalLines.length === 0 || contourRefs.length === 0) return internalLines
  const rings = extractConnectedClosedRingsFromLineCurves(internalLines)
  const remove = new Set<number>()
  for (const ring of rings) {
    if (ring.vertices.length < 3) continue
    if (isPolylineDuplicateOfAnyContour(ring.vertices, true, contourRefs)) {
      for (const i of ring.curveIndices) remove.add(i)
    }
  }
  if (remove.size === 0) return internalLines
  return internalLines.filter((_, i) => !remove.has(i))
}

export function seamRingFromDraftVertices(
  seamVertices: DxfPoint[] | null | undefined,
  seamClosed?: boolean,
): PieceCutRing {
  if (!seamVertices || seamVertices.length < 3) return null
  const closed = seamClosed ?? dxfVertexRingClosed(seamVertices)
  return closedRingPointsRaw(seamVertices, closed)
}

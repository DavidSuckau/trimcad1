import type { Curve, PatternPiece, Point } from '../types/model'
import type { BatchSelectionFilter, BatchSelectionTarget } from '../types/model'
import { bezierAt } from '../geometry/curveToPath'
import { getNotchPositionAndAngleOnCutLine } from '../geometry/notchOnCurve'
import { seamVertexNearProjectedNotch } from '../geometry/notchResyncCutLine'
import { pieceLocalToWorld } from '../geometry/pieceTransform'
import { masterSoftVertexIndexSet } from '../geometry/seamUtils'
import { useSeamLineForPointCurveEditing, useSeamLineForVertexEditing } from '../geometry/vertexMaster'

export type WorldRect = { minX: number; minY: number; maxX: number; maxY: number }

export function batchTargetKey(t: BatchSelectionTarget): string {
  switch (t.kind) {
    case 'vertex':
      return `v:${t.pieceId}:${t.vertexIndex}`
    case 'curvePoint':
      return `cp:${t.pieceId}:${t.curveIndex}`
    case 'notch':
      return `n:${t.pieceId}:${t.notchId}`
    case 'internalLine':
      return `il:${t.pieceId}:${t.curveIndex}`
  }
}

export function filterBatchTargets(
  targets: BatchSelectionTarget[],
  filter: BatchSelectionFilter,
  pieces?: PatternPiece[]
): BatchSelectionTarget[] {
  if (filter === 'all') return targets

  if (filter === 'softVertices' || filter === 'hardVertices') {
    if (!pieces?.length) return []
    const byId = new Map(pieces.map((p) => [p.id, p]))
    const wantSoft = filter === 'softVertices'
    return targets.filter((t) => {
      if (t.kind !== 'vertex') return false
      const piece = byId.get(t.pieceId)
      if (!piece) return false
      const soft = masterSoftVertexIndexSet(piece).has(t.vertexIndex)
      return wantSoft ? soft : !soft
    })
  }

  const kindByFilter: Partial<Record<BatchSelectionFilter, BatchSelectionTarget['kind']>> = {
    vertices: 'vertex',
    notches: 'notch',
    curvePoints: 'curvePoint',
    internalLines: 'internalLine',
  }
  const want = kindByFilter[filter]
  if (want == null) return targets
  return targets.filter((t) => t.kind === want)
}

function pointInWorldRect(p: Point, r: WorldRect): boolean {
  return p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY
}

function pointOnCurveSample(c: Curve, t: number): Point {
  if (c.type === 'line') {
    return {
      x: c.start.x + t * (c.end.x - c.start.x),
      y: c.start.y + t * (c.end.y - c.start.y),
    }
  }
  return bezierAt(c, t)
}

/** Prüft, ob mindestens ein Punkt entlang der Kurve im Rechteck liegt (grobe Abdeckung). */
function curveAnySampleInRect(curve: Curve, piece: PatternPiece, r: WorldRect): boolean {
  const samples = [0, 0.25, 0.5, 0.75, 1]
  for (const t of samples) {
    const local = pointOnCurveSample(curve, t)
    const w = pieceLocalToWorld(local, piece.transform)
    if (pointInWorldRect(w, r)) return true
  }
  return false
}

function vertexWorldPosition(piece: PatternPiece, vi: number, curvesForVertices: Curve[]): Point {
  const vertexPos = vi === 0 ? curvesForVertices[0].start : curvesForVertices[vi - 1].end
  return pieceLocalToWorld(vertexPos, piece.transform)
}

/**
 * Sammelt alle Ziele, deren repräsentative Punkte (bzw. Kurven-Samples) im Welt-Rechteck liegen.
 */
export function collectMarqueeTargets(pieces: PatternPiece[], rect: WorldRect): BatchSelectionTarget[] {
  const out: BatchSelectionTarget[] = []
  const seen = new Set<string>()

  const add = (t: BatchSelectionTarget) => {
    const k = batchTargetKey(t)
    if (seen.has(k)) return
    seen.add(k)
    out.push(t)
  }

  for (const piece of pieces) {
    // Eckpunkte
    const useSeamMaster = useSeamLineForVertexEditing(piece)
    const curvesForVertices = useSeamMaster ? piece.seamLine : piece.cutLine
    if (curvesForVertices.length > 0) {
      const n = curvesForVertices.length
      for (let vi = 0; vi < n; vi++) {
        if (useSeamMaster && seamVertexNearProjectedNotch(piece, vi)) continue
        /** Notch.vertexIndex ist cutLine-Ecke; vi ist bei Seam-Master ein seam-Index — nicht vergleichen (sonst werden u. a. weiche/blaue Punkte fälschlich übersprungen). */
        if (!useSeamMaster && piece.notches.some((no) => no.vertexIndex === vi)) continue
        const w = vertexWorldPosition(piece, vi, curvesForVertices)
        if (pointInWorldRect(w, rect)) {
          add({ kind: 'vertex', pieceId: piece.id, vertexIndex: vi })
        }
      }
    }

    // Kurvenpunkte (Bézier-Mitte)
    const curvesForPoint = useSeamLineForPointCurveEditing(piece) ? piece.seamLine : piece.cutLine
    for (let ci = 0; ci < curvesForPoint.length; ci++) {
      const c = curvesForPoint[ci]
      if (c.type !== 'bezier') continue
      const mid = bezierAt(c, 0.5)
      const w = pieceLocalToWorld(mid, piece.transform)
      if (pointInWorldRect(w, rect)) {
        add({ kind: 'curvePoint', pieceId: piece.id, curveIndex: ci })
      }
    }

    // Kerben (Referenzpunkt auf Schnittkontur)
    for (const n of piece.notches) {
      const cutPos = getNotchPositionAndAngleOnCutLine(n, piece.cutLine, piece.seamLine)
      const w = pieceLocalToWorld(cutPos.position, piece.transform)
      if (pointInWorldRect(w, rect)) {
        add({ kind: 'notch', pieceId: piece.id, notchId: n.id })
      }
    }

    // Interne Linien
    for (let ii = 0; ii < piece.internalLines.length; ii++) {
      const curve = piece.internalLines[ii]
      if (curveAnySampleInRect(curve, piece, rect)) {
        add({ kind: 'internalLine', pieceId: piece.id, curveIndex: ii })
      }
    }
  }

  return out
}

export function mergeBatchTargets(a: BatchSelectionTarget[], b: BatchSelectionTarget[]): BatchSelectionTarget[] {
  const m = new Map<string, BatchSelectionTarget>()
  for (const t of a) m.set(batchTargetKey(t), t)
  for (const t of b) m.set(batchTargetKey(t), t)
  return [...m.values()]
}

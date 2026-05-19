/**
 * DXF-Import: verschachtelte Konturen → interne Linien, Zuordnung per Polygon,
 * freistehende Internals/Notches, Kerben-Deduplizierung.
 */

import type { Curve, InternalCircle, Notch, PatternPiece, Point } from '../types/model'
import type { DxfEntity, DxfPoint, ParsedDxf } from './dxfParser'
import { resyncNotchesAfterCutLineRebuilt } from '../geometry/notchResyncCutLine'
import { isPointInPolygon } from '../geometry/pointInPolygon'
import {
  type BBox,
  type PieceDraft,
  dxfVerticesToLineCurves,
  lineToNotchDxf,
  pointToNotchDxf,
  polylineFromEntity,
  transformDxfInsertPoint,
} from './dxfCollectCutDrafts'
import { dist } from './dxfShared'
import {
  isCutLayer,
  isDrillLayer,
  isGrainLayer,
  isInternalLayer,
  isNotchLineLayer,
  isSeamLayer,
  isAuxDxfLayer,
} from './dxfImportLayers'

const ASSIGN_BBOX_PAD_MM = 50
const NOTCH_DEDUPE_MM = 2.5
const V_NOTCH_TIP_SNAP_MM = 1.5

export type PieceCutRing = DxfPoint[] | null

export function assignDxfPointToPiece(
  px: number,
  py: number,
  cutRings: PieceCutRing[],
  cutBounds: BBox[],
): number {
  const p = { x: px, y: py }
  for (let i = 0; i < cutRings.length; i++) {
    const ring = cutRings[i]
    if (ring && ring.length >= 3 && isPointInPolygon(p, ring)) return i
  }
  let bestPiece = -1
  let bestDist = Infinity
  for (let i = 0; i < cutBounds.length; i++) {
    const b = cutBounds[i]
    if (px >= b.minX - ASSIGN_BBOX_PAD_MM && px <= b.maxX + ASSIGN_BBOX_PAD_MM
      && py >= b.minY - ASSIGN_BBOX_PAD_MM && py <= b.maxY + ASSIGN_BBOX_PAD_MM) {
      const d = Math.max(0, b.minX - px, px - b.maxX, b.minY - py, py - b.maxY)
      if (d < bestDist) {
        bestDist = d
        bestPiece = i
      }
    }
  }
  return bestPiece
}

function isCircleInsideCut(
  cx: number,
  cy: number,
  radius: number,
  ring: PieceCutRing,
  bounds: BBox,
): boolean {
  if (!ring || ring.length < 3) {
    return cx >= bounds.minX && cx <= bounds.maxX && cy >= bounds.minY && cy <= bounds.maxY
  }
  if (!isPointInPolygon({ x: cx, y: cy }, ring)) return false
  const maxR = Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2
  return radius < maxR * 0.48
}

function collectInternalsFromEntityList(
  entities: DxfEntity[],
  mapPoint: (p: DxfPoint) => Point,
  radiusScale: number,
  cutRings: PieceCutRing[],
  cutBounds: BBox[],
  extraCutLayers: string[],
): {
  internalLinesByPiece: Map<number, Curve[]>
  internalCirclesByPiece: Map<number, InternalCircle[]>
  notchLinesByPiece: Map<number, Array<{ x1: number; y1: number; x2: number; y2: number; layer: string }>>
} {
  const internalLinesByPiece = new Map<number, Curve[]>()
  const internalCirclesByPiece = new Map<number, InternalCircle[]>()
  const notchLinesByPiece = new Map<number, Array<{ x1: number; y1: number; x2: number; y2: number; layer: string }>>()

  const pushInternalLine = (pieceIdx: number, curves: Curve[]) => {
    if (curves.length === 0) return
    const list = internalLinesByPiece.get(pieceIdx) ?? []
    list.push(...curves)
    internalLinesByPiece.set(pieceIdx, list)
  }

  const pushInternalCircle = (pieceIdx: number, c: InternalCircle) => {
    const list = internalCirclesByPiece.get(pieceIdx) ?? []
    list.push(c)
    internalCirclesByPiece.set(pieceIdx, list)
  }

  for (const e of entities) {
    if (isAuxDxfLayer(e.layer)) continue

    if (e.type === 'LINE') {
      if (isGrainLayer(e.layer) || isSeamLayer(e.layer)) continue
      const p1 = mapPoint({ x: e.x1, y: e.y1 })
      const p2 = mapPoint({ x: e.x2, y: e.y2 })
      const mx = (p1.x + p2.x) / 2
      const my = (p1.y + p2.y) / 2
      const idx = assignDxfPointToPiece(mx, my, cutRings, cutBounds)
      if (idx < 0) continue

      if (isNotchLineLayer(e.layer)) {
        const list = notchLinesByPiece.get(idx) ?? []
        list.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, layer: e.layer })
        notchLinesByPiece.set(idx, list)
        continue
      }

      if (isInternalLayer(e.layer) || (!isCutLayer(e.layer, extraCutLayers) && !isDrillLayer(e.layer))) {
        if (isCutLayer(e.layer, extraCutLayers)) continue
        pushInternalLine(idx, [{
          type: 'line',
          start: p1,
          end: p2,
        }])
      }
      continue
    }

    if (e.type === 'CIRCLE') {
      const c = mapPoint({ x: e.cx, y: e.cy })
      const r = e.radius * radiusScale
      const idx = assignDxfPointToPiece(c.x, c.y, cutRings, cutBounds)
      if (idx < 0) continue
      const ring = cutRings[idx]
      const bounds = cutBounds[idx]
      if (!isCircleInsideCut(c.x, c.y, r, ring, bounds)) continue

      if (isDrillLayer(e.layer)) continue

      if (isInternalLayer(e.layer) || !isCutLayer(e.layer, extraCutLayers)) {
        pushInternalCircle(idx, {
          id: Math.random().toString(36).slice(2, 12),
          center: c,
          radius: Math.max(0.1, r),
        })
      }
      continue
    }

    const pl = polylineFromEntity(e)
    if (!pl) continue
    const pts = pl.vertices.map(mapPoint)
    if (pts.length < 2) continue
    const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length
    const my = pts.reduce((s, p) => s + p.y, 0) / pts.length
    const idx = assignDxfPointToPiece(mx, my, cutRings, cutBounds)
    if (idx < 0) continue

    if (isCutLayer(pl.layer, extraCutLayers)) continue
    if (isSeamLayer(pl.layer) || isGrainLayer(pl.layer) || isNotchLineLayer(pl.layer)) continue

    const ring = cutRings[idx]
    const centroidInside =
      ring != null &&
      ring.length >= 3 &&
      isPointInPolygon({ x: mx, y: my }, ring)

    if (isInternalLayer(pl.layer) || !pl.closed || centroidInside) {
      pushInternalLine(idx, dxfVerticesToLineCurves(
        pts.map((p) => ({ x: p.x, y: p.y })),
        pl.closed,
      ))
    }
  }

  return { internalLinesByPiece, internalCirclesByPiece, notchLinesByPiece }
}

function dist2d(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function dedupeNotches(notches: Notch[]): Notch[] {
  const out: Notch[] = []
  for (const n of notches) {
    const dup = out.some(
      (o) =>
        dist2d(o.position, n.position) < NOTCH_DEDUPE_MM
        && Math.abs((o.angle ?? 0) - (n.angle ?? 0)) < 25,
    )
    if (!dup) out.push(n)
  }
  return out
}

/** Zwei Kerben-Linien mit gemeinsamer Spitze → eine V-Kerbe. */
function mergeVNotchLines(
  lines: Array<{ x1: number; y1: number; x2: number; y2: number; layer: string }>,
): Notch[] {
  const used = new Set<number>()
  const out: Notch[] = []

  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue
    const a = lines[i]
    const tips = [
      { x: a.x1, y: a.y1 },
      { x: a.x2, y: a.y2 },
    ]
    let paired = false
    for (let j = i + 1; j < lines.length; j++) {
      if (used.has(j)) continue
      const b = lines[j]
      const ends = [
        { x: b.x1, y: b.y1 },
        { x: b.x2, y: b.y2 },
      ]
      for (const ta of tips) {
        for (const tb of ends) {
          if (dist2d(ta, tb) > V_NOTCH_TIP_SNAP_MM) continue
          const tip = { x: (ta.x + tb.x) / 2, y: (ta.y + tb.y) / 2 }
          const otherA = dist2d(ta, tip) < 0.01 ? { x: a.x2, y: a.y2 } : { x: a.x1, y: a.y1 }
          const otherB = dist2d(tb, tip) < 0.01 ? { x: b.x2, y: b.y2 } : { x: b.x1, y: b.y1 }
          const depth = (dist2d(otherA, tip) + dist2d(otherB, tip)) / 2
          const width = dist2d(otherA, otherB)
          const angle = (Math.atan2(tip.y - (otherA.y + otherB.y) / 2, tip.x - (otherA.x + otherB.x) / 2) * 180) / Math.PI
          out.push({
            id: Math.random().toString(36).slice(2, 12),
            position: tip,
            angle,
            type: 'v',
            depth: Math.max(1, depth),
            width: Math.max(2, width),
          })
          used.add(i)
          used.add(j)
          paired = true
          break
        }
        if (paired) break
      }
      if (paired) break
    }
    if (!paired) {
      const n = lineToNotchDxf(a.x1, a.y1, a.x2, a.y2, a.layer, 1)
      if (n) out.push(n)
      used.add(i)
    }
  }
  return out
}

export function enrichPiecesFromParsedDxf(
  pieces: PatternPiece[],
  cutRings: PieceCutRing[],
  cutBounds: BBox[],
  parsed: ParsedDxf,
  unitScale: number,
  extraCutLayers: string[],
): void {
  const { entities, blocks } = parsed
  const scale = unitScale

  const mapPt = (p: DxfPoint): Point => ({ x: p.x * scale, y: p.y * scale })

  const fromFlat = collectInternalsFromEntityList(entities, mapPt, scale, cutRings, cutBounds, extraCutLayers)

  // INSERT-Blöcke: transformierte Entities für Zuordnung zu bereits platzierten Teilen
  const insertEntities: DxfEntity[] = []
  for (const e of entities) {
    if (e.type !== 'INSERT') continue
    let blk = blocks.get(e.blockName)
    if (!blk) {
      for (const [k, v] of blocks) {
        if (k.toUpperCase() === e.blockName.toUpperCase()) {
          blk = v
          break
        }
      }
    }
    if (!blk) continue
    const insert = { x: e.x, y: e.y, scaleX: e.scaleX, scaleY: e.scaleY, rotation: e.rotation }
    for (const be of blk.entities) {
      if (be.type === 'LINE') {
        const p1 = transformDxfInsertPoint({ x: be.x1, y: be.y1 }, insert, scale)
        const p2 = transformDxfInsertPoint({ x: be.x2, y: be.y2 }, insert, scale)
        insertEntities.push({
          type: 'LINE',
          layer: be.layer,
          x1: p1.x,
          y1: p1.y,
          x2: p2.x,
          y2: p2.y,
        })
        continue
      }
      if (be.type === 'CIRCLE') {
        const c = transformDxfInsertPoint({ x: be.cx, y: be.cy }, insert, scale)
        insertEntities.push({
          type: 'CIRCLE',
          layer: be.layer,
          cx: c.x,
          cy: c.y,
          radius: be.radius * Math.abs(insert.scaleX) * unitScale,
        })
        continue
      }
      const pl = polylineFromEntity(be)
      if (pl) {
        const pts = pl.vertices.map((p) => transformDxfInsertPoint(p, insert, scale))
        insertEntities.push({
          type: 'POLYLINE',
          layer: pl.layer,
          vertices: pts,
          closed: pl.closed,
        })
        continue
      }
      if (be.type === 'POINT' && isNotchLineLayer(be.layer) && !isAuxDxfLayer(be.layer)) {
        const p = transformDxfInsertPoint({ x: be.x, y: be.y }, insert, scale)
        insertEntities.push({ ...be, x: p.x, y: p.y })
      }
    }
  }

  const mapPtId = (p: DxfPoint): Point => ({ x: p.x, y: p.y })
  const fromInsert = collectInternalsFromEntityList(insertEntities, mapPtId, 1, cutRings, cutBounds, extraCutLayers)

  const mergeMaps = <T>(a: Map<number, T[]>, b: Map<number, T[]>, merge: (x: T[], y: T[]) => T[]) => {
    for (const [k, v] of b) {
      const prev = a.get(k) ?? []
      a.set(k, merge(prev, v))
    }
  }

  mergeMaps(fromFlat.internalLinesByPiece, fromInsert.internalLinesByPiece, (x, y) => [...x, ...y])
  mergeMaps(fromFlat.internalCirclesByPiece, fromInsert.internalCirclesByPiece, (x, y) => [...x, ...y])

  const notchLineMap = new Map<number, Array<{ x1: number; y1: number; x2: number; y2: number; layer: string }>>()
  for (const [k, v] of fromFlat.notchLinesByPiece) notchLineMap.set(k, [...v])
  for (const [k, v] of fromInsert.notchLinesByPiece) {
    const prev = notchLineMap.get(k) ?? []
    notchLineMap.set(k, [...prev, ...v])
  }

  for (let i = 0; i < pieces.length; i++) {
    const extraLines = fromFlat.internalLinesByPiece.get(i) ?? []
    const extraLines2 = fromInsert.internalLinesByPiece.get(i) ?? []
    if (extraLines.length + extraLines2.length > 0) {
      pieces[i].internalLines = [...pieces[i].internalLines, ...extraLines, ...extraLines2]
    }
    const extraCircles = [
      ...(fromFlat.internalCirclesByPiece.get(i) ?? []),
      ...(fromInsert.internalCirclesByPiece.get(i) ?? []),
    ]
    if (extraCircles.length > 0) {
      pieces[i].internalCircles = [...pieces[i].internalCircles, ...extraCircles]
    }

    const lineBatch = notchLineMap.get(i) ?? []
    if (lineBatch.length > 0) {
      const paired = mergeVNotchLines(lineBatch)
      pieces[i].notches = dedupeNotches([...pieces[i].notches, ...paired])
    } else {
      pieces[i].notches = dedupeNotches(pieces[i].notches)
    }
  }

  const addPointNotch = (e: Extract<DxfEntity, { type: 'POINT' }>, coordScale: number) => {
    const px = e.x * coordScale
    const py = e.y * coordScale
    const idx = assignDxfPointToPiece(px, py, cutRings, cutBounds)
    if (idx < 0 || !pieces[idx]) return
    const n = pointToNotchDxf(e.x, e.y, e.layer, coordScale, {
      depth: e.notchDepth,
      width: e.notchWidth,
      angle: e.notchAngle,
    })
    pieces[idx].notches = dedupeNotches([...pieces[idx].notches, n])
  }

  for (const e of entities) {
    if (e.type === 'POINT' && isNotchLineLayer(e.layer) && !isAuxDxfLayer(e.layer)) {
      addPointNotch(e, scale)
    }
  }
  for (const e of insertEntities) {
    if (e.type === 'POINT' && isNotchLineLayer(e.layer) && !isAuxDxfLayer(e.layer)) {
      addPointNotch(e, 1)
    }
  }

  for (let i = 0; i < pieces.length; i++) {
    pieces[i].notches = resyncNotchesAfterCutLineRebuilt(
      pieces[i].notches,
      pieces[i].cutLine,
      pieces[i].cutLine,
    )
  }
}

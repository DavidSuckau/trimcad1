/**
 * Sammelt und dedupliziert Schnitt-/Naht-Entwürfe aus geparstem DXF (gemeinsam für Standard- und Vorlagen-Import).
 */

import type { Notch, Drill, Line, Point, Curve, InternalCircle } from '../types/model'
import { isPointInPolygon } from '../geometry/pointInPolygon'
import type { DxfEntity, DxfPoint, DxfBlock } from './dxfParser'
import { dist } from './dxfShared'
import {
  isCutLayer,
  isSeamLayer,
  isNotchLineLayer,
  notchTypeForLayer,
  isDrillLayer,
  isGrainLayer,
  isExcludedLayerFallback,
  isInternalLayer,
  isAuxDxfLayer,
} from './dxfImportLayers'

export const DUPLICATE_THRESHOLD_DXF = 0.01

export const NEAR_DUPE_REL_TOL = 0.02

function generateId(): string {
  return Math.random().toString(36).slice(2, 12)
}

export type BBox = { minX: number; minY: number; maxX: number; maxY: number }

export function boundsOfDxfPoints(pts: DxfPoint[]): BBox {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const p of pts) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { minX, minY, maxX, maxY }
}

export function polygonArea(pts: DxfPoint[]): number {
  if (pts.length < 3) return 0
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return Math.abs(a / 2)
}

function getBlockCaseInsensitive(blocks: Map<string, DxfBlock>, name: string): DxfBlock | undefined {
  if (blocks.has(name)) return blocks.get(name)
  const u = name.toUpperCase()
  for (const [k, v] of blocks) {
    if (k.toUpperCase() === u) return v
  }
  return undefined
}

export function applyUnitScaleToDxfPoints(
  points: DxfPoint[],
  insUnits: number,
  importScale = 1
): DxfPoint[] {
  const scale = (insUnits === 4 ? 10 : 1) * importScale
  if (scale === 1) return points
  return points.map((p) => ({ x: p.x * scale, y: p.y * scale }))
}

export function transformDxfInsertPoint(
  p: DxfPoint,
  insert: { x: number; y: number; scaleX: number; scaleY: number; rotation: number },
  unitScale: number
): Point {
  const rad = (insert.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const x = (p.x * insert.scaleX * cos - p.y * insert.scaleY * sin) * unitScale + insert.x * unitScale
  const y = (p.x * insert.scaleX * sin + p.y * insert.scaleY * cos) * unitScale + insert.y * unitScale
  return { x, y }
}

export function polylineFromEntity(
  e: DxfEntity
): { vertices: DxfPoint[]; closed: boolean; layer: string } | null {
  if (e.type === 'POLYLINE' || e.type === 'LWPOLYLINE' || e.type === 'ARC_POLYLINE') {
    return { vertices: e.vertices, closed: e.closed, layer: e.layer }
  }
  return null
}

export type PieceDraft = {
  cutVertices: DxfPoint[]
  closed: boolean
  seamVertices?: DxfPoint[] | null
  seamClosed?: boolean
  notchesFromLayers: Notch[]
  drillsFromLayers: Drill[]
  grainLine: Line | null
  importSource: 'block' | 'modelspace' | 'fallback'
  /** Offene/geschlossene interne Polylines (Layer 8 o. ä.), noch nicht als Curves. */
  internalPolylines?: Array<{ vertices: DxfPoint[]; closed: boolean }>
  internalCircles?: Array<{ center: DxfPoint; radius: number }>
}

const CONTOUR_HASH_DECIMALS = 2
const NEAR_DUPE_MIN_AREA_MM2 = 2
const NEAR_DUPE_BBOX_OVERLAP_MIN = 0.72

function roundContourCoord(v: number): number {
  const f = 10 ** CONTOUR_HASH_DECIMALS
  return Math.round(v * f) / f
}

function ringPointsForHash(vertices: DxfPoint[], closed: boolean): DxfPoint[] | null {
  if (vertices.length < 3) return null
  const pts: DxfPoint[] = []
  for (const p of vertices) {
    const q = { x: roundContourCoord(p.x), y: roundContourCoord(p.y) }
    if (pts.length > 0 && dist(pts[pts.length - 1], q) < 1e-9) continue
    pts.push(q)
  }
  const geometricallyClosed =
    closed || (pts.length >= 2 && dist(pts[0], pts[pts.length - 1]) < DUPLICATE_THRESHOLD_DXF)
  if (!geometricallyClosed) return null
  while (pts.length > 2 && dist(pts[0], pts[pts.length - 1]) < DUPLICATE_THRESHOLD_DXF) {
    pts.pop()
  }
  return pts.length >= 3 ? pts : null
}

function signedAreaRing(pts: DxfPoint[]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return a / 2
}

function encodeRing(pts: DxfPoint[]): string {
  return pts.map((p) => `${p.x},${p.y}`).join('|')
}

function canonicalCutContourKey(vertices: DxfPoint[], closed: boolean): string | null {
  const ring = ringPointsForHash(vertices, closed)
  if (!ring) return null
  let oriented = [...ring]
  if (signedAreaRing(oriented) < 0) oriented.reverse()
  const n = oriented.length
  let best = encodeRing(oriented)
  for (let i = 1; i < n; i++) {
    const rot = [...oriented.slice(i), ...oriented.slice(0, i)]
    const s = encodeRing(rot)
    if (s < best) best = s
  }
  const rev = [...oriented].reverse()
  for (let i = 0; i < n; i++) {
    const rot = [...rev.slice(i), ...rev.slice(0, i)]
    const s = encodeRing(rot)
    if (s < best) best = s
  }
  return best
}

function dedupePieceDraftsByCutContour(drafts: PieceDraft[]): { drafts: PieceDraft[]; removed: number } {
  const seen = new Set<string>()
  const out: PieceDraft[] = []
  let removed = 0
  for (const d of drafts) {
    const key = canonicalCutContourKey(d.cutVertices, d.closed)
    if (key == null) {
      out.push(d)
      continue
    }
    if (seen.has(key)) {
      removed++
      continue
    }
    seen.add(key)
    out.push(d)
  }
  return { drafts: out, removed }
}

export function closedRingPointsRaw(vertices: DxfPoint[], closed: boolean): DxfPoint[] | null {
  if (vertices.length < 3) return null
  const pts: DxfPoint[] = []
  for (const p of vertices) {
    const q = { x: p.x, y: p.y }
    if (pts.length > 0 && dist(pts[pts.length - 1], q) < DUPLICATE_THRESHOLD_DXF) continue
    pts.push(q)
  }
  const geometricallyClosed =
    closed || (pts.length >= 2 && dist(pts[0], pts[pts.length - 1]) < DUPLICATE_THRESHOLD_DXF)
  if (!geometricallyClosed) return null
  while (pts.length > 2 && dist(pts[0], pts[pts.length - 1]) < DUPLICATE_THRESHOLD_DXF) {
    pts.pop()
  }
  return pts.length >= 3 ? pts : null
}

function relCloseMm(a: number, b: number, relTol: number): boolean {
  const m = Math.max(Math.abs(a), Math.abs(b), 1e-6)
  return Math.abs(a - b) / m <= relTol
}

function bboxAreaMm2(b: BBox): number {
  return Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY)
}

function bboxIntersectionAreaMm2(a: BBox, b: BBox): number {
  const ix0 = Math.max(a.minX, b.minX)
  const iy0 = Math.max(a.minY, b.minY)
  const ix1 = Math.min(a.maxX, b.maxX)
  const iy1 = Math.min(a.maxY, b.maxY)
  return Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0)
}

export function polygonCentroidClosed(pts: DxfPoint[]): DxfPoint | null {
  const n = pts.length
  if (n < 3) return null
  let cx = 0
  let cy = 0
  let aTwice = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const cross = pts[i].x * pts[j].y - pts[j].x * pts[i].y
    aTwice += cross
    cx += (pts[i].x + pts[j].x) * cross
    cy += (pts[i].y + pts[j].y) * cross
  }
  if (Math.abs(aTwice) < 1e-9) {
    let sx = 0
    let sy = 0
    for (const p of pts) {
      sx += p.x
      sy += p.y
    }
    return { x: sx / n, y: sy / n }
  }
  const a = aTwice / 2
  return { x: cx / (6 * a), y: cy / (6 * a) }
}

/** Zwei geschlossene Konturen sind geometrisch nahezu gleich (Import-Deduplizierung / Innenlinien-Filter). */
export function areNearDuplicateContourRings(
  vertsA: DxfPoint[],
  closedA: boolean,
  vertsB: DxfPoint[],
  closedB: boolean,
): boolean {
  const ringA = closedRingPointsRaw(vertsA, closedA)
  const ringB = closedRingPointsRaw(vertsB, closedB)
  if (!ringA || !ringB) return false

  const areaA = polygonArea(ringA)
  const areaB = polygonArea(ringB)
  if (areaA < NEAR_DUPE_MIN_AREA_MM2 || areaB < NEAR_DUPE_MIN_AREA_MM2) return false

  const bA = boundsOfDxfPoints(ringA)
  const bB = boundsOfDxfPoints(ringB)
  const wA = bA.maxX - bA.minX
  const hA = bA.maxY - bA.minY
  const wB = bB.maxX - bB.minX
  const hB = bB.maxY - bB.minY

  if (!relCloseMm(wA, wB, NEAR_DUPE_REL_TOL)) return false
  if (!relCloseMm(hA, hB, NEAR_DUPE_REL_TOL)) return false
  if (!relCloseMm(areaA, areaB, NEAR_DUPE_REL_TOL)) return false

  const cA = polygonCentroidClosed(ringA)
  const cB = polygonCentroidClosed(ringB)
  if (!cA || !cB) return false
  const diag = Math.max(Math.hypot(wA, hA), Math.hypot(wB, hB))
  const centroidTolMm = Math.max(0.5, NEAR_DUPE_REL_TOL * diag)
  if (dist(cA, cB) > centroidTolMm) return false

  const inter = bboxIntersectionAreaMm2(bA, bB)
  const boxMin = Math.max(Math.min(bboxAreaMm2(bA), bboxAreaMm2(bB)), 1e-6)
  if (inter / boxMin < NEAR_DUPE_BBOX_OVERLAP_MIN) return false

  return true
}

function areNearDuplicateCuts(a: PieceDraft, b: PieceDraft): boolean {
  return areNearDuplicateContourRings(a.cutVertices, a.closed, b.cutVertices, b.closed)
}

function dedupeNearDuplicatePieceDrafts(drafts: PieceDraft[]): { drafts: PieceDraft[]; removed: number } {
  const kept: PieceDraft[] = []
  let removed = 0
  for (const d of drafts) {
    let isDup = false
    for (const k of kept) {
      if (areNearDuplicateCuts(d, k)) {
        isDup = true
        break
      }
    }
    if (isDup) removed++
    else kept.push(d)
  }
  return { drafts: kept, removed }
}

function pickSeamForCut(
  cutB: BBox,
  seams: Array<{ vertices: DxfPoint[]; closed: boolean }>
): { vertices: DxfPoint[]; closed: boolean } | null {
  if (seams.length === 0) return null
  const cxc = (cutB.minX + cutB.maxX) / 2
  const cyc = (cutB.minY + cutB.maxY) / 2
  for (const s of seams) {
    const b = boundsOfDxfPoints(s.vertices)
    if (cxc >= b.minX && cxc <= b.maxX && cyc >= b.minY && cyc <= b.maxY) return s
  }
  let best: { vertices: DxfPoint[]; closed: boolean } | null = null
  let bestD = Infinity
  for (const s of seams) {
    const b = boundsOfDxfPoints(s.vertices)
    const sx = (b.minX + b.maxX) / 2
    const sy = (b.minY + b.maxY) / 2
    const d = Math.hypot(sx - cxc, sy - cyc)
    if (d < bestD) {
      bestD = d
      best = s
    }
  }
  return best && bestD < 800 ? best : null
}

export function lineToNotchDxf(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  layer: string,
  coordScale: number
): Notch | null {
  const type = notchTypeForLayer(layer)
  const mx = ((x1 + x2) / 2) * coordScale
  const my = ((y1 + y2) / 2) * coordScale
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI
  const depth = Math.hypot(x2 - x1, y2 - y1) * coordScale
  return {
    id: generateId(),
    position: { x: mx, y: my },
    angle,
    type,
    depth: Math.max(1, depth),
    width: 6,
  }
}

function extractNotchesFromBlock(
  blockEntities: DxfEntity[],
  insert: { x: number; y: number; scaleX: number; scaleY: number; rotation: number },
  unitScale: number
): Notch[] {
  const notches: Notch[] = []
  for (const e of blockEntities) {
    if (e.type === 'LINE' && isNotchLineLayer(e.layer)) {
      const p1 = transformDxfInsertPoint({ x: e.x1, y: e.y1 }, insert, unitScale)
      const p2 = transformDxfInsertPoint({ x: e.x2, y: e.y2 }, insert, unitScale)
      const n = lineToNotchDxf(p1.x, p1.y, p2.x, p2.y, e.layer, 1)
      if (n) notches.push(n)
    }
    if (e.type === 'POINT' && isNotchLineLayer(e.layer) && !isAuxDxfLayer(e.layer)) {
      const p = transformDxfInsertPoint({ x: e.x, y: e.y }, insert, unitScale)
      notches.push(
        pointToNotchDxf(p.x, p.y, e.layer, 1, {
          depth: e.notchDepth,
          width: e.notchWidth,
          angle: e.notchAngle,
        }),
      )
    }
  }
  return notches
}

function extractDrillsFromBlock(
  blockEntities: DxfEntity[],
  insert: { x: number; y: number; scaleX: number; scaleY: number; rotation: number },
  unitScale: number
): Drill[] {
  const drills: Drill[] = []
  for (const e of blockEntities) {
    if (e.type === 'CIRCLE' && isDrillLayer(e.layer)) {
      const c = transformDxfInsertPoint({ x: e.cx, y: e.cy }, insert, unitScale)
      const r = e.radius * Math.abs(insert.scaleX) * unitScale
      drills.push({
        id: generateId(),
        center: c,
        radius: Math.max(0.1, r),
      })
    }
  }
  return drills
}

function extractGrainFromBlock(
  blockEntities: DxfEntity[],
  insert: { x: number; y: number; scaleX: number; scaleY: number; rotation: number },
  unitScale: number,
  cutBounds: BBox
): Line | null {
  let best: Line | null = null
  let bestScore = Infinity
  for (const e of blockEntities) {
    if (e.type === 'LINE' && isGrainLayer(e.layer)) {
      const p1 = transformDxfInsertPoint({ x: e.x1, y: e.y1 }, insert, unitScale)
      const p2 = transformDxfInsertPoint({ x: e.x2, y: e.y2 }, insert, unitScale)
      const mx = (p1.x + p2.x) / 2
      const my = (p1.y + p2.y) / 2
      const inside =
        mx >= cutBounds.minX &&
        mx <= cutBounds.maxX &&
        my >= cutBounds.minY &&
        my <= cutBounds.maxY
      const d = inside ? 0 : Math.max(cutBounds.minX - mx, mx - cutBounds.maxX, cutBounds.minY - my, my - cutBounds.maxY)
      if (d < bestScore) {
        bestScore = d
        best = { start: p1, end: p2 }
      }
    }
  }
  return best
}

export function pointToNotchDxf(
  px: number,
  py: number,
  layer: string,
  coordScale: number,
  attrs?: { depth?: number; width?: number; angle?: number },
): Notch {
  const type = notchTypeForLayer(layer)
  const depthRaw = attrs?.depth
  const depth =
    depthRaw != null && Number.isFinite(depthRaw) && depthRaw > 0
      ? depthRaw * coordScale
      : 4
  const width =
    attrs?.width != null && Number.isFinite(attrs.width) && attrs.width > 0
      ? attrs.width * coordScale
      : 6
  const angle =
    attrs?.angle != null && Number.isFinite(attrs.angle) ? attrs.angle : 90
  return {
    id: generateId(),
    position: { x: px * coordScale, y: py * coordScale },
    angle,
    type,
    depth: Math.max(1, depth),
    width: Math.max(1, width),
  }
}

const NESTED_MAX_AREA_RATIO = 0.92
const NESTED_MIN_PARENT_AREA_RATIO = 1.08
const NESTED_VERTEX_INSIDE_FRAC = 0.88

function isDraftInsideParent(inner: PieceDraft, outer: PieceDraft): boolean {
  const innerRing = closedRingPointsRaw(inner.cutVertices, inner.closed)
  const outerRing = closedRingPointsRaw(outer.cutVertices, outer.closed)
  if (!innerRing || !outerRing || innerRing.length < 3 || outerRing.length < 3) return false

  const areaInner = polygonArea(innerRing)
  const areaOuter = polygonArea(outerRing)
  if (areaInner < 0.5 || areaOuter < areaInner * NESTED_MIN_PARENT_AREA_RATIO) return false
  if (areaInner >= areaOuter * NESTED_MAX_AREA_RATIO) return false

  const centroid = polygonCentroidClosed(innerRing)
  if (!centroid || !isPointInPolygon(centroid, outerRing)) return false

  let insideVerts = 0
  for (const v of innerRing) {
    if (isPointInPolygon(v, outerRing)) insideVerts++
  }
  return insideVerts / innerRing.length >= NESTED_VERTEX_INSIDE_FRAC
}

function mergeInnerDraftIntoParent(parent: PieceDraft, inner: PieceDraft): void {
  if (!parent.internalPolylines) parent.internalPolylines = []
  if (!parent.internalCircles) parent.internalCircles = []
  const innerAsInternal = {
    vertices: inner.cutVertices.map((p) => ({ x: p.x, y: p.y })),
    closed: inner.closed || true,
  }
  if (!isInternalPolylineDuplicateOfDraftContours(innerAsInternal, parent)) {
    parent.internalPolylines.push(innerAsInternal)
  }
  for (const pl of inner.internalPolylines ?? []) {
    if (!isInternalPolylineDuplicateOfDraftContours(pl, parent)) {
      parent.internalPolylines.push(pl)
    }
  }
  for (const c of inner.internalCircles ?? []) {
    parent.internalCircles.push(c)
  }
  parent.notchesFromLayers.push(...inner.notchesFromLayers)
  parent.drillsFromLayers.push(...inner.drillsFromLayers)
}

/** Innere geschlossene Konturen werden dem äußeren Teil als interne Linien zugeordnet. */
export function absorbNestedPieceDrafts(drafts: PieceDraft[]): { drafts: PieceDraft[]; absorbed: number } {
  if (drafts.length < 2) return { drafts, absorbed: 0 }

  const areas = drafts.map((d) => {
    const r = closedRingPointsRaw(d.cutVertices, d.closed)
    return r ? polygonArea(r) : 0
  })
  const absorbedIdx = new Set<number>()

  for (let j = 0; j < drafts.length; j++) {
    let bestParent = -1
    let bestParentArea = Infinity
    for (let i = 0; i < drafts.length; i++) {
      if (i === j || absorbedIdx.has(i)) continue
      if (areas[i] <= areas[j]) continue
      if (!isDraftInsideParent(drafts[j], drafts[i])) continue
      if (areas[i] < bestParentArea) {
        bestParentArea = areas[i]
        bestParent = i
      }
    }
    if (bestParent >= 0) {
      mergeInnerDraftIntoParent(drafts[bestParent], drafts[j])
      absorbedIdx.add(j)
    }
  }

  if (absorbedIdx.size === 0) return { drafts, absorbed: 0 }
  return { drafts: drafts.filter((_, i) => !absorbedIdx.has(i)), absorbed: absorbedIdx.size }
}

function collectInternalsInBlockForBounds(
  blockEntities: DxfEntity[],
  insert: { x: number; y: number; scaleX: number; scaleY: number; rotation: number },
  unitScale: number,
  cutBounds: BBox,
): {
  polylines: Array<{ vertices: DxfPoint[]; closed: boolean }>
  circles: Array<{ center: DxfPoint; radius: number }>
} {
  const polylines: Array<{ vertices: DxfPoint[]; closed: boolean }> = []
  const circles: Array<{ center: DxfPoint; radius: number }> = []

  for (const be of blockEntities) {
    if (be.type === 'INSERT') continue
    if (isAuxDxfLayer(be.layer)) continue
    if (be.type === 'CIRCLE' && isInternalLayer(be.layer)) {
      const c = transformDxfInsertPoint({ x: be.cx, y: be.cy }, insert, unitScale)
      const r = be.radius * Math.abs(insert.scaleX) * unitScale
      if (
        c.x >= cutBounds.minX &&
        c.x <= cutBounds.maxX &&
        c.y >= cutBounds.minY &&
        c.y <= cutBounds.maxY
      ) {
        circles.push({ center: c, radius: Math.max(0.1, r) })
      }
      continue
    }
    const pl = polylineFromEntity(be)
    if (!pl || !isInternalLayer(pl.layer)) continue
    const pts = pl.vertices.map((p) => transformDxfInsertPoint(p, insert, unitScale) as DxfPoint)
    if (pts.length < 2) continue
    const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length
    const my = pts.reduce((s, p) => s + p.y, 0) / pts.length
    if (mx >= cutBounds.minX && mx <= cutBounds.maxX && my >= cutBounds.minY && my <= cutBounds.maxY) {
      polylines.push({ vertices: pts, closed: pl.closed })
    }
  }
  return { polylines, circles }
}

function extractPieceDrafts(
  parsed: { entities: DxfEntity[]; blocks: Map<string, DxfBlock>; insUnits: number },
  extraCutLayers: string[],
  importScale: number
): PieceDraft[] {
  const { entities, blocks, insUnits } = parsed
  const unitScale = (insUnits === 4 ? 10 : 1) * importScale
  const drafts: PieceDraft[] = []

  for (const e of entities) {
    if (e.type !== 'INSERT') continue
    const blk = getBlockCaseInsensitive(blocks, e.blockName)
    if (!blk) continue

    const cuts: Array<{ vertices: DxfPoint[]; closed: boolean }> = []
    const seams: Array<{ vertices: DxfPoint[]; closed: boolean }> = []

    for (const be of blk.entities) {
      const pl = polylineFromEntity(be)
      if (!pl) continue
      const pts = pl.vertices.map((p) => transformDxfInsertPoint(p, e, unitScale) as DxfPoint)
      if (isCutLayer(pl.layer, extraCutLayers)) {
        cuts.push({ vertices: pts, closed: pl.closed })
      }
      if (isSeamLayer(pl.layer)) {
        seams.push({ vertices: pts, closed: pl.closed })
      }
    }

    const notchesFromLayers = extractNotchesFromBlock(blk.entities, e, unitScale)
    const drillsFromLayers = extractDrillsFromBlock(blk.entities, e, unitScale)

    for (const cut of cuts) {
      const cutB = boundsOfDxfPoints(cut.vertices)
      const seam = pickSeamForCut(cutB, seams)
      const grainLine = extractGrainFromBlock(blk.entities, e, unitScale, cutB)
      const blockInternals = collectInternalsInBlockForBounds(blk.entities, e, unitScale, cutB)
      drafts.push({
        cutVertices: cut.vertices,
        closed: cut.closed,
        seamVertices: seam?.vertices ?? null,
        seamClosed: seam?.closed,
        notchesFromLayers: [...notchesFromLayers],
        drillsFromLayers: [...drillsFromLayers],
        grainLine,
        importSource: 'block',
        internalPolylines: blockInternals.polylines,
        internalCircles: blockInternals.circles,
      })
    }
  }

  const cutsFlat: Array<{ vertices: DxfPoint[]; closed: boolean }> = []
  const seamsFlat: Array<{ vertices: DxfPoint[]; closed: boolean }> = []

  for (const e of entities) {
    if (e.type === 'INSERT') continue
    const pl = polylineFromEntity(e)
    if (!pl) continue
    const pts = applyUnitScaleToDxfPoints(pl.vertices, insUnits, importScale)
    if (isCutLayer(pl.layer, extraCutLayers)) {
      cutsFlat.push({ vertices: pts, closed: pl.closed })
    }
    if (isSeamLayer(pl.layer)) {
      seamsFlat.push({ vertices: pts, closed: pl.closed })
    }
  }

  for (const cut of cutsFlat) {
    const cutB = boundsOfDxfPoints(cut.vertices)
    const seam = pickSeamForCut(cutB, seamsFlat)
    drafts.push({
      cutVertices: cut.vertices,
      closed: cut.closed,
      seamVertices: seam?.vertices ?? null,
      seamClosed: seam?.closed,
      notchesFromLayers: [],
      drillsFromLayers: [],
      grainLine: null,
      importSource: 'modelspace',
    })
  }

  return drafts
}

function extractFallbackCutDrafts(
  parsed: { entities: DxfEntity[]; blocks: Map<string, DxfBlock>; insUnits: number },
  importScale: number
): PieceDraft[] {
  const { entities, blocks, insUnits } = parsed
  const unitScale = (insUnits === 4 ? 10 : 1) * importScale
  const candidates: Array<{ vertices: DxfPoint[]; layer: string }> = []

  const consider = (pts: DxfPoint[], closed: boolean, layer: string) => {
    if (pts.length < 3) return
    if (isExcludedLayerFallback(layer)) return
    const c = closed || dxfVertexRingClosed(pts)
    if (!c) return
    if (polygonArea(pts) < 2) return
    candidates.push({ vertices: pts, layer })
  }

  for (const e of entities) {
    if (e.type === 'INSERT') {
      const blk = getBlockCaseInsensitive(blocks, e.blockName)
      if (!blk) continue
      for (const be of blk.entities) {
        const pl = polylineFromEntity(be)
        if (!pl) continue
        const pts = pl.vertices.map((p) => transformDxfInsertPoint(p, e, unitScale) as DxfPoint)
        consider(pts, pl.closed || dxfVertexRingClosed(pts), pl.layer)
      }
      continue
    }
    const pl = polylineFromEntity(e)
    if (!pl) continue
    const pts = applyUnitScaleToDxfPoints(pl.vertices, insUnits, importScale)
    consider(pts, pl.closed || dxfVertexRingClosed(pts), pl.layer)
  }

  candidates.sort((a, b) => polygonArea(b.vertices) - polygonArea(a.vertices))
  const maxPieces = 80
  const drafts: PieceDraft[] = []
  for (let i = 0; i < Math.min(candidates.length, maxPieces); i++) {
    const c = candidates[i]
    drafts.push({
      cutVertices: c.vertices,
      closed: true,
      seamVertices: null,
      notchesFromLayers: [],
      drillsFromLayers: [],
      grainLine: null,
      importSource: 'fallback',
    })
  }
  return drafts
}

function isInternalPolylineDuplicateOfDraftContours(
  pl: { vertices: DxfPoint[]; closed: boolean },
  draft: PieceDraft,
): boolean {
  if (areNearDuplicateContourRings(pl.vertices, pl.closed, draft.cutVertices, draft.closed)) {
    return true
  }
  if (draft.seamVertices && draft.seamVertices.length >= 3) {
    return areNearDuplicateContourRings(
      pl.vertices,
      pl.closed,
      draft.seamVertices,
      draft.seamClosed ?? draft.closed,
    )
  }
  return false
}

export function draftInternalsToPieceFields(draft: PieceDraft): {
  internalLines: Curve[]
  internalCircles: InternalCircle[]
} {
  const internalLines: Curve[] = []
  for (const pl of draft.internalPolylines ?? []) {
    if (pl.vertices.length < 2) continue
    if (isInternalPolylineDuplicateOfDraftContours(pl, draft)) continue
    internalLines.push(...dxfVerticesToLineCurves(pl.vertices, pl.closed))
  }
  const internalCircles: InternalCircle[] = (draft.internalCircles ?? []).map((c) => ({
    id: generateId(),
    center: { x: c.center.x, y: c.center.y },
    radius: Math.max(0.1, c.radius),
  }))
  return { internalLines, internalCircles }
}

export function dxfVerticesToLineCurves(vertices: DxfPoint[], closed: boolean): Curve[] {
  if (vertices.length < 2) return []
  const curves: Curve[] = []
  const n = vertices.length
  for (let i = 0; i < n - 1; i++) {
    const a = vertices[i]
    const b = vertices[i + 1]
    if (dist(a, b) < DUPLICATE_THRESHOLD_DXF) continue
    curves.push({
      type: 'line',
      start: { x: a.x, y: a.y },
      end: { x: b.x, y: b.y },
    })
  }
  if (closed && n >= 3) {
    const a = vertices[n - 1]
    const b = vertices[0]
    if (dist(a, b) >= DUPLICATE_THRESHOLD_DXF) {
      curves.push({
        type: 'line',
        start: { x: a.x, y: a.y },
        end: { x: b.x, y: b.y },
      })
    }
  }
  return curves
}

/** True wenn erste und letzte Stützpunkte zusammenfallen (geschlossene Polylinie). */
export function dxfVertexRingClosed(vertices: DxfPoint[]): boolean {
  if (vertices.length < 3) return false
  const first = vertices[0]
  const last = vertices[vertices.length - 1]
  return dist(first, last) < DUPLICATE_THRESHOLD_DXF
}

export type ParsedDxfForDrafts = {
  entities: DxfEntity[]
  blocks: Map<string, DxfBlock>
  insUnits: number
}

export function collectDedupedPieceDrafts(
  parsed: ParsedDxfForDrafts,
  extraCutLayers: string[],
  importScale: number
): {
  drafts: PieceDraft[]
  usedFallback: boolean
  removedExactDupes: number
  removedNearDupes: number
  absorbedNested: number
} {
  let drafts = extractPieceDrafts(parsed, extraCutLayers, importScale)
  let usedFallback = false
  if (drafts.length === 0) {
    drafts = extractFallbackCutDrafts(parsed, importScale)
    usedFallback = drafts.length > 0
  }
  const dedupExact = dedupePieceDraftsByCutContour(drafts)
  drafts = dedupExact.drafts
  const dedupNear = dedupeNearDuplicatePieceDrafts(drafts)
  drafts = dedupNear.drafts

  const nested = absorbNestedPieceDrafts(drafts)
  drafts = nested.drafts

  return {
    drafts,
    usedFallback,
    removedExactDupes: dedupExact.removed,
    removedNearDupes: dedupNear.removed,
    absorbedNested: nested.absorbed,
  }
}

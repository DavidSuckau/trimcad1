/**
 * DXF-Import: Konvertiert DXF-Daten zu PatternPiece[].
 * Nutzt dxfParser, notchDetection und Layer-Heuristiken für Fremdsysteme.
 */

import type { PatternPiece, Curve, Notch, Point, Drill, Line } from '../types/model'
import { parseDxf, type DxfEntity, type DxfPoint } from './dxfParser'
import { detectNotchesInPolyline } from './notchDetection'
import { dist } from './dxfShared'
import {
  deriveCutLineFromSeamWithValidation,
  offsetCurvesInwardForSeam,
  SEAM_FROM_CUT_SIMPLIFY_IMPORT_MM,
} from '../geometry/offset'
import {
  isCutLayer,
  isSeamLayer,
  isNotchLineLayer,
  notchTypeForLayer,
  isDrillLayer,
  isGrainLayer,
  isExcludedLayerFallback,
} from './dxfImportLayers'
import { resyncNotchesAfterCutLineRebuilt } from '../geometry/notchResyncCutLine'
import { nearestCurveIndexAndPoint } from '../geometry/nearestOnCurve'
import { isBinaryDxf, scanUnsupportedEntityHints } from './dxfBinaryHints'

const DUPLICATE_THRESHOLD = 0.01

export type ImportDxfOptions = {
  /** Zusätzliche Layer-Namen (kommagetrennt in den Einstellungen), die als Schnittkontur gelten. */
  extraCutLayers?: string[]
  /** Optionaler manueller Faktor auf den gesamten Import (nach DXF-Units), z. B. 10 bei 10x zu klein. */
  importScale?: number
  /** V-Kerben in der Polyligne erkennen und zu Notches mit bereinigter Kontur (Standard: true). */
  detectVNotchesInPolyline?: boolean
  /**
   * Wenn die DXF keine Naht-Polyline liefert: Nahtlinie per Offset nach innen erzeugen und Schnittkontur daraus ableiten.
   * Erfordert `importSeamAllowanceMm` &gt; 0.
   */
  createSeamLineOnImport?: boolean
  /** Nahtzugabe in mm für `createSeamLineOnImport` (z. B. 8). */
  importSeamAllowanceMm?: number
}

export type ImportDxfResult = {
  pieces: PatternPiece[]
  error?: string
  warnings?: string[]
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 12)
}

export function parseExtraCutLayers(extra?: string): string[] {
  if (!extra || !extra.trim()) return []
  return extra
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function verticesToCurves(vertices: DxfPoint[], closed: boolean): Curve[] {
  if (vertices.length < 2) return []
  const curves: Curve[] = []
  const n = vertices.length
  for (let i = 0; i < n - 1; i++) {
    const a = vertices[i]
    const b = vertices[i + 1]
    if (dist(a, b) < DUPLICATE_THRESHOLD) continue
    curves.push({
      type: 'line',
      start: { x: a.x, y: a.y },
      end: { x: b.x, y: b.y },
    })
  }
  if (closed && n >= 3) {
    const a = vertices[n - 1]
    const b = vertices[0]
    if (dist(a, b) >= DUPLICATE_THRESHOLD) {
      curves.push({
        type: 'line',
        start: { x: a.x, y: a.y },
        end: { x: b.x, y: b.y },
      })
    }
  }
  return curves
}

function applyUnitScale(points: DxfPoint[], insUnits: number, importScale = 1): DxfPoint[] {
  const scale = (insUnits === 4 ? 10 : 1) * importScale
  if (scale === 1) return points
  return points.map((p) => ({ x: p.x * scale, y: p.y * scale }))
}

function transformPoint(
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

type BBox = { minX: number; minY: number; maxX: number; maxY: number }

function polygonArea(pts: DxfPoint[]): number {
  if (pts.length < 3) return 0
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return Math.abs(a / 2)
}

function getBlockCaseInsensitive(
  blocks: Map<string, import('./dxfParser').DxfBlock>,
  name: string
): import('./dxfParser').DxfBlock | undefined {
  if (blocks.has(name)) return blocks.get(name)
  const u = name.toUpperCase()
  for (const [k, v] of blocks) {
    if (k.toUpperCase() === u) return v
  }
  return undefined
}

function boundsOf(pts: DxfPoint[]): BBox {
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

function lineToNotch(
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

function polylineFromEntity(
  e: DxfEntity
): { vertices: DxfPoint[]; closed: boolean; layer: string } | null {
  if (e.type === 'POLYLINE' || e.type === 'LWPOLYLINE' || e.type === 'ARC_POLYLINE') {
    return { vertices: e.vertices, closed: e.closed, layer: e.layer }
  }
  return null
}

type PieceDraft = {
  cutVertices: DxfPoint[]
  closed: boolean
  seamVertices?: DxfPoint[] | null
  seamClosed?: boolean
  notchesFromLayers: Notch[]
  drillsFromLayers: Drill[]
  grainLine: Line | null
  /** INSERT/Block vs. Modellraum vs. Fallback — steuert implizit Priorität (Liste: zuerst Block). */
  importSource: 'block' | 'modelspace' | 'fallback'
}

const CONTOUR_HASH_DECIMALS = 2

/** Rel. Toleranz für Near-Duplikate (Größe/Fläche); bewusst konservativ. */
const NEAR_DUPE_REL_TOL = 0.02
const NEAR_DUPE_MIN_AREA_MM2 = 2
/** Mindestens so viel Überlappung der achsparallelen Bounding-Boxes (Anteil der kleineren Box-Fläche). */
const NEAR_DUPE_BBOX_OVERLAP_MIN = 0.72

function roundContourCoord(v: number): number {
  const f = 10 ** CONTOUR_HASH_DECIMALS
  return Math.round(v * f) / f
}

/** Geschlossene Punktfolge ohne abschließenden Doppelpunkt (falls vorhanden). */
function ringPointsForHash(vertices: DxfPoint[], closed: boolean): DxfPoint[] | null {
  if (vertices.length < 3) return null
  const pts: DxfPoint[] = []
  for (const p of vertices) {
    const q = { x: roundContourCoord(p.x), y: roundContourCoord(p.y) }
    if (pts.length > 0 && dist(pts[pts.length - 1], q) < 1e-9) continue
    pts.push(q)
  }
  const geometricallyClosed =
    closed || (pts.length >= 2 && dist(pts[0], pts[pts.length - 1]) < DUPLICATE_THRESHOLD)
  if (!geometricallyClosed) return null
  while (pts.length > 2 && dist(pts[0], pts[pts.length - 1]) < DUPLICATE_THRESHOLD) {
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

/** Stabiler Schlüssel für geschlossene Konturen (Startpunkt- und Umlaufs-unabhängig). */
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

/** Entfernt identische Schnittkonturen (Block-Entwürfe stehen in der Liste vor Modellraum → Block gewinnt). */
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

/** Geschlossene Stützpunktliste ohne Rundung (für Fläche/Schwerpunkt/Near-Match). */
function closedRingPointsRaw(vertices: DxfPoint[], closed: boolean): DxfPoint[] | null {
  if (vertices.length < 3) return null
  const pts: DxfPoint[] = []
  for (const p of vertices) {
    const q = { x: p.x, y: p.y }
    if (pts.length > 0 && dist(pts[pts.length - 1], q) < DUPLICATE_THRESHOLD) continue
    pts.push(q)
  }
  const geometricallyClosed =
    closed || (pts.length >= 2 && dist(pts[0], pts[pts.length - 1]) < DUPLICATE_THRESHOLD)
  if (!geometricallyClosed) return null
  while (pts.length > 2 && dist(pts[0], pts[pts.length - 1]) < DUPLICATE_THRESHOLD) {
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

/** Schwerpunkt eines geschlossenen Polygons (ohne Selbstüberschneidungs-Sonderfälle). */
function polygonCentroidClosed(pts: DxfPoint[]): DxfPoint | null {
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

function areNearDuplicateCuts(a: PieceDraft, b: PieceDraft): boolean {
  const ringA = closedRingPointsRaw(a.cutVertices, a.closed)
  const ringB = closedRingPointsRaw(b.cutVertices, b.closed)
  if (!ringA || !ringB) return false

  const areaA = polygonArea(ringA)
  const areaB = polygonArea(ringB)
  if (areaA < NEAR_DUPE_MIN_AREA_MM2 || areaB < NEAR_DUPE_MIN_AREA_MM2) return false

  const bA = boundsOf(ringA)
  const bB = boundsOf(ringB)
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

/**
 * Entfernt „fast gleiche“ geschlossene Konturen (nach exaktem Hash-Dedupe).
 * Reihenfolge der Liste bleibt: zuerst Block, dann Modellraum/Fallback → erste Quelle gewinnt (BLOCK > MODELSPACE).
 */
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

function estimateSeamAllowanceMm(seamPts: DxfPoint[], cutCurves: Curve[]): number | null {
  if (seamPts.length < 3 || cutCurves.length < 3) return null
  const distances: number[] = []
  for (const p of seamPts) {
    const nr = nearestCurveIndexAndPoint(p, cutCurves)
    if (nr) distances.push(nr.distance)
  }
  if (distances.length === 0) return null
  distances.sort((a, b) => a - b)
  const med = distances[Math.floor(distances.length / 2)]
  if (med > 0.05 && med < 500) return med
  const nr0 = nearestCurveIndexAndPoint(seamPts[0], cutCurves)
  const d0 = nr0?.distance
  return d0 != null && d0 > 0.05 && d0 < 500 ? d0 : null
}

function pickSeamForCut(cutB: BBox, seams: Array<{ vertices: DxfPoint[]; closed: boolean }>): { vertices: DxfPoint[]; closed: boolean } | null {
  if (seams.length === 0) return null
  const cxc = (cutB.minX + cutB.maxX) / 2
  const cyc = (cutB.minY + cutB.maxY) / 2
  for (const s of seams) {
    const b = boundsOf(s.vertices)
    if (cxc >= b.minX && cxc <= b.maxX && cyc >= b.minY && cyc <= b.maxY) return s
  }
  let best: { vertices: DxfPoint[]; closed: boolean } | null = null
  let bestD = Infinity
  for (const s of seams) {
    const b = boundsOf(s.vertices)
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

function extractNotchesFromBlock(
  blockEntities: DxfEntity[],
  insert: { x: number; y: number; scaleX: number; scaleY: number; rotation: number },
  unitScale: number
): Notch[] {
  const notches: Notch[] = []
  for (const e of blockEntities) {
    if (e.type === 'LINE' && isNotchLineLayer(e.layer)) {
      const p1 = transformPoint({ x: e.x1, y: e.y1 }, insert, unitScale)
      const p2 = transformPoint({ x: e.x2, y: e.y2 }, insert, unitScale)
      const n = lineToNotch(p1.x, p1.y, p2.x, p2.y, e.layer, 1)
      if (n) notches.push(n)
    }
    if (e.type === 'POINT' && isNotchLineLayer(e.layer)) {
      const p = transformPoint({ x: e.x, y: e.y }, insert, unitScale)
      notches.push(pointToNotch(p.x, p.y, e.layer, 1))
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
      const c = transformPoint({ x: e.cx, y: e.cy }, insert, unitScale)
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
      const p1 = transformPoint({ x: e.x1, y: e.y1 }, insert, unitScale)
      const p2 = transformPoint({ x: e.x2, y: e.y2 }, insert, unitScale)
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

function extractPieceDrafts(
  parsed: {
    entities: DxfEntity[]
    blocks: Map<string, import('./dxfParser').DxfBlock>
    insUnits: number
  },
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
      const pts = pl.vertices.map((p) => transformPoint(p, e, unitScale) as DxfPoint)
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
      const cutB = boundsOf(cut.vertices)
      const seam = pickSeamForCut(cutB, seams)
      const grainLine = extractGrainFromBlock(blk.entities, e, unitScale, cutB)
      drafts.push({
        cutVertices: cut.vertices,
        closed: cut.closed,
        seamVertices: seam?.vertices ?? null,
        seamClosed: seam?.closed,
        notchesFromLayers: [...notchesFromLayers],
        drillsFromLayers: [...drillsFromLayers],
        grainLine,
        importSource: 'block',
      })
    }
  }

  const cutsFlat: Array<{ vertices: DxfPoint[]; closed: boolean }> = []
  const seamsFlat: Array<{ vertices: DxfPoint[]; closed: boolean }> = []

  for (const e of entities) {
    if (e.type === 'INSERT') continue
    const pl = polylineFromEntity(e)
    if (!pl) continue
    const pts = applyUnitScale(pl.vertices, insUnits, importScale)
    if (isCutLayer(pl.layer, extraCutLayers)) {
      cutsFlat.push({ vertices: pts, closed: pl.closed })
    }
    if (isSeamLayer(pl.layer)) {
      seamsFlat.push({ vertices: pts, closed: pl.closed })
    }
  }

  for (const cut of cutsFlat) {
    const cutB = boundsOf(cut.vertices)
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

/**
 * Wenn keine Standard-Schnitt-Layer passen: geschlossene Polylines auf „neutralen“ Layern
 * (keine Kerben/Bohrung/Grain/Naht, keine typischen Hilfs-Layer-Namen).
 */
function extractFallbackCutDrafts(parsed: {
  entities: DxfEntity[]
  blocks: Map<string, import('./dxfParser').DxfBlock>
  insUnits: number
}, importScale: number): PieceDraft[] {
  const { entities, blocks, insUnits } = parsed
  const unitScale = (insUnits === 4 ? 10 : 1) * importScale
  const candidates: Array<{ vertices: DxfPoint[]; layer: string }> = []

  const consider = (pts: DxfPoint[], closed: boolean, layer: string) => {
    if (pts.length < 3) return
    if (isExcludedLayerFallback(layer)) return
    const c = closed || isClosed(pts)
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
        const pts = pl.vertices.map((p) => transformPoint(p, e, unitScale) as DxfPoint)
        consider(pts, pl.closed || isClosed(pts), pl.layer)
      }
      continue
    }
    const pl = polylineFromEntity(e)
    if (!pl) continue
    const pts = applyUnitScale(pl.vertices, insUnits, importScale)
    consider(pts, pl.closed || isClosed(pts), pl.layer)
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

function pointToNotch(px: number, py: number, layer: string, coordScale: number): Notch {
  const type = notchTypeForLayer(layer)
  return {
    id: generateId(),
    position: { x: px * coordScale, y: py * coordScale },
    angle: 90,
    type,
    depth: 4,
    width: 6,
  }
}

function assignToPiece(mx: number, my: number, cutBounds: BBox[]): number {
  let bestPiece = -1
  let bestDist = Infinity
  for (let i = 0; i < cutBounds.length; i++) {
    const b = cutBounds[i]
    if (mx >= b.minX - 50 && mx <= b.maxX + 50 && my >= b.minY - 50 && my <= b.maxY + 50) {
      const d = Math.max(0, b.minX - mx, mx - b.maxX, b.minY - my, my - b.maxY)
      if (d < bestDist) {
        bestDist = d
        bestPiece = i
      }
    }
  }
  return bestPiece
}

function extractStandaloneNotches(
  entities: DxfEntity[],
  cutBounds: BBox[],
  unitScale: number
): Map<number, Notch[]> {
  const byPiece = new Map<number, Notch[]>()
  for (const e of entities) {
    if (e.type === 'LINE' && isNotchLineLayer(e.layer)) {
      const mx = ((e.x1 + e.x2) / 2) * unitScale
      const my = ((e.y1 + e.y2) / 2) * unitScale
      const bestPiece = assignToPiece(mx, my, cutBounds)
      if (bestPiece >= 0) {
        const n = lineToNotch(e.x1, e.y1, e.x2, e.y2, e.layer, unitScale)
        if (n) {
          const list = byPiece.get(bestPiece) ?? []
          list.push(n)
          byPiece.set(bestPiece, list)
        }
      }
    }
    if (e.type === 'POINT' && isNotchLineLayer(e.layer)) {
      const mx = e.x * unitScale
      const my = e.y * unitScale
      const bestPiece = assignToPiece(mx, my, cutBounds)
      if (bestPiece >= 0) {
        const n = pointToNotch(e.x, e.y, e.layer, unitScale)
        const list = byPiece.get(bestPiece) ?? []
        list.push(n)
        byPiece.set(bestPiece, list)
      }
    }
  }
  return byPiece
}

function extractStandaloneDrills(
  entities: DxfEntity[],
  cutBounds: BBox[],
  unitScale: number
): Map<number, Drill[]> {
  const byPiece = new Map<number, Drill[]>()
  for (const e of entities) {
    if (e.type === 'CIRCLE' && isDrillLayer(e.layer)) {
      const mx = e.cx * unitScale
      const my = e.cy * unitScale
      let bestPiece = -1
      let bestDist = Infinity
      for (let i = 0; i < cutBounds.length; i++) {
        const b = cutBounds[i]
        if (mx >= b.minX - 50 && mx <= b.maxX + 50 && my >= b.minY - 50 && my <= b.maxY + 50) {
          const d = Math.max(0, b.minX - mx, mx - b.maxX, b.minY - my, my - b.maxY)
          if (d < bestDist) {
            bestDist = d
            bestPiece = i
          }
        }
      }
      if (bestPiece >= 0) {
        const r = e.radius * unitScale
        const list = byPiece.get(bestPiece) ?? []
        list.push({
          id: generateId(),
          center: { x: mx, y: my },
          radius: Math.max(0.1, r),
        })
        byPiece.set(bestPiece, list)
      }
    }
  }
  return byPiece
}

function extractStandaloneGrain(
  entities: DxfEntity[],
  cutBounds: BBox[],
  unitScale: number
): Map<number, Line> {
  const byPiece = new Map<number, Line>()
  for (const e of entities) {
    if (e.type === 'LINE' && isGrainLayer(e.layer)) {
      const p1 = { x: e.x1 * unitScale, y: e.y1 * unitScale }
      const p2 = { x: e.x2 * unitScale, y: e.y2 * unitScale }
      const mx = (p1.x + p2.x) / 2
      const my = (p1.y + p2.y) / 2
      let bestPiece = -1
      let bestScore = Infinity
      for (let i = 0; i < cutBounds.length; i++) {
        const b = cutBounds[i]
        const inside = mx >= b.minX && mx <= b.maxX && my >= b.minY && my <= b.maxY
        const d = inside ? 0 : Math.max(b.minX - mx, mx - b.maxX, b.minY - my, my - b.maxY)
        if (d < bestScore) {
          bestScore = d
          bestPiece = i
        }
      }
      if (bestPiece >= 0 && bestScore < 800) {
        byPiece.set(bestPiece, { start: p1, end: p2 })
      }
    }
  }
  return byPiece
}

function isClosed(vertices: DxfPoint[]): boolean {
  if (vertices.length < 3) return false
  const first = vertices[0]
  const last = vertices[vertices.length - 1]
  return dist(first, last) < DUPLICATE_THRESHOLD
}

/** Max. Abstand importierter Eckpunkte zur abgeleiteten Schnittkontur (Clipper-Roundtrip). */
function maxDeviationVerticesToCurves(vertices: DxfPoint[], curves: Curve[]): number {
  let max = 0
  for (const p of vertices) {
    const nr = nearestCurveIndexAndPoint({ x: p.x, y: p.y }, curves)
    if (nr) max = Math.max(max, nr.distance)
  }
  return max
}

const SEAM_ROUNDTRIP_WARN_MM = 2
const NOTCH_SHORT_MAX_RELAXED_MM = 9
const NOTCH_MIN_ANGLE_RELAXED_DEG = 30
/** Dritte Stufe: längere Schenkel, flachere Winkel, max-Längen-Modus. */
const NOTCH_SHORT_MAX_VERY_RELAXED_MM = 16
const NOTCH_MIN_ANGLE_VERY_RELAXED_DEG = 20

export type NotchImportDetectTier = 'strict' | 'relaxed' | 'veryRelaxed' | null

function detectNotchesWithToleranceFallback(
  vertices: DxfPoint[],
  closedRing: boolean
): {
  cleanedVertices: DxfPoint[]
  notches: ReturnType<typeof detectNotchesInPolyline>['notches']
  notchTier: NotchImportDetectTier
} {
  const strict = detectNotchesInPolyline(vertices, { closedRing })
  if (strict.notches.length > 0) {
    return { ...strict, notchTier: 'strict' }
  }
  const relaxed = detectNotchesInPolyline(vertices, {
    closedRing,
    shortSegmentMaxMm: NOTCH_SHORT_MAX_RELAXED_MM,
    minAngleDeg: NOTCH_MIN_ANGLE_RELAXED_DEG,
  })
  if (relaxed.notches.length > 0) {
    return { ...relaxed, notchTier: 'relaxed' }
  }
  const veryRelaxed = detectNotchesInPolyline(vertices, {
    closedRing,
    shortSegmentMaxMm: NOTCH_SHORT_MAX_VERY_RELAXED_MM,
    minAngleDeg: NOTCH_MIN_ANGLE_VERY_RELAXED_DEG,
    legLengthMode: 'asymmetric',
  })
  if (veryRelaxed.notches.length > 0) {
    return { ...veryRelaxed, notchTier: 'veryRelaxed' }
  }
  return { ...strict, notchTier: null }
}

/**
 * Parst DXF-Text und erzeugt PatternPiece[].
 * Erkennt geometrische Kerben in Polylines und separate Notch-Entities (ASTM Layer 4, 80–83).
 */
export function importDxfFromString(content: string, options?: ImportDxfOptions): ImportDxfResult {
  const warnings: string[] = []
  const extraCutLayers = options?.extraCutLayers ?? []
  const manualImportScale =
    typeof options?.importScale === 'number' && Number.isFinite(options.importScale) && options.importScale > 0
      ? options.importScale
      : 1
  const detectVNotches = options?.detectVNotchesInPolyline !== false
  const createSeamOnImport = options?.createSeamLineOnImport === true
  const importSeamMm =
    typeof options?.importSeamAllowanceMm === 'number' &&
    Number.isFinite(options.importSeamAllowanceMm) &&
    options.importSeamAllowanceMm > 0
      ? options.importSeamAllowanceMm
      : null

  const text = content.replace(/^\uFEFF/, '')

  if (isBinaryDxf(text)) {
    return {
      pieces: [],
      error: 'Binär-DXF wird nicht unterstützt. Bitte als ASCII R12 (AC1009) exportieren.',
    }
  }

  const unsupported = scanUnsupportedEntityHints(text)
  for (const u of unsupported) {
    warnings.push(`${u}-Entities werden ignoriert.`)
  }

  try {
    const parsed = parseDxf(text)
    const { insUnits } = parsed
    const unitScale = insUnits === 4 ? 10 : 1
    const scale = unitScale * manualImportScale

    if (parsed.entities.length === 0) {
      warnings.push('Keine Entities in der ENTITIES-Sektion gefunden. Prüfen Sie, ob die Datei DXF R12 ASCII ist.')
    }

    let drafts = extractPieceDrafts(parsed, extraCutLayers, manualImportScale)
    if (drafts.length === 0) {
      drafts = extractFallbackCutDrafts(parsed, manualImportScale)
      if (drafts.length > 0) {
        warnings.push(
          'Kein bekannter Schnitt-Layer: geschlossene Konturen wurden von anderen Layern übernommen (Fläche ≥ 2 mm², keine Hilfs-/Beschriftungs-Layer).'
        )
      }
    }

    const dedupExact = dedupePieceDraftsByCutContour(drafts)
    drafts = dedupExact.drafts
    if (dedupExact.removed > 0) {
      warnings.push(
        `${dedupExact.removed} doppelte Schnittkontur(en) entfernt (exakt gleiche Geometrie nach Hash-Rundung). Es bleibt jeweils der zuerst verarbeitete Entwurf (üblicherweise Block/INSERT vor Modellraum).`
      )
    }

    const dedupNear = dedupeNearDuplicatePieceDrafts(drafts)
    drafts = dedupNear.drafts
    if (dedupNear.removed > 0) {
      warnings.push(
        `${dedupNear.removed} nahezu identische Schnittkontur(en) entfernt (Größe/Fläche je ±${Math.round(NEAR_DUPE_REL_TOL * 100)} %, hohe Bounding-Box-Überlappung, nahe Schwerpunkte). Block-Entwürfe haben Vorrang vor später in der Liste stehenden Quellen.`
      )
    }

    if (drafts.length === 0) {
      return {
        pieces: [],
        error:
          'Keine Schnittkonturen gefunden. Erwartet: POLYLINE/LWPOLYLINE (ggf. mit Bulge) auf einem Schnitt-Layer (z. B. CUT, 1, BOUNDARY) oder in Blöcken. In den Einstellungen zusätzliche Schnitt-Layer eintragen oder in der Quelle als R12 ASCII mit geschlossenen Polylines exportieren.',
        warnings: warnings.length ? warnings : undefined,
      }
    }

    const pieces: PatternPiece[] = []
    const cutBounds: BBox[] = []

    for (let d = 0; d < drafts.length; d++) {
      const draft = drafts[d]
      const vertices = draft.cutVertices
      const closed = draft.closed
      if (vertices.length < 3) continue

      const contourClosed = closed || isClosed(vertices)
      const detectRes = detectVNotches
        ? detectNotchesWithToleranceFallback(vertices, contourClosed)
        : { cleanedVertices: [...vertices], notches: [], notchTier: null as NotchImportDetectTier }
      const { cleanedVertices, notches: geomNotches } = detectRes
      const pieceNum = String(pieces.length + 1).padStart(3, '0')
      if (detectRes.notchTier === 'relaxed') {
        warnings.push(
          `Teil ${pieceNum}: V-Kerben mit mittlerer Toleranz erkannt (${NOTCH_SHORT_MAX_RELAXED_MM} mm / ${NOTCH_MIN_ANGLE_RELAXED_DEG}°).`
        )
      } else if (detectRes.notchTier === 'veryRelaxed') {
        warnings.push(
          `Teil ${pieceNum}: V-Kerben mit großzügiger Toleranz erkannt (${NOTCH_SHORT_MAX_VERY_RELAXED_MM} mm / ${NOTCH_MIN_ANGLE_VERY_RELAXED_DEG}°, asymmetrische Schenkel erlaubt).`
        )
      }

      const isContourClosed = closed || isClosed(cleanedVertices)
      if (!isContourClosed) continue

      let cutLine = verticesToCurves(cleanedVertices, isContourClosed)
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity
      for (const p of cleanedVertices) {
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
      }

      let allNotches: Notch[] = [
        ...geomNotches.map((n) => ({
          id: generateId(),
          position: n.position,
          angle: n.angle,
          type: (n.isSlit ? 'single' : 'v') as Notch['type'],
          depth: n.depth,
          width: n.width,
        })),
        ...draft.notchesFromLayers,
      ]

      let seamLine: Curve[] = []
      let seamAllowanceMm: number | null = null
      const hasSeamFromDxf = draft.seamVertices && draft.seamVertices.length >= 3
      let cutLineOldForNotchResync = cutLine

      if (hasSeamFromDxf) {
        const sc = draft.seamClosed || isClosed(draft.seamVertices!)
        const sl = verticesToCurves(draft.seamVertices!, sc)
        const est = estimateSeamAllowanceMm(draft.seamVertices!, cutLine)
        if (est != null && sl.length >= 3) {
          seamLine = sl
          seamAllowanceMm = est
        }
      } else if (createSeamOnImport && importSeamMm != null && cutLine.length >= 3) {
        const importedCut = cutLine
        let sl = offsetCurvesInwardForSeam(cutLine, importSeamMm)
        let derived = sl.length >= 3 ? deriveCutLineFromSeamWithValidation(sl, importSeamMm) : { ok: false as const, message: 'Keine Nahtlinie' }

        if (!derived.ok && sl.length >= 3) {
          const slAlt = offsetCurvesInwardForSeam(cutLine, importSeamMm, SEAM_FROM_CUT_SIMPLIFY_IMPORT_MM)
          if (slAlt.length >= 3) {
            const d2 = deriveCutLineFromSeamWithValidation(slAlt, importSeamMm)
            if (d2.ok) {
              sl = slAlt
              derived = d2
              warnings.push(
                `Teil ${pieceNum}: Nahtlinie mit stärkerer Kantenvereinfachung erzeugt (Import-Stabilität).`
              )
            }
          }
        }

        if (derived.ok) {
          const dev = maxDeviationVerticesToCurves(cleanedVertices, derived.cutLine)
          if (dev > SEAM_ROUNDTRIP_WARN_MM) {
            warnings.push(
              `Teil ${pieceNum}: Schnittkontur weicht nach Naht-Offset-Roundtrip um bis zu ${dev.toFixed(1)} mm von der importierten Polylinie ab.`
            )
          }
          cutLine = derived.cutLine
          cutLineOldForNotchResync = importedCut
          seamLine = sl
          seamAllowanceMm = importSeamMm
        } else if (sl.length >= 3) {
          seamLine = sl
          seamAllowanceMm = importSeamMm
          cutLineOldForNotchResync = importedCut
          warnings.push(
            `Teil ${pieceNum}: Nahtlinie und Nahtzugabe gesetzt; Schnittkontur bleibt wie importiert (kein Roundtrip: ${derived.message}). Beim Bearbeiten der Naht wird die Schnittkontur ggf. angeglichen.`
          )
        } else {
          warnings.push(
            `Teil ${pieceNum}: Innere Naht konnte nicht erzeugt werden (Offset leer oder zu klein).`
          )
        }
      }

      allNotches = resyncNotchesAfterCutLineRebuilt(allNotches, cutLineOldForNotchResync, cutLine)

      const id = generateId()
      const number = String(pieces.length + 1).padStart(3, '0')
      const piece: PatternPiece = {
        id,
        number,
        name: `Teil ${number}`,
        cutLine,
        seamLine,
        seamAllowanceMm,
        notches: allNotches,
        drills: [...draft.drillsFromLayers],
        grainLine: draft.grainLine,
        internalLines: [],
        internalCircles: [],
        layer: 'CUT',
        transform: { x: 0, y: 0, rotation: 0, mirrored: false },
        softVertices: [],
        softVerticesMaster: [],
        fillInterior: true,
      }
      pieces.push(piece)
      cutBounds.push({ minX, minY, maxX, maxY })
    }

    const standaloneNotches = extractStandaloneNotches(parsed.entities, cutBounds, scale)
    const standaloneDrills = extractStandaloneDrills(parsed.entities, cutBounds, scale)
    const standaloneGrain = extractStandaloneGrain(parsed.entities, cutBounds, scale)

    for (const [idx, notchList] of standaloneNotches) {
      if (pieces[idx]) {
        const merged = [...(pieces[idx].notches ?? []), ...notchList]
        pieces[idx].notches = resyncNotchesAfterCutLineRebuilt(merged, pieces[idx].cutLine, pieces[idx].cutLine)
      }
    }
    for (const [idx, drillList] of standaloneDrills) {
      if (pieces[idx]) {
        pieces[idx].drills = [...pieces[idx].drills, ...drillList]
      }
    }
    for (const [idx, grain] of standaloneGrain) {
      if (pieces[idx] && !pieces[idx].grainLine) {
        pieces[idx].grainLine = grain
      }
    }

    if (pieces.length === 0 && drafts.length > 0) {
      return {
        pieces: [],
        error:
          'Konturen gefunden, aber keine geschlossene Schnittlinie (mindestens 3 Punkte, geschlossen).',
        warnings: warnings.length ? warnings : undefined,
      }
    }

    return { pieces, warnings: warnings.length ? warnings : undefined }
  } catch (err) {
    return {
      pieces: [],
      error: err instanceof Error ? err.message : 'Unbekannter Fehler beim DXF-Import',
    }
  }
}

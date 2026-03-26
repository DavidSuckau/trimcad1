/**
 * DXF-Import: Konvertiert DXF-Daten zu PatternPiece[].
 * Nutzt dxfParser, notchDetection und Layer-Heuristiken für Fremdsysteme.
 */

import type { PatternPiece, Curve, Notch, Point, Drill, Line } from '../types/model'
import { parseDxf, type DxfEntity, type DxfPoint } from './dxfParser'
import { detectNotchesInPolyline } from './notchDetection'
import { dist } from './dxfShared'
import {
  isCutLayer,
  isSeamLayer,
  isNotchLineLayer,
  notchTypeForLayer,
  isDrillLayer,
  isGrainLayer,
} from './dxfImportLayers'
import { resyncNotchesAfterCutLineRebuilt } from '../geometry/notchResyncCutLine'
import { nearestCurveIndexAndPoint } from '../geometry/nearestOnCurve'
import { isBinaryDxf, scanUnsupportedEntityHints } from './dxfBinaryHints'

const DUPLICATE_THRESHOLD = 0.01

export type ImportDxfOptions = {
  /** Zusätzliche Layer-Namen (kommagetrennt in den Einstellungen), die als Schnittkontur gelten. */
  extraCutLayers?: string[]
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

function applyUnitScale(points: DxfPoint[], insUnits: number): DxfPoint[] {
  const scale = insUnits === 4 ? 10 : 1
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
  extraCutLayers: string[]
): PieceDraft[] {
  const { entities, blocks, insUnits } = parsed
  const unitScale = insUnits === 4 ? 10 : 1
  const drafts: PieceDraft[] = []

  for (const e of entities) {
    if (e.type !== 'INSERT') continue
    const blk = blocks.get(e.blockName)
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

    for (const cut of cuts) {
      const cutB = boundsOf(cut.vertices)
      const seam = pickSeamForCut(cutB, seams)
      const notchesFromLayers = extractNotchesFromBlock(blk.entities, e, unitScale)
      const drillsFromLayers = extractDrillsFromBlock(blk.entities, e, unitScale)
      const grainLine = extractGrainFromBlock(blk.entities, e, unitScale, cutB)
      drafts.push({
        cutVertices: cut.vertices,
        closed: cut.closed,
        seamVertices: seam?.vertices ?? null,
        seamClosed: seam?.closed,
        notchesFromLayers,
        drillsFromLayers,
        grainLine,
      })
    }
  }

  const cutsFlat: Array<{ vertices: DxfPoint[]; closed: boolean }> = []
  const seamsFlat: Array<{ vertices: DxfPoint[]; closed: boolean }> = []

  for (const e of entities) {
    if (e.type === 'INSERT') continue
    const pl = polylineFromEntity(e)
    if (!pl) continue
    const pts = applyUnitScale(pl.vertices, insUnits)
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
    })
  }

  return drafts
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
        const n = lineToNotch(e.x1, e.y1, e.x2, e.y2, e.layer, unitScale)
        if (n) {
          const list = byPiece.get(bestPiece) ?? []
          list.push(n)
          byPiece.set(bestPiece, list)
        }
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

/**
 * Parst DXF-Text und erzeugt PatternPiece[].
 * Erkennt geometrische Kerben in Polylines und separate Notch-Entities (ASTM Layer 4, 80–83).
 */
export function importDxfFromString(content: string, options?: ImportDxfOptions): ImportDxfResult {
  const warnings: string[] = []
  const extraCutLayers = options?.extraCutLayers ?? []

  if (isBinaryDxf(content)) {
    return {
      pieces: [],
      error: 'Binär-DXF wird nicht unterstützt. Bitte als ASCII R12 (AC1009) exportieren.',
    }
  }

  const unsupported = scanUnsupportedEntityHints(content)
  for (const u of unsupported) {
    warnings.push(`${u}-Entities werden ignoriert.`)
  }

  try {
    const parsed = parseDxf(content)
    const { insUnits } = parsed
    const scale = insUnits === 4 ? 10 : 1

    if (parsed.entities.length === 0) {
      warnings.push('Keine Entities in der ENTITIES-Sektion gefunden. Prüfen Sie, ob die Datei DXF R12 ASCII ist.')
    }

    const drafts = extractPieceDrafts(parsed, extraCutLayers)

    if (drafts.length === 0) {
      return {
        pieces: [],
        error:
          'Keine Schnittkonturen gefunden. Erwartet: POLYLINE/LWPOLYLINE auf einem Schnitt-Layer (z. B. CUT, 1, BOUNDARY) oder in Blöcken. Optional in den Einstellungen zusätzliche Schnitt-Layer eintragen.',
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

      const { cleanedVertices, notches: geomNotches } = detectNotchesInPolyline(vertices)

      const isContourClosed = closed || isClosed(cleanedVertices)
      if (!isContourClosed) continue

      const cutLine = verticesToCurves(cleanedVertices, isContourClosed)
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
          type: 'v' as const,
          depth: n.depth,
          width: n.width,
        })),
        ...draft.notchesFromLayers,
      ]

      let seamLine: Curve[] = []
      let seamAllowanceMm: number | null = null
      if (draft.seamVertices && draft.seamVertices.length >= 3) {
        const sc = draft.seamClosed || isClosed(draft.seamVertices)
        const sl = verticesToCurves(draft.seamVertices, sc)
        const est = estimateSeamAllowanceMm(draft.seamVertices, cutLine)
        if (est != null && sl.length >= 3) {
          seamLine = sl
          seamAllowanceMm = est
        }
      }

      allNotches = resyncNotchesAfterCutLineRebuilt(allNotches, cutLine, cutLine)

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
        layer: 'CUT',
        transform: { x: 0, y: 0, rotation: 0, mirrored: false },
        softVertices: [],
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

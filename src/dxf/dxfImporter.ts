/**
 * DXF-Import: Konvertiert DXF-Daten zu PatternPiece[].
 * Nutzt dxfParser und notchDetection für geometrische Kerben.
 */

import type { PatternPiece, Curve, Notch, Point } from '../types/model'
import { parseDxf } from './dxfParser'
import { detectNotchesInPolyline } from './notchDetection'
import { dist } from './dxfShared'
import type { DxfEntity, DxfPoint } from './dxfParser'

const CUT_LAYERS = new Set([
  'CUT', '1', 'BOUNDARY', '0',
  'CUTLINE', 'NATLINE', 'OUTLINE', 'CONTOUR',
])
const NOTCH_LAYERS = new Map<string, 'single' | 'double' | 'v'>([
  ['4', 'single'],
  ['80', 'single'],
  ['81', 'double'],
  ['82', 'v'],
  ['83', 'single'],
  ['NOTCH', 'single'],
])

const DUPLICATE_THRESHOLD = 0.01

function generateId(): string {
  return Math.random().toString(36).slice(2, 12)
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

/** Ermittelt Notch aus LINE-Entity (Slit/V). coords bereits in mm. */
function lineToNotch(
  x1: number, y1: number, x2: number, y2: number,
  layer: string,
  coordScale: number
): Notch | null {
  const type = NOTCH_LAYERS.get(layer) ?? 'single'
  const mx = ((x1 + x2) / 2) * coordScale
  const my = ((y1 + y2) / 2) * coordScale
  const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI
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

/** Polylines aus Entities extrahieren (direkt oder aus BLOCK+INSERT). */
function extractCutPolylines(
  parsed: { entities: DxfEntity[]; blocks: Map<string, import('./dxfParser').DxfBlock>; insUnits: number }
): Array<{ vertices: DxfPoint[]; closed: boolean; notchesFromLayers: Notch[]; scale: number }> {
  const { entities, blocks, insUnits } = parsed
  const scale = insUnits === 4 ? 10 : 1
  const result: Array<{ vertices: DxfPoint[]; closed: boolean; notchesFromLayers: Notch[]; scale: number }> = []

  for (const e of entities) {
    if (e.type === 'INSERT') {
      const blk = blocks.get(e.blockName)
      if (!blk) continue
      for (const be of blk.entities) {
        if (be.type === 'POLYLINE' && CUT_LAYERS.has(be.layer)) {
          const pts = be.vertices.map((p) => transformPoint(p, e, scale) as DxfPoint)
          const notchesFromLayers = extractNotchesFromBlock(blk.entities, e, scale)
          result.push({ vertices: pts, closed: be.closed, notchesFromLayers, scale })
        } else if (be.type === 'LWPOLYLINE' && CUT_LAYERS.has(be.layer)) {
          const pts = be.vertices.map((p) => transformPoint(p, e, scale) as DxfPoint)
          const notchesFromLayers = extractNotchesFromBlock(blk.entities, e, scale)
          result.push({ vertices: pts, closed: be.closed, notchesFromLayers, scale })
        }
      }
      continue
    }
    if (e.type === 'POLYLINE' && CUT_LAYERS.has(e.layer)) {
      const pts = applyUnitScale(e.vertices, insUnits)
      result.push({ vertices: pts, closed: e.closed, notchesFromLayers: [], scale })
    }
    if (e.type === 'LWPOLYLINE' && CUT_LAYERS.has(e.layer)) {
      const pts = applyUnitScale(e.vertices, insUnits)
      result.push({ vertices: pts, closed: e.closed, notchesFromLayers: [], scale })
    }
  }

  return result
}

function extractNotchesFromBlock(
  blockEntities: DxfEntity[],
  insert: { x: number; y: number; scaleX: number; scaleY: number; rotation: number },
  unitScale: number
): Notch[] {
  const notches: Notch[] = []
  for (const e of blockEntities) {
    if (e.type === 'LINE' && NOTCH_LAYERS.has(e.layer)) {
      const p1 = transformPoint({ x: e.x1, y: e.y1 }, insert, unitScale)
      const p2 = transformPoint({ x: e.x2, y: e.y2 }, insert, unitScale)
      const n = lineToNotch(p1.x, p1.y, p2.x, p2.y, e.layer, 1)
      if (n) notches.push(n)
    }
  }
  return notches
}

/** Sammelt Notch-Entities aus den Haupt-Entities (ohne BLOCK). */
function extractStandaloneNotches(
  entities: DxfEntity[],
  cutBounds: Array<{ minX: number; minY: number; maxX: number; maxY: number }>,
  unitScale: number
): Map<number, Notch[]> {
  const byPiece = new Map<number, Notch[]>()
  for (const e of entities) {
    if (e.type === 'LINE' && NOTCH_LAYERS.has(e.layer)) {
      const mx = (e.x1 + e.x2) / 2 * unitScale
      const my = (e.y1 + e.y2) / 2 * unitScale
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

export type ImportDxfResult = {
  pieces: PatternPiece[]
  error?: string
}

/**
 * Parst DXF-Text und erzeugt PatternPiece[].
 * Erkennt geometrische Kerben in Polylines und separate Notch-Entities (ASTM Layer 4, 80–83).
 */
export function importDxfFromString(content: string): ImportDxfResult {
  try {
    const parsed = parseDxf(content)
    const { insUnits } = parsed
    const scale = insUnits === 4 ? 10 : 1

    const cutData = extractCutPolylines(parsed)

    if (cutData.length === 0) {
      return { pieces: [], error: 'Keine Schnittkonturen (CUT/Layer 1) gefunden.' }
    }

    const pieces: PatternPiece[] = []
    const cutBounds: Array<{ minX: number; minY: number; maxX: number; maxY: number }> = []

    for (let i = 0; i < cutData.length; i++) {
      const { vertices, closed, notchesFromLayers } = cutData[i]
      if (vertices.length < 3) continue

      const { cleanedVertices, notches } = detectNotchesInPolyline(vertices)

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const p of cleanedVertices) {
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
      }
      cutBounds.push({ minX, minY, maxX, maxY })

      const cutLine = verticesToCurves(cleanedVertices, closed || isClosed(cleanedVertices))
      const allNotches: Notch[] = [
        ...notches.map((n) => ({
          id: generateId(),
          position: n.position,
          angle: n.angle,
          type: 'v' as const,
          depth: n.depth,
          width: n.width,
        })),
        ...notchesFromLayers,
      ]

      const id = generateId()
      const number = String(i + 1).padStart(3, '0')
      const piece: PatternPiece = {
        id,
        number,
        name: `Teil ${number}`,
        cutLine,
        seamLine: [],
        seamAllowanceMm: null,
        notches: allNotches,
        drills: [],
        grainLine: null,
        internalLines: [],
        layer: 'CUT',
        transform: { x: 0, y: 0, rotation: 0, mirrored: false },
      }
      pieces.push(piece)
    }

    const standaloneNotches = extractStandaloneNotches(parsed.entities, cutBounds, scale)
    for (const [idx, notchList] of standaloneNotches) {
      if (pieces[idx]) {
        pieces[idx].notches = [...(pieces[idx].notches ?? []), ...notchList]
      }
    }

    return { pieces }
  } catch (err) {
    return {
      pieces: [],
      error: err instanceof Error ? err.message : 'Unbekannter Fehler beim DXF-Import',
    }
  }
}

function isClosed(vertices: DxfPoint[]): boolean {
  if (vertices.length < 3) return false
  const first = vertices[0]
  const last = vertices[vertices.length - 1]
  return dist(first, last) < DUPLICATE_THRESHOLD
}

/**
 * Minimal DXF R12 ASCII Parser – TrimTex DXF-Import.
 * Parst HEADER, ENTITIES (POLYLINE, VERTEX, LWPOLYLINE, LINE, CIRCLE, ARC),
 * optional BLOCKS und INSERT.
 *
 * Spezifikation: docs/DXF-MASTER-SPEZIFIKATION.txt
 */

import { expandLwPolylineWithBulge, type VertexWithBulge } from './dxfBulge'
import { tessellateArcEntity } from './dxfArcTessellate'
import { tessellateEllipseEntity } from './dxfEllipseTessellate'

export type DxfPoint = { x: number; y: number }

export type DxfPolyline = {
  type: 'POLYLINE'
  layer: string
  vertices: DxfPoint[]
  closed: boolean
}

export type DxfLwPolyline = {
  type: 'LWPOLYLINE'
  layer: string
  vertices: DxfPoint[]
  closed: boolean
}

export type DxfLine = {
  type: 'LINE'
  layer: string
  x1: number
  y1: number
  x2: number
  y2: number
}

export type DxfCircle = {
  type: 'CIRCLE'
  layer: string
  cx: number
  cy: number
  radius: number
}

export type DxfInsert = {
  type: 'INSERT'
  blockName: string
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number
}

/** Kreisbogen als Polylinie (nach Tessellation), für Import wie LWPOLYLINE. */
export type DxfArcPolyline = {
  type: 'ARC_POLYLINE'
  layer: string
  vertices: DxfPoint[]
  closed: boolean
}

export type DxfPointEntity = {
  type: 'POINT'
  layer: string
  x: number
  y: number
  /** ASTM Kerbe: Tiefe (Gruppe 30, mm in Datei-Einheiten). */
  notchDepth?: number
  /** ASTM Kerbe: Breite (Gruppe 39). */
  notchWidth?: number
  /** ASTM Kerbe: Winkel in Grad (Gruppe 50). */
  notchAngle?: number
}

export type DxfEntity =
  | DxfPolyline
  | DxfLwPolyline
  | DxfLine
  | DxfCircle
  | DxfInsert
  | DxfArcPolyline
  | DxfPointEntity

export type DxfBlock = {
  name: string
  entities: DxfEntity[]
}

export type ParsedDxf = {
  insUnits: number // 4=cm, 5=mm
  entities: DxfEntity[]
  blocks: Map<string, DxfBlock>
}

/**
 * Liest Gruppen (code, value) aus DXF-Text.
 * Robust gegen Leerzeilen zwischen Code und Wert sowie einzelne Störzeilen.
 */
export function readGroups(text: string): Array<{ code: number; value: string }> {
  const raw = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  const groups: Array<{ code: number; value: string }> = []
  let i = 0
  while (i < raw.length) {
    const line = raw[i].trim()
    if (line === '') {
      i++
      continue
    }
    const code = parseInt(line, 10)
    if (Number.isNaN(code)) {
      i++
      continue
    }
    i++
    while (i < raw.length && raw[i].trim() === '') i++
    if (i >= raw.length) break
    const value = raw[i].trim()
    i++
    groups.push({ code, value })
  }
  return groups
}

function normSecName(v: string): string {
  return v.trim().toUpperCase()
}

function normEntityName(v: string): string {
  return v.trim().toUpperCase()
}

function nextEntityIndex(groups: Array<{ code: number; value: string }>, start: number): number {
  for (let j = start + 1; j < groups.length; j++) {
    if (groups[j].code === 0 && groups[j].value !== '') return j
  }
  return groups.length
}

function getValue(groups: Array<{ code: number; value: string }>, code: number): string | undefined {
  const g = groups.find((x) => x.code === code)
  return g?.value
}

function getNum(groups: Array<{ code: number; value: string }>, code: number): number | undefined {
  const v = getValue(groups, code)
  if (v == null) return undefined
  const n = parseFloat(v)
  return Number.isNaN(n) ? undefined : n
}

/** Startindizes aller SECTION … mit gegebenem Namen (code 2). */
function findSectionStarts(groups: Array<{ code: number; value: string }>, sectionName: string): number[] {
  const want = normSecName(sectionName)
  const starts: number[] = []
  for (let i = 0; i < groups.length - 1; i++) {
    if (
      groups[i].code === 0 &&
      normSecName(groups[i].value) === 'SECTION' &&
      groups[i + 1].code === 2 &&
      normSecName(groups[i + 1].value) === want
    ) {
      starts.push(i)
    }
  }
  return starts
}

/**
 * Parst DXF R12 ASCII zu strukturierten Daten.
 * BLOCKS werden immer vor ENTITIES ausgewertet (auch wenn ENTITIES in der Datei zuerst steht).
 */
export function parseDxf(text: string): ParsedDxf {
  const groups = readGroups(text)

  let insUnits = 5
  for (const hs of findSectionStarts(groups, 'HEADER')) {
    const headerEnd = groups.findIndex((x, j) => j > hs && x.code === 0 && normSecName(x.value) === 'ENDSEC')
    const headerGroups = headerEnd >= 0 ? groups.slice(hs, headerEnd) : []
    const ui = headerGroups.findIndex((x) => x.code === 9 && x.value === '$INSUNITS')
    if (ui >= 0 && ui + 1 < headerGroups.length && headerGroups[ui + 1].code === 70) {
      const v = parseInt(headerGroups[ui + 1].value, 10)
      if (!Number.isNaN(v)) insUnits = v
    }
  }

  const blocks = new Map<string, DxfBlock>()
  for (const bs of findSectionStarts(groups, 'BLOCKS')) {
    const blks = parseBlocksSection(groups, bs)
    for (const b of blks.blocks) blocks.set(b.name, b)
  }

  const entities: DxfEntity[] = []
  for (const es of findSectionStarts(groups, 'ENTITIES')) {
    const ents = parseEntitiesSection(groups, es)
    entities.push(...ents.list)
  }

  return { insUnits, entities, blocks }
}

/** Parst ENTITIES-Sektion. */
function parseEntitiesSection(
  groups: Array<{ code: number; value: string }>,
  start: number
): { list: DxfEntity[]; nextIndex: number } {
  const list: DxfEntity[] = []
  let i = start
  const endSecIdx = groups.findIndex((x, j) => j > start && x.code === 0 && normSecName(x.value) === 'ENDSEC')
  const limit = endSecIdx >= 0 ? endSecIdx : groups.length

  while (i < limit) {
    const g = groups[i]
    if (g.code === 0) {
      const ev = normEntityName(g.value)
      if (ev === 'POLYLINE') {
        const result = parsePolyline(groups, i)
        if (result.entity) list.push(result.entity)
        i = result.nextIndex
        continue
      }
      if (ev === 'LWPOLYLINE') {
        const result = parseLwPolyline(groups, i)
        if (result.entity) list.push(result.entity)
        i = result.nextIndex
        continue
      }
      if (ev === 'LINE') {
        const slice = groups.slice(i)
        const layer = getValue(slice, 8) ?? '0'
        const x1 = getNum(slice, 10) ?? 0
        const y1 = getNum(slice, 20) ?? 0
        const x2 = getNum(slice, 11) ?? 0
        const y2 = getNum(slice, 21) ?? 0
        list.push({ type: 'LINE', layer, x1, y1, x2, y2 })
        i = nextEntityIndex(groups, i)
        continue
      }
      if (ev === 'CIRCLE') {
        const slice = groups.slice(i)
        const layer = getValue(slice, 8) ?? '0'
        const cx = getNum(slice, 10) ?? 0
        const cy = getNum(slice, 20) ?? 0
        const radius = getNum(slice, 40) ?? 0
        list.push({ type: 'CIRCLE', layer, cx, cy, radius })
        i = nextEntityIndex(groups, i)
        continue
      }
      if (ev === 'POINT') {
        const slice = groups.slice(i)
        const layer = getValue(slice, 8) ?? '0'
        const x = getNum(slice, 10) ?? 0
        const y = getNum(slice, 20) ?? 0
        const z30 = getNum(slice, 30)
        const w39 = getNum(slice, 39)
        const a50 = getNum(slice, 50)
        const ent: DxfPointEntity = { type: 'POINT', layer, x, y }
        if (z30 != null && Number.isFinite(z30)) ent.notchDepth = z30
        if (w39 != null && Number.isFinite(w39)) ent.notchWidth = w39
        if (a50 != null && Number.isFinite(a50)) ent.notchAngle = a50
        list.push(ent)
        i = nextEntityIndex(groups, i)
        continue
      }
      if (ev === 'INSERT') {
        const slice = groups.slice(i)
        const blockName = getValue(slice, 2) ?? ''
        const x = getNum(slice, 10) ?? 0
        const y = getNum(slice, 20) ?? 0
        const scaleX = getNum(slice, 41) ?? 1
        const scaleY = getNum(slice, 42) ?? 1
        const rotation = getNum(slice, 50) ?? 0
        list.push({ type: 'INSERT', blockName, x, y, scaleX, scaleY, rotation })
        i = nextEntityIndex(groups, i)
        continue
      }
      if (ev === 'ARC') {
        const slice = groups.slice(i)
        const layer = getValue(slice, 8) ?? '0'
        const cx = getNum(slice, 10) ?? 0
        const cy = getNum(slice, 20) ?? 0
        const radius = getNum(slice, 40) ?? 0
        const a0 = getNum(slice, 50) ?? 0
        const a1 = getNum(slice, 51) ?? 0
        const verts = tessellateArcEntity(cx, cy, radius, a0, a1)
        if (verts.length >= 2) {
          list.push({ type: 'ARC_POLYLINE', layer, vertices: verts, closed: false })
        }
        i = nextEntityIndex(groups, i)
        continue
      }
      if (ev === 'ELLIPSE') {
        const result = parseEllipseEntity(groups, i)
        if (result.entity) list.push(result.entity)
        i = result.nextIndex
        continue
      }
      if (ev === 'SPLINE') {
        const result = parseSplineEntity(groups, i)
        if (result.entity) list.push(result.entity)
        i = result.nextIndex
        continue
      }
    }
    i++
  }

  return { list, nextIndex: limit + 1 }
}

/** Parst POLYLINE + VERTEX + SEQEND. */
function parsePolyline(
  groups: Array<{ code: number; value: string }>,
  start: number
): { entity: DxfPolyline | null; nextIndex: number } {
  const slice = groups.slice(start)
  const layer = getValue(slice, 8) ?? '0'
  const flag70 = getNum(slice, 70) ?? 0
  const closed = (flag70 & 1) !== 0

  const rawVerts: VertexWithBulge[] = []
  let idx = 0
  while (idx < slice.length) {
    const g = slice[idx]
    if (g.code === 0 && normEntityName(g.value) === 'VERTEX') {
      const vSlice = slice.slice(idx)
      const x = getNum(vSlice, 10)
      const y = getNum(vSlice, 20)
      const bulge = getNum(vSlice, 42) ?? 0
      if (x != null && y != null) {
        rawVerts.push({ x, y, bulge })
      }
      idx++
      continue
    }
    if (g.code === 0 && normEntityName(g.value) === 'SEQEND') {
      break
    }
    idx++
  }

  const seqendIdx = slice.findIndex((x) => x.code === 0 && normEntityName(x.value) === 'SEQEND')
  const nextIndex = seqendIdx >= 0 ? start + seqendIdx + 1 : start + slice.length

  const vertices =
    rawVerts.length > 0 && rawVerts.some((v) => Math.abs(v.bulge) > 1e-10)
      ? expandLwPolylineWithBulge(rawVerts, closed)
      : rawVerts.map((v) => ({ x: v.x, y: v.y }))

  if (vertices.length < 2) return { entity: null, nextIndex }

  return {
    entity: { type: 'POLYLINE', layer, vertices, closed },
    nextIndex,
  }
}

/** Parst LWPOLYLINE (Vertices als 10/x, 20/y Paare). */
function parseLwPolyline(
  groups: Array<{ code: number; value: string }>,
  start: number
): { entity: DxfLwPolyline | null; nextIndex: number } {
  const slice = groups.slice(start)
  const layer = getValue(slice, 8) ?? '0'
  const flag70 = getNum(slice, 70) ?? 0
  const closed = (flag70 & 1) !== 0

  const rawVerts: VertexWithBulge[] = []
  let pendingX: number | null = null
  for (let idx = 0; idx < slice.length; idx++) {
    const g = slice[idx]
    if (g.code === 10) {
      const x = parseFloat(g.value)
      if (!Number.isNaN(x)) pendingX = x
      continue
    }
    if (g.code === 20 && pendingX != null) {
      const y = parseFloat(g.value)
      let bulge = 0
      if (idx + 1 < slice.length && slice[idx + 1].code === 42) {
        bulge = parseFloat(slice[idx + 1].value)
        if (Number.isNaN(bulge)) bulge = 0
        idx++
      }
      rawVerts.push({ x: pendingX, y: Number.isNaN(y) ? 0 : y, bulge })
      pendingX = null
      continue
    }
    if (g.code === 0 && idx > 0) break
  }

  const nextEntityIdx = slice.findIndex((x, j) => {
    if (j <= 0 || x.code !== 0) return false
    const ev = normEntityName(x.value)
    return (
      [
        'LINE',
        'CIRCLE',
        'POINT',
        'POLYLINE',
        'LWPOLYLINE',
        'INSERT',
        'ARC',
        'ELLIPSE',
        'SPLINE',
        'ENDSEC',
      ].includes(ev) || ev === 'SEQEND'
    )
  })
  const nextIndex = nextEntityIdx >= 0 ? start + nextEntityIdx : start + slice.length

  const vertices =
    rawVerts.length > 0 && rawVerts.some((v) => Math.abs(v.bulge) > 1e-10)
      ? expandLwPolylineWithBulge(rawVerts, closed)
      : rawVerts.map((v) => ({ x: v.x, y: v.y }))

  if (vertices.length < 2) return { entity: null, nextIndex }

  return {
    entity: { type: 'LWPOLYLINE', layer, vertices, closed },
    nextIndex,
  }
}

/** Parst BLOCKS-Sektion. */
function parseBlocksSection(
  groups: Array<{ code: number; value: string }>,
  start: number
): { blocks: DxfBlock[]; nextIndex: number } {
  const blocks: DxfBlock[] = []
  const endSecIdx = groups.findIndex((x, j) => j > start && x.code === 0 && normSecName(x.value) === 'ENDSEC')
  const limit = endSecIdx >= 0 ? endSecIdx : groups.length

  let i = start
  while (i < limit) {
    const g = groups[i]
    if (g.code === 0 && normEntityName(g.value) === 'BLOCK') {
      const blkSlice = groups.slice(i)
      const name = getValue(blkSlice, 2)
      if (!name || name === '*MODEL_SPACE' || name === '*PAPER_SPACE') {
        i++
        continue
      }
      const endblkIdx = groups.findIndex((x, j) => j > i && x.code === 0 && normEntityName(x.value) === 'ENDBLK')
      const blockRange = endblkIdx >= 0 ? groups.slice(i + 1, endblkIdx) : []
      const entities = parseEntitiesFromSlice(blockRange)
      blocks.push({ name, entities })
      i = endblkIdx >= 0 ? endblkIdx + 1 : limit
      continue
    }
    i++
  }

  return { blocks, nextIndex: limit + 1 }
}

function parseEllipseEntity(
  groups: Array<{ code: number; value: string }>,
  start: number
): { entity: DxfArcPolyline | null; nextIndex: number } {
  const nextIndex = nextEntityIndex(groups, start)
  const slice = groups.slice(start, nextIndex)
  const layer = getValue(slice, 8) ?? '0'
  const cx = getNum(slice, 10) ?? 0
  const cy = getNum(slice, 20) ?? 0
  const mx = getNum(slice, 11) ?? 0
  const my = getNum(slice, 21) ?? 0
  const ratio = getNum(slice, 40) ?? 1
  const p41 = getNum(slice, 41)
  const p42 = getNum(slice, 42)
  const verts = tessellateEllipseEntity(cx, cy, mx, my, ratio, p41 ?? null, p42 ?? null)
  if (verts.length < 2) return { entity: null, nextIndex }
  return {
    entity: { type: 'ARC_POLYLINE', layer, vertices: verts, closed: false },
    nextIndex,
  }
}

function parseSplineEntity(
  groups: Array<{ code: number; value: string }>,
  start: number
): { entity: DxfArcPolyline | null; nextIndex: number } {
  const nextIndex = nextEntityIndex(groups, start)
  const slice = groups.slice(start, nextIndex)
  const layer = getValue(slice, 8) ?? '0'
  const pts: DxfPoint[] = []
  let j = 0
  while (j < slice.length) {
    if (slice[j].code === 10) {
      const x = parseFloat(slice[j].value)
      j++
      while (j < slice.length && slice[j].code !== 20 && slice[j].code !== 0) j++
      if (j < slice.length && slice[j].code === 20) {
        const y = parseFloat(slice[j].value)
        if (!Number.isNaN(x) && !Number.isNaN(y)) pts.push({ x, y })
      }
      j++
      continue
    }
    j++
  }
  if (pts.length < 2) return { entity: null, nextIndex }
  let closed = false
  if (pts.length >= 3) {
    const a = pts[0]
    const b = pts[pts.length - 1]
    closed = Math.hypot(a.x - b.x, a.y - b.y) < 0.02
  }
  return {
    entity: { type: 'ARC_POLYLINE', layer, vertices: pts, closed },
    nextIndex,
  }
}

/** Parst Entities aus einer Gruppenscheibe (z.B. innerhalb eines Blocks). */
function parseEntitiesFromSlice(groups: Array<{ code: number; value: string }>): DxfEntity[] {
  const list: DxfEntity[] = []
  let i = 0
  while (i < groups.length) {
    const g = groups[i]
    if (g.code === 0) {
      const ev = normEntityName(g.value)
      if (ev === 'POLYLINE') {
        const result = parsePolyline(groups, i)
        if (result.entity) list.push(result.entity)
        i = result.nextIndex
        continue
      }
      if (ev === 'LWPOLYLINE') {
        const result = parseLwPolyline(groups, i)
        if (result.entity) list.push(result.entity)
        i = result.nextIndex
        continue
      }
      if (ev === 'LINE') {
        const slice = groups.slice(i)
        const layer = getValue(slice, 8) ?? '0'
        const x1 = getNum(slice, 10) ?? 0
        const y1 = getNum(slice, 20) ?? 0
        const x2 = getNum(slice, 11) ?? 0
        const y2 = getNum(slice, 21) ?? 0
        list.push({ type: 'LINE', layer, x1, y1, x2, y2 })
        i = nextEntityIndex(groups, i)
        continue
      }
      if (ev === 'CIRCLE') {
        const slice = groups.slice(i)
        const layer = getValue(slice, 8) ?? '0'
        const cx = getNum(slice, 10) ?? 0
        const cy = getNum(slice, 20) ?? 0
        const radius = getNum(slice, 40) ?? 0
        list.push({ type: 'CIRCLE', layer, cx, cy, radius })
        i = nextEntityIndex(groups, i)
        continue
      }
      if (ev === 'POINT') {
        const slice = groups.slice(i)
        const layer = getValue(slice, 8) ?? '0'
        const x = getNum(slice, 10) ?? 0
        const y = getNum(slice, 20) ?? 0
        const z30 = getNum(slice, 30)
        const w39 = getNum(slice, 39)
        const a50 = getNum(slice, 50)
        const ent: DxfPointEntity = { type: 'POINT', layer, x, y }
        if (z30 != null && Number.isFinite(z30)) ent.notchDepth = z30
        if (w39 != null && Number.isFinite(w39)) ent.notchWidth = w39
        if (a50 != null && Number.isFinite(a50)) ent.notchAngle = a50
        list.push(ent)
        i = nextEntityIndex(groups, i)
        continue
      }
      if (ev === 'ARC') {
        const slice = groups.slice(i)
        const layer = getValue(slice, 8) ?? '0'
        const cx = getNum(slice, 10) ?? 0
        const cy = getNum(slice, 20) ?? 0
        const radius = getNum(slice, 40) ?? 0
        const a0 = getNum(slice, 50) ?? 0
        const a1 = getNum(slice, 51) ?? 0
        const verts = tessellateArcEntity(cx, cy, radius, a0, a1)
        if (verts.length >= 2) {
          list.push({ type: 'ARC_POLYLINE', layer, vertices: verts, closed: false })
        }
        i = nextEntityIndex(groups, i)
        continue
      }
      if (ev === 'ELLIPSE') {
        const result = parseEllipseEntity(groups, i)
        if (result.entity) list.push(result.entity)
        i = result.nextIndex
        continue
      }
      if (ev === 'SPLINE') {
        const result = parseSplineEntity(groups, i)
        if (result.entity) list.push(result.entity)
        i = result.nextIndex
        continue
      }
    }
    i++
  }
  return list
}

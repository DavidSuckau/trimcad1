/**
 * Minimal DXF R12 ASCII Parser – TrimTex DXF-Import.
 * Parst HEADER, ENTITIES (POLYLINE, VERTEX, LWPOLYLINE, LINE, CIRCLE),
 * optional BLOCKS und INSERT.
 *
 * Spezifikation: docs/DXF-MASTER-SPEZIFIKATION.txt
 */

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

export type DxfEntity = DxfPolyline | DxfLwPolyline | DxfLine | DxfCircle | DxfInsert

export type DxfBlock = {
  name: string
  entities: DxfEntity[]
}

export type ParsedDxf = {
  insUnits: number // 4=cm, 5=mm
  entities: DxfEntity[]
  blocks: Map<string, DxfBlock>
}

/** Liest Gruppen (code, value) aus DXF-Text. */
function readGroups(text: string): Array<{ code: number; value: string }> {
  const lines = text.split(/\r?\n/)
  const groups: Array<{ code: number; value: string }> = []
  for (let i = 0; i < lines.length - 1; i += 2) {
    const codeStr = lines[i].trim()
    const value = lines[i + 1] ?? ''
    const code = parseInt(codeStr, 10)
    if (!Number.isNaN(code)) {
      groups.push({ code, value: value.trim() })
    }
  }
  return groups
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

/** Parst DXF R12 ASCII zu strukturierten Daten. */
export function parseDxf(text: string): ParsedDxf {
  const groups = readGroups(text)

  let insUnits = 5 // default mm
  const entities: DxfEntity[] = []
  const blocks = new Map<string, DxfBlock>()

  let i = 0
  while (i < groups.length) {
    const g = groups[i]
    if (g.code === 0 && g.value === 'SECTION') {
      const secName = getValue(groups.slice(i), 2)
      if (secName === 'HEADER') {
        const headerEnd = groups.findIndex((x, j) => j > i && x.code === 0 && x.value === 'ENDSEC')
        const headerGroups = headerEnd >= 0 ? groups.slice(i, headerEnd) : []
        const ui = headerGroups.findIndex((x) => x.code === 9 && x.value === '$INSUNITS')
        if (ui >= 0 && ui + 2 < headerGroups.length && headerGroups[ui + 1].code === 70) {
          const v = parseInt(headerGroups[ui + 2].value, 10)
          if (!Number.isNaN(v)) insUnits = v
        }
        i = headerEnd >= 0 ? headerEnd + 1 : groups.length
        continue
      }
      if (secName === 'ENTITIES') {
        const ents = parseEntitiesSection(groups, i)
        entities.push(...ents.list)
        i = ents.nextIndex
        continue
      }
      if (secName === 'BLOCKS') {
        const blks = parseBlocksSection(groups, i)
        for (const b of blks.blocks) blocks.set(b.name, b)
        i = blks.nextIndex
        continue
      }
    }
    i++
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
  const endSecIdx = groups.findIndex((x, j) => j > start && x.code === 0 && x.value === 'ENDSEC')
  const limit = endSecIdx >= 0 ? endSecIdx : groups.length

  while (i < limit) {
    const g = groups[i]
    if (g.code === 0) {
      if (g.value === 'POLYLINE') {
        const result = parsePolyline(groups, i)
        if (result.entity) list.push(result.entity)
        i = result.nextIndex
        continue
      }
      if (g.value === 'LWPOLYLINE') {
        const result = parseLwPolyline(groups, i)
        if (result.entity) list.push(result.entity)
        i = result.nextIndex
        continue
      }
      if (g.value === 'LINE') {
        const slice = groups.slice(i)
        const layer = getValue(slice, 8) ?? '0'
        const x1 = getNum(slice, 10) ?? 0
        const y1 = getNum(slice, 20) ?? 0
        const x2 = getNum(slice, 11) ?? 0
        const y2 = getNum(slice, 21) ?? 0
        list.push({ type: 'LINE', layer, x1, y1, x2, y2 })
        i++
        continue
      }
      if (g.value === 'CIRCLE') {
        const slice = groups.slice(i)
        const layer = getValue(slice, 8) ?? '0'
        const cx = getNum(slice, 10) ?? 0
        const cy = getNum(slice, 20) ?? 0
        const radius = getNum(slice, 40) ?? 0
        list.push({ type: 'CIRCLE', layer, cx, cy, radius })
        i++
        continue
      }
      if (g.value === 'INSERT') {
        const slice = groups.slice(i)
        const blockName = getValue(slice, 2) ?? ''
        const x = getNum(slice, 10) ?? 0
        const y = getNum(slice, 20) ?? 0
        const scaleX = getNum(slice, 41) ?? 1
        const scaleY = getNum(slice, 42) ?? 1
        const rotation = getNum(slice, 50) ?? 0
        list.push({ type: 'INSERT', blockName, x, y, scaleX, scaleY, rotation })
        i++
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
  const closed = flag70 === 1

  const vertices: DxfPoint[] = []
  let idx = 0
  while (idx < slice.length) {
    const g = slice[idx]
    if (g.code === 0 && g.value === 'VERTEX') {
      const vSlice = slice.slice(idx)
      const x = getNum(vSlice, 10)
      const y = getNum(vSlice, 20)
      if (x != null && y != null) {
        vertices.push({ x, y })
      }
      idx++
      continue
    }
    if (g.code === 0 && g.value === 'SEQEND') {
      break
    }
    idx++
  }

  const seqendIdx = slice.findIndex((x) => x.code === 0 && x.value === 'SEQEND')
  const nextIndex = seqendIdx >= 0 ? start + seqendIdx + 1 : start + slice.length

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

  const vertices: DxfPoint[] = []
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
      vertices.push({ x: pendingX, y: Number.isNaN(y) ? 0 : y })
      pendingX = null
      continue
    }
    if (g.code === 0) break
  }

  const nextEntityIdx = slice.findIndex(
    (x, j) => j > 0 && x.code === 0 && ['LINE', 'CIRCLE', 'POLYLINE', 'LWPOLYLINE', 'INSERT', 'ENDSEC'].includes(x.value)
  )
  const nextIndex = nextEntityIdx >= 0 ? start + nextEntityIdx : start + slice.length

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
  const endSecIdx = groups.findIndex((x, j) => j > start && x.code === 0 && x.value === 'ENDSEC')
  const limit = endSecIdx >= 0 ? endSecIdx : groups.length

  let i = start
  while (i < limit) {
    const g = groups[i]
    if (g.code === 0 && g.value === 'BLOCK') {
      const blkSlice = groups.slice(i)
      const name = getValue(blkSlice, 2)
      if (!name || name === '*MODEL_SPACE' || name === '*PAPER_SPACE') {
        i++
        continue
      }
      const endblkIdx = groups.findIndex((x, j) => j > i && x.code === 0 && x.value === 'ENDBLK')
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

/** Parst Entities aus einer Gruppenscheibe (z.B. innerhalb eines Blocks). */
function parseEntitiesFromSlice(groups: Array<{ code: number; value: string }>): DxfEntity[] {
  const list: DxfEntity[] = []
  let i = 0
  while (i < groups.length) {
    const g = groups[i]
    if (g.code === 0) {
      if (g.value === 'POLYLINE') {
        const result = parsePolyline(groups, i)
        if (result.entity) list.push(result.entity)
        i = result.nextIndex
        continue
      }
      if (g.value === 'LWPOLYLINE') {
        const result = parseLwPolyline(groups, i)
        if (result.entity) list.push(result.entity)
        i = result.nextIndex
        continue
      }
      if (g.value === 'LINE') {
        const slice = groups.slice(i)
        const layer = getValue(slice, 8) ?? '0'
        const x1 = getNum(slice, 10) ?? 0
        const y1 = getNum(slice, 20) ?? 0
        const x2 = getNum(slice, 11) ?? 0
        const y2 = getNum(slice, 21) ?? 0
        list.push({ type: 'LINE', layer, x1, y1, x2, y2 })
        i++
        continue
      }
      if (g.value === 'CIRCLE') {
        const slice = groups.slice(i)
        const layer = getValue(slice, 8) ?? '0'
        const cx = getNum(slice, 10) ?? 0
        const cy = getNum(slice, 20) ?? 0
        const radius = getNum(slice, 40) ?? 0
        list.push({ type: 'CIRCLE', layer, cx, cy, radius })
        i++
        continue
      }
    }
    i++
  }
  return list
}

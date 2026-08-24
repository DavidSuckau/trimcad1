import type { MaterialCatalogFile, MaterialCatalogRow } from './materialCatalogTypes'
import { MATERIAL_CATALOG_STORAGE_KEY, emptyMaterialCatalogFile } from './materialCatalogTypes'

const GRAIN: MaterialCatalogRow['grainDirection'][] = ['kette', 'schuss', 'frei']

function isGrainDirection(v: unknown): v is MaterialCatalogRow['grainDirection'] {
  return typeof v === 'string' && (GRAIN as string[]).includes(v)
}

function normalizeRow(raw: unknown): MaterialCatalogRow | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' && o.id.length > 0 ? o.id : null
  if (!id) return null
  const createdAt = typeof o.createdAt === 'string' && o.createdAt.length > 0 ? o.createdAt : new Date().toISOString()
  const materialNumber =
    typeof o.materialNumber === 'string'
      ? o.materialNumber
      : typeof o.articleNumber === 'string'
        ? o.articleNumber
        : ''
  const supplierSku = typeof o.supplierSku === 'string' ? o.supplierSku : ''
  const description = typeof o.description === 'string' ? o.description : ''
  const supplierName = typeof o.supplierName === 'string' ? o.supplierName : ''
  const category = typeof o.category === 'string' ? o.category : ''
  const thicknessLabel = typeof o.thicknessLabel === 'string' ? o.thicknessLabel : ''
  const storageLocation = typeof o.storageLocation === 'string' ? o.storageLocation : ''
  const grainDirection = isGrainDirection(o.grainDirection) ? o.grainDirection : 'frei'
  let purchasePrice: number | null = null
  if (typeof o.purchasePrice === 'number' && Number.isFinite(o.purchasePrice)) purchasePrice = o.purchasePrice
  else if (o.purchasePrice === null) purchasePrice = null
  const priceBasis: MaterialCatalogRow['priceBasis'] = o.priceBasis === 'lfm' ? 'lfm' : 'm2'
  let rollWidthMm: number | null = null
  if (typeof o.rollWidthMm === 'number' && Number.isFinite(o.rollWidthMm) && o.rollWidthMm > 0) {
    rollWidthMm = o.rollWidthMm
  } else if (o.rollWidthMm === null) rollWidthMm = null
  let quantityOnHand: number | null = null
  if (typeof o.quantityOnHand === 'number' && Number.isFinite(o.quantityOnHand)) quantityOnHand = o.quantityOnHand
  else if (o.quantityOnHand === null) quantityOnHand = null
  const projectName = typeof o.projectName === 'string' ? o.projectName : ''
  return {
    id,
    createdAt,
    materialNumber,
    supplierSku,
    description,
    supplierName,
    purchasePrice,
    priceBasis,
    rollWidthMm,
    category,
    thicknessLabel,
    grainDirection,
    storageLocation,
    quantityOnHand,
    projectName,
  }
}

function parseFile(raw: unknown): MaterialCatalogFile {
  if (!raw || typeof raw !== 'object') return emptyMaterialCatalogFile()
  const o = raw as Record<string, unknown>
  if (o.version !== 1) return emptyMaterialCatalogFile()
  if (!Array.isArray(o.rows)) return { version: 1, rows: [] }
  const rows: MaterialCatalogRow[] = []
  for (const item of o.rows) {
    const row = normalizeRow(item)
    if (row) rows.push(row)
  }
  const projects: string[] = []
  if (Array.isArray(o.projects)) {
    for (const p of o.projects) {
      if (typeof p === 'string' && p.trim()) projects.push(p.trim())
    }
  }
  return { version: 1, rows, ...(projects.length > 0 ? { projects } : {}) }
}

export function loadMaterialCatalog(storage: Pick<Storage, 'getItem'> = localStorage): MaterialCatalogFile {
  try {
    const s = storage.getItem(MATERIAL_CATALOG_STORAGE_KEY)
    if (s == null || s === '') return emptyMaterialCatalogFile()
    return parseFile(JSON.parse(s) as unknown)
  } catch {
    return emptyMaterialCatalogFile()
  }
}

export function saveMaterialCatalog(data: MaterialCatalogFile, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(MATERIAL_CATALOG_STORAGE_KEY, JSON.stringify(data))
  } catch {
    // ignore quota / private mode
  }
}

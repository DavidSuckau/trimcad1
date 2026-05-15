export type GrainDirection = 'kette' | 'schuss' | 'frei'

/** EK-Preis bezieht sich auf m² oder auf Laufmeter (Rolle). */
export type MaterialPriceBasis = 'm2' | 'lfm'

export type MaterialCatalogRow = {
  id: string
  createdAt: string
  materialNumber: string
  supplierSku: string
  description: string
  supplierName: string
  purchasePrice: number | null
  /** EK bezieht sich auf m² oder Laufmeter Rolle (bei lfm Rollenbreite nötig). */
  priceBasis: MaterialPriceBasis
  /** Nutzbreite Rolle in mm (Stoff); bei Preis pro m² optional. */
  rollWidthMm: number | null
  category: string
  thicknessLabel: string
  grainDirection: GrainDirection
  storageLocation: string
  quantityOnHand: number | null
}

export type MaterialCatalogFile = {
  version: 1
  rows: MaterialCatalogRow[]
}

export const MATERIAL_CATALOG_STORAGE_KEY = 'trimtex.materialCatalog.v1'

export function newMaterialCatalogRowId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `mc-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

export function createEmptyMaterialCatalogRow(): MaterialCatalogRow {
  return {
    id: newMaterialCatalogRowId(),
    createdAt: new Date().toISOString(),
    materialNumber: '',
    supplierSku: '',
    description: '',
    supplierName: '',
    purchasePrice: null,
    priceBasis: 'm2',
    rollWidthMm: null,
    category: '',
    thicknessLabel: '',
    grainDirection: 'frei',
    storageLocation: '',
    quantityOnHand: null,
  }
}

export function emptyMaterialCatalogFile(): MaterialCatalogFile {
  return { version: 1, rows: [] }
}

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
  /** Optionales Projekt (Filter/Gruppierung in der Materialdatenbank). */
  projectName: string
}

export type MaterialCatalogFile = {
  version: 1
  rows: MaterialCatalogRow[]
  /** Benannte Projekte (auch ohne Materialzeilen); optional. */
  projects?: string[]
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
    projectName: '',
  }
}

/** Alle Projektnamen aus expliziter Liste und Zeilen (sortiert, eindeutig). */
export function collectMaterialCatalogProjectNames(
  rows: MaterialCatalogRow[],
  explicitProjects?: string[],
): string[] {
  const set = new Set<string>()
  for (const p of explicitProjects ?? []) {
    const t = p.trim()
    if (t) set.add(t)
  }
  for (const r of rows) {
    const t = r.projectName.trim()
    if (t) set.add(t)
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'de'))
}

export function emptyMaterialCatalogFile(): MaterialCatalogFile {
  return { version: 1, rows: [] }
}

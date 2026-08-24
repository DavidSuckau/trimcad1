import { beforeEach, describe, expect, it } from 'vitest'
import { loadMaterialCatalog, saveMaterialCatalog } from './materialCatalogStorage'
import { MATERIAL_CATALOG_STORAGE_KEY } from './materialCatalogTypes'
import type { MaterialCatalogFile } from './materialCatalogTypes'

function makeMemoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
  } as Pick<Storage, 'getItem' | 'setItem'>
}

describe('materialCatalogStorage', () => {
  let storage: Pick<Storage, 'getItem' | 'setItem'>

  beforeEach(() => {
    storage = makeMemoryStorage()
  })

  it('liefert leere Datei wenn Key fehlt', () => {
    expect(loadMaterialCatalog(storage)).toEqual({ version: 1, rows: [] })
  })

  it('liefert leere Datei bei ungültigem JSON', () => {
    storage.setItem(MATERIAL_CATALOG_STORAGE_KEY, '{ not json')
    expect(loadMaterialCatalog(storage)).toEqual({ version: 1, rows: [] })
  })

  it('roundtrip speichern und laden', () => {
    const file: MaterialCatalogFile = {
      version: 1,
      rows: [
        {
          id: 'row-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          materialNumber: 'A-1',
          supplierSku: 'L-99',
          description: 'Baumwolle',
          supplierName: 'Muster AG',
          purchasePrice: 12.5,
          priceBasis: 'm2',
          rollWidthMm: 1500,
          category: 'Webware',
          thicknessLabel: '200 gr',
          grainDirection: 'kette',
          storageLocation: 'Regal A',
          quantityOnHand: 10,
          projectName: 'Sommer 2026',
        },
      ],
      projects: ['Sommer 2026', 'Winter'],
    }
    saveMaterialCatalog(file, storage)
    expect(loadMaterialCatalog(storage)).toEqual(file)
  })

  it('liest legacy articleNumber als materialNumber', () => {
    storage.setItem(
      MATERIAL_CATALOG_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        rows: [
          {
            id: 'x',
            createdAt: '2026-01-01T00:00:00.000Z',
            articleNumber: 'ALT-1',
            supplierSku: '',
            description: '',
            supplierName: '',
            purchasePrice: null,
            category: '',
            thicknessLabel: '',
            grainDirection: 'frei',
            storageLocation: '',
            quantityOnHand: null,
          },
        ],
      }),
    )
    const loaded = loadMaterialCatalog(storage)
    expect(loaded.rows[0]?.materialNumber).toBe('ALT-1')
    expect(loaded.rows[0]?.priceBasis).toBe('m2')
    expect(loaded.rows[0]?.rollWidthMm).toBeNull()
    expect(loaded.rows[0]?.projectName).toBe('')
  })

  it('liest projectName und projects', () => {
    storage.setItem(
      MATERIAL_CATALOG_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        projects: ['Alpha'],
        rows: [
          {
            id: 'x',
            createdAt: '2026-01-01T00:00:00.000Z',
            materialNumber: 'M1',
            supplierSku: '',
            description: '',
            supplierName: '',
            purchasePrice: null,
            priceBasis: 'm2',
            category: '',
            thicknessLabel: '',
            grainDirection: 'frei',
            storageLocation: '',
            quantityOnHand: null,
            projectName: 'Beta',
          },
        ],
      }),
    )
    const loaded = loadMaterialCatalog(storage)
    expect(loaded.projects).toEqual(['Alpha'])
    expect(loaded.rows[0]?.projectName).toBe('Beta')
  })
})

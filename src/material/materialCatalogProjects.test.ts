import { describe, expect, it } from 'vitest'
import { collectMaterialCatalogProjectNames, createEmptyMaterialCatalogRow } from './materialCatalogTypes'

describe('collectMaterialCatalogProjectNames', () => {
  it('sammelt explizite Projekte und Zeilen-Projekte', () => {
    const rows = [
      { ...createEmptyMaterialCatalogRow(), projectName: 'B-Projekt' },
      { ...createEmptyMaterialCatalogRow(), projectName: 'A-Projekt' },
      { ...createEmptyMaterialCatalogRow(), projectName: 'A-Projekt' },
    ]
    expect(collectMaterialCatalogProjectNames(rows, ['Z-Alt'])).toEqual(['A-Projekt', 'B-Projekt', 'Z-Alt'])
  })
})

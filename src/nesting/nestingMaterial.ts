import type { PatternPiece } from '../types/model'
import type { MaterialCatalogRow } from '../material/materialCatalogTypes'
import { materialKeyForBom } from '../bom/pieceBomStats'
import { findCatalogRowByMaterialKey } from '../bom/materialCatalogCost'

export type NestingMaterialOption = {
  materialKey: string
  label: string
  rollWidthMm: number
  grainDirection: MaterialCatalogRow['grainDirection']
  pieceCount: number
}

/** Material-Keys mit Katalogtreffer und gültiger Rollenbreite. */
export function listNestingMaterialOptions(
  pieces: PatternPiece[],
  catalogRows: MaterialCatalogRow[],
): NestingMaterialOption[] {
  const keys = new Set<string>()
  for (const p of pieces) {
    const k = materialKeyForBom(p.material)
    if (k) keys.add(k)
  }
  const out: NestingMaterialOption[] = []
  for (const materialKey of keys) {
    const row = findCatalogRowByMaterialKey(catalogRows, materialKey)
    if (!row?.rollWidthMm || row.rollWidthMm <= 0) continue
    const pieceCount = pieces.filter((p) => materialKeyForBom(p.material) === materialKey).length
    if (pieceCount === 0) continue
    const label = row.description.trim() || row.materialNumber.trim() || materialKey
    out.push({
      materialKey,
      label,
      rollWidthMm: row.rollWidthMm,
      grainDirection: row.grainDirection,
      pieceCount,
    })
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, 'de'))
}

export function piecesForMaterial(pieces: PatternPiece[], materialKey: string): PatternPiece[] {
  return pieces.filter((p) => materialKeyForBom(p.material) === materialKey)
}

export function allowRotate180ForGrain(_grainDirection: MaterialCatalogRow['grainDirection']): boolean {
  return true
}

export function allowMirrorForGrain(grainDirection: MaterialCatalogRow['grainDirection']): boolean {
  return grainDirection === 'frei'
}

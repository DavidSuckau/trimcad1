import type { PatternPiece } from '../types/model'
import { materialKeyForBom } from '../bom/pieceBomStats'

/**
 * Nach Umbenennung der Materialnummer im Katalog: alle Schnittteile mit dem alten Key nachziehen.
 */
export function remapPieceMaterialKey(
  pieces: PatternPiece[],
  oldKey: string,
  newKey: string,
): PatternPiece[] {
  const from = materialKeyForBom(oldKey)
  const to = materialKeyForBom(newKey)
  if (!from || !to || from === to) return pieces
  let changed = false
  const next = pieces.map((p) => {
    if (materialKeyForBom(p.material) !== from) return p
    changed = true
    return { ...p, material: to }
  })
  return changed ? next : pieces
}

import type { ConfiguratorPartId, ConfiguratorPartParams } from './types'

/**
 * Einheitliche Box-Parameter für ein Panel: gemeinsame Maße aus dem Dialog,
 * pro Teil passende widthMm/heightMm (Anzeige + konsistent mit Generator),
 * Offsets bleiben pro Teil im Flat-Layout erhalten.
 */
export function mergeLaserBoxParamsForPart(
  partId: ConfiguratorPartId,
  draft: ConfiguratorPartParams,
  preserveOffsets: { offsetX: number; offsetY: number },
): ConfiguratorPartParams {
  const boxW = Math.max(1, draft.boxWidthMm ?? draft.widthMm)
  const boxL = Math.max(1, draft.boxLengthMm ?? draft.widthMm)
  const boxH = Math.max(1, draft.boxHeightMm ?? draft.heightMm)

  let widthMm = boxW
  let heightMm = boxH
  if (partId === 'left' || partId === 'right') {
    widthMm = boxL
    heightMm = boxH
  } else if (partId === 'bottom') {
    widthMm = boxW
    heightMm = boxL
  }

  return {
    widthMm,
    heightMm,
    offsetX: preserveOffsets.offsetX,
    offsetY: preserveOffsets.offsetY,
    boxWidthMm: boxW,
    boxLengthMm: boxL,
    boxHeightMm: boxH,
    materialThicknessMm: draft.materialThicknessMm ?? 3,
    fingerCount: draft.fingerCount ?? 7,
    kerfMm: draft.kerfMm ?? 0.15,
    fitToleranceMm: draft.fitToleranceMm ?? 0,
    lidType: draft.lidType ?? 'removable',
    materialType: draft.materialType ?? 'wood',
    openTop: draft.openTop ?? false,
    openBottom: draft.openBottom ?? false,
  }
}

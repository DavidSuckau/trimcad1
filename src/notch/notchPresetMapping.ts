import type { NotchType } from '../types/model'
import type { NotchSetting } from '../store/useStore'

/**
 * UI-Preset (Einstellungen) → Modell-Notch (LOP-009).
 * Siehe docs/ENTWICKLER-CODE-REVIEW-UNKLARHEITEN.txt – Mapping-Tabelle.
 */
export function modelNotchFieldsFromPreset(
  p: NotchSetting,
): { type: NotchType; depth: number; width: number } | null {
  if (p.type === 'keine') return null
  return {
    type: p.type === 'kerbe' ? 'v' : 'single',
    depth: Math.max(0.5, p.depthMm || 4),
    width: Math.max(0.5, p.widthMm || 6),
  }
}

export function findMatchingNotchPresetIndex(
  notch: { type: NotchType; depth: number; width?: number },
  settings: NotchSetting[],
): number | null {
  const w = notch.width ?? 6
  for (let i = 0; i < settings.length; i++) {
    const f = modelNotchFieldsFromPreset(settings[i])
    if (!f) continue
    if (
      f.type === notch.type &&
      Math.abs(f.depth - notch.depth) < 0.02 &&
      Math.abs(f.width - w) < 0.02
    ) {
      return i
    }
  }
  return null
}

/** UI- und Arbeitsflächen-Text: 0.75–1.75× (Standard 1). */
export const UI_TEXT_SCALE_MIN = 0.75
export const UI_TEXT_SCALE_MAX = 1.75
export const UI_TEXT_SCALE_DEFAULT = 1

export function clampUiTextScale(v: number): number {
  if (!Number.isFinite(v)) return UI_TEXT_SCALE_DEFAULT
  return Math.min(UI_TEXT_SCALE_MAX, Math.max(UI_TEXT_SCALE_MIN, v))
}

/** SVG-Text auf der Arbeitsfläche (Weltkoordinaten, zoom-unabhängige Lesbarkeit). */
export function canvasTextSize(base: number, scale: number): number {
  return base * clampUiTextScale(scale)
}

/** React-inline fontSize mit px – skaliert über --ui-text-scale auf :root. */
export function uiTextPx(px: number): string {
  return `calc(${px}px * var(--ui-text-scale, 1))`
}

export function applyUiTextScaleToDocument(scale: number): void {
  document.documentElement.style.setProperty('--ui-text-scale', String(clampUiTextScale(scale)))
}

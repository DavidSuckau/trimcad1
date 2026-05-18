import { describe, expect, it } from 'vitest'
import { canvasTextSize, clampUiTextScale, uiTextPx } from './uiTextScale'

describe('uiTextScale', () => {
  it('clampUiTextScale begrenzt auf 0.75–1.75', () => {
    expect(clampUiTextScale(0.5)).toBe(0.75)
    expect(clampUiTextScale(2)).toBe(1.75)
    expect(clampUiTextScale(1.2)).toBe(1.2)
    expect(clampUiTextScale(Number.NaN)).toBe(1)
  })

  it('canvasTextSize skaliert Basiswerte', () => {
    expect(canvasTextSize(10, 1.5)).toBe(15)
  })

  it('uiTextPx erzeugt calc-Ausdruck', () => {
    expect(uiTextPx(13)).toBe('calc(13px * var(--ui-text-scale, 1))')
  })
})

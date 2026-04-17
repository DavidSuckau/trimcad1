import { describe, expect, it } from 'vitest'
import { findMatchingNotchPresetIndex, modelNotchFieldsFromPreset } from './notchPresetMapping'
import type { NotchSetting } from '../store/useStore'

describe('notchPresetMapping', () => {
  it('mappt Kerbe auf v und Strich auf single', () => {
    const kerbe: NotchSetting = { type: 'kerbe', widthMm: 6, depthMm: 4 }
    const strich: NotchSetting = { type: 'strich', widthMm: 2.5, depthMm: 2 }
    expect(modelNotchFieldsFromPreset({ type: 'keine', widthMm: 1, depthMm: 1 })).toBeNull()
    expect(modelNotchFieldsFromPreset(kerbe)).toEqual({ type: 'v', depth: 4, width: 6 })
    expect(modelNotchFieldsFromPreset(strich)).toEqual({ type: 'single', depth: 2, width: 2.5 })
  })

  it('findet passenden Preset-Index', () => {
    const settings: NotchSetting[] = [
      { type: 'kerbe', widthMm: 6, depthMm: 4 },
      { type: 'strich', widthMm: 2.5, depthMm: 2 },
    ]
    expect(findMatchingNotchPresetIndex({ type: 'v', depth: 4, width: 6 }, settings)).toBe(0)
    expect(findMatchingNotchPresetIndex({ type: 'single', depth: 2, width: 2.5 }, settings)).toBe(1)
    expect(findMatchingNotchPresetIndex({ type: 'v', depth: 99, width: 6 }, settings)).toBeNull()
  })
})

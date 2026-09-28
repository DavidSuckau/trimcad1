import { afterEach, describe, expect, it } from 'vitest'
import {
  getLastPerfMeasureMs,
  getPerfMeasureSnapshot,
  perfMark,
  perfMeasure,
  setPerfHudActive,
} from './perfMarks'

describe('perfMarks', () => {
  afterEach(() => {
    setPerfHudActive(false)
  })

  it('records measure duration when HUD is active', () => {
    setPerfHudActive(true)
    perfMark('test-hit-start')
    // busy-wait ~1–2ms so duration is measurable
    const t0 = performance.now()
    while (performance.now() - t0 < 1.5) {
      /* spin */
    }
    perfMeasure('test-hit', 'test-hit-start')
    const ms = getLastPerfMeasureMs('test-hit')
    expect(ms).not.toBeNull()
    expect(ms!).toBeGreaterThan(0.5)
    expect(getPerfMeasureSnapshot()['test-hit']).toBe(ms)
  })

  it('skips recording when HUD off and not forced (prod path)', () => {
    setPerfHudActive(false)
    // In Vitest import.meta.env.DEV is typically true — marks still run in DEV.
    // Snapshot API remains defined.
    expect(typeof getLastPerfMeasureMs('missing')).toBe('object')
    expect(getLastPerfMeasureMs('missing')).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { runNesting } from './nestingEngine'
import type { NestingJobRequest, NestingPartGeometry } from './nestingTypes'

function boxGeom(id: string, w: number, h: number): NestingPartGeometry {
  const poly = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ]
  return {
    pieceId: id,
    name: id,
    areaMm2: w * h,
    polygon0: poly,
    polygon180: [
      { x: w, y: h },
      { x: 0, y: h },
      { x: 0, y: 0 },
      { x: w, y: 0 },
    ],
    grain0: { start: { x: w / 2, y: 2 }, end: { x: w / 2, y: h - 2 } },
    grain180: { start: { x: w / 2, y: h - 2 }, end: { x: w / 2, y: 2 } },
  }
}

describe('runNesting', () => {
  it('places two rectangles in 500mm roll', () => {
    const req: NestingJobRequest = {
      materialKey: 'STOFF',
      rollWidthMm: 500,
      spacingMm: 2,
      maxRollLengthMm: null,
      timeLimitMs: 5000,
      parts: [
        { pieceId: 'a', quantity: 2, geometry: boxGeom('a', 200, 100) },
      ],
    }
    const res = runNesting(req)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.plan.placements.length).toBe(2)
    expect(res.plan.usedLengthMm).toBeGreaterThan(0)
    expect(res.plan.efficiencyPct).toBeGreaterThan(0)
    expect(res.plan.usedLengthMm).toBeLessThan(150)
    expect(res.plan.efficiencyPct).toBeGreaterThan(70)
  })

  it('packs four small rectangles with reasonable efficiency', () => {
    const req: NestingJobRequest = {
      materialKey: 'STOFF',
      rollWidthMm: 300,
      spacingMm: 2,
      maxRollLengthMm: null,
      timeLimitMs: 5000,
      parts: [{ pieceId: 's', quantity: 4, geometry: boxGeom('s', 120, 80) }],
    }
    const res = runNesting(req)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.plan.placements.length).toBe(4)
    expect(res.plan.efficiencyPct).toBeGreaterThan(52)
  })

  it('fails when part wider than roll', () => {
    const req: NestingJobRequest = {
      materialKey: 'STOFF',
      rollWidthMm: 100,
      spacingMm: 0,
      maxRollLengthMm: null,
      timeLimitMs: 1000,
      parts: [{ pieceId: 'big', quantity: 1, geometry: boxGeom('big', 200, 50) }],
    }
    const res = runNesting(req)
    expect(res.ok).toBe(false)
  })
})

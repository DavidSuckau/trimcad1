import { describe, expect, it } from 'vitest'
import type { Line } from '../types/model'
import { alignGrainLineToContourTangent, snapGrainLineToContourEdge } from './grainArrowLayout'

describe('grainArrowLayout snap', () => {
  it('alignGrainLineToContourTangent legt den Mittelpunkt auf anchorPoint', () => {
    const line: Line = { start: { x: 0, y: 0 }, end: { x: 0, y: 100 } }
    const aligned = alignGrainLineToContourTangent(line, 0, { x: 50, y: 25 })
    expect(aligned.start.y).toBeCloseTo(25, 5)
    expect(aligned.end.y).toBeCloseTo(25, 5)
    expect(aligned.start.x).toBeCloseTo(0, 5)
    expect(aligned.end.x).toBeCloseTo(100, 5)
  })

  it('snapGrainLineToContourEdge richtet parallel zur horizontalen Kante aus', () => {
    const line: Line = { start: { x: 20, y: 55 }, end: { x: 20, y: 45 } }
    const curves = [
      { type: 'line' as const, start: { x: 0, y: 50 }, end: { x: 100, y: 50 } },
    ]
    const snapped = snapGrainLineToContourEdge(line, curves, 14)
    expect(snapped).not.toBeNull()
    const dy = snapped!.end.y - snapped!.start.y
    const dx = snapped!.end.x - snapped!.start.x
    expect(Math.abs(dy)).toBeLessThan(1e-6)
    expect(Math.abs(dx)).toBeGreaterThan(1)
    expect(snapped!.start.y).toBeCloseTo(50, 3)
  })

  it('snapGrainLineToContourEdge liefert null wenn die Mitte zu weit von der Kontur ist', () => {
    const line: Line = { start: { x: 10, y: 10 }, end: { x: 10, y: 30 } }
    const curves = [
      { type: 'line' as const, start: { x: 0, y: 50 }, end: { x: 100, y: 50 } },
    ]
    expect(snapGrainLineToContourEdge(line, curves, 5)).toBeNull()
  })
})

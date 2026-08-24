import { describe, expect, it } from 'vitest'
import type { Curve } from '../types/model'
import { clipperOffsetClosedPolygon } from './offset'
import { deriveCutLineFromSeamWithValidation } from './offset'

const bezierSeam: Curve[] = [
  { type: 'bezier', start: { x: 0, y: 0 }, cp1: { x: 30, y: 18 }, cp2: { x: 70, y: -18 }, end: { x: 100, y: 0 } },
  { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 60 } },
  { type: 'line', start: { x: 100, y: 60 }, end: { x: 0, y: 60 } },
  { type: 'line', start: { x: 0, y: 60 }, end: { x: 0, y: 0 } },
]

/** Max. Abweichung von Mittelpunkten von der Sehne (nur Kurvenmitte x∈[20,80]). */
function curveMidsectionMicroJitterMm(curves: Curve[]): number {
  const mids: { x: number; y: number }[] = []
  for (const c of curves) {
    if (c.type !== 'line') continue
    const mid = { x: (c.start.x + c.end.x) / 2, y: (c.start.y + c.end.y) / 2 }
    if (mid.x >= 20 && mid.x <= 80 && mid.y > 2) mids.push(mid)
  }
  mids.sort((a, b) => a.x - b.x)
  let max = 0
  for (let i = 1; i < mids.length - 1; i++) {
    const a = mids[i - 1]!
    const b = mids[i]!
    const c = mids[i + 1]!
    const dx = c.x - a.x
    const dy = c.y - a.y
    const lenSq = dx * dx + dy * dy
    if (lenSq < 1e-12) continue
    const t = ((b.x - a.x) * dx + (b.y - a.y) * dy) / lenSq
    const px = a.x + t * dx
    const py = a.y + t * dy
    max = Math.max(max, Math.hypot(b.x - px, b.y - py))
  }
  return max
}

describe('offset smoothness on Bézier (Clipper2)', () => {
  it('deriveCutLine: wenig Mikro-Zickzack auf Kurven-Außenkante', () => {
    const derived = deriveCutLineFromSeamWithValidation(bezierSeam, 10)
    expect(derived.ok).toBe(true)
    if (!derived.ok) return
    expect(curveMidsectionMicroJitterMm(derived.cutLine)).toBeLessThan(0.12)
    expect(derived.cutLine.length).toBeLessThan(36)
  })

  it('Clipper2-Offset ähnlich glatt wie Clipper1 auf Kurvenmitte', () => {
    const c2 = clipperOffsetClosedPolygon(bezierSeam, 10, {
      joinType: 'miter',
      miterLimit: 3,
      simplifyTolerance: 0,
      offsetEngine: 'clipper2',
    })
    const c1 = clipperOffsetClosedPolygon(bezierSeam, 10, {
      joinType: 'miter',
      miterLimit: 3,
      simplifyTolerance: 0,
      offsetEngine: 'clipper1',
    })
    const j2 = curveMidsectionMicroJitterMm(c2.lineCurves)
    const j1 = curveMidsectionMicroJitterMm(c1.lineCurves)
    expect(j2).toBeLessThan(0.12)
    expect(j2).toBeLessThanOrEqual(j1 * 1.5 + 0.02)
  })
})

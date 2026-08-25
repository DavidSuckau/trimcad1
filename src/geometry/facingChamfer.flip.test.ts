import { describe, expect, it } from 'vitest'
import type { Curve, PatternPiece } from '../types/model'
import { chamferCutLineCornersInSeamAllowance } from './facingChamfer'
import { deriveCutLineForPiece } from './deriveCutLineForPiece'
import { bezierAt } from './curveToPath'
import { nearestCurveIndexAndPoint } from './nearestOnCurve'

function reverseCurves(curves: Curve[]): Curve[] {
  return curves
    .slice()
    .reverse()
    .map((c) =>
      c.type === 'line'
        ? { type: 'line' as const, start: { ...c.end }, end: { ...c.start } }
        : {
            type: 'bezier' as const,
            start: { ...c.end },
            end: { ...c.start },
            cp1: { ...c.cp2 },
            cp2: { ...c.cp1 },
          }
    )
}

function mirrorXCurves(curves: Curve[], cx: number): Curve[] {
  const m = (p: { x: number; y: number }) => ({ x: 2 * cx - p.x, y: p.y })
  return curves.map((c) =>
    c.type === 'line'
      ? { type: 'line' as const, start: m(c.start), end: m(c.end) }
      : {
          type: 'bezier' as const,
          start: m(c.start),
          end: m(c.end),
          cp1: m(c.cp1),
          cp2: m(c.cp2),
        }
  )
}

function midDist(seam: Curve[], cut: Curve[]) {
  return seam.map((c) => {
    const mid =
      c.type === 'line'
        ? { x: (c.start.x + c.end.x) / 2, y: (c.start.y + c.end.y) / 2 }
        : bezierAt(c, 0.5)
    return nearestCurveIndexAndPoint(mid, cut)?.distance ?? NaN
  })
}

function base(cut: Curve[], seam: Curve[]): PatternPiece {
  return {
    id: 'p',
    number: '1',
    name: 't',
    cutLine: cut,
    seamLine: seam,
    seamAllowanceMm: 10,
    notches: [],
    drills: [],
    grainLine: null,
    internalLines: [],
    internalCircles: [],
    layer: 'CUT',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    softVertices: [],
    fillInterior: true,
    material: '',
    bomQuantity: 1,
  }
}

describe('chamfer after mirror / reverse', () => {
  const seam: Curve[] = [
    { type: 'line', start: { x: 10, y: 10 }, end: { x: 90, y: 10 } },
    { type: 'line', start: { x: 90, y: 10 }, end: { x: 90, y: 90 } },
    { type: 'line', start: { x: 90, y: 90 }, end: { x: 10, y: 90 } },
    { type: 'line', start: { x: 10, y: 90 }, end: { x: 10, y: 10 } },
  ]

  it('index-misaligned same-length cut+seam must not kill SA', () => {
    const cut: Curve[] = [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
      { type: 'line', start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
      { type: 'line', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
    ]
    const seamRot = [...seam.slice(1), seam[0]]
    const out = chamferCutLineCornersInSeamAllowance(base(cut, seamRot))
    for (const d of midDist(seamRot, out)) expect(d).toBeGreaterThan(5)
  })

  it('mirrored cut+seam (flip-like) keeps mid-edge SA', () => {
    const cut: Curve[] = [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
      { type: 'line', start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
      { type: 'line', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
    ]
    const cx = 50
    const cutM = mirrorXCurves(cut, cx)
    const seamM = mirrorXCurves(seam, cx)
    const out = chamferCutLineCornersInSeamAllowance(base(cutM, seamM))
    for (const d of midDist(seamM, out)) expect(d).toBeGreaterThan(5)
  })

  it('reversed winding after mirror keeps SA', () => {
    const cut: Curve[] = [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
      { type: 'line', start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
      { type: 'line', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
    ]
    const cx = 50
    const cutM = reverseCurves(mirrorXCurves(cut, cx))
    const seamM = reverseCurves(mirrorXCurves(seam, cx))
    const out = chamferCutLineCornersInSeamAllowance(base(cutM, seamM))
    for (const d of midDist(seamM, out)) expect(d).toBeGreaterThan(5)
  })

  it('Clipper-Offset + Flip: Kanten-NZ bleibt nach Chamfer', () => {
    const draft = base([], seam)
    const derived = deriveCutLineForPiece(draft, seam, 10)
    expect(derived.ok).toBe(true)
    if (!derived.ok) return
    const cx = 50
    const seamM = mirrorXCurves(seam, cx)
    const cutM = mirrorXCurves(derived.cutLine, cx)
    const out = chamferCutLineCornersInSeamAllowance(base(cutM, seamM))
    for (const d of midDist(seamM, out)) expect(d).toBeGreaterThan(6)
  })

  it('große NZ / kurze Kante: Kantenmitte behält NZ beim Chamfer', () => {
    const smallSeam: Curve[] = [
      { type: 'line', start: { x: 30, y: 30 }, end: { x: 70, y: 30 } },
      { type: 'line', start: { x: 70, y: 30 }, end: { x: 70, y: 70 } },
      { type: 'line', start: { x: 70, y: 70 }, end: { x: 30, y: 70 } },
      { type: 'line', start: { x: 30, y: 70 }, end: { x: 30, y: 30 } },
    ]
    const draft = base([], smallSeam)
    draft.seamAllowanceMm = 18
    const derived = deriveCutLineForPiece(draft, smallSeam, 18)
    expect(derived.ok).toBe(true)
    if (!derived.ok) return
    const out = chamferCutLineCornersInSeamAllowance({
      ...draft,
      cutLine: derived.cutLine,
      seamLine: smallSeam,
    })
    for (const d of midDist(smallSeam, out)) expect(d).toBeGreaterThan(14)
  })
})

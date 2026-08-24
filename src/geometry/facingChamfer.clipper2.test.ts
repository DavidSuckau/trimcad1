import { describe, expect, it } from 'vitest'
import type { Curve, PatternPiece } from '../types/model'
import { deriveCutLineForPiece } from './deriveCutLineForPiece'
import { buildFacingGeometryFromParent, chamferCollapsesSeamAllowance } from './facingPiece'
import { chamferCutLineCornersInSeamAllowance } from './facingChamfer'
import { interiorAngleAtVertexDegrees } from './softVertexPromotion'

function rectSeam(o: number, s: number): Curve[] {
  return [
    { type: 'line', start: { x: o, y: o }, end: { x: o + s, y: o } },
    { type: 'line', start: { x: o + s, y: o }, end: { x: o + s, y: o + s } },
    { type: 'line', start: { x: o + s, y: o + s }, end: { x: o, y: o + s } },
    { type: 'line', start: { x: o, y: o + s }, end: { x: o, y: o } },
  ]
}

function bezierTopSeam(): Curve[] {
  return [
    { type: 'bezier', start: { x: 0, y: 0 }, cp1: { x: 30, y: 18 }, cp2: { x: 70, y: -18 }, end: { x: 100, y: 0 } },
    { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 60 } },
    { type: 'line', start: { x: 100, y: 60 }, end: { x: 0, y: 60 } },
    { type: 'line', start: { x: 0, y: 60 }, end: { x: 0, y: 0 } },
  ]
}

function parentFromSeam(seam: Curve[], sa: number): PatternPiece {
  const draft: PatternPiece = {
    id: 'p',
    number: '1',
    name: 't',
    cutLine: [],
    seamLine: seam,
    seamAllowanceMm: sa,
    notches: [],
    drills: [],
    grainLine: null,
    internalLines: [],
    internalCircles: [],
    layer: 'CUT',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    softVertices: [],
    softVerticesMaster: [],
    fillInterior: true,
    material: '',
    bomQuantity: 1,
  }
  const derived = deriveCutLineForPiece(draft, seam, sa)
  expect(derived.ok).toBe(true)
  if (!derived.ok) throw new Error('derive failed')
  return { ...draft, cutLine: derived.cutLine }
}

/** Anzahl scharfer Cut-Ecken (≤165° Innenwinkel). */
function sharpCutCornerCount(cut: Curve[]): number {
  let n = 0
  for (let i = 0; i < cut.length; i++) {
    const a = interiorAngleAtVertexDegrees(cut, i)
    if (a != null && a <= 165) n++
  }
  return n
}

describe('Kaschierung: alle Ecken chamfern (Clipper2)', () => {
  it('Rechteck-NZ: 4 Naht-Ecken → 8 Cut-Segmente nach Chamfer', () => {
    const parent = parentFromSeam(rectSeam(10, 80), 10)
    const facing = buildFacingGeometryFromParent(parent)
    expect(facing.cutLine.length).toBe(8)
  })

  it('Bézier-Oben: weiterhin 4 scharfe Cut-Ecken erkennbar', () => {
    const parent = parentFromSeam(bezierTopSeam(), 10)
    expect(sharpCutCornerCount(parent.cutLine)).toBeGreaterThanOrEqual(4)
    const chamfered = chamferCutLineCornersInSeamAllowance(parent)
    // Mehr Segmente als reine 4-Ecken-Box (Kurve tesselliert), aber Chamfer muss greifen
    expect(chamfered.length).toBeGreaterThan(parent.cutLine.length)
  })

  it('buildFacingGeometryFromParent wendet Chamfer an (Bézier)', () => {
    const parent = parentFromSeam(bezierTopSeam(), 10)
    const facing = buildFacingGeometryFromParent(parent)
    const plain = parent.cutLine
    expect(facing.cutLine.length).not.toBe(plain.length)
  })

  it('alle Naht-Ecken chamfern (Bézier, kein SA-Rollback)', () => {
    const parent = parentFromSeam(bezierTopSeam(), 10)
    const facing = buildFacingGeometryFromParent(parent)
    expect(chamferCollapsesSeamAllowance(parent.seamLine, parent.cutLine, facing.cutLine, 10)).toBe(false)
    for (let si = 0; si < parent.seamLine.length; si++) {
      const S = parent.seamLine[si]!.start
      const nearChamfer = facing.cutLine.some((c) => {
        if (c.type !== 'line') return false
        const mid = { x: (c.start.x + c.end.x) / 2, y: (c.start.y + c.end.y) / 2 }
        return Math.hypot(mid.x - S.x, mid.y - S.y) < 20
      })
      expect(nearChamfer).toBe(true)
    }
  })
})

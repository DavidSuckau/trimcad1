import { describe, expect, it } from 'vitest'
import type { Curve, PatternPiece } from '../types/model'
import { chamferCutLineCornersInSeamAllowance } from './facingChamfer'
import { curveSegmentArcLength } from './curveToPath'

function square(size: number): Curve[] {
  return [
    { type: 'line', start: { x: 0, y: 0 }, end: { x: size, y: 0 } },
    { type: 'line', start: { x: size, y: 0 }, end: { x: size, y: size } },
    { type: 'line', start: { x: size, y: size }, end: { x: 0, y: size } },
    { type: 'line', start: { x: 0, y: size }, end: { x: 0, y: 0 } },
  ]
}

function basePiece(cutLine: Curve[], seamLine: Curve[], sa: number | null): PatternPiece {
  return {
    id: 'p1',
    number: '001',
    name: 'Test',
    cutLine,
    seamLine,
    seamAllowanceMm: sa,
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

describe('chamferCutLineCornersInSeamAllowance', () => {
  it('ohne NZ bleibt cutLine unverändert (4 Segmente)', () => {
    const cut = square(100)
    const piece = basePiece(cut, [], null)
    const out = chamferCutLineCornersInSeamAllowance(piece)
    expect(out).toHaveLength(4)
  })

  it('Rechteck mit NZ 10 mm: 8 Segmente (4 Kanten + 4 Chamfers), Naht unverändert', () => {
    const seam = square(100)
    // Außenkontur 10 mm größer (vereinfacht als 120er Quadrat)
    const cut = square(120)
    const piece = basePiece(cut, seam, 10)
    const out = chamferCutLineCornersInSeamAllowance(piece)
    expect(out.length).toBe(8)
    // Erste Kante (unten) wurde an beiden Enden um 10 mm gekürzt → Länge 100
    const bottom = out[0]
    expect(bottom.type).toBe('line')
    if (bottom.type === 'line') {
      expect(curveSegmentArcLength(bottom, 0, 1)).toBeCloseTo(100, 0)
    }
    // Erster Chamfer ist eine Diagonale ~14.14 mm
    const chamfer = out[1]
    expect(chamfer.type).toBe('line')
    if (chamfer.type === 'line') {
      expect(curveSegmentArcLength(chamfer, 0, 1)).toBeCloseTo(Math.SQRT2 * 10, 0)
    }
  })

  it('weiche Ecke wird nicht abgeschrägt', () => {
    const cut = square(120)
    const piece = basePiece(cut, square(100), 10)
    piece.softVertices = [0, 1, 2, 3]
    const out = chamferCutLineCornersInSeamAllowance(piece)
    expect(out).toHaveLength(4)
  })

  it('tessellierte Kurve: Zwischenpunkte nicht chamfern, NZ bleibt erhalten', () => {
    // Außenkontur: drei gerade Kanten + eine in viele kurze Segmente zerlegte „Kurve“ (wie Clipper-Offset)
    const seam = square(100)
    const cut: Curve[] = []
    // unten
    cut.push({ type: 'line', start: { x: 0, y: 0 }, end: { x: 120, y: 0 } })
    // rechts
    cut.push({ type: 'line', start: { x: 120, y: 0 }, end: { x: 120, y: 120 } })
    // oben
    cut.push({ type: 'line', start: { x: 120, y: 120 }, end: { x: 0, y: 120 } })
    // links: konvexe Tessellation (ausbauchend), viele fast-kollineare Punkte
    const leftPts: { x: number; y: number }[] = []
    const steps = 12
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const y = 120 - t * 120
      // Ausbauchung nach links (x negativ relativ zu 0)
      const bulge = 15 * Math.sin(Math.PI * t)
      leftPts.push({ x: -bulge, y })
    }
    for (let i = 0; i < leftPts.length - 1; i++) {
      cut.push({ type: 'line', start: { ...leftPts[i] }, end: { ...leftPts[i + 1] } })
    }
    const piece = basePiece(cut, seam, 10)
    const out = chamferCutLineCornersInSeamAllowance(piece)
    // Nur die 4 echten Ecken bekommen Chamfers → +4 Segmente, Tessellationspunkte bleiben
    expect(out.length).toBe(cut.length + 4)
    // Mittelpunkt der tessellierten linken Kante sollte noch deutlich außerhalb der Naht liegen (NZ)
    const midLeft = out.find(
      (c) =>
        c.type === 'line' &&
        Math.abs((c.start.y + c.end.y) / 2 - 60) < 8 &&
        c.start.x < 5 &&
        c.end.x < 5
    )
    expect(midLeft).toBeTruthy()
    if (midLeft && midLeft.type === 'line') {
      expect(Math.min(midLeft.start.x, midLeft.end.x)).toBeLessThan(-5)
    }
  })
})

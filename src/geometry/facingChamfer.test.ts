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
})

import { describe, expect, it } from 'vitest'
import type { PatternPiece } from '../types/model'
import { getRotationUiLayout } from './pieceTransform'

const square100: PatternPiece['cutLine'] = [
  { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
  { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
  { type: 'line', start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
  { type: 'line', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
]

function makePiece(over: Partial<PatternPiece> = {}): PatternPiece {
  return {
    id: 'p1',
    number: '001',
    name: 'Teil',
    cutLine: square100,
    seamLine: [],
    notches: [],
    drills: [],
    grainLine: null,
    internalLines: [],
    internalCircles: [],
    layer: 'CUT',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    material: 'M-1',
    bomQuantity: 1,
    ...over,
  }
}

function isInsideBounds(
  p: { x: number; y: number },
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  pad = 0,
) {
  return (
    p.x >= bounds.minX + pad &&
    p.x <= bounds.maxX - pad &&
    p.y >= bounds.minY + pad &&
    p.y <= bounds.maxY - pad
  )
}

describe('getRotationUiLayout', () => {
  it('legt den Drehgriff bei zentriertem Pivot oberhalb des Pivots innerhalb der BBox', () => {
    const piece = makePiece({
      transform: { x: 0, y: 0, rotation: 0, mirrored: false, pivotLocal: { x: 50, y: 50 } },
    })
    const layout = getRotationUiLayout(piece)
    expect(layout).not.toBeNull()
    const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    expect(isInsideBounds(layout!.handleLocal, bounds)).toBe(true)
    expect(layout!.handleLocal.y).toBeLessThan(layout!.pivot.y)
    expect(layout!.rotationRadius).toBeLessThanOrEqual(50)
  })

  it('hält den Griff innerhalb der BBox, wenn der Pivot nahe der oberen Kante liegt', () => {
    const piece = makePiece({
      transform: { x: 0, y: 0, rotation: 0, mirrored: false, pivotLocal: { x: 50, y: 8 } },
    })
    const layout = getRotationUiLayout(piece)
    expect(layout).not.toBeNull()
    const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    expect(isInsideBounds(layout!.handleLocal, bounds)).toBe(true)
    expect(layout!.rotationRadius).toBeLessThanOrEqual(8)
  })

  it('hält Ring und Griff innerhalb der BBox bei schmalem Rechteck', () => {
    const cutLine: PatternPiece['cutLine'] = [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 200, y: 0 } },
      { type: 'line', start: { x: 200, y: 0 }, end: { x: 200, y: 30 } },
      { type: 'line', start: { x: 200, y: 30 }, end: { x: 0, y: 30 } },
      { type: 'line', start: { x: 0, y: 30 }, end: { x: 0, y: 0 } },
    ]
    const piece = makePiece({
      cutLine,
      transform: { x: 0, y: 0, rotation: 0, mirrored: false, pivotLocal: { x: 100, y: 15 } },
    })
    const layout = getRotationUiLayout(piece)
    expect(layout).not.toBeNull()
    const bounds = { minX: 0, minY: 0, maxX: 200, maxY: 30 }
    expect(isInsideBounds(layout!.handleLocal, bounds)).toBe(true)
    const r = layout!.rotationRadius
    const p = layout!.pivot
    expect(p.x - r).toBeGreaterThanOrEqual(bounds.minX)
    expect(p.x + r).toBeLessThanOrEqual(bounds.maxX)
    expect(p.y - r).toBeGreaterThanOrEqual(bounds.minY)
    expect(p.y + r).toBeLessThanOrEqual(bounds.maxY)
  })
})

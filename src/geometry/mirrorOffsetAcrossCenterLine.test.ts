import { describe, expect, it } from 'vitest'
import type { PatternPiece } from '../types/model'
import { mirrorOffsetAcrossCenterLine, effectiveMirrorCenterLineXMm } from './mirrorPiece'
import { boundsForPieceCutLineWorld } from '../workspace/workspaceOverviewBounds'

function squarePiece(tx: number, ty = 0): PatternPiece {
  return {
    id: 'p1',
    number: '1',
    name: 'Links',
    layer: 'CUT',
    cutLine: [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 80 } },
      { type: 'line', start: { x: 100, y: 80 }, end: { x: 0, y: 80 } },
      { type: 'line', start: { x: 0, y: 80 }, end: { x: 0, y: 0 } },
    ],
    seamLine: [],
    notches: [],
    drills: [],
    grainLine: null,
    internalLines: [],
    internalCircles: [],
    transform: { x: tx, y: ty, rotation: 0, mirrored: false },
    softVertices: [],
    fillInterior: true,
    material: '',
    bomQuantity: 1,
  }
}

describe('mirrorOffsetAcrossCenterLine', () => {
  it('legt Kind spiegelbildlich zur Mittellinie (gleicher Abstand, andere Seite)', () => {
    const parent = squarePiece(-200)
    // Weltmitte Parent: tx + 50 = -150
    const center = 0
    const offset = mirrorOffsetAcrossCenterLine(parent, center)
    const child: PatternPiece = {
      ...parent,
      id: 'c1',
      transform: {
        ...parent.transform,
        x: parent.transform.x + offset.x,
        y: parent.transform.y + offset.y,
      },
    }
    const pb = boundsForPieceCutLineWorld(parent)!
    const cb = boundsForPieceCutLineWorld(child)!
    const parentCx = (pb.minX + pb.maxX) / 2
    const childCx = (cb.minX + cb.maxX) / 2
    expect(parentCx).toBeCloseTo(-150, 5)
    expect(childCx).toBeCloseTo(150, 5)
    expect(Math.abs(childCx - center)).toBeCloseTo(Math.abs(parentCx - center), 5)
  })

  it('bei Parent rechts der Linie landet Kind links', () => {
    const parent = squarePiece(300)
    const center = 100
    const offset = mirrorOffsetAcrossCenterLine(parent, center)
    const childTx = parent.transform.x + offset.x
    // Parent-Weltmitte 350 → Kind-Mitte 2*100-350 = -150 → tx = -150 - 50 = -200
    expect(childTx).toBeCloseTo(-200, 5)
  })

  it('effectiveMirrorCenterLineXMm defaultet auf 0', () => {
    expect(effectiveMirrorCenterLineXMm(undefined)).toBe(0)
    expect(effectiveMirrorCenterLineXMm(null)).toBe(0)
    expect(effectiveMirrorCenterLineXMm(42)).toBe(42)
  })
})

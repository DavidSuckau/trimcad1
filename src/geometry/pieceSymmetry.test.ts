import { describe, expect, it } from 'vitest'
import {
  buildSymmetricContour,
  crossZ,
  mirrorPointAcrossLine,
  symmetryAxisEndpointsFromCurveTangentHit,
  symmetryAxisEndpointsFromInternalCurve,
  symmetryAxisEndpointsFromStraightMasterEdge,
  symmetryAxisFromMasterEdgePick,
} from './pieceSymmetry'
import { enumerateEdges } from './edgeEnumeration'
import type { Curve, PatternPiece } from '../types/model'

const square = (size: number): Curve[] => [
  { type: 'line', start: { x: 0, y: 0 }, end: { x: size, y: 0 } },
  { type: 'line', start: { x: size, y: 0 }, end: { x: size, y: size } },
  { type: 'line', start: { x: size, y: size }, end: { x: 0, y: size } },
  { type: 'line', start: { x: 0, y: size }, end: { x: 0, y: 0 } },
]

function squarePieceMasterCut(size: number): PatternPiece {
  const curves = square(size)
  return {
    id: 'p',
    number: '1',
    name: 't',
    cutLine: curves,
    seamLine: [],
    seamAllowanceMm: null,
    notches: [],
    drills: [],
    grainLine: null,
    internalLines: [],
    internalCircles: [],
    layer: 'CUT',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    softVertices: [],
    softVerticesMaster: [],
  }
}

describe('pieceSymmetry', () => {
  it('symmetryAxisEndpointsFromInternalCurve: Sehne', () => {
    const c: Curve = {
      type: 'bezier',
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
      cp1: { x: 2, y: 8 },
      cp2: { x: 8, y: 8 },
    }
    const { axisA, axisB } = symmetryAxisEndpointsFromInternalCurve(c)
    expect(axisA).toEqual({ x: 0, y: 0 })
    expect(axisB).toEqual({ x: 10, y: 0 })
  })

  it('symmetryAxisEndpointsFromStraightMasterEdge: untere Kante Quadrat', () => {
    const piece = squarePieceMasterCut(100)
    const ax = symmetryAxisEndpointsFromStraightMasterEdge(piece, 0)
    expect(ax).not.toBeNull()
    if (!ax) return
    expect(ax.axisA).toEqual({ x: 0, y: 0 })
    expect(ax.axisB).toEqual({ x: 100, y: 0 })
  })

  it('symmetryAxisEndpointsFromStraightMasterEdge: null bei Bézier-Kante', () => {
    const curves: Curve[] = [
      {
        type: 'bezier',
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 },
        cp1: { x: 2, y: 5 },
        cp2: { x: 8, y: 5 },
      },
      { type: 'line', start: { x: 10, y: 0 }, end: { x: 10, y: 10 } },
      { type: 'line', start: { x: 10, y: 10 }, end: { x: 0, y: 10 } },
      { type: 'line', start: { x: 0, y: 10 }, end: { x: 0, y: 0 } },
    ]
    const piece: PatternPiece = { ...squarePieceMasterCut(1), cutLine: curves, seamLine: [] }
    expect(symmetryAxisEndpointsFromStraightMasterEdge(piece, 0)).toBeNull()
  })

  it('symmetryAxisEndpointsFromCurveTangentHit: horizontale Tangente bei symmetrischer Bézier in t=0.5', () => {
    const curves: Curve[] = [
      {
        type: 'bezier',
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 },
        cp1: { x: 2, y: 5 },
        cp2: { x: 8, y: 5 },
      },
    ]
    const ax = symmetryAxisEndpointsFromCurveTangentHit(curves, 0, 0.5)
    expect(ax).not.toBeNull()
    if (!ax) return
    const dx = ax.axisB.x - ax.axisA.x
    const dy = ax.axisB.y - ax.axisA.y
    expect(Math.abs(dy)).toBeLessThan(1e-6)
    expect(Math.abs(dx)).toBeGreaterThan(1000)
  })

  it('symmetryAxisFromMasterEdgePick: Bézier-Kante nutzt Tangente, nicht null', () => {
    const curves: Curve[] = [
      {
        type: 'bezier',
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 },
        cp1: { x: 2, y: 5 },
        cp2: { x: 8, y: 5 },
      },
      { type: 'line', start: { x: 10, y: 0 }, end: { x: 10, y: 10 } },
      { type: 'line', start: { x: 10, y: 10 }, end: { x: 0, y: 10 } },
      { type: 'line', start: { x: 0, y: 10 }, end: { x: 0, y: 0 } },
    ]
    const piece: PatternPiece = { ...squarePieceMasterCut(1), cutLine: curves, seamLine: [] }
    const edge = enumerateEdges(piece)[0]
    const ax = symmetryAxisFromMasterEdgePick(piece, edge, 0, 0.5)
    expect(ax).not.toBeNull()
  })
  it('mirrorPointAcrossLine: horizontal axis y=50', () => {
    const a = { x: 0, y: 50 }
    const b = { x: 100, y: 50 }
    const p = { x: 30, y: 80 }
    const m = mirrorPointAcrossLine(p, a, b)
    expect(m.x).toBeCloseTo(30, 5)
    expect(m.y).toBeCloseTo(20, 5)
  })

  it('crossZ: left of vector is positive', () => {
    const a = { x: 0, y: 0 }
    const b = { x: 10, y: 0 }
    expect(crossZ(a, b, { x: 5, y: 5 })).toBeGreaterThan(0)
    expect(crossZ(a, b, { x: 5, y: -5 })).toBeLessThan(0)
  })

  it('buildSymmetricContour: Quadrat, vertikale Achse durch Mitte, linke Hälfte behalten', () => {
    const curves = square(100)
    const r = buildSymmetricContour(curves, { x: 50, y: -10 }, { x: 50, y: 110 }, 'left')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const xs = r.curves.flatMap((c) => [c.start.x, c.end.x])
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    expect(minX).toBeCloseTo(0, 0)
    expect(maxX).toBeCloseTo(100, 0)
  })

  it('buildSymmetricContour: identische Achsenpunkte scheitern', () => {
    const curves = square(100)
    const r = buildSymmetricContour(curves, { x: 1, y: 1 }, { x: 1, y: 1 }, 'left')
    expect(r.ok).toBe(false)
  })
})

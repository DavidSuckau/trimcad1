import { describe, expect, it } from 'vitest'
import type { Curve, PatternPiece } from '../types/model'
import { offsetClosedPolygonVariable, deriveCutLineFromSeamWithVariableAllowance, deriveCutLineFromSeamWithValidation } from './offset'
import { signedAreaCurves } from './curveToPath'
import { enumerateEdges, buildCurveIndexAllowanceMap, hasVariableAllowance, remapEdgeSeamAllowances } from './edgeEnumeration'

function square(size: number): Curve[] {
  return [
    { type: 'line', start: { x: 0, y: 0 }, end: { x: size, y: 0 } },
    { type: 'line', start: { x: size, y: 0 }, end: { x: size, y: size } },
    { type: 'line', start: { x: size, y: size }, end: { x: 0, y: size } },
    { type: 'line', start: { x: 0, y: size }, end: { x: 0, y: 0 } },
  ]
}

function makePiece(cutLine: Curve[], overrides?: { seamAllowanceMm?: number; edgeSeamAllowances?: { edgeIndex: number; allowanceMm: number }[] }): PatternPiece {
  return {
    id: 'test',
    number: '001',
    name: 'Test',
    cutLine,
    seamLine: cutLine,
    seamAllowanceMm: overrides?.seamAllowanceMm ?? 10,
    edgeSeamAllowances: overrides?.edgeSeamAllowances,
    notches: [],
    drills: [],
    grainLine: null,
    internalLines: [],
    layer: 'CUT',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    softVertices: [],
    softVerticesMaster: [],
  }
}

describe('enumerateEdges', () => {
  it('enumerates 4 edges for a square (all hard corners)', () => {
    const piece = makePiece(square(100))
    const edges = enumerateEdges(piece)
    expect(edges).toHaveLength(4)
    expect(edges[0].curveIndices).toEqual([0])
    expect(edges[1].curveIndices).toEqual([1])
    expect(edges[2].curveIndices).toEqual([2])
    expect(edges[3].curveIndices).toEqual([3])
  })

  it('groups soft vertices into a single edge', () => {
    const sq = square(100)
    const piece = makePiece(sq)
    piece.softVertices = [1]
    const edges = enumerateEdges(piece)
    expect(edges).toHaveLength(3)
    expect(edges[0].curveIndices).toEqual([0, 1])
    expect(edges[1].curveIndices).toEqual([2])
    expect(edges[2].curveIndices).toEqual([3])
  })
})

describe('hasVariableAllowance', () => {
  it('returns false for no overrides', () => {
    const piece = makePiece(square(100))
    expect(hasVariableAllowance(piece)).toBe(false)
  })

  it('returns false when override matches default', () => {
    const piece = makePiece(square(100), { seamAllowanceMm: 10, edgeSeamAllowances: [{ edgeIndex: 0, allowanceMm: 10 }] })
    expect(hasVariableAllowance(piece)).toBe(false)
  })

  it('returns true when override differs from default', () => {
    const piece = makePiece(square(100), { seamAllowanceMm: 10, edgeSeamAllowances: [{ edgeIndex: 0, allowanceMm: 5 }] })
    expect(hasVariableAllowance(piece)).toBe(true)
  })
})

describe('buildCurveIndexAllowanceMap', () => {
  it('maps all curve indices to default when no overrides', () => {
    const piece = makePiece(square(100))
    const map = buildCurveIndexAllowanceMap(piece)
    expect(map.size).toBe(4)
    for (let i = 0; i < 4; i++) {
      expect(map.get(i)).toBe(10)
    }
  })

  it('respects per-edge overrides', () => {
    const piece = makePiece(square(100), {
      seamAllowanceMm: 10,
      edgeSeamAllowances: [{ edgeIndex: 2, allowanceMm: 0 }],
    })
    const map = buildCurveIndexAllowanceMap(piece)
    expect(map.get(0)).toBe(10)
    expect(map.get(1)).toBe(10)
    expect(map.get(2)).toBe(0)
    expect(map.get(3)).toBe(10)
  })
})

describe('offsetClosedPolygonVariable', () => {
  it('produces a closed polygon for uniform allowance', () => {
    const seamLine = square(100)
    const allowance = new Map<number, number>()
    for (let i = 0; i < 4; i++) allowance.set(i, 10)

    const result = offsetClosedPolygonVariable(seamLine, allowance)
    expect(result.success).toBe(true)
    expect(result.lineCurves.length).toBeGreaterThanOrEqual(4)
    const first = result.lineCurves[0].start
    const last = result.lineCurves[result.lineCurves.length - 1].end
    expect(Math.abs(first.x - last.x)).toBeLessThan(0.01)
    expect(Math.abs(first.y - last.y)).toBeLessThan(0.01)
  })

  it('produces a larger area than the original for positive allowance', () => {
    const seamLine = square(100)
    const allowance = new Map<number, number>()
    for (let i = 0; i < 4; i++) allowance.set(i, 10)

    const result = offsetClosedPolygonVariable(seamLine, allowance)
    expect(result.success).toBe(true)

    const seamArea = Math.abs(signedAreaCurves(seamLine))
    const cutArea = Math.abs(signedAreaCurves(result.lineCurves))
    expect(cutArea).toBeGreaterThan(seamArea)
  })

  it('produces a closed polygon with mixed allowances (10, 10, 0, 10)', () => {
    const seamLine = square(100)
    const allowance = new Map<number, number>()
    allowance.set(0, 10)
    allowance.set(1, 10)
    allowance.set(2, 0)
    allowance.set(3, 10)

    const result = offsetClosedPolygonVariable(seamLine, allowance)
    expect(result.success).toBe(true)
    expect(result.lineCurves.length).toBeGreaterThanOrEqual(4)
    const first = result.lineCurves[0].start
    const last = result.lineCurves[result.lineCurves.length - 1].end
    expect(Math.abs(first.x - last.x)).toBeLessThan(0.01)
    expect(Math.abs(first.y - last.y)).toBeLessThan(0.01)
  })

  it('all-zero allowance returns polygon coincident with seamLine', () => {
    const seamLine = square(100)
    const allowance = new Map<number, number>()
    for (let i = 0; i < 4; i++) allowance.set(i, 0)

    const result = offsetClosedPolygonVariable(seamLine, allowance)
    expect(result.success).toBe(true)
    const seamArea = Math.abs(signedAreaCurves(seamLine))
    const cutArea = Math.abs(signedAreaCurves(result.lineCurves))
    expect(Math.abs(cutArea - seamArea)).toBeLessThan(1)
  })

  it('one-edge-zero: cutLine follows seamLine on that edge', () => {
    const seamLine = square(100)
    const allowance = new Map<number, number>()
    allowance.set(0, 10)
    allowance.set(1, 10)
    allowance.set(2, 0)
    allowance.set(3, 10)

    const result = offsetClosedPolygonVariable(seamLine, allowance)
    expect(result.success).toBe(true)

    // The edge with 0 allowance (top: from (100,100) to (0,100)) should be near y=100
    // while the opposite edge (bottom: from (0,0) to (100,0)) should be offset to y=-10
    const allPts = result.lineCurves.map((c) => c.start)
    const minY = Math.min(...allPts.map((p) => p.y))
    const maxY = Math.max(...allPts.map((p) => p.y))
    expect(minY).toBeLessThan(-5)
    expect(maxY).toBeLessThanOrEqual(115)
  })

  it('handles concave (L-shaped) polygon without self-intersection', () => {
    // L-shape: has a concave corner at (50,50)
    const lShape: Curve[] = [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 50 } },
      { type: 'line', start: { x: 100, y: 50 }, end: { x: 50, y: 50 } },
      { type: 'line', start: { x: 50, y: 50 }, end: { x: 50, y: 100 } },
      { type: 'line', start: { x: 50, y: 100 }, end: { x: 0, y: 100 } },
      { type: 'line', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
    ]
    const allowance = new Map<number, number>()
    for (let i = 0; i < 6; i++) allowance.set(i, 5)

    const result = offsetClosedPolygonVariable(lShape, allowance)
    expect(result.success).toBe(true)
    expect(result.lineCurves.length).toBeGreaterThanOrEqual(6)

    const cutArea = Math.abs(signedAreaCurves(result.lineCurves))
    const seamArea = Math.abs(signedAreaCurves(lShape))
    expect(cutArea).toBeGreaterThan(seamArea)
  })

  it('handles concave polygon with mixed allowances', () => {
    const lShape: Curve[] = [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 50 } },
      { type: 'line', start: { x: 100, y: 50 }, end: { x: 50, y: 50 } },
      { type: 'line', start: { x: 50, y: 50 }, end: { x: 50, y: 100 } },
      { type: 'line', start: { x: 50, y: 100 }, end: { x: 0, y: 100 } },
      { type: 'line', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
    ]
    const allowance = new Map<number, number>()
    allowance.set(0, 10)
    allowance.set(1, 5)
    allowance.set(2, 0)
    allowance.set(3, 0)
    allowance.set(4, 10)
    allowance.set(5, 5)

    const result = offsetClosedPolygonVariable(lShape, allowance)
    expect(result.success).toBe(true)

    const first = result.lineCurves[0].start
    const last = result.lineCurves[result.lineCurves.length - 1].end
    expect(Math.abs(first.x - last.x)).toBeLessThan(0.01)
    expect(Math.abs(first.y - last.y)).toBeLessThan(0.01)
  })
})

describe('deriveCutLineFromSeamWithVariableAllowance', () => {
  it('returns ok: true for a valid square with mixed allowances', () => {
    const seamLine = square(100)
    const allowance = new Map<number, number>()
    allowance.set(0, 10)
    allowance.set(1, 5)
    allowance.set(2, 0)
    allowance.set(3, 15)

    const result = deriveCutLineFromSeamWithVariableAllowance(seamLine, allowance, 15)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.cutLine.length).toBeGreaterThanOrEqual(4)
      const first = result.cutLine[0].start
      const last = result.cutLine[result.cutLine.length - 1].end
      expect(Math.abs(first.x - last.x)).toBeLessThan(0.1)
      expect(Math.abs(first.y - last.y)).toBeLessThan(0.1)
    }
  })

  it('returns ok: false for too-small seamLine', () => {
    const seamLine: Curve[] = [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
      { type: 'line', start: { x: 1, y: 0 }, end: { x: 0, y: 0 } },
    ]
    const allowance = new Map<number, number>()
    allowance.set(0, 10)
    allowance.set(1, 10)

    const result = deriveCutLineFromSeamWithVariableAllowance(seamLine, allowance, 10)
    expect(result.ok).toBe(false)
  })

  it('uniform variable allowance produces comparable result to Clipper', () => {
    const seamLine = square(100)
    const mm = 8
    const allowance = new Map<number, number>()
    for (let i = 0; i < 4; i++) allowance.set(i, mm)

    const variableResult = deriveCutLineFromSeamWithVariableAllowance(seamLine, allowance, mm)
    const uniformResult = deriveCutLineFromSeamWithValidation(seamLine, mm)

    expect(variableResult.ok).toBe(true)
    expect(uniformResult.ok).toBe(true)

    if (variableResult.ok && uniformResult.ok) {
      const varArea = Math.abs(signedAreaCurves(variableResult.cutLine))
      const uniArea = Math.abs(signedAreaCurves(uniformResult.cutLine))
      // Areas should be similar (within 5%)
      expect(Math.abs(varArea - uniArea) / uniArea).toBeLessThan(0.05)
    }
  })
})

describe('remapEdgeSeamAllowances', () => {
  it('preserves allowances when nothing changes', () => {
    const piece = makePiece(square(100), {
      seamAllowanceMm: 10,
      edgeSeamAllowances: [{ edgeIndex: 1, allowanceMm: 5 }],
    })
    const result = remapEdgeSeamAllowances(piece, piece)
    expect(result).toEqual([{ edgeIndex: 1, allowanceMm: 5 }])
  })

  it('preserves allowances when vertex is moved (same topology)', () => {
    const curves = square(100)
    const old = makePiece(curves, {
      seamAllowanceMm: 10,
      edgeSeamAllowances: [{ edgeIndex: 0, allowanceMm: 3 }, { edgeIndex: 2, allowanceMm: 7 }],
    })
    const movedCurves: Curve[] = [
      { type: 'line', start: { x: 5, y: 5 }, end: { x: 100, y: 0 } },
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
      { type: 'line', start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
      { type: 'line', start: { x: 0, y: 100 }, end: { x: 5, y: 5 } },
    ]
    const moved = makePiece(movedCurves, {
      seamAllowanceMm: 10,
      edgeSeamAllowances: old.edgeSeamAllowances,
    })
    const result = remapEdgeSeamAllowances(old, moved)
    expect(result).toEqual([{ edgeIndex: 0, allowanceMm: 3 }, { edgeIndex: 2, allowanceMm: 7 }])
  })

  it('transfers allowance to both halves when edge splits (soft→hard)', () => {
    const curves: Curve[] = [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 50, y: 0 } },
      { type: 'line', start: { x: 50, y: 0 }, end: { x: 100, y: 0 } },
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
      { type: 'line', start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
      { type: 'line', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
    ]
    const old = makePiece(curves, { seamAllowanceMm: 10 })
    old.softVertices = [1]
    old.edgeSeamAllowances = [{ edgeIndex: 0, allowanceMm: 5 }]

    const newPiece = { ...old, softVertices: [] as number[] }

    const result = remapEdgeSeamAllowances(old, newPiece)
    expect(result).toBeDefined()
    const overrideMap = new Map(result!.map((o) => [o.edgeIndex, o.allowanceMm]))
    const newEdges = enumerateEdges(newPiece)
    const edgeForCurve0 = newEdges.find((e) => e.curveIndices.includes(0))
    const edgeForCurve1 = newEdges.find((e) => e.curveIndices.includes(1))
    expect(overrideMap.get(edgeForCurve0!.edgeIndex)).toBe(5)
    expect(overrideMap.get(edgeForCurve1!.edgeIndex)).toBe(5)
  })

  it('merges allowances when edges merge (hard→soft)', () => {
    const curves: Curve[] = [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 50, y: 0 } },
      { type: 'line', start: { x: 50, y: 0 }, end: { x: 100, y: 0 } },
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
      { type: 'line', start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
      { type: 'line', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
    ]
    const old = makePiece(curves, { seamAllowanceMm: 10 })
    old.softVertices = []
    old.edgeSeamAllowances = [
      { edgeIndex: 0, allowanceMm: 5 },
      { edgeIndex: 1, allowanceMm: 5 },
    ]

    const newPiece = { ...old, softVertices: [1] }

    const result = remapEdgeSeamAllowances(old, newPiece)
    expect(result).toBeDefined()
    const overrideMap = new Map(result!.map((o) => [o.edgeIndex, o.allowanceMm]))
    const newEdges = enumerateEdges(newPiece)
    const mergedEdge = newEdges.find((e) => e.curveIndices.includes(0) && e.curveIndices.includes(1))
    expect(mergedEdge).toBeDefined()
    expect(overrideMap.get(mergedEdge!.edgeIndex)).toBe(5)
  })

  it('returns undefined when no overrides exist', () => {
    const piece = makePiece(square(100), { seamAllowanceMm: 10 })
    const result = remapEdgeSeamAllowances(piece, piece)
    expect(result).toBeUndefined()
  })

  it('drops override that matches new default', () => {
    const piece = makePiece(square(100), {
      seamAllowanceMm: 10,
      edgeSeamAllowances: [{ edgeIndex: 1, allowanceMm: 10 }],
    })
    const result = remapEdgeSeamAllowances(piece, piece)
    expect(result).toBeUndefined()
  })

  it('preserves multiple overrides on different edges', () => {
    const piece = makePiece(square(100), {
      seamAllowanceMm: 10,
      edgeSeamAllowances: [
        { edgeIndex: 0, allowanceMm: 3 },
        { edgeIndex: 1, allowanceMm: 0 },
        { edgeIndex: 3, allowanceMm: 15 },
      ],
    })
    const result = remapEdgeSeamAllowances(piece, piece)
    expect(result).toEqual([
      { edgeIndex: 0, allowanceMm: 3 },
      { edgeIndex: 1, allowanceMm: 0 },
      { edgeIndex: 3, allowanceMm: 15 },
    ])
  })
})

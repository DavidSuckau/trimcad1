import { describe, expect, it } from 'vitest'
import type { Curve } from '../types/model'
import type { EnumeratedEdge } from './edgeEnumeration'
import { deltaMinimalDegToHorizontal, masterEdgeIsStraightLine } from './horizontalLevelEdge'

describe('deltaMinimalDegToHorizontal', () => {
  it('0° bleibt 0', () => {
    expect(deltaMinimalDegToHorizontal(0)).toBe(0)
  })
  it('10° → -10°', () => {
    expect(deltaMinimalDegToHorizontal(10)).toBe(-10)
  })
  it('170° → +10° (kurzer Weg zu horizontal)', () => {
    expect(deltaMinimalDegToHorizontal(170)).toBe(10)
  })
  it('-95° → -85° (kürzester Weg zu horizontal)', () => {
    expect(deltaMinimalDegToHorizontal(-95)).toBe(-85)
  })
})

describe('masterEdgeIsStraightLine', () => {
  const line = (x1: number, y1: number, x2: number, y2: number): Curve => ({
    type: 'line',
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
  })

  it('ein Liniensegment', () => {
    const curves: Curve[] = [line(0, 0, 10, 0), line(10, 0, 10, 10), line(10, 10, 0, 10), line(0, 10, 0, 0)]
    const edge: EnumeratedEdge = { edgeIndex: 0, curveIndices: [0], startCornerVi: 0 }
    expect(masterEdgeIsStraightLine(curves, edge)).toBe(true)
  })

  it('lehnt Bézier ab', () => {
    const curves: Curve[] = [
      {
        type: 'bezier',
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 },
        cp1: { x: 3, y: 5 },
        cp2: { x: 7, y: 5 },
      },
    ]
    const edge: EnumeratedEdge = { edgeIndex: 0, curveIndices: [0], startCornerVi: 0 }
    expect(masterEdgeIsStraightLine(curves, edge)).toBe(false)
  })

  it('lehnt Knick (zwei Linien nicht kollinear) ab', () => {
    const curves: Curve[] = [line(0, 0, 5, 0), line(5, 0, 5, 5)]
    const edge: EnumeratedEdge = { edgeIndex: 0, curveIndices: [0, 1], startCornerVi: 0 }
    expect(masterEdgeIsStraightLine(curves, edge)).toBe(false)
  })

  it('zwei kollineare Liniensegmente', () => {
    const curves: Curve[] = [line(0, 0, 5, 0), line(5, 0, 10, 0)]
    const edge: EnumeratedEdge = { edgeIndex: 0, curveIndices: [0, 1], startCornerVi: 0 }
    expect(masterEdgeIsStraightLine(curves, edge)).toBe(true)
  })
})

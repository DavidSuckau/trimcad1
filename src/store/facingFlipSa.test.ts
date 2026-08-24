import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import type { Curve, PatternPiece } from '../types/model'
import { deriveCutLineForPiece } from '../geometry/deriveCutLineForPiece'
import { bezierAt, curvesBounds } from '../geometry/curveToPath'
import { nearestCurveIndexAndPoint } from '../geometry/nearestOnCurve'

/** Abstand Naht-Segmentmitte → Schnittkontur (Mitte der Kante, nicht Ecke). */
function midEdgeSeamToCutDistances(seam: Curve[], cut: Curve[]): number[] {
  return seam.map((c) => {
    const mid =
      c.type === 'line'
        ? { x: (c.start.x + c.end.x) / 2, y: (c.start.y + c.end.y) / 2 }
        : bezierAt(c, 0.5)
    return nearestCurveIndexAndPoint(mid, cut)?.distance ?? NaN
  })
}

describe('facing seam allowance after parent flip', () => {
  beforeEach(() => {
    const seam: Curve[] = [
      { type: 'line', start: { x: 10, y: 10 }, end: { x: 90, y: 10 } },
      { type: 'line', start: { x: 90, y: 10 }, end: { x: 90, y: 90 } },
      { type: 'line', start: { x: 90, y: 90 }, end: { x: 10, y: 90 } },
      {
        type: 'bezier',
        start: { x: 10, y: 90 },
        end: { x: 10, y: 10 },
        cp1: { x: -40, y: 70 },
        cp2: { x: -40, y: 30 },
      },
    ]
    const draft: PatternPiece = {
      id: 'parent',
      number: '001',
      name: 'Vorderteil',
      cutLine: [],
      seamLine: seam,
      seamAllowanceMm: 10,
      notches: [],
      drills: [],
      grainLine: { start: { x: 50, y: 20 }, end: { x: 50, y: 80 } },
      internalLines: [],
      internalCircles: [],
      layer: 'CUT',
      transform: { x: 0, y: 0, rotation: 0, mirrored: false },
      softVertices: [],
      fillInterior: true,
      material: '',
      bomQuantity: 1,
    }
    const derived = deriveCutLineForPiece(draft, seam, 10)
    draft.cutLine = derived.ok ? derived.cutLine : seam
    useStore.setState({
      workspace: {
        id: 'ws',
        name: 'T',
        pieces: [draft],
        view: { zoom: 1, panX: 0, panY: 0 },
        seamAssignments: [],
        notes: [],
        profileAssignments: [],
      },
      selectedPieceIds: [],
      toastMessage: null,
    })
  })

  it('hält Kanten-NZ der Kaschierung nach Flip der Mutter', () => {
    const childId = useStore.getState().createFacingPiece('parent')!
    const before = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    const beforeDists = midEdgeSeamToCutDistances(before.seamLine, before.cutLine)

    useStore.getState().flipPieceAlongGrain('parent')

    const after = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    const afterDists = midEdgeSeamToCutDistances(after.seamLine, after.cutLine)
    const ab = curvesBounds(after.cutLine)!
    const asb = curvesBounds(after.seamLine)!

    expect(ab.minX).toBeLessThan(asb.minX - 3)
    expect(ab.maxX).toBeGreaterThan(asb.maxX + 3)
    expect(ab.minY).toBeLessThan(asb.minY - 3)
    expect(ab.maxY).toBeGreaterThan(asb.maxY + 3)

    for (let i = 0; i < afterDists.length; i++) {
      expect(afterDists[i]).toBeGreaterThan(6)
      expect(Math.abs(afterDists[i] - beforeDists[i])).toBeLessThan(1.5)
    }
  })

  it('hält NZ auch wenn Mutter-cutLine als deviate gespiegelt wurde', () => {
    useStore.setState((s) => ({
      workspace: {
        ...s.workspace,
        pieces: s.workspace.pieces.map((p) =>
          p.id === 'parent' ? { ...p, cutLineDeviatesFromSeamAllowanceOffset: true as const } : p
        ),
      },
    }))
    const childId = useStore.getState().createFacingPiece('parent')!
    useStore.getState().flipPieceAlongGrain('parent')
    const after = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    const dists = midEdgeSeamToCutDistances(after.seamLine, after.cutLine)
    for (const d of dists) expect(d).toBeGreaterThan(6)
  })
})

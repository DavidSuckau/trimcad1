import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import type { Workspace } from '../types/model'
import { edgeTotalLength, resolvedSeamAssignmentCurveIndices } from '../geometry/seamUtils'

function piece(id: string, bottomLen: number) {
  const seam = [
    { type: 'line' as const, start: { x: 0, y: 0 }, end: { x: bottomLen, y: 0 } },
    { type: 'line' as const, start: { x: bottomLen, y: 0 }, end: { x: bottomLen, y: 60 } },
    { type: 'line' as const, start: { x: bottomLen, y: 60 }, end: { x: 0, y: 60 } },
    { type: 'line' as const, start: { x: 0, y: 60 }, end: { x: 0, y: 0 } },
  ]
  return {
    id,
    number: id,
    name: id,
    cutLine: seam,
    seamLine: seam,
    seamAllowanceMm: null,
    notches: [],
    drills: [],
    grainLine: null,
    internalLines: [],
    internalCircles: [],
    layer: 'CUT' as const,
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    softVertices: [],
    fillInterior: true,
    material: '',
    bomQuantity: 1,
  }
}

describe('equalizeSeamAssignmentLength', () => {
  beforeEach(() => {
    const workspace: Workspace = {
      id: 'ws',
      name: 't',
      pieces: [piece('A', 100), piece('B', 100.5)],
      view: { zoom: 1, panX: 0, panY: 0 },
      seamAssignments: [
        {
          id: 's1',
          pieceIdA: 'A',
          pieceIdB: 'B',
          curveIndicesA: [0],
          curveIndicesB: [0],
          clickedCurveA: 0,
          clickedCurveB: 0,
        },
      ],
      profileAssignments: [],
    }
    useStore.setState({ workspace, toastMessage: null, selectedPieceIds: [] })
  })

  it('gleicht kleine Δ (~0.5 mm) per Klick-Aktion auf 0', () => {
    const before = useStore.getState().workspace.pieces
    const a0 = before.find((p) => p.id === 'A')!
    const b0 = before.find((p) => p.id === 'B')!
    const lenA0 = edgeTotalLength(a0, [0])
    const lenB0 = edgeTotalLength(b0, [0])
    expect(Math.abs(lenA0 - lenB0)).toBeGreaterThan(0.4)

    useStore.getState().equalizeSeamAssignmentLength('s1', 'A')

    const after = useStore.getState().workspace.pieces
    const a1 = after.find((p) => p.id === 'A')!
    const b1 = after.find((p) => p.id === 'B')!
    const lenA1 = edgeTotalLength(a1, resolvedSeamAssignmentCurveIndices(a1, [0]))
    const lenB1 = edgeTotalLength(b1, resolvedSeamAssignmentCurveIndices(b1, [0]))
    expect(Math.abs(lenA1 - lenB1)).toBeLessThan(0.05)
    expect(useStore.getState().toastMessage).toMatch(/angeglichen/)
  })
})

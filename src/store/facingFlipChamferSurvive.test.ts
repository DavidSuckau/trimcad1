import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import type { Curve, Workspace } from '../types/model'
import { deriveCutLineForPiece } from '../geometry/deriveCutLineForPiece'

describe('Kaschierung: Fasen nach Flip der Mutter neu erzeugen', () => {
  beforeEach(() => {
    const workspace: Workspace = {
      id: 'ws',
      name: 'T',
      pieces: [],
      view: { zoom: 1, panX: 0, panY: 0 },
      seamAssignments: [],
      notes: [],
      profileAssignments: [],
    }
    useStore.setState({ workspace, selectedPieceIds: [], toastMessage: null })
  })

  function setupRectParentWithFacing() {
    const seam: Curve[] = [
      { type: 'line', start: { x: 10, y: 10 }, end: { x: 90, y: 10 } },
      { type: 'line', start: { x: 90, y: 10 }, end: { x: 90, y: 90 } },
      { type: 'line', start: { x: 90, y: 90 }, end: { x: 10, y: 90 } },
      { type: 'line', start: { x: 10, y: 90 }, end: { x: 10, y: 10 } },
    ]
    const draft = {
      id: 'parent',
      number: '001',
      name: 'Mutter',
      cutLine: [] as Curve[],
      seamLine: seam,
      seamAllowanceMm: 10,
      notches: [],
      drills: [],
      grainLine: { start: { x: 50, y: 20 }, end: { x: 50, y: 80 } },
      internalLines: [],
      internalCircles: [],
      layer: 'CUT' as const,
      transform: { x: 0, y: 0, rotation: 0, mirrored: false },
      softVertices: [],
      softVerticesMaster: [] as number[],
      fillInterior: true,
      material: '',
      bomQuantity: 1,
    }
    const derived0 = deriveCutLineForPiece(draft, seam, 10)
    if (!derived0.ok) throw new Error('derive')
    useStore.setState((s) => ({
      workspace: { ...s.workspace, pieces: [{ ...draft, cutLine: derived0.cutLine }] },
    }))
    return useStore.getState().createFacingPiece('parent')!
  }

  it('flipPieceAlongGrain: Kaschierung behält/erneuert abgeschnittene Ecken', () => {
    const childId = setupRectParentWithFacing()
    const before = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    expect(before.cutLine.length).toBe(8)

    useStore.getState().flipPieceAlongGrain('parent')

    const after = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    const parent = useStore.getState().workspace.pieces.find((p) => p.id === 'parent')!
    const derived = deriveCutLineForPiece(parent, parent.seamLine, 10)
    expect(derived.ok).toBe(true)
    if (!derived.ok) return

    // 4 Fasen → mind. 4 Extra-Segmente gegenüber der abgeleiteten Cut
    expect(after.cutLine.length).toBeGreaterThanOrEqual(8)
    expect(after.cutLine.length - derived.cutLine.length).toBeGreaterThanOrEqual(4)
  })

  it('flipPieceAlongAxis: Kaschierung behält/erneuert abgeschnittene Ecken', () => {
    const childId = setupRectParentWithFacing()
    useStore.getState().flipPieceAlongAxis('parent', { x: 50, y: 0 }, { x: 50, y: 100 })
    const after = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    const parent = useStore.getState().workspace.pieces.find((p) => p.id === 'parent')!
    const derived = deriveCutLineForPiece(parent, parent.seamLine, 10)
    expect(derived.ok).toBe(true)
    if (!derived.ok) return
    expect(after.cutLine.length).toBeGreaterThanOrEqual(8)
    expect(after.cutLine.length - derived.cutLine.length).toBeGreaterThanOrEqual(4)
  })
})

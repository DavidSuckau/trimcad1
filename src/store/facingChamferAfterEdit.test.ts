import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import type { Curve, Workspace } from '../types/model'
import { buildFacingGeometryFromParent, chamferCollapsesSeamAllowance } from '../geometry/facingPiece'
import { deriveCutLineForPiece } from '../geometry/deriveCutLineForPiece'

describe('Kaschierung: Ecken nach Mutter-Edit', () => {
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

  it('Rechteck: Chamfer bleibt nach Vertex-Zug (kein Rollback)', () => {
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
    const derived0 = deriveCutLineForPiece(draft, seam, 10)
    expect(derived0.ok).toBe(true)
    if (!derived0.ok) return
    useStore.setState((s) => ({
      workspace: {
        ...s.workspace,
        pieces: [{ ...draft, cutLine: derived0.cutLine }],
      },
    }))
    const childId = useStore.getState().createFacingPiece('parent')!
    useStore.getState().updateVertex('parent', 0, { x: -15, y: -5 })
    useStore.getState().updateVertex('parent', 2, { x: 110, y: 105 })
    const child = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    const parent = useStore.getState().workspace.pieces.find((p) => p.id === 'parent')!
    expect(child).toBeTruthy()
    const derived1 = deriveCutLineForPiece(parent!, parent!.seamLine, 10)
    expect(derived1.ok).toBe(true)
    if (!derived1.ok) return
    expect(chamferCollapsesSeamAllowance(parent!.seamLine, derived1.cutLine, child!.cutLine, 10)).toBe(false)
    expect(child!.cutLine.length).toBeGreaterThanOrEqual(8)
  })

  it('Bézier-Mutter: Chamfer bleibt nach Vertex-Zug', () => {
    const seam: Curve[] = [
      { type: 'bezier', start: { x: 0, y: 0 }, cp1: { x: 30, y: 18 }, cp2: { x: 70, y: -18 }, end: { x: 100, y: 0 } },
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 60 } },
      { type: 'line', start: { x: 100, y: 60 }, end: { x: 0, y: 60 } },
      { type: 'line', start: { x: 0, y: 60 }, end: { x: 0, y: 0 } },
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
      grainLine: null,
      internalLines: [],
      internalCircles: [],
      layer: 'CUT' as const,
      transform: { x: 0, y: 0, rotation: 0, mirrored: false },
      softVertices: [],
      softVerticesMaster: [],
      fillInterior: true,
      material: '',
      bomQuantity: 1,
    }
    const derived0 = deriveCutLineForPiece(draft, seam, 10)
    expect(derived0.ok).toBe(true)
    if (!derived0.ok) return
    useStore.setState((s) => ({
      workspace: { ...s.workspace, pieces: [{ ...draft, cutLine: derived0.cutLine }] },
    }))
    useStore.getState().createFacingPiece('parent')!
    useStore.getState().updateVertex('parent', 1, { x: 105, y: -3 })
    const parent = useStore.getState().workspace.pieces.find((p) => p.id === 'parent')!
    const rebuilt = buildFacingGeometryFromParent(parent)
    const derived1 = deriveCutLineForPiece(parent, parent.seamLine, 10)
    expect(derived1.ok).toBe(true)
    if (!derived1.ok) return
    expect(chamferCollapsesSeamAllowance(parent.seamLine, derived1.cutLine, rebuilt.cutLine, 10)).toBe(false)
    expect(rebuilt.cutLine).not.toEqual(derived1.cutLine)
  })
})

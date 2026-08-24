import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import type { Curve, Workspace } from '../types/model'
import { buildFacingGeometryFromParent, chamferCollapsesSeamAllowance } from '../geometry/facingPiece'
import { deriveCutLineForPiece } from '../geometry/deriveCutLineForPiece'
import { interiorAngleAtVertexDegrees } from '../geometry/softVertexPromotion'

function sharpCutCornerCount(cut: Curve[]): number {
  let n = 0
  for (let i = 0; i < cut.length; i++) {
    const a = interiorAngleAtVertexDegrees(cut, i)
    if (a != null && a <= 165) n++
  }
  return n
}

describe('Kaschierung: Ecken nach Kurven-Einbau in Mutter', () => {
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

  it('Rechteck: Bézier auf Naht → Kaschierung behält Chamfer ohne Rollback', () => {
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
    const childId = useStore.getState().createFacingPiece('parent')!
    const childBefore = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    expect(childBefore.cutLine.length).toBeGreaterThanOrEqual(8)

    useStore.getState().replaceSegmentWithBezier('parent', 0, { x: 30, y: 25 }, { x: 70, y: -5 })
    const parent = useStore.getState().workspace.pieces.find((p) => p.id === 'parent')!
    const child = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    expect(parent.seamLine[0].type).toBe('bezier')

    const derived1 = deriveCutLineForPiece(parent, parent.seamLine, 10)
    expect(derived1.ok).toBe(true)
    if (!derived1.ok) return

    expect(chamferCollapsesSeamAllowance(parent.seamLine, derived1.cutLine, child.cutLine, 10)).toBe(false)
    expect(child.cutLine.length).toBeGreaterThanOrEqual(8)
    expect(sharpCutCornerCount(child.cutLine)).toBeGreaterThanOrEqual(4)
  })

  it('alle 4 Naht-Ecken bekommen eine Fase (symmetrisch)', () => {
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
      softVerticesMaster: [],
      fillInterior: true,
      material: '',
      bomQuantity: 1,
    }
    const derived0 = deriveCutLineForPiece(draft, seam, 10)
    if (!derived0.ok) throw new Error('derive')
    let parent = { ...draft, cutLine: derived0.cutLine }
    parent = {
      ...parent,
      seamLine: [
        {
          type: 'bezier',
          start: { x: 10, y: 10 },
          end: { x: 90, y: 10 },
          cp1: { x: 30, y: 25 },
          cp2: { x: 70, y: -5 },
        },
        ...seam.slice(1),
      ],
    }
    const derived1 = deriveCutLineForPiece(parent, parent.seamLine, 10)
    if (!derived1.ok) throw new Error('derive2')
    parent = { ...parent, cutLine: derived1.cutLine }
    const facing = buildFacingGeometryFromParent(parent)
    const derivedCut = deriveCutLineForPiece(parent, parent.seamLine, 10)
    if (!derivedCut.ok) throw new Error('derive3')
    expect(chamferCollapsesSeamAllowance(parent.seamLine, derivedCut.cutLine, facing.cutLine, 10)).toBe(false)
    // 4 Naht-Ecken → mindestens 8 Segmente (je Ecke Fase + Flachstück)
    expect(facing.cutLine.length).toBeGreaterThanOrEqual(8)
  })
})

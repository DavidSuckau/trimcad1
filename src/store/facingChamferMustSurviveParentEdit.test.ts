import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import type { Curve, Workspace } from '../types/model'
import { buildFacingGeometryFromParent, chamferCollapsesSeamAllowance } from '../geometry/facingPiece'
import { deriveCutLineForPiece } from '../geometry/deriveCutLineForPiece'
import { interiorAngleAtVertexDegrees } from '../geometry/softVertexPromotion'

function sharpCornerCount(curves: Curve[], maxDeg = 165): number {
  let n = 0
  for (let i = 0; i < curves.length; i++) {
    const a = interiorAngleAtVertexDegrees(curves, i)
    if (a != null && a <= maxDeg) n++
  }
  return n
}

/** Anzahl Fasen ≈ Extra-Segmente gegenüber abgeleiteter Cut (Rechteck: 4 → 8). */
function chamferExtraSegments(facingCutLen: number, derivedCutLen: number): number {
  return facingCutLen - derivedCutLen
}

describe('Kaschierung: Ecken dürfen nach Mutter-Edit nicht verschwinden', () => {
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

  function setupRectParent() {
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
    useStore.setState((s) => ({
      workspace: { ...s.workspace, pieces: [{ ...draft, cutLine: derived0.cutLine }] },
    }))
    const childId = useStore.getState().createFacingPiece('parent')!
    return childId
  }

  it('nach mehreren Vertex-Zügen bleiben 4 Fasen erhalten', () => {
    const childId = setupRectParent()
    const before = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    expect(before.cutLine.length).toBe(8)

    useStore.getState().updateVertex('parent', 0, { x: 0, y: 0 })
    useStore.getState().updateVertex('parent', 1, { x: 100, y: 5 })
    useStore.getState().updateVertex('parent', 2, { x: 95, y: 100 })
    useStore.getState().updateVertex('parent', 3, { x: 5, y: 95 })

    const parent = useStore.getState().workspace.pieces.find((p) => p.id === 'parent')!
    const child = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    const derived = deriveCutLineForPiece(parent, parent.seamLine, 10)
    expect(derived.ok).toBe(true)
    if (!derived.ok) return

    expect(chamferCollapsesSeamAllowance(parent.seamLine, derived.cutLine, child.cutLine, 10)).toBe(false)
    expect(child.cutLine.length).toBeGreaterThanOrEqual(8)
    expect(chamferExtraSegments(child.cutLine.length, derived.cutLine.length)).toBeGreaterThanOrEqual(4)
  })

  it('Punkt einfügen + Ecke ziehen: Fasen bleiben', () => {
    const childId = setupRectParent()
    useStore.getState().insertPointOnCutLine('parent', 0, { x: 50, y: 10 }, 0.5)
    useStore.getState().updateVertex('parent', 0, { x: -10, y: -8 })

    const parent = useStore.getState().workspace.pieces.find((p) => p.id === 'parent')!
    const child = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    const derived = deriveCutLineForPiece(parent, parent.seamLine, 10)
    expect(derived.ok).toBe(true)
    if (!derived.ok) return

    expect(chamferCollapsesSeamAllowance(parent.seamLine, derived.cutLine, child.cutLine, 10)).toBe(false)
    // 4 scharfe Naht-Ecken (eingefügter Punkt ist weich) → mind. 4 Fasen (= +4 Segmente typisch)
    const sharpSeam = sharpCornerCount(parent.seamLine)
    expect(sharpSeam).toBeGreaterThanOrEqual(4)
    expect(child.cutLine.length).toBeGreaterThan(derived.cutLine.length)
    expect(child.cutLine.length).toBeGreaterThanOrEqual(8)
  })

  it('Soft-Master fälschlich nahe Ecke: Chamfer trotzdem an allen 4 Ecken', () => {
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
      // Soft an Index 0 = echte Ecke — darf Kaschierungs-Fase nicht killen
      softVerticesMaster: [0],
      fillInterior: true,
      material: '',
      bomQuantity: 1,
    }
    const derived0 = deriveCutLineForPiece(draft, seam, 10)
    expect(derived0.ok).toBe(true)
    if (!derived0.ok) return
    const parent = { ...draft, cutLine: derived0.cutLine }
    const facing = buildFacingGeometryFromParent(parent)
    // Ecke 0 soft auf Naht → 3 Fasen erwartet; aber Cut-Soft-Fehlmapping darf nicht ALLE killen
    expect(facing.cutLine.length).toBeGreaterThanOrEqual(6)
    expect(chamferCollapsesSeamAllowance(seam, derived0.cutLine, facing.cutLine, 10)).toBe(false)
  })

  it('Bézier + starke Kontur-Änderung: kein Total-Rollback', () => {
    const seam: Curve[] = [
      { type: 'bezier', start: { x: 10, y: 10 }, cp1: { x: 35, y: 40 }, cp2: { x: 65, y: -20 }, end: { x: 90, y: 10 } },
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
    const d0 = deriveCutLineForPiece(draft, seam, 10)
    expect(d0.ok).toBe(true)
    if (!d0.ok) return
    useStore.setState((s) => ({
      workspace: { ...s.workspace, pieces: [{ ...draft, cutLine: d0.cutLine }] },
    }))
    const childId = useStore.getState().createFacingPiece('parent')!
    const lenBefore = useStore.getState().workspace.pieces.find((p) => p.id === childId)!.cutLine.length
    expect(lenBefore).toBeGreaterThan(4)

    useStore.getState().updateVertex('parent', 1, { x: 120, y: -10 })
    useStore.getState().updateVertex('parent', 2, { x: 110, y: 110 })

    const parent = useStore.getState().workspace.pieces.find((p) => p.id === 'parent')!
    const child = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    const derived = deriveCutLineForPiece(parent, parent.seamLine, 10)
    expect(derived.ok).toBe(true)
    if (!derived.ok) return
    expect(chamferCollapsesSeamAllowance(parent.seamLine, derived.cutLine, child.cutLine, 10)).toBe(false)
    expect(child.cutLine.length).toBeGreaterThan(derived.cutLine.length)
  })
})

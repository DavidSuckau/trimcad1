import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import type { Workspace } from '../types/model'
import {
  lengthScaleFromThickness,
  resolveNeutralFactor,
  scaleCurvesAboutCentroid,
} from '../geometry/thicknessCorrection'

const square = [
  { type: 'line' as const, start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
  { type: 'line' as const, start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
  { type: 'line' as const, start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
  { type: 'line' as const, start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
]

const makePiece = (id: string, number: string, overrides: Record<string, unknown> = {}) => ({
  id,
  number,
  name: 'Sitzwange_A',
  cutLine: square,
  seamLine: [
    { type: 'line' as const, start: { x: 10, y: 10 }, end: { x: 90, y: 10 } },
    { type: 'line' as const, start: { x: 90, y: 10 }, end: { x: 90, y: 90 } },
    { type: 'line' as const, start: { x: 90, y: 90 }, end: { x: 10, y: 90 } },
    { type: 'line' as const, start: { x: 10, y: 90 }, end: { x: 10, y: 10 } },
  ],
  seamAllowanceMm: 10,
  notches: [
    {
      id: 'n1',
      position: { x: 50, y: 0 },
      angle: 90,
      type: 'single' as const,
      depth: 4,
      width: 6,
      sNormalized: 0.25,
    },
  ],
  drills: [],
  grainLine: { start: { x: 50, y: 20 }, end: { x: 50, y: 80 } },
  internalLines: [],
  internalCircles: [],
  layer: 'CUT' as const,
  transform: { x: 20, y: 30, rotation: 0, mirrored: false },
  softVertices: [],
  fillInterior: true,
  material: 'Leder',
  bomQuantity: 1,
  ...overrides,
})

describe('thicknessCorrection math', () => {
  it('resolveNeutralFactor mappt Modi', () => {
    expect(resolveNeutralFactor('outer')).toBe(0)
    expect(resolveNeutralFactor('mid')).toBe(0.5)
    expect(resolveNeutralFactor('inner')).toBe(1)
    expect(resolveNeutralFactor('custom', 0.3)).toBe(0.3)
  })

  it('lengthScaleFromThickness: 5 mm, R=80, k=0.5 → λ=0.96875', () => {
    expect(
      lengthScaleFromThickness({ thicknessMm: 5, meanRadiusMm: 80, neutralFactor: 0.5 }),
    ).toBeCloseTo(0.96875, 5)
  })

  it('scaleCurvesAboutCentroid erhält Segmentzahl und -typen', () => {
    const out = scaleCurvesAboutCentroid(square, 0.97)
    expect(out).toHaveLength(4)
    expect(out.every((c) => c.type === 'line')).toBe(true)
  })
})

describe('createThicknessCorrectedPiece', () => {
  beforeEach(() => {
    const workspace: Workspace = {
      id: 'ws-thick',
      name: 'Test',
      pieces: [makePiece('parent', '001')],
      view: { zoom: 1, panX: 0, panY: 0 },
      seamAssignments: [],
      notes: [],
      profileAssignments: [],
    }
    useStore.setState({
      workspace,
      selectedPieceIds: [],
      toastMessage: null,
      thicknessCorrectionDialogPieceId: null,
    })
  })

  it('legt verknüpftes Teil mit Namen _5mm an und lässt Mutter unverändert', () => {
    const before = structuredClone(useStore.getState().workspace.pieces.find((p) => p.id === 'parent')!)
    const id = useStore.getState().createThicknessCorrectedPiece('parent', {
      thicknessMm: 5,
      mode: 'mid',
      meanRadiusMm: 80,
    })
    expect(id).toBeTruthy()
    const pieces = useStore.getState().workspace.pieces
    expect(pieces).toHaveLength(2)
    const parent = pieces.find((p) => p.id === 'parent')!
    const child = pieces.find((p) => p.id === id)!
    expect(parent.cutLine).toEqual(before.cutLine)
    expect(parent.seamLine).toEqual(before.seamLine)
    expect(parent.notches).toHaveLength(1)
    expect(child.name).toBe('Sitzwange_A_5mm')
    expect(child.kind).toBe('thickness')
    expect(child.thicknessParentId).toBe('parent')
    expect(child.thicknessCorrection?.linked).toBe(true)
    expect(child.cutLine).toHaveLength(4)
    expect(child.seamLine).toHaveLength(4)
    expect(child.notches).toHaveLength(1)
    expect(child.material).toBe('Leder')
  })

  it('blockiert Geometrie-Edits solange verknüpft', () => {
    const childId = useStore.getState().createThicknessCorrectedPiece('parent', {
      thicknessMm: 5,
      mode: 'mid',
      meanRadiusMm: 120,
    })!
    const before = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    useStore.getState().updateVertex(childId, 0, { x: 999, y: 999 })
    const after = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    expect(after.cutLine[0].start.x).toBe(before.cutLine[0].start.x)
    expect(useStore.getState().toastMessage).toMatch(/Mutter|synchronisiert|editierbar/)
  })

  it('nach Unlink ist Geometrie editierbar und Mutter-Löschen entfernt Kind nicht', () => {
    const childId = useStore.getState().createThicknessCorrectedPiece('parent', {
      thicknessMm: 8,
      mode: 'mid',
      meanRadiusMm: 100,
    })!
    useStore.getState().unlinkThicknessPiece(childId)
    const child = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    expect(child.thicknessCorrection?.linked).toBe(false)
    expect(child.thicknessParentId).toBeUndefined()

    useStore.getState().updateVertex(childId, 0, { x: -5, y: -5 })
    const edited = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    expect(edited.cutLine[0].start.x).not.toBe(child.cutLine[0].start.x)

    useStore.getState().deletePiece('parent')
    expect(useStore.getState().workspace.pieces.map((p) => p.id)).toContain(childId)
  })

  it('verknüpftes Kind wird mit Mutter gelöscht', () => {
    const childId = useStore.getState().createThicknessCorrectedPiece('parent', {
      thicknessMm: 5,
      mode: 'mid',
    })!
    useStore.getState().deletePiece('parent')
    const ids = useStore.getState().workspace.pieces.map((p) => p.id)
    expect(ids).not.toContain('parent')
    expect(ids).not.toContain(childId)
  })

  it('sync übernimmt Material und Kontur von der Mutter', () => {
    const childId = useStore.getState().createThicknessCorrectedPiece('parent', {
      thicknessMm: 5,
      mode: 'mid',
      meanRadiusMm: 120,
    })!
    useStore.getState().updatePiece('parent', { material: 'Canvas' })
    // Material sync via updatePiece → syncLinkedPiecesFromParents
    expect(useStore.getState().workspace.pieces.find((p) => p.id === childId)!.material).toBe('Canvas')

    useStore.getState().updateVertex('parent', 0, { x: -10, y: -10 })
    const child = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    expect(child.thicknessParentId).toBe('parent')
    expect(child.cutLine).toHaveLength(4)
    expect(child.notches).toHaveLength(1)
  })

  it('erzeugt keine Dickenkorrektur aus Kaschierung', () => {
    const facingId = useStore.getState().createFacingPiece('parent')!
    expect(
      useStore.getState().createThicknessCorrectedPiece(facingId, { thicknessMm: 5, mode: 'mid' }),
    ).toBeNull()
  })
})

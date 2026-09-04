import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import type { Workspace } from '../types/model'

const square = [
  { type: 'line' as const, start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
  { type: 'line' as const, start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
  { type: 'line' as const, start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
  { type: 'line' as const, start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
]

const makePiece = (id: string, number: string, overrides: Record<string, unknown> = {}) => ({
  id,
  number,
  name: 'Vorderteil',
  cutLine: square,
  seamLine: [
    { type: 'line' as const, start: { x: 10, y: 10 }, end: { x: 90, y: 10 } },
    { type: 'line' as const, start: { x: 90, y: 10 }, end: { x: 90, y: 90 } },
    { type: 'line' as const, start: { x: 90, y: 90 }, end: { x: 10, y: 90 } },
    { type: 'line' as const, start: { x: 10, y: 90 }, end: { x: 10, y: 10 } },
  ],
  seamAllowanceMm: 10,
  notches: [],
  drills: [],
  grainLine: { start: { x: 50, y: 20 }, end: { x: 50, y: 80 } },
  internalLines: [],
  internalCircles: [],
  layer: 'CUT' as const,
  transform: { x: 20, y: 30, rotation: 15, mirrored: false },
  softVertices: [],
  fillInterior: true,
  material: '',
  bomQuantity: 1,
  ...overrides,
})

describe('createMirrorPiece', () => {
  beforeEach(() => {
    const workspace: Workspace = {
      id: 'ws-mirror',
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
    })
  })

  it('legt eine Spiegelkopie mit mirrorParentId und Offset an', () => {
    const id = useStore.getState().createMirrorPiece('parent')
    expect(id).toBeTruthy()
    const pieces = useStore.getState().workspace.pieces
    expect(pieces).toHaveLength(2)
    const child = pieces.find((p) => p.id === id)!
    expect(child.mirrorParentId).toBe('parent')
    expect(child.kind).toBe('mirror')
    expect(child.name).toBe('Vorderteil Spiegel')
    expect(child.transform.x).toBeGreaterThan(20)
    expect(child.transform.y).toBe(30)
    expect(child.transform.rotation).toBe(15)
    expect(child.cutLine).toHaveLength(4)
    expect(child.seamLine).toHaveLength(4)
  })

  it('spiegelt die Kontur horizontal um die BBox-Mitte', () => {
    const id = useStore.getState().createMirrorPiece('parent')!
    const parent = useStore.getState().workspace.pieces.find((p) => p.id === 'parent')!
    const child = useStore.getState().workspace.pieces.find((p) => p.id === id)!
    // Mutter: Naht start (10,10); Spiegel um cx=50 → (90,10)
    expect(child.seamLine[0].start.x).toBeCloseTo(90, 5)
    expect(child.seamLine[0].start.y).toBeCloseTo(parent.seamLine[0].start.y, 5)
  })

  it('sync hält Kind-Transform und übernimmt gespiegelte Mutter-Kontur', () => {
    const childId = useStore.getState().createMirrorPiece('parent')!
    const childBefore = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    const savedTransform = { ...childBefore.transform }

    useStore.getState().updateVertex('parent', 0, { x: -20, y: -10 })

    const childAfter = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    expect(childAfter.transform).toEqual(savedTransform)
    expect(childAfter.mirrorParentId).toBe('parent')
    // Nach Edit: Mutter-Naht-Start verschoben, Kind bleibt Spiegel davon
    const parent = useStore.getState().workspace.pieces.find((p) => p.id === 'parent')!
    const cx =
      (Math.min(...parent.cutLine.flatMap((c) => [c.start.x, c.end.x])) +
        Math.max(...parent.cutLine.flatMap((c) => [c.start.x, c.end.x]))) /
      2
    const expectedX = 2 * cx - parent.seamLine[0].start.x
    expect(childAfter.seamLine[0].start.x).toBeCloseTo(expectedX, 1)
    expect(childAfter.seamLine[0].start.y).toBeCloseTo(parent.seamLine[0].start.y, 1)
  })

  it('löscht abhängige Spiegelkopien mit der Mutter', () => {
    const childId = useStore.getState().createMirrorPiece('parent')!
    expect(useStore.getState().workspace.pieces.map((p) => p.id)).toContain(childId)
    useStore.getState().deletePiece('parent')
    const ids = useStore.getState().workspace.pieces.map((p) => p.id)
    expect(ids).not.toContain('parent')
    expect(ids).not.toContain(childId)
  })

  it('blockiert manuelle Geometrie-Edits an der Spiegelkopie', () => {
    const childId = useStore.getState().createMirrorPiece('parent')!
    const before = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    const cutLen = before.cutLine.length
    useStore.getState().updateVertex(childId, 0, { x: 999, y: 999 })
    const after = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    expect(after.cutLine).toHaveLength(cutLen)
    expect(after.cutLine[0].start.x).toBe(before.cutLine[0].start.x)
    expect(useStore.getState().toastMessage).toMatch(/Mutter/)
  })

  it('erzeugt keine Spiegelkopie aus Kaschierung oder Spiegelkopie', () => {
    const facingId = useStore.getState().createFacingPiece('parent')!
    expect(useStore.getState().createMirrorPiece(facingId)).toBeNull()
    const mirrorId = useStore.getState().createMirrorPiece('parent')!
    expect(useStore.getState().createMirrorPiece(mirrorId)).toBeNull()
    expect(useStore.getState().toastMessage).toMatch(/abhängige/)
  })

  it('erlaubt Material an der Spiegelkopie und behält es beim Sync', () => {
    const childId = useStore.getState().createMirrorPiece('parent')!
    useStore.getState().updatePiece(childId, { material: 'Futterstoff' })
    expect(useStore.getState().workspace.pieces.find((p) => p.id === childId)!.material).toBe(
      'Futterstoff'
    )

    useStore.getState().updateVertex('parent', 0, { x: -20, y: -10 })
    const childAfter = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    expect(childAfter.material).toBe('Futterstoff')
    expect(childAfter.mirrorParentId).toBe('parent')
  })
})

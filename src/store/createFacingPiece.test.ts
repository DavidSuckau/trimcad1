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

describe('createFacingPiece', () => {
  beforeEach(() => {
    const workspace: Workspace = {
      id: 'ws-facing',
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

  it('legt eine Kaschierung mit facingParentId und Offset an', () => {
    const id = useStore.getState().createFacingPiece('parent')
    expect(id).toBeTruthy()
    const pieces = useStore.getState().workspace.pieces
    expect(pieces).toHaveLength(2)
    const child = pieces.find((p) => p.id === id)!
    expect(child.facingParentId).toBe('parent')
    expect(child.kind).toBe('facing')
    expect(child.name).toBe('Vorderteil Kaschierung')
    expect(child.fillInterior).toBe(false)
    expect(child.transform.x).toBeGreaterThan(20)
    expect(child.transform.y).toBe(30)
    expect(child.transform.rotation).toBe(15)
    // Chamfer: mehr Segmente als Mutter-Rechteck
    expect(child.cutLine.length).toBeGreaterThan(4)
    // Nahtlinie bleibt eckig (4 Segmente)
    expect(child.seamLine).toHaveLength(4)
  })

  it('behält Kanten-Nahtzugabe beim Erzeugen', () => {
    const id = useStore.getState().createFacingPiece('parent')!
    const child = useStore.getState().workspace.pieces.find((p) => p.id === id)!
    for (const edge of child.seamLine) {
      const mid = {
        x: (edge.start.x + edge.end.x) / 2,
        y: (edge.start.y + edge.end.y) / 2,
      }
      let best = Infinity
      for (const s of child.cutLine) {
        if (s.type !== 'line') continue
        const ax = s.start.x,
          ay = s.start.y,
          bx = s.end.x,
          by = s.end.y
        const dx = bx - ax,
          dy = by - ay
        const len2 = dx * dx + dy * dy
        let t = len2 < 1e-12 ? 0 : ((mid.x - ax) * dx + (mid.y - ay) * dy) / len2
        t = Math.max(0, Math.min(1, t))
        best = Math.min(best, Math.hypot(mid.x - (ax + t * dx), mid.y - (ay + t * dy)))
      }
      expect(best).toBeGreaterThan(8)
    }
  })

  it('behält Kanten-NZ nach Mutter-Edit (Sync)', () => {
    const childId = useStore.getState().createFacingPiece('parent')!
    useStore.getState().updateVertex('parent', 0, { x: -15, y: -5 })
    useStore.getState().updateVertex('parent', 2, { x: 110, y: 105 })
    const child = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    for (const edge of child.seamLine) {
      const mid = {
        x: (edge.start.x + edge.end.x) / 2,
        y: (edge.start.y + edge.end.y) / 2,
      }
      let best = Infinity
      for (const s of child.cutLine) {
        if (s.type !== 'line') continue
        const ax = s.start.x,
          ay = s.start.y,
          bx = s.end.x,
          by = s.end.y
        const dx = bx - ax,
          dy = by - ay
        const len2 = dx * dx + dy * dy
        let t = len2 < 1e-12 ? 0 : ((mid.x - ax) * dx + (mid.y - ay) * dy) / len2
        t = Math.max(0, Math.min(1, t))
        best = Math.min(best, Math.hypot(mid.x - (ax + t * dx), mid.y - (ay + t * dy)))
      }
      expect(best).toBeGreaterThan(7)
    }
  })

  it('erzeugt keine Kaschierung aus einer Kaschierung', () => {
    const childId = useStore.getState().createFacingPiece('parent')!
    const nested = useStore.getState().createFacingPiece(childId)
    expect(nested).toBeNull()
    expect(useStore.getState().workspace.pieces).toHaveLength(2)
    expect(useStore.getState().toastMessage).toMatch(/Kaschierung/)
  })

  it('sync hält Kind-Transform und übernimmt Mutter-Kontur', () => {
    const childId = useStore.getState().createFacingPiece('parent')!
    const childBefore = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    const savedTransform = { ...childBefore.transform }

    useStore.getState().updateVertex('parent', 0, { x: -20, y: -10 })

    const childAfter = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    expect(childAfter.transform).toEqual(savedTransform)
    expect(childAfter.facingParentId).toBe('parent')
    const parent = useStore.getState().workspace.pieces.find((p) => p.id === 'parent')!
    // Kind-Naht startet wie Mutter-Naht (Kopie), Transform lokal
    expect(childAfter.seamLine[0].start.x).toBeCloseTo(parent.seamLine[0].start.x, 5)
    expect(childAfter.seamLine[0].start.y).toBeCloseTo(parent.seamLine[0].start.y, 5)
  })

  it('löscht abhängige Kaschierungen mit der Mutter', () => {
    const childId = useStore.getState().createFacingPiece('parent')!
    expect(useStore.getState().workspace.pieces.map((p) => p.id)).toContain(childId)
    useStore.getState().deletePiece('parent')
    const ids = useStore.getState().workspace.pieces.map((p) => p.id)
    expect(ids).not.toContain('parent')
    expect(ids).not.toContain(childId)
  })

  it('blockiert manuelle Geometrie-Edits an der Kaschierung', () => {
    const childId = useStore.getState().createFacingPiece('parent')!
    const before = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    const cutLen = before.cutLine.length
    useStore.getState().updateVertex(childId, 0, { x: 999, y: 999 })
    const after = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    expect(after.cutLine).toHaveLength(cutLen)
    expect(after.cutLine[0].start.x).toBe(before.cutLine[0].start.x)
    expect(useStore.getState().toastMessage).toMatch(/synchronisiert/)
  })

  it('erlaubt Material an der Kaschierung und behält es beim Sync', () => {
    const childId = useStore.getState().createFacingPiece('parent')!
    useStore.getState().updatePiece(childId, { material: 'Futterstoff' })
    expect(useStore.getState().workspace.pieces.find((p) => p.id === childId)!.material).toBe('Futterstoff')

    useStore.getState().updateVertex('parent', 0, { x: -20, y: -10 })
    const childAfter = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    expect(childAfter.material).toBe('Futterstoff')
    expect(childAfter.facingParentId).toBe('parent')
  })

  it('erlaubt Laufrichtung an der Kaschierung und behält sie beim Sync', () => {
    const childId = useStore.getState().createFacingPiece('parent')!
    const grain = { start: { x: 10, y: 10 }, end: { x: 10, y: 90 } }
    useStore.getState().setGrainLine(childId, grain)
    expect(useStore.getState().workspace.pieces.find((p) => p.id === childId)!.grainLine).toEqual(grain)

    useStore.getState().updateVertex('parent', 0, { x: -15, y: -5 })
    const childAfter = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    expect(childAfter.grainLine).toEqual(grain)
  })
})

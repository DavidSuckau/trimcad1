import { beforeEach, describe, expect, it } from 'vitest'
import type { Curve, PatternPiece, Workspace } from '../types/model'
import { trimPieceCutLineByOtherPieceOverlap } from './seamTrimByOverlap'
import { useStore } from '../store/useStore'

function rect(x0: number, y0: number, x1: number, y1: number): Curve[] {
  return [
    { type: 'line', start: { x: x0, y: y0 }, end: { x: x1, y: y0 } },
    { type: 'line', start: { x: x1, y: y0 }, end: { x: x1, y: y1 } },
    { type: 'line', start: { x: x1, y: y1 }, end: { x: x0, y: y1 } },
    { type: 'line', start: { x: x0, y: y1 }, end: { x: x0, y: y0 } },
  ]
}

function piece(id: string, cutLine: Curve[], seamLine: Curve[] = []): PatternPiece {
  return {
    id,
    number: id,
    name: id,
    cutLine,
    seamLine,
    seamAllowanceMm: seamLine.length >= 3 ? 8 : null,
    notches: [],
    drills: [],
    grainLine: null,
    internalLines: [],
    internalCircles: [],
    layer: 'CUT',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    softVertices: [],
    softVerticesMaster: [],
    fillInterior: true,
    material: '',
    bomQuantity: 1,
  }
}

function oneCornerClipShape(): Curve[] {
  return [
    { type: 'line', start: { x: -1000, y: -1000 }, end: { x: 1180, y: -1000 } },
    { type: 'line', start: { x: 1180, y: -1000 }, end: { x: -1000, y: 1180 } },
    { type: 'line', start: { x: -1000, y: 1180 }, end: { x: -1000, y: -1000 } },
  ]
}

describe('trimPieceCutLineByOtherPieceOverlap', () => {
  it('schneidet genau eine Ecke der Zielkontur', () => {
    const target = piece('A', rect(0, 0, 100, 100))
    const other = piece('B', oneCornerClipShape())
    const result = trimPieceCutLineByOtherPieceOverlap(target, other, { chosenCutVertexIndex: 2 })
    expect(result.ok).toBe(true)
    if (!result.ok || !result.changed) return
    const pts = result.cutLine.map((c) => c.start)
    expect(pts.some((p) => Math.abs(p.x - 0) < 1e-5 && Math.abs(p.y - 0) < 1e-5)).toBe(true)
    expect(pts.some((p) => Math.abs(p.x - 100) < 1e-5 && Math.abs(p.y - 0) < 1e-5)).toBe(true)
    expect(pts.some((p) => Math.abs(p.x - 0) < 1e-5 && Math.abs(p.y - 100) < 1e-5)).toBe(true)
    expect(pts.some((p) => Math.abs(p.x - 100) < 1e-5 && Math.abs(p.y - 100) < 1e-5)).toBe(false)
  })

  it('bricht ab, wenn oben und unten betroffen waeren (mehr als eine Ecke)', () => {
    const target = piece('A', rect(0, 0, 100, 100))
    const other = piece('B', rect(50, -20, 160, 120))
    const result = trimPieceCutLineByOtherPieceOverlap(target, other)
    expect(result.ok).toBe(false)
  })

  it('mit gewählter Ecke: mehrere entfernte Ecken → eigene Meldung', () => {
    const target = piece('A', rect(0, 0, 100, 100))
    const other = piece('B', rect(50, -20, 160, 120))
    const result = trimPieceCutLineByOtherPieceOverlap(target, other, { chosenCutVertexIndex: 2 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('mehrere Ecken')
    }
  })

  it('mit gewählter falscher Ecke: eine andere Ecke wird geschnitten', () => {
    const target = piece('A', rect(0, 0, 100, 100))
    const other = piece('B', oneCornerClipShape())
    const result = trimPieceCutLineByOtherPieceOverlap(target, other, { chosenCutVertexIndex: 0 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('andere Ecke')
    }
  })

  it('liefert No-Op, wenn keine Überlappung vorliegt', () => {
    const target = piece('A', rect(0, 0, 100, 100))
    const other = piece('B', rect(200, 0, 260, 80))
    const result = trimPieceCutLineByOtherPieceOverlap(target, other)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.changed).toBe(false)
  })

  it('kann auch mit transformierten Teilen trimmen (Weltkoordinaten)', () => {
    const target = piece('A', rect(0, 0, 100, 100))
    const other = piece('B', oneCornerClipShape())
    target.transform = { x: 200, y: 100, rotation: 0, mirrored: false }
    other.transform = { x: 200, y: 100, rotation: 0, mirrored: false }
    const result = trimPieceCutLineByOtherPieceOverlap(target, other)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.changed).toBe(true)
  })

  it('toleriert leicht versetzte Partner-Kontur (Ecken nicht exakt deckungsgleich)', () => {
    const target = piece('A', rect(0, 0, 100, 100))
    const other = piece('B', oneCornerClipShape())
    other.transform = { x: 1.4, y: -0.9, rotation: 0, mirrored: false }
    const result = trimPieceCutLineByOtherPieceOverlap(target, other, { chosenCutVertexIndex: 2 })
    expect(result.ok).toBe(true)
    if (!result.ok || !result.changed) return
    const pts = result.cutLine.map((c) => c.start)
    expect(pts.some((p) => Math.abs(p.x - 100) < 1e-5 && Math.abs(p.y - 100) < 1e-5)).toBe(false)
  })
})

describe('manual seam trim via store', () => {
  beforeEach(() => {
    const seam = rect(10, 10, 90, 90)
    const workspace: Workspace = {
      id: 'ws-trim',
      name: 'Trim',
      pieces: [piece('A', rect(0, 0, 100, 100), seam), piece('B', oneCornerClipShape())],
      view: { zoom: 1, panX: 0, panY: 0 },
      seamAssignments: [],
    }
    useStore.setState({
      workspace,
      selectedPieceIds: ['A', 'B'],
      toastMessage: null,
      nahtTrimPickCutVertexActive: false,
    })
  })

  it('ändert nur cutLine und lässt seamLine des Zielteils unverändert', () => {
    const before = useStore.getState().workspace.pieces.find((p) => p.id === 'A')
    expect(before).toBeTruthy()
    if (!before) return
    const seamBefore = JSON.stringify(before.seamLine)
    useStore.getState().startNahtTrimVertexPick()
    useStore.getState().completeNahtTrimAtCutVertex('A', 2)
    const after = useStore.getState().workspace.pieces.find((p) => p.id === 'A')
    expect(after).toBeTruthy()
    if (!after) return
    expect(JSON.stringify(after.seamLine)).toBe(seamBefore)
    expect(after.cutLine.length).toBeGreaterThanOrEqual(4)
  })

  it('funktioniert auch mit nur einem ausgewählten Zielteil', () => {
    useStore.setState({ selectedPieceIds: ['A'], toastMessage: null })
    const before = useStore.getState().workspace.pieces.find((p) => p.id === 'A')
    expect(before).toBeTruthy()
    if (!before) return
    useStore.getState().startNahtTrimVertexPick()
    useStore.getState().completeNahtTrimAtCutVertex('A', 2)
    const after = useStore.getState().workspace.pieces.find((p) => p.id === 'A')
    expect(after).toBeTruthy()
    if (!after) return
    expect(after.cutLine.length).toBeGreaterThanOrEqual(4)
    expect(JSON.stringify(after.cutLine)).not.toBe(JSON.stringify(before.cutLine))
  })
})


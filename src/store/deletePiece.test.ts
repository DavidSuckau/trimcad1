import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import type { Workspace } from '../types/model'

const square = [
  { type: 'line' as const, start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
  { type: 'line' as const, start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
  { type: 'line' as const, start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
  { type: 'line' as const, start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
]

const makePiece = (id: string, number: string) => ({
  id,
  number,
  name: id,
  cutLine: square,
  seamLine: [],
  seamAllowanceMm: null,
  notches: [],
  drills: [],
  grainLine: null,
  internalLines: [],
  layer: 'CUT' as const,
  transform: { x: 0, y: 0, rotation: 0, mirrored: false },
  softVertices: [],
  fillInterior: true,
  material: '',
  bomQuantity: 1,
})

describe('deletePiece', () => {
  beforeEach(() => {
    const workspace: Workspace = {
      id: 'ws-delete',
      name: 'Test',
      pieces: [makePiece('A', '001'), makePiece('B', '002'), makePiece('C', '003')],
      view: { zoom: 1, panX: 0, panY: 0 },
      seamAssignments: [
        {
          id: 'sa1',
          pieceIdA: 'A',
          pieceIdB: 'B',
          curveIndicesA: [0],
          clickedCurveA: 0,
          curveIndicesB: [2],
          clickedCurveB: 2,
        },
        {
          id: 'sa2',
          pieceIdA: 'B',
          pieceIdB: 'C',
          curveIndicesA: [1],
          clickedCurveA: 1,
          curveIndicesB: [3],
          clickedCurveB: 3,
        },
      ],
      notes: [
        { id: 'n1', pieceId: 'A', position: { x: 50, y: 50 }, text: 'Notiz A' },
        { id: 'n2', pieceId: 'B', position: { x: 50, y: 50 }, text: 'Notiz B' },
      ],
      profileAssignments: [
        { id: 'pa1', pieceId: 'A', edgeIndex: 0, profileName: 'Profil 1', profileKey: 'A' },
        { id: 'pa2', pieceId: 'C', edgeIndex: 1, profileName: 'Profil 2', profileKey: 'B' },
      ],
    }
    useStore.setState({
      workspace,
      selectedPieceIds: ['A', 'B'],
      piecePropertiesDialogPieceId: 'B',
      nahtzugabeDialogPieceId: 'A',
    })
  })

  it('entfernt das Teil aus der Pieces-Liste', () => {
    useStore.getState().deletePiece('A')
    const pieces = useStore.getState().workspace.pieces
    expect(pieces.map((p) => p.id)).toEqual(['B', 'C'])
  })

  it('bereinigt verwaiste seamAssignments', () => {
    useStore.getState().deletePiece('B')
    const sa = useStore.getState().workspace.seamAssignments
    expect(sa).toEqual([])
  })

  it('behält seamAssignments die nicht betroffen sind', () => {
    useStore.getState().deletePiece('A')
    const sa = useStore.getState().workspace.seamAssignments
    expect(sa.length).toBe(1)
    expect(sa[0].id).toBe('sa2')
  })

  it('entfernt Notizen des gelöschten Teils', () => {
    useStore.getState().deletePiece('A')
    const notes = useStore.getState().workspace.notes ?? []
    expect(notes.length).toBe(1)
    expect(notes[0].pieceId).toBe('B')
  })

  it('entfernt profileAssignments des gelöschten Teils', () => {
    useStore.getState().deletePiece('A')
    const pa = useStore.getState().workspace.profileAssignments ?? []
    expect(pa.length).toBe(1)
    expect(pa[0].pieceId).toBe('C')
  })

  it('entfernt die ID aus selectedPieceIds', () => {
    useStore.getState().deletePiece('A')
    expect(useStore.getState().selectedPieceIds).toEqual(['B'])
  })

  it('setzt piecePropertiesDialogPieceId zurück wenn betroffen', () => {
    useStore.getState().deletePiece('B')
    expect(useStore.getState().piecePropertiesDialogPieceId).toBeNull()
  })

  it('setzt nahtzugabeDialogPieceId zurück wenn betroffen', () => {
    useStore.getState().deletePiece('A')
    expect(useStore.getState().nahtzugabeDialogPieceId).toBeNull()
  })
})

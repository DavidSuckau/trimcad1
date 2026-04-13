import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import type { Workspace, Curve } from '../types/model'

function bezierBox(): Curve[] {
  return [
    { type: 'bezier', start: { x: 0, y: 0 }, cp1: { x: 20, y: 0 }, cp2: { x: 30, y: 0 }, end: { x: 50, y: 0 } },
    { type: 'bezier', start: { x: 50, y: 0 }, cp1: { x: 50, y: 20 }, cp2: { x: 50, y: 30 }, end: { x: 50, y: 50 } },
    { type: 'line', start: { x: 50, y: 50 }, end: { x: 0, y: 50 } },
    { type: 'line', start: { x: 0, y: 50 }, end: { x: 0, y: 0 } },
  ]
}

function pieceById(pieceId: string) {
  return useStore.getState().workspace.pieces.find((x) => x.id === pieceId)!
}

describe('removeVertex', () => {
  beforeEach(() => {
    const workspace: Workspace = {
      id: 'ws-remove-vertex',
      name: 'Test',
      pieces: [
        {
          id: 'p1',
          number: '001',
          name: 'Teil',
          cutLine: bezierBox(),
          seamLine: [],
          seamAllowanceMm: null,
          notches: [],
          drills: [],
          grainLine: null,
          internalLines: [],
          layer: 'CUT',
          transform: { x: 0, y: 0, rotation: 0, mirrored: false },
          softVertices: [],
          fillInterior: true,
          material: '',
          bomQuantity: 1,
        },
      ],
      view: { zoom: 1, panX: 0, panY: 0 },
      seamAssignments: [],
    }
    useStore.setState({ workspace, selectedPieceIds: ['p1'] })
  })

  it('behält Bezier-Geometrie beim Löschen eines Vertex zwischen zwei Bezier-Segmenten', () => {
    const { removeVertex } = useStore.getState()
    removeVertex('p1', 1)
    const piece = pieceById('p1')
    expect(piece.cutLine.length).toBe(3)
    expect(piece.cutLine.some((c) => c.type === 'bezier')).toBe(true)
  })

  it('behält Bezier beim Löschen auch wenn KP2/KP1 am gemeinsamen Eck liegen (grüne Kurvenpunkte)', () => {
    const degenerateAtCorner: Curve[] = [
      { type: 'bezier', start: { x: 0, y: 0 }, cp1: { x: 10, y: 0 }, cp2: { x: 50, y: 0 }, end: { x: 50, y: 0 } },
      { type: 'bezier', start: { x: 50, y: 0 }, cp1: { x: 50, y: 0 }, cp2: { x: 50, y: 30 }, end: { x: 50, y: 50 } },
      { type: 'line', start: { x: 50, y: 50 }, end: { x: 0, y: 50 } },
      { type: 'line', start: { x: 0, y: 50 }, end: { x: 0, y: 0 } },
    ]
    useStore.setState({
      workspace: {
        id: 'ws-remove-vertex',
        name: 'Test',
        pieces: [
          {
            id: 'p1',
            number: '001',
            name: 'Teil',
            cutLine: degenerateAtCorner,
            seamLine: [],
            seamAllowanceMm: null,
            notches: [],
            drills: [],
            grainLine: null,
            internalLines: [],
            layer: 'CUT',
            transform: { x: 0, y: 0, rotation: 0, mirrored: false },
            softVertices: [],
            fillInterior: true,
            material: '',
            bomQuantity: 1,
          },
        ],
        view: { zoom: 1, panX: 0, panY: 0 },
        seamAssignments: [],
      },
      selectedPieceIds: ['p1'],
    })
    const { removeVertex } = useStore.getState()
    removeVertex('p1', 1)
    const piece = pieceById('p1')
    expect(piece.cutLine.length).toBe(3)
    expect(piece.cutLine.some((c) => c.type === 'bezier')).toBe(true)
  })

  it('ignoriert ungültige Vertex-Indizes (kein unbeabsichtigtes Springen/Löschen)', () => {
    const before = pieceById('p1')
    const beforeJson = JSON.stringify(before.cutLine)
    const { removeVertex, updateVertex } = useStore.getState()

    removeVertex('p1', -1)
    removeVertex('p1', 999)
    updateVertex('p1', -1, { x: 123, y: 456 })
    updateVertex('p1', 999, { x: 123, y: 456 })

    const after = pieceById('p1')
    expect(JSON.stringify(after.cutLine)).toBe(beforeJson)
  })

  it('remappt seamAssignment-Indices beim Entfernen eines Vertex auf der Master-Kontur', () => {
    const seam = bezierBox()
    const seamAllowanceMm = 10
    useStore.setState({
      workspace: {
        id: 'ws-remove-vertex-seam-assignment',
        name: 'Test',
        pieces: [
          {
            id: 'p1',
            number: '001',
            name: 'Teil',
            cutLine: seam,
            seamLine: seam,
            seamAllowanceMm,
            notches: [],
            drills: [],
            grainLine: null,
            internalLines: [],
            layer: 'CUT',
            transform: { x: 0, y: 0, rotation: 0, mirrored: false },
            softVertices: [],
            fillInterior: true,
            material: '',
            bomQuantity: 1,
          },
          {
            id: 'p2',
            number: '002',
            name: 'Teil2',
            cutLine: bezierBox(),
            seamLine: [],
            seamAllowanceMm: null,
            notches: [],
            drills: [],
            grainLine: null,
            internalLines: [],
            layer: 'CUT',
            transform: { x: 0, y: 0, rotation: 0, mirrored: false },
            softVertices: [],
            fillInterior: true,
            material: '',
            bomQuantity: 1,
          },
        ],
        view: { zoom: 1, panX: 0, panY: 0 },
        seamAssignments: [
          {
            id: 'a1',
            pieceIdA: 'p1',
            curveIndicesA: [0, 1, 2],
            clickedCurveA: 1,
            pieceIdB: 'p2',
            curveIndicesB: [0, 1],
            clickedCurveB: 0,
          },
        ],
      },
      selectedPieceIds: ['p1'],
    })

    useStore.getState().removeVertex('p1', 1)

    const a = useStore.getState().workspace.seamAssignments.find((x) => x.id === 'a1')!
    expect(a.curveIndicesA).toEqual([0, 1])
    expect(a.clickedCurveA).toBe(0)
    expect(a.curveIndicesB).toEqual([0, 1])
    expect(a.clickedCurveB).toBe(0)
  })
})

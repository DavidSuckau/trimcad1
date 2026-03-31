import { describe, expect, it, beforeEach } from 'vitest'
import { useStore } from './useStore'
import { buildCirclePolygonCutLine } from '../workspace/workspaceGeometry'
import type { Workspace } from '../types/model'

function pieceById(pieceId: string) {
  return useStore.getState().workspace.pieces.find((x) => x.id === pieceId)!
}

describe('setVertexSoft', () => {
  const defaultView = { zoom: 1, panX: 0, panY: 0 }

  beforeEach(() => {
    const cutLine = buildCirclePolygonCutLine(50, 6)
    const workspace: Workspace = {
      id: 'ws1',
      name: 'Test',
      pieces: [
        {
          id: 'hex',
          number: '001',
          name: 'Hex',
          cutLine,
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
      view: defaultView,
      seamAssignments: [],
    }
    useStore.setState({
      workspace,
      selectedPieceIds: ['hex'],
    })
  })

  it('fügt weichen Punkt hinzu und entfernt ihn wieder (cutLine, ohne Nahtzugabe)', () => {
    const { setVertexSoft } = useStore.getState()
    setVertexSoft('hex', 2, true)
    expect(pieceById('hex').softVertices).toEqual([2])

    setVertexSoft('hex', 2, false)
    expect(pieceById('hex').softVertices).toEqual([])
  })

  it('ist idempotent: mehrfaches Setzen weich für denselben Vertex erzeugt keine Duplikate', () => {
    const { setVertexSoft } = useStore.getState()
    setVertexSoft('hex', 2, true)
    setVertexSoft('hex', 2, true)
    setVertexSoft('hex', 2, true)
    expect(pieceById('hex').softVertices).toEqual([2])
  })

  it('ignoriert ungültige Vertex-Indizes (keine Änderung am Piece)', () => {
    const { setVertexSoft } = useStore.getState()
    const before = pieceById('hex')
    setVertexSoft('hex', 999, true)
    const after = pieceById('hex')
    expect(after.softVertices).toEqual(before.softVertices)
    expect(after).toBe(before)
  })

  it('speichert bei Nahtzugabe (Seam-as-Master) exakt in softVerticesMaster und cutLine-Liste konsistent', () => {
    const cutLine = buildCirclePolygonCutLine(50, 6)
    const seamLine = cutLine.map((c) =>
      c.type === 'line'
        ? { type: 'line' as const, start: { ...c.start }, end: { ...c.end } }
        : { type: 'bezier' as const, start: { ...c.start }, end: { ...c.end }, cp1: { ...c.cp1 }, cp2: { ...c.cp2 } }
    )
    const workspace: Workspace = {
      id: 'ws-seam-soft',
      name: 'Test',
      pieces: [
        {
          id: 'hex2',
          number: '002',
          name: 'Hex2',
          cutLine,
          seamLine,
          seamAllowanceMm: 10,
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
    useStore.setState({ workspace, selectedPieceIds: ['hex2'] })

    const { setVertexSoft } = useStore.getState()
    setVertexSoft('hex2', 2, true)
    const p = pieceById('hex2')
    expect(p.softVerticesMaster).toEqual([2])
    expect(p.softVertices).toEqual([])
  })

  it('weicher Punkt an rechtwinkliger Rechteck-Ecke bleibt in softVertices (Index 1)', () => {
    const rect: Workspace['pieces'][0]['cutLine'] = [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 50 } },
      { type: 'line', start: { x: 100, y: 50 }, end: { x: 0, y: 50 } },
      { type: 'line', start: { x: 0, y: 50 }, end: { x: 0, y: 0 } },
    ]
    useStore.setState({
      workspace: {
        id: 'ws-rect',
        name: 'Test',
        pieces: [
          {
            id: 'rect',
            number: '003',
            name: 'Rect',
            cutLine: rect,
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
        view: defaultView,
        seamAssignments: [],
      },
      selectedPieceIds: ['rect'],
    })
    const { setVertexSoft } = useStore.getState()
    setVertexSoft('rect', 1, true)
    expect(pieceById('rect').softVertices).toEqual([1])
  })
})

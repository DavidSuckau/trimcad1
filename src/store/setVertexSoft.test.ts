import { describe, expect, it, beforeEach } from 'vitest'
import { useStore } from './useStore'
import { buildCirclePolygonCutLine } from '../workspace/workspaceGeometry'
import type { Workspace } from '../types/model'


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

  it('fügt weichen Punkt hinzu und entfernt ihn wieder (Innenwinkel > 90°)', () => {
    const { setVertexSoft } = useStore.getState()
    setVertexSoft('hex', 2, true)
    let p = useStore.getState().workspace.pieces.find((x) => x.id === 'hex')!
    expect(p.softVertices?.includes(2)).toBe(true)

    setVertexSoft('hex', 2, false)
    p = useStore.getState().workspace.pieces.find((x) => x.id === 'hex')!
    expect(p.softVertices?.includes(2)).toBe(false)
  })

  it('speichert bei Nahtzugabe (Seam-as-Master) weiche Punkte als cutLine-Indizes', () => {
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
    const p = useStore.getState().workspace.pieces.find((x) => x.id === 'hex2')!
    expect(p.softVertices?.includes(2)).toBe(true)
  })
})

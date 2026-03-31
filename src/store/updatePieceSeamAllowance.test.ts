import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import { masterSoftVertexIndexSet } from '../geometry/seamUtils'
import type { Workspace, Curve } from '../types/model'

function square(size: number): Curve[] {
  return [
    { type: 'line', start: { x: 0, y: 0 }, end: { x: size, y: 0 } },
    { type: 'line', start: { x: size, y: 0 }, end: { x: size, y: size } },
    { type: 'line', start: { x: size, y: size }, end: { x: 0, y: size } },
    { type: 'line', start: { x: 0, y: size }, end: { x: 0, y: 0 } },
  ]
}

describe('updatePiece: erste Nahtzugabe (ohne bestehende seamLine)', () => {
  beforeEach(() => {
    const cutLine = square(100)
    const workspace: Workspace = {
      id: 'ws-upd-seam',
      name: 'Test',
      pieces: [
        {
          id: 'p1',
          number: '001',
          name: 'Teil 001',
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
      view: { zoom: 1, panX: 0, panY: 0 },
      seamAssignments: [],
    }
    useStore.setState({ workspace, selectedPieceIds: ['p1'] })
  })

  it('übernimmt die bisherige Kontur als seamLine (Master) und leitet cutLine nach außen ab', () => {
    useStore.getState().updatePiece('p1', { seamAllowanceMm: 10 })
    const p = useStore.getState().workspace.pieces.find((x) => x.id === 'p1')
    expect(p).toBeDefined()
    expect(p!.seamAllowanceMm).toBe(10)
    expect(p!.seamLine.length).toBe(4)
    expect(p!.cutLine.length).toBeGreaterThanOrEqual(3)
    const outer = p!.cutLine[0]
    expect(outer.type).toBe('line')
    if (outer.type === 'line') {
      expect(Math.hypot(outer.end.x - outer.start.x, outer.end.y - outer.start.y)).toBeGreaterThan(100)
    }
  })

  it('behält weiche Punkte auf der Außenkontur nach erster Nahtzugabe (nicht rot durch Sharp-Corner-Promotion)', () => {
    const cutLine = square(100)
    useStore.setState({
      workspace: {
        id: 'ws-upd-seam',
        name: 'Test',
        pieces: [
          {
            id: 'p1',
            number: '001',
            name: 'Teil 001',
            cutLine,
            seamLine: [],
            seamAllowanceMm: null,
            notches: [],
            drills: [],
            grainLine: null,
            internalLines: [],
            layer: 'CUT',
            transform: { x: 0, y: 0, rotation: 0, mirrored: false },
            softVertices: [1],
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
    useStore.getState().updatePiece('p1', { seamAllowanceMm: 10 })
    const p = useStore.getState().workspace.pieces.find((x) => x.id === 'p1')!
    expect(p.softVertices?.length).toBeGreaterThan(0)
    expect(p.cutLine.length).toBeGreaterThanOrEqual(3)
  })

  it('applyOffset: weiche Punkte bleiben nach Nahtzugabe erhalten (Remap + kein Strip)', () => {
    const cutLine = square(100)
    useStore.setState({
      workspace: {
        id: 'ws-off',
        name: 'Test',
        pieces: [
          {
            id: 'p2',
            number: '002',
            name: 'Teil',
            cutLine,
            seamLine: [],
            seamAllowanceMm: null,
            notches: [],
            drills: [],
            grainLine: null,
            internalLines: [],
            layer: 'CUT',
            transform: { x: 0, y: 0, rotation: 0, mirrored: false },
            softVertices: [2],
            fillInterior: true,
            material: '',
            bomQuantity: 1,
          },
        ],
        view: { zoom: 1, panX: 0, panY: 0 },
        seamAssignments: [],
      },
      selectedPieceIds: ['p2'],
    })
    useStore.getState().applyOffset('p2', 8)
    const p = useStore.getState().workspace.pieces.find((x) => x.id === 'p2')!
    expect(p.seamAllowanceMm).toBe(8)
    expect(p.softVertices?.length).toBeGreaterThan(0)
    expect(masterSoftVertexIndexSet(p).size).toBeGreaterThan(0)
  })
})

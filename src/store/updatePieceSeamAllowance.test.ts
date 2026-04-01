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
    expect(p.softVerticesMaster?.includes(1)).toBe(true)
    expect(masterSoftVertexIndexSet(p).has(1)).toBe(true)
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
    expect(p.softVerticesMaster?.includes(2)).toBe(true)
    expect(masterSoftVertexIndexSet(p).size).toBeGreaterThan(0)
  })

  it('vermeidet Überschneidung: ein einzelner Cut-Soft-Index färbt nicht mehrere Master-Eckpunkte blau', () => {
    const piece: Workspace['pieces'][0] = {
      id: 'map-overlap',
      number: '003',
      name: 'MapOverlap',
      cutLine: [
        { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
        { type: 'line', start: { x: 100, y: 0 }, end: { x: 0, y: 100 } },
        { type: 'line', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
      ],
      seamLine: [
        { type: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
        { type: 'line', start: { x: 1, y: 0 }, end: { x: 1, y: 1 } },
        { type: 'line', start: { x: 1, y: 1 }, end: { x: 0, y: 1 } },
        { type: 'line', start: { x: 0, y: 1 }, end: { x: 0, y: 0 } },
      ],
      seamAllowanceMm: 10,
      notches: [],
      drills: [],
      grainLine: null,
      internalLines: [],
      layer: 'CUT',
      transform: { x: 0, y: 0, rotation: 0, mirrored: false },
      softVertices: [0],
      softVerticesMaster: [],
      fillInterior: true,
      material: '',
      bomQuantity: 1,
    }
    const mapped = masterSoftVertexIndexSet(piece)
    expect([...mapped]).toEqual([0])
  })

  it('beim Hinzufügen der Nahtzugabe bleibt ein weicher Punkt am Winkel stabil (nicht rot)', () => {
    const cutLine: Curve[] = [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 120, y: 0 } },
      { type: 'line', start: { x: 120, y: 0 }, end: { x: 40, y: 70 } },
      { type: 'line', start: { x: 40, y: 70 }, end: { x: 0, y: 0 } },
    ]
    useStore.setState({
      workspace: {
        id: 'ws-angle',
        name: 'Angle',
        pieces: [
          {
            id: 'p-angle',
            number: '004',
            name: 'AnglePiece',
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
      selectedPieceIds: ['p-angle'],
    })

    useStore.getState().updatePiece('p-angle', { seamAllowanceMm: 10 })
    const p = useStore.getState().workspace.pieces.find((x) => x.id === 'p-angle')!
    expect(p.softVerticesMaster?.includes(1)).toBe(true)
    const softOnMaster = masterSoftVertexIndexSet(p)
    expect(softOnMaster.has(1)).toBe(true)
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import {
  masterSoftVertexIndexSet,
  masterNotchVertexIndexSet,
  mapCutVertexIndexToMasterVertexIndexForVertexDrag,
} from '../geometry/seamUtils'
import { nearestCurveIndexAndPoint } from '../geometry/nearestOnCurve'
import type { Workspace, Curve } from '../types/model'

function square(size: number): Curve[] {
  return [
    { type: 'line', start: { x: 0, y: 0 }, end: { x: size, y: 0 } },
    { type: 'line', start: { x: size, y: 0 }, end: { x: size, y: size } },
    { type: 'line', start: { x: size, y: size }, end: { x: 0, y: size } },
    { type: 'line', start: { x: 0, y: size }, end: { x: 0, y: 0 } },
  ]
}

function roundedSquareBezier(size: number): Curve[] {
  // 4 Cubic Beziers (CCW), bewusst gekrümmt, damit der Offset beim Nahtzugabe-Apply typischerweise
  // die Segmentanzahl ändert (vereinfachen/flatten), was genau den Edge-Case triggert.
  const bulge = size * 0.2
  const x0 = 0
  const y0 = 0
  const x1 = size
  const y1 = size

  return [
    // bottom: (x0,y0) -> (x1,y0)
    {
      type: 'bezier',
      start: { x: x0, y: y0 },
      end: { x: x1, y: y0 },
      cp1: { x: x0 + 0.33 * size, y: y0 - bulge },
      cp2: { x: x0 + 0.66 * size, y: y0 - bulge },
    },
    // right: (x1,y0) -> (x1,y1)
    {
      type: 'bezier',
      start: { x: x1, y: y0 },
      end: { x: x1, y: y1 },
      cp1: { x: x1 + bulge, y: y0 + 0.33 * size },
      cp2: { x: x1 + bulge, y: y0 + 0.66 * size },
    },
    // top: (x1,y1) -> (x0,y1)
    {
      type: 'bezier',
      start: { x: x1, y: y1 },
      end: { x: x0, y: y1 },
      cp1: { x: x1 - 0.33 * size, y: y1 + bulge },
      cp2: { x: x1 - 0.66 * size, y: y1 + bulge },
    },
    // left: (x0,y1) -> (x0,y0)
    {
      type: 'bezier',
      start: { x: x0, y: y1 },
      end: { x: x0, y: y0 },
      cp1: { x: x0 - bulge, y: y1 - 0.33 * size },
      cp2: { x: x0 - bulge, y: y1 - 0.66 * size },
    },
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
          internalCircles: [],
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
    // Mit tangentialen Außen-Fillets hat die CutLine viele kurze Segmente; die längste Kante bleibt ~100 mm.
    let maxChord = 0
    for (const c of p!.cutLine) {
      if (c.type === 'line') {
        maxChord = Math.max(maxChord, Math.hypot(c.end.x - c.start.x, c.end.y - c.start.y))
      }
    }
    expect(maxChord).toBeGreaterThan(100)
  })

  it('Kerbe bleibt auf cutLine positioniert bei erster Nahtzugabe (via sNormalized)', () => {
    const cutLine = square(120)
    useStore.setState({
      workspace: {
        id: 'ws-notch-seam',
        name: 'Test',
        pieces: [
          {
            id: 'p1',
            number: '001',
            name: 'Teil 001',
            cutLine,
            seamLine: [],
            seamAllowanceMm: null,
            notches: [
              {
                id: 'n1',
                position: { x: 120, y: 120 },
                angle: 0,
                type: 'single',
                depth: 4,
                sNormalized: 0.5,
              },
            ],
            drills: [],
            grainLine: null,
            internalLines: [],
            internalCircles: [],
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

    useStore.getState().updatePiece('p1', { seamAllowanceMm: 10 })
    const p = useStore.getState().workspace.pieces.find((x) => x.id === 'p1')!

    expect(p.notches).toHaveLength(1)
    const notch = p.notches[0]
    expect(notch.vertexIndex).toBeUndefined()
    expect(notch.sNormalized).toBeDefined()
    const nr = nearestCurveIndexAndPoint(notch.position, p.cutLine)
    expect(nr).not.toBeNull()
    expect(nr!.distance).toBeLessThan(0.5)
  })

  it('Kerbe bleibt auf cutLine positioniert auch wenn Offset die Segmentanzahl ändert (via sNormalized)', () => {
    const size = 120
    const cutLine = roundedSquareBezier(size)
    useStore.setState({
      workspace: {
        id: 'ws-notch-seam-curve',
        name: 'Test',
        pieces: [
          {
            id: 'p1',
            number: '001',
            name: 'Teil 001',
            cutLine,
            seamLine: [],
            seamAllowanceMm: null,
            notches: [
              {
                id: 'n1',
                position: { x: size, y: 0 },
                angle: 0,
                type: 'single',
                depth: 4,
                sNormalized: 0.25,
              },
            ],
            drills: [],
            grainLine: null,
            internalLines: [],
            internalCircles: [],
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

    useStore.getState().updatePiece('p1', { seamAllowanceMm: 10 })
    const p = useStore.getState().workspace.pieces.find((x) => x.id === 'p1')!
    expect(p.notches).toHaveLength(1)

    const notch = p.notches[0]
    expect(notch.vertexIndex).toBeUndefined()
    expect(notch.sNormalized).toBeDefined()
    const nr = nearestCurveIndexAndPoint(notch.position, p.cutLine)
    expect(nr).not.toBeNull()
    expect(nr!.distance).toBeLessThan(0.5)
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
            internalCircles: [],
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
            internalCircles: [],
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

  it('masterNotchVertexIndexSet: gibt immer leeres Set zurück (kein vertexIndex-Anker mehr)', () => {
    const inner = square(100)
    const outer = square(130)
    const piece: Workspace['pieces'][0] = {
      id: 'notch-master-hide',
      number: '098',
      name: 'N',
      cutLine: outer,
      seamLine: inner,
      seamAllowanceMm: 15,
      notches: [
        {
          id: 'n1',
          position: { x: 0, y: 0 },
          angle: 0,
          type: 'single',
          depth: 4,
        },
      ],
      drills: [],
      grainLine: null,
      internalLines: [],
      internalCircles: [],
      layer: 'CUT',
      transform: { x: 0, y: 0, rotation: 0, mirrored: false },
      softVertices: [],
      fillInterior: true,
      material: '',
      bomQuantity: 1,
    }
    expect(masterNotchVertexIndexSet(piece).size).toBe(0)
  })

  it('mapCutVertexIndexToMasterVertexIndexForVertexDrag: bei Nahtzugabe gleiche Segmentzahl → 1:1 (trotz großem Abstand Cut↔Naht)', () => {
    const inner = square(100)
    const outer = square(130)
    const piece: Workspace['pieces'][0] = {
      id: 'map-drag',
      number: '099',
      name: 'Map',
      cutLine: outer,
      seamLine: inner,
      seamAllowanceMm: 15,
      notches: [],
      drills: [],
      grainLine: null,
      internalLines: [],
      internalCircles: [],
      layer: 'CUT',
      transform: { x: 0, y: 0, rotation: 0, mirrored: false },
      softVertices: [],
      fillInterior: true,
      material: '',
      bomQuantity: 1,
    }
    expect(inner.length).toBe(outer.length)
    expect(mapCutVertexIndexToMasterVertexIndexForVertexDrag(piece, 2)).toBe(2)
  })

  it('applyOffset: Kerben werden auf die neue Schnittkontur projiziert (wie updatePiece), keine veralteten Koordinaten', () => {
    const cutLine = square(100)
    useStore.setState({
      workspace: {
        id: 'ws-notch',
        name: 'Test',
        pieces: [
          {
            id: 'p-notch',
            number: '003',
            name: 'Mit',
            cutLine,
            seamLine: [],
            seamAllowanceMm: null,
            notches: [
              {
                id: 'n1',
                position: { x: 50, y: 0 },
                angle: 90,
                type: 'single',
                depth: 4,
              },
            ],
            drills: [],
            grainLine: null,
            internalLines: [],
            internalCircles: [],
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
      selectedPieceIds: ['p-notch'],
    })
    useStore.getState().applyOffset('p-notch', 10)
    const p = useStore.getState().workspace.pieces.find((x) => x.id === 'p-notch')!
    expect(p.notches).toHaveLength(1)
    const nr = nearestCurveIndexAndPoint(p.notches[0].position, p.cutLine)
    expect(nr).not.toBeNull()
    expect(nr!.distance).toBeLessThan(0.15)
  })

  it('vermeidet Überschneidung: softVerticesMaster ist alleinige Quelle, verwaiste softVertices färben keine Master-Vertices blau', () => {
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
      internalCircles: [],
      layer: 'CUT',
      transform: { x: 0, y: 0, rotation: 0, mirrored: false },
      softVertices: [0],
      softVerticesMaster: [],
      fillInterior: true,
      material: '',
      bomQuantity: 1,
    }
    const mapped = masterSoftVertexIndexSet(piece)
    expect([...mapped]).toEqual([])

    const pieceWithMaster: Workspace['pieces'][0] = { ...piece, softVerticesMaster: [2] }
    const mapped2 = masterSoftVertexIndexSet(pieceWithMaster)
    expect([...mapped2]).toEqual([2])
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
            internalCircles: [],
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

describe('updateNotch bei Nahtzugabe', () => {
  it('Positionsänderung ohne vertexIndex-Feld: Kontur (cut/seam) unverändert, Verankerung wird gelöst', () => {
    useStore.setState({
      workspace: {
        id: 'ws-un',
        name: 'T',
        pieces: [
          {
            id: 'p-un',
            number: '1',
            name: 'T',
            cutLine: square(120),
            seamLine: square(100),
            seamAllowanceMm: 10,
            notches: [
              {
                id: 'n1',
                position: { x: 50, y: 0 },
                angle: 0,
                type: 'single',
                depth: 4,
                vertexIndex: 1,
              },
            ],
            drills: [],
            grainLine: null,
            internalLines: [],
            internalCircles: [],
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
    })
    const before = useStore.getState().workspace.pieces.find((p) => p.id === 'p-un')!
    const cl = before.cutLine.length
    const sl = before.seamLine.length
    useStore.getState().updateNotch('p-un', 'n1', { position: { x: 40, y: 0 }, angle: 180 })
    const after = useStore.getState().workspace.pieces.find((p) => p.id === 'p-un')!
    expect(after.cutLine.length).toBe(cl)
    expect(after.seamLine.length).toBe(sl)
    expect(after.notches[0].vertexIndex).toBeUndefined()
  })
})

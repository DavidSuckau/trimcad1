import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import { masterSoftVertexIndexSet } from '../geometry/seamUtils'
import type { Workspace, Curve } from '../types/model'

const square = (size: number): Curve[] => [
  { type: 'line', start: { x: 0, y: 0 }, end: { x: size, y: 0 } },
  { type: 'line', start: { x: size, y: 0 }, end: { x: size, y: size } },
  { type: 'line', start: { x: size, y: size }, end: { x: 0, y: size } },
  { type: 'line', start: { x: 0, y: size }, end: { x: 0, y: 0 } },
]

function setupPieceWithSeamAllowance() {
  const cutLine = square(100)
  const workspace: Workspace = {
    id: 'ws-soft-stability',
    name: 'Test',
    pieces: [
      {
        id: 'p1',
        number: '001',
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
        softVertices: [],
        softVerticesMaster: [],
        fillInterior: true,
        material: '',
        bomQuantity: 1,
      },
    ],
    view: { zoom: 1, panX: 0, panY: 0 },
    seamAssignments: [],
  }
  useStore.setState({ workspace, selectedPieceIds: ['p1'] })
  useStore.getState().updatePiece('p1', { seamAllowanceMm: 10 })
}

describe('softVertex stability – harte Vertices bleiben hart', () => {
  beforeEach(() => {
    setupPieceWithSeamAllowance()
  })

  it('updatePiece mit Nahtzugabe setzt keine Vertices ungewollt auf soft', () => {
    const piece = useStore.getState().workspace.pieces[0]
    expect(piece.seamAllowanceMm).toBe(10)
    expect(piece.seamLine.length).toBeGreaterThanOrEqual(3)
    expect(piece.softVertices).toEqual([])
    expect(piece.softVerticesMaster).toEqual([])
  })

  it('insertPointOnCutLine (seam master): bestehende harte Vertices bleiben hart', () => {
    const before = useStore.getState().workspace.pieces[0]
    const seamLen = before.seamLine.length
    expect(seamLen).toBeGreaterThanOrEqual(4)
    expect(before.softVertices).toEqual([])

    const midPoint = {
      x: (before.seamLine[0].start.x + before.seamLine[0].end.x) / 2,
      y: (before.seamLine[0].start.y + before.seamLine[0].end.y) / 2,
    }
    useStore.getState().insertPointOnCutLine('p1', 0, midPoint, 0.5)

    const after = useStore.getState().workspace.pieces[0]
    expect(after.seamLine.length).toBe(seamLen + 1)
    expect(after.softVerticesMaster).toContain(1)

    for (let i = 0; i < after.cutLine.length; i++) {
      const isSoft = (after.softVertices ?? []).includes(i)
      const isSoftMaster = (after.softVerticesMaster ?? []).includes(i)
      if (!isSoftMaster) {
        const masterImplied = after.softVerticesMaster?.some((mvi) => {
          const masterCurves = after.seamLine
          if (mvi < 0 || mvi >= masterCurves.length) return false
          return true
        })
        if (!masterImplied && isSoft) {
          const cutVertex = i === 0 ? after.cutLine[0].start : after.cutLine[i - 1].end
          const seamInserted = midPoint
          const dist = Math.hypot(cutVertex.x - seamInserted.x, cutVertex.y - seamInserted.y)
          if (dist > 5) {
            throw new Error(
              `Vertex ${i} auf cutLine wurde ungewollt soft – ` +
              `Distanz zum eingefügten Punkt: ${dist.toFixed(1)} mm`
            )
          }
        }
      }
    }
  })

  it('masterSoftVertexIndexSet zeigt keine harten Vertices als soft nach Punkt-Einfügen', () => {
    const before = useStore.getState().workspace.pieces[0]
    const seamLen = before.seamLine.length

    const midPoint = {
      x: (before.seamLine[0].start.x + before.seamLine[0].end.x) / 2,
      y: (before.seamLine[0].start.y + before.seamLine[0].end.y) / 2,
    }
    useStore.getState().insertPointOnCutLine('p1', 0, midPoint, 0.5)

    const after = useStore.getState().workspace.pieces[0]
    expect(after.seamLine.length).toBe(seamLen + 1)

    const softMasterSet = masterSoftVertexIndexSet(after)
    const softMasterArr = after.softVerticesMaster ?? []

    for (const vi of softMasterSet) {
      const isExplicitlyMaster = softMasterArr.includes(vi)
      if (!isExplicitlyMaster) {
        throw new Error(
          `masterSoftVertexIndexSet liefert Master-Index ${vi} als soft, ` +
          `aber ${vi} ist nicht in softVerticesMaster – Bug: harter Vertex wird blau angezeigt`
        )
      }
    }
  })

  it('masterSoftVertexIndexSet stabil nach mehrfachem Punkt-Einfügen', () => {
    const p0 = useStore.getState().workspace.pieces[0]
    useStore.getState().insertPointOnCutLine('p1', 0, {
      x: (p0.seamLine[0].start.x + p0.seamLine[0].end.x) / 2,
      y: (p0.seamLine[0].start.y + p0.seamLine[0].end.y) / 2,
    }, 0.5)

    const p1 = useStore.getState().workspace.pieces[0]
    useStore.getState().insertPointOnCutLine('p1', 2, {
      x: (p1.seamLine[2].start.x + p1.seamLine[2].end.x) / 2,
      y: (p1.seamLine[2].start.y + p1.seamLine[2].end.y) / 2,
    }, 0.5)

    const after = useStore.getState().workspace.pieces[0]
    const softMasterSet = masterSoftVertexIndexSet(after)
    const softMasterArr = after.softVerticesMaster ?? []

    for (const vi of softMasterSet) {
      expect(softMasterArr).toContain(vi)
    }
    expect(softMasterSet.size).toBe(softMasterArr.length)
  })

  it('Punkt einfügen auf Cut-as-Master: nur der neue Punkt wird soft', () => {
    useStore.getState().updatePiece('p1', { seamAllowanceMm: null })

    const before = useStore.getState().workspace.pieces[0]
    expect(before.cutLine.length).toBe(4)
    expect(before.softVertices).toEqual([])

    const midPoint = {
      x: (before.cutLine[0].start.x + before.cutLine[0].end.x) / 2,
      y: (before.cutLine[0].start.y + before.cutLine[0].end.y) / 2,
    }
    useStore.getState().insertPointOnCutLine('p1', 0, midPoint, 0.5)

    const after = useStore.getState().workspace.pieces[0]
    expect(after.cutLine.length).toBe(5)
    expect(after.softVertices).toContain(1)
    const nonInserted = (after.softVertices ?? []).filter((vi) => vi !== 1)
    expect(nonInserted).toEqual([])
  })
})

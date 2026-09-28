import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import type { Notch, Workspace } from '../types/model'
import { getNotchPositionAndAngle } from '../geometry/notchOnCurve'
import { buildMirrorGeometryFromParent } from '../geometry/mirrorPiece'
import { cutLineWithNotchCutouts } from '../geometry/notchOnCurve'

const square = [
  { type: 'line' as const, start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
  { type: 'line' as const, start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
  { type: 'line' as const, start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
  { type: 'line' as const, start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
]

const seam = [
  { type: 'line' as const, start: { x: 10, y: 10 }, end: { x: 90, y: 10 } },
  { type: 'line' as const, start: { x: 90, y: 10 }, end: { x: 90, y: 90 } },
  { type: 'line' as const, start: { x: 90, y: 90 }, end: { x: 10, y: 90 } },
  { type: 'line' as const, start: { x: 10, y: 90 }, end: { x: 10, y: 10 } },
]

function makeParent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'parent',
    number: '001',
    name: 'Vorderteil',
    cutLine: square,
    seamLine: seam,
    seamAllowanceMm: 10,
    notches: [] as Notch[],
    drills: [],
    grainLine: null,
    internalLines: [],
    internalCircles: [],
    layer: 'CUT' as const,
    transform: { x: -200, y: 0, rotation: 0, mirrored: false },
    softVertices: [],
    fillInterior: true,
    material: '',
    bomQuantity: 1,
    ...overrides,
  }
}

describe('Spiegelkopie: Kerben folgen der Mutter', () => {
  beforeEach(() => {
    const workspace: Workspace = {
      id: 'ws-mirror-notch',
      name: 'Test',
      pieces: [makeParent()],
      view: { zoom: 1, panX: 0, panY: 0 },
      seamAssignments: [],
      notes: [],
      profileAssignments: [],
      mirrorCenterLineXMm: 0,
    }
    useStore.setState({ workspace, selectedPieceIds: [], toastMessage: null })
  })

  it('übernimmt Typ/Tiefe/Breite und gespiegelte Lage beim Anlegen und nach Änderung', () => {
    const childId = useStore.getState().createMirrorPiece('parent')!

    const notch: Notch = {
      id: 'n1',
      position: { x: 100, y: 50 },
      angle: 180,
      type: 'v',
      depth: 5,
      width: 8,
    }
    useStore.getState().addNotch('parent', notch)

    let parent = useStore.getState().workspace.pieces.find((p) => p.id === 'parent')!
    let child = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    expect(child.notches).toHaveLength(1)
    expect(child.notches[0].type).toBe('v')
    expect(child.notches[0].depth).toBe(5)
    expect(child.notches[0].width).toBe(8)

    const pPos = getNotchPositionAndAngle(parent.notches[0], parent.cutLine).position
    const cPos = getNotchPositionAndAngle(child.notches[0], child.cutLine).position
    // Rechte Kante (100,50) → linke Kante (0,50) bei Spiegel um cx=50
    expect(pPos.x).toBeCloseTo(100, 1)
    expect(cPos.x).toBeCloseTo(0, 1)
    expect(cPos.y).toBeCloseTo(pPos.y, 1)

    // Tipps zeigen beide nach innen (Mutter −X, Kind +X)
    const pAngle = getNotchPositionAndAngle(parent.notches[0], parent.cutLine).angle
    const cAngle = getNotchPositionAndAngle(child.notches[0], child.cutLine).angle
    const pIn = { x: Math.cos((pAngle * Math.PI) / 180), y: Math.sin((pAngle * Math.PI) / 180) }
    const cIn = { x: Math.cos((cAngle * Math.PI) / 180), y: Math.sin((cAngle * Math.PI) / 180) }
    expect(pIn.x).toBeLessThan(-0.5)
    expect(cIn.x).toBeGreaterThan(0.5)

    useStore.getState().updateNotch('parent', 'n1', { type: 'single', depth: 7, width: 3 })
    child = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    expect(child.notches[0].type).toBe('single')
    expect(child.notches[0].depth).toBe(7)
    expect(child.notches[0].width).toBe(3)

    useStore.getState().updateNotch('parent', 'n1', {
      position: { x: 50, y: 0 },
      sNormalized: 0.125,
    })
    parent = useStore.getState().workspace.pieces.find((p) => p.id === 'parent')!
    child = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    const cPos2 = getNotchPositionAndAngle(child.notches[0], child.cutLine).position
    expect(cPos2.x).toBeCloseTo(50, 1)
    expect(cPos2.y).toBeCloseTo(0, 1)

    useStore.getState().removeNotch('parent', 'n1')
    child = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    expect(child.notches).toHaveLength(0)
  })

  it('baut V-Cutouts auf der Spiegelkopie wie auf der Mutter', () => {
    const parent = makeParent({
      notches: [
        {
          id: 'n1',
          position: { x: 50, y: 0 },
          angle: 90,
          type: 'v' as const,
          depth: 4,
          width: 6,
          sNormalized: 0.125,
        },
      ],
    })
    const geom = buildMirrorGeometryFromParent(parent)
    expect(geom.notches).toHaveLength(1)
    expect(geom.notches[0].type).toBe('v')
    expect(geom.notches[0].depth).toBe(4)
    expect(geom.notches[0].width).toBe(6)

    const parentCutouts = cutLineWithNotchCutouts(parent.cutLine, parent.notches, parent.seamLine)
    const childCutouts = cutLineWithNotchCutouts(geom.cutLine, geom.notches, geom.seamLine)
    expect(parentCutouts.length).toBeGreaterThan(parent.cutLine.length)
    expect(childCutouts.length).toBeGreaterThan(geom.cutLine.length)
    // Gleiche Anzahl Detour-Segmente (V = 2 Zusatzkanten)
    expect(childCutouts.length - geom.cutLine.length).toBe(
      parentCutouts.length - parent.cutLine.length,
    )
  })

  it('blockiert Kerben-Edits an der Spiegelkopie selbst', () => {
    const childId = useStore.getState().createMirrorPiece('parent')!
    useStore.getState().addNotch('parent', {
      id: 'n1',
      position: { x: 50, y: 0 },
      angle: 90,
      type: 'v',
      depth: 4,
      width: 6,
    })
    const before = useStore.getState().workspace.pieces.find((p) => p.id === childId)!.notches[0]
    useStore.getState().updateNotch(childId, before.id, { depth: 99 })
    const after = useStore.getState().workspace.pieces.find((p) => p.id === childId)!.notches[0]
    expect(after.depth).toBe(before.depth)
    expect(useStore.getState().toastMessage).toMatch(/Mutter/)
  })
})

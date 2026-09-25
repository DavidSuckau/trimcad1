import { describe, expect, it } from 'vitest'
import type { Notch, PatternPiece } from '../types/model'
import { buildFacingGeometryFromParent, transferNotchesToFacingCut } from './facingPiece'
import { getNotchPositionAndAngle } from './notchOnCurve'
import { cutLineWithNotchCutouts } from './notchOnCurve'
import { nearestCurveIndexAndPoint } from './nearestOnCurve'
import { pathLengthAt, totalPathLength } from './curveToPath'

const square = [
  { type: 'line' as const, start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
  { type: 'line' as const, start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
  { type: 'line' as const, start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
  { type: 'line' as const, start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
]

const seamInset = [
  { type: 'line' as const, start: { x: 10, y: 10 }, end: { x: 90, y: 10 } },
  { type: 'line' as const, start: { x: 90, y: 10 }, end: { x: 90, y: 90 } },
  { type: 'line' as const, start: { x: 90, y: 90 }, end: { x: 10, y: 90 } },
  { type: 'line' as const, start: { x: 10, y: 90 }, end: { x: 10, y: 10 } },
]

function parentWithNotch(notch: Notch): PatternPiece {
  return {
    id: 'parent',
    number: '001',
    name: 'Teil',
    cutLine: square,
    seamLine: seamInset,
    seamAllowanceMm: 10,
    notches: [notch],
    drills: [],
    grainLine: null,
    internalLines: [],
    internalCircles: [],
    layer: 'CUT',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    softVertices: [],
    softVerticesMaster: [],
    fillInterior: true,
  }
}

describe('transferNotchesToFacingCut / Kaschierung Kerben', () => {
  it('legt Kantenmitte-Kerbe relativ gleich auf die Kaschier-Kontur', () => {
    const notch: Notch = {
      id: 'n1',
      position: { x: 50, y: 0 },
      angle: 90,
      type: 'v',
      depth: 4,
      width: 6,
      sNormalized: 50 / 400,
    }
    const parent = parentWithNotch(notch)
    const facing = buildFacingGeometryFromParent(parent)
    expect(facing.notches).toHaveLength(1)
    const fn = facing.notches[0]
    const pos = getNotchPositionAndAngle(fn, facing.cutLine).position
    // Untere Kante der Kaschierung (nach NZ/Chamfer) — y nahe Außenkante, x etwa Mitte
    expect(pos.x).toBeGreaterThan(30)
    expect(pos.x).toBeLessThan(70)
    expect(pos.y).toBeLessThan(15)

    const withCutouts = cutLineWithNotchCutouts(facing.cutLine, facing.notches, facing.seamLine)
    expect(withCutouts.length).toBeGreaterThan(facing.cutLine.length)
  })

  it('hält relative Bogenlänge auch wenn Chamfer Segmente hinzufügt', () => {
    const notch: Notch = {
      id: 'n2',
      position: { x: 100, y: 50 },
      angle: 0,
      type: 'v',
      depth: 5,
      width: 8,
    }
    const parent = parentWithNotch(notch)
    const facing = buildFacingGeometryFromParent(parent)
    expect(facing.cutLine.length).toBeGreaterThan(4)

    const parentPos = getNotchPositionAndAngle(notch, parent.cutLine).position
    const parentL = (() => {
      const n = nearestCurveIndexAndPoint(parentPos, parent.cutLine)!
      return pathLengthAt(parent.cutLine, n.curveIndex, n.t ?? 0) / totalPathLength(parent.cutLine)
    })()
    const facingPos = getNotchPositionAndAngle(facing.notches[0], facing.cutLine).position
    const facingL = (() => {
      const n = nearestCurveIndexAndPoint(facingPos, facing.cutLine)!
      return pathLengthAt(facing.cutLine, n.curveIndex, n.t ?? 0) / totalPathLength(facing.cutLine)
    })()
    expect(Math.abs(facingL - parentL)).toBeLessThan(0.08)
  })

  it('transferNotchesToFacingCut mappt per sNormalized', () => {
    const from = square
    const to = [
      { type: 'line' as const, start: { x: 0, y: 0 }, end: { x: 200, y: 0 } },
      { type: 'line' as const, start: { x: 200, y: 0 }, end: { x: 200, y: 200 } },
      { type: 'line' as const, start: { x: 200, y: 200 }, end: { x: 0, y: 200 } },
      { type: 'line' as const, start: { x: 0, y: 200 }, end: { x: 0, y: 0 } },
    ]
    const notches: Notch[] = [
      {
        id: 'n',
        position: { x: 50, y: 0 },
        angle: 90,
        type: 'v',
        depth: 3,
        width: 4,
        sNormalized: 0.125,
      },
    ]
    const out = transferNotchesToFacingCut(notches, from, to, [])
    expect(out[0].position.x).toBeCloseTo(100, 0)
    expect(out[0].position.y).toBeCloseTo(0, 0)
  })
})

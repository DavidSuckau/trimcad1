import { describe, expect, it } from 'vitest'
import type { Curve, Notch } from '../types/model'
import {
  materializeNotchAnchorsOnCutLine,
  resolveNotchCutLineAnchor,
  getNotchPositionAndAngle,
  notchCutoutPoints,
} from './notchOnCurve'
import { pathLengthAt, totalPathLength } from './curveToPath'

function square(size: number): Curve[] {
  return [
    { type: 'line', start: { x: 0, y: 0 }, end: { x: size, y: 0 } },
    { type: 'line', start: { x: size, y: 0 }, end: { x: size, y: size } },
    { type: 'line', start: { x: size, y: size }, end: { x: 0, y: size } },
    { type: 'line', start: { x: 0, y: size }, end: { x: 0, y: 0 } },
  ]
}

describe('resolveNotchCutLineAnchor / materialize', () => {
  it('sNormalized schlägt position (vertexIndex wird ignoriert)', () => {
    const cutLine = square(100)
    const total = totalPathLength(cutLine)
    const notch: Notch = {
      id: 'n1',
      sNormalized: 0.25,
      arcLengthMm: 350,
      position: { x: 999, y: 999 },
      angle: 0,
      type: 'v',
      depth: 4,
    }
    const a = resolveNotchCutLineAnchor(notch, cutLine)
    expect(a).not.toBeNull()
    const L = pathLengthAt(cutLine, a!.curveIndex, a!.t)
    expect(L / total).toBeCloseTo(0.25, 5)
    const g = getNotchPositionAndAngle(notch, cutLine)
    expect(g.position.x).toBeCloseTo(100, 3)
    expect(g.position.y).toBeCloseTo(0, 3)
  })

  it('sNormalized schlägt arcLengthMm wenn beide gesetzt', () => {
    const cutLine = square(100)
    const total = totalPathLength(cutLine)
    const wantS = 0.25
    const wrongMm = total * 0.1
    const notch: Notch = {
      id: 'n1',
      sNormalized: wantS,
      arcLengthMm: wrongMm,
      position: { x: 0, y: 0 },
      angle: 0,
      type: 'v',
      depth: 4,
    }
    const a = resolveNotchCutLineAnchor(notch, cutLine)!
    const L = pathLengthAt(cutLine, a.curveIndex, a.t)
    expect(L / total).toBeCloseTo(wantS, 5)
  })

  it('arcLengthMm wenn kein sNormalized', () => {
    const cutLine = square(100)
    const Lwant = 150
    const notch: Notch = {
      id: 'n1',
      arcLengthMm: Lwant,
      position: { x: 0, y: 0 },
      angle: 0,
      type: 'v',
      depth: 4,
    }
    const a = resolveNotchCutLineAnchor(notch, cutLine)!
    const L = pathLengthAt(cutLine, a.curveIndex, a.t)
    expect(L).toBeCloseTo(Lwant, 3)
  })

  it('materialize setzt konsistente Felder für freie Kerbe', () => {
    const cutLine = square(100)
    const notch: Notch = {
      id: 'n1',
      position: { x: 50, y: 0 },
      angle: 0,
      type: 'v',
      depth: 4,
    }
    const m = materializeNotchAnchorsOnCutLine(notch, cutLine)!
    expect(m.sNormalized).toBeDefined()
    expect(m.arcLengthMm).toBeDefined()
    expect(m.vertexIndex).toBeUndefined()
    expect(Math.abs(m.position.y)).toBeLessThan(1e-6)
    expect(m.position.x).toBeCloseTo(50, 3)
  })

  it('V-Kerbe faellt bei ungueltiger Breite auf Linien-Darstellung zurueck', () => {
    const cutLine = square(0.01)
    const geom = notchCutoutPoints(
      { x: 0, y: 0 },
      90,
      4,
      6,
      cutLine,
      { curveIndex: 0, t: 0 },
      'v'
    )
    expect(geom).not.toBeNull()
    expect(geom!.kind).toBe('line')
  })

  it('liefert bei degeneriertem Segment weiterhin eine endliche Kerb-Geometrie', () => {
    const cutLine: Curve[] = [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 0, y: 0 } },
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
      { type: 'line', start: { x: 100, y: 100 }, end: { x: 0, y: 0 } },
    ]
    const notch: Notch = {
      id: 'n-deg',
      position: { x: 0, y: 0 },
      angle: 0,
      type: 'v',
      depth: 4,
      width: 6,
    }
    const pos = getNotchPositionAndAngle(notch, cutLine)
    expect(Number.isFinite(pos.position.x)).toBe(true)
    expect(Number.isFinite(pos.position.y)).toBe(true)
    expect(Number.isFinite(pos.angle)).toBe(true)
    const geom = notchCutoutPoints(pos.position, pos.angle, notch.depth, notch.width ?? 6, cutLine, { curveIndex: 0, t: 0 }, notch.type)
    expect(geom).not.toBeNull()
  })
})

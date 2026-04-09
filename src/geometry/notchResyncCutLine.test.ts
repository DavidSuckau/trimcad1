import { describe, expect, it } from 'vitest'
import type { Curve, Notch } from '../types/model'
import { resyncNotchesAfterCutLineRebuilt } from './notchResyncCutLine'
import { getNotchCutLineParameter, getNotchPositionAndAngle } from './notchOnCurve'

function square(size: number): Curve[] {
  return [
    { type: 'line', start: { x: 0, y: 0 }, end: { x: size, y: 0 } },
    { type: 'line', start: { x: size, y: 0 }, end: { x: size, y: size } },
    { type: 'line', start: { x: size, y: size }, end: { x: 0, y: size } },
    { type: 'line', start: { x: 0, y: size }, end: { x: 0, y: 0 } },
  ]
}

describe('resyncNotchesAfterCutLineRebuilt: position-first', () => {
  it('haelt bei topologiekompatibler Aenderung Segment+t auch mit Scalar-Anker stabil', () => {
    const oldCutLine = square(100)
    const newCutLine: Curve[] = [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 200, y: 0 } },
      { type: 'line', start: { x: 200, y: 0 }, end: { x: 200, y: 100 } },
      { type: 'line', start: { x: 200, y: 100 }, end: { x: 0, y: 100 } },
      { type: 'line', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
    ]
    const notch: Notch = {
      id: 'n1',
      position: { x: 50, y: 0 },
      angle: 90,
      type: 'single',
      depth: 4,
      width: 6,
      sNormalized: 0.125, // 50 / 400
      arcLengthMm: 50,
    }

    const next = resyncNotchesAfterCutLineRebuilt([notch], oldCutLine, newCutLine)[0]
    const pos = getNotchPositionAndAngle(next, newCutLine).position
    // Bei kompatibler Topologie bleibt die lokale Segmentlaenge erhalten (hier 50 mm ab Segmentstart).
    expect(pos.x).toBeCloseTo(50, 3)
    expect(pos.y).toBeCloseTo(0, 3)
    expect(next.sNormalized).toBeCloseTo(50 / 600, 4)
    expect(next.arcLengthMm).toBeCloseTo(50, 3)
  })

  it('bei Startpunkt-Rotation bleibt die Kerbe geometrisch an der Ecke (100,0); kein vertexIndex', () => {
    const size = 100
    const oldCutLine = square(size)
    // Gleiche Geometrie, aber Startpunkt/Segmentreihenfolge um 1 verschoben.
    const newCutLine: Curve[] = [oldCutLine[1], oldCutLine[2], oldCutLine[3], oldCutLine[0]]

    const notch: Notch = {
      id: 'n1',
      position: { x: size, y: 0 }, // physisch korrekt: Ecke (size,0)
      angle: 0,
      type: 'single',
      depth: 4,
      // Historisch vertexIndex — Resync entfernt ihn; Lage kommt aus Position/Projektion.
      vertexIndex: 1,
    }

    const [resynced] = resyncNotchesAfterCutLineRebuilt([notch], oldCutLine, newCutLine)
    expect(resynced.vertexIndex).toBeUndefined()
    const pos = getNotchPositionAndAngle(resynced, newCutLine).position
    expect(pos.x).toBeCloseTo(100, 6)
    expect(pos.y).toBeCloseTo(0, 6)
  })

  it('bei verformter erster Kante: Position bleibt per Projektion an alter Stelle', () => {
    const oldCutLine = square(100)
    const newCutLine: Curve[] = [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 130, y: 15 } },
      { type: 'line', start: { x: 130, y: 15 }, end: { x: 100, y: 100 } },
      { type: 'line', start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
      { type: 'line', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
    ]
    const notch: Notch = {
      id: 'n-anch',
      position: { x: 100, y: 0 },
      angle: 0,
      type: 'single',
      depth: 4,
      vertexIndex: 1,
    }
    const [resynced] = resyncNotchesAfterCutLineRebuilt([notch], oldCutLine, newCutLine)
    expect(resynced.vertexIndex).toBeUndefined()
    const pos = getNotchPositionAndAngle(resynced, newCutLine).position
    // Projektion von (100,0) auf Kante 0 ((0,0)→(130,15)): t ≈ 13000/17125 ≈ 0.759
    expect(pos.x).toBeCloseTo(98.686, 2)
    expect(pos.y).toBeCloseTo(11.387, 2)
  })

  it('freie Kerbe bleibt frei (kein auto vertex re-anchor nur wegen t≈0/1)', () => {
    const size = 100
    const oldCutLine = square(size)
    const newCutLine: Curve[] = [oldCutLine[1], oldCutLine[2], oldCutLine[3], oldCutLine[0]]
    const notch: Notch = {
      id: 'n-free',
      position: { x: size, y: 0 },
      angle: 0,
      type: 'single',
      depth: 4,
    }

    const [resynced] = resyncNotchesAfterCutLineRebuilt([notch], oldCutLine, newCutLine)
    expect(resynced.vertexIndex).toBeUndefined()
  })

  it('freie Kerbe: bei kompatibler Topologie wird Segment+t stabil fortgeschrieben', () => {
    const size = 100
    const oldCutLine = square(size)
    const newCutLine: Curve[] = [oldCutLine[1], oldCutLine[2], oldCutLine[3], oldCutLine[0]]
    // 50 mm entlang alter Kontur = Mitte untere Kante (50,0); position absichtlich falsch — sNormalized zählt.
    const sMidBottom = 50 / 400
    const notch: Notch = {
      id: 'n-sn',
      position: { x: 999, y: 999 },
      angle: 0,
      type: 'single',
      depth: 4,
      sNormalized: sMidBottom,
      arcLengthMm: 50,
    }
    const oldCanon = getNotchPositionAndAngle(notch, oldCutLine).position
    expect(oldCanon.x).toBeCloseTo(50, 3)
    expect(oldCanon.y).toBeCloseTo(0, 3)

    const [resynced] = resyncNotchesAfterCutLineRebuilt([notch], oldCutLine, newCutLine)
    const p = getNotchPositionAndAngle(resynced, newCutLine).position
    // Zyklischer Shift: gleiche physische Kante (unten) bleibt (50,0), nicht (100,50).
    expect(p.x).toBeCloseTo(50, 3)
    expect(p.y).toBeCloseTo(0, 3)
    expect(resynced.vertexIndex).toBeUndefined()
  })

  it('freie Kerbe ohne Scalar-Anker bleibt per Projektion an physischer Position', () => {
    const oldCutLine: Curve[] = [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
      { type: 'line', start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
      { type: 'line', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
    ]
    const newCutLine: Curve[] = [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 140, y: 35 } },
      { type: 'line', start: { x: 140, y: 35 }, end: { x: 100, y: 100 } },
      { type: 'line', start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
      { type: 'line', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
    ]
    const notch: Notch = {
      id: 'n-carry',
      position: { x: 95, y: 0 },
      angle: 0,
      type: 'single',
      depth: 4,
    }

    const [resynced] = resyncNotchesAfterCutLineRebuilt([notch], oldCutLine, newCutLine)
    const p = getNotchCutLineParameter(resynced, newCutLine)
    expect(p).not.toBeNull()
    expect(p!.curveIndex).toBe(0)
    const pos = getNotchPositionAndAngle(resynced, newCutLine).position
    // Projektion von (95,0) auf (0,0)→(140,35): bleibt nahe (95,0) auf der neuen Kante
    expect(pos.x).toBeCloseTo(89.42, 1)
    expect(pos.y).toBeCloseTo(22.36, 1)
  })
})


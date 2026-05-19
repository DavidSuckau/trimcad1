import { describe, expect, it } from 'vitest'
import type { PatternPiece } from '../types/model'
import {
  collectContourMeasurementStationArcLengths,
  getCutLineNotchMeasurementDistances,
} from './measurementStations'
function squarePiece(softVertices: number[] = []): PatternPiece {
  return {
    id: 'p1',
    name: 'Test',
    number: '1',
    cutLine: [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
      { type: 'line', start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
      { type: 'line', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
    ],
    seamLine: [],
    notches: [],
    drills: [],
    grainLine: null,
    internalLines: [],
    internalCircles: [],
    layer: 'fabric',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    softVertices,
  }
}

describe('measurementStations', () => {
  it('Konturmaß-Stationen ignorieren weiche Eckpunkte', () => {
    const piece = squarePiece([1])
    const stations = collectContourMeasurementStationArcLengths(piece, piece.cutLine)
    expect(stations).not.toContain(100)
    expect(stations).toContain(0)
    expect(stations).toContain(200)
    expect(stations).toContain(300)
  })

  it('Kerben-Abstand springt über weichen Eckpunkt zur nächsten harten Ecke', () => {
    const piece = squarePiece([1])
    piece.notches = [
      {
        id: 'n1',
        type: 'v',
        depth: 3,
        position: { x: 50, y: 0 },
        angle: 90,
        sNormalized: 0.125,
        arcLengthMm: 50,
      },
    ]
    const d = getCutLineNotchMeasurementDistances(piece, 0, 0.5)
    expect(d.distanceMmLeft).toBeCloseTo(50, 1)
    expect(d.distanceMmRight).toBeCloseTo(150, 1)
  })

  it('Kerben-Abstand zwischen zwei Kerben und nächster harter Ecke', () => {
    const piece = squarePiece()
    piece.notches = [
      { id: 'n1', type: 'v', depth: 3, position: { x: 40, y: 0 }, angle: 90, sNormalized: 0.1, arcLengthMm: 40 },
      { id: 'n2', type: 'v', depth: 3, position: { x: 100, y: 20 }, angle: 0, sNormalized: 0.3, arcLengthMm: 120 },
    ]
    const d = getCutLineNotchMeasurementDistances(piece, 0, 0.7)
    expect(d.distanceMmLeft).toBeCloseTo(30, 1)
    expect(d.distanceMmRight).toBeCloseTo(30, 1)
  })
})

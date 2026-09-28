import { describe, expect, it } from 'vitest'
import type { Curve, Notch, PatternPiece } from '../types/model'
import { getCutLineContourMeasurements } from './contourMeasurements'
import { collectContourMeasurementStationArcLengths } from './measurementStations'

function squareWithSoftMid(): Curve[] {
  return [
    { type: 'line', start: { x: 0, y: 0 }, end: { x: 50, y: 0 } },
    { type: 'line', start: { x: 50, y: 0 }, end: { x: 100, y: 0 } },
    { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
    { type: 'line', start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
    { type: 'line', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
  ]
}

function basePiece(overrides: Partial<PatternPiece> = {}): PatternPiece {
  return {
    id: 'p',
    number: '1',
    name: 't',
    cutLine: squareWithSoftMid(),
    seamLine: squareWithSoftMid(),
    seamAllowanceMm: 10,
    notches: [],
    drills: [],
    grainLine: null,
    internalLines: [],
    internalCircles: [],
    layer: 'CUT',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    softVertices: [],
    softVerticesMaster: [],
    ...overrides,
  }
}

describe('getCutLineContourMeasurements', () => {
  it('bei Nahtzugabe: weiche Master-Punkte erzeugen keine Extra-Maße (auch bei gleicher Segmentzahl)', () => {
    const piece = basePiece({ softVerticesMaster: [1] })
    const meas = getCutLineContourMeasurements(piece)
    expect(meas).toHaveLength(4)
    const bottom = meas.find((m) => Math.abs(m.lengthMm - 100) < 0.5)
    expect(bottom).toBeTruthy()
  })

  it('Maße nur Ecke↔Ecke, Ecke↔Kerbe, Kerbe↔Kerbe — weiche Punkte übersprungen', () => {
    const notch: Notch = {
      id: 'n1',
      type: 'v',
      depth: 3,
      width: 4,
      position: { x: 25, y: 0 },
      angle: 90,
      sNormalized: 25 / 400,
    }
    const piece = basePiece({ softVerticesMaster: [1], notches: [notch] })
    const stations = collectContourMeasurementStationArcLengths(piece, piece.seamLine)
    // 4 harte Ecken + 1 Kerbe; Index 1 (50,0) weich → nicht
    expect(stations).toHaveLength(5)
    const meas = getCutLineContourMeasurements(piece)
    expect(meas).toHaveLength(5)
    const lens = meas.map((m) => Math.round(m.lengthMm)).sort((a, b) => a - b)
    expect(lens).toEqual([25, 75, 100, 100, 100])
  })

  it('tessellierte cutLine mit Nahtzugabe → Maße entlang seam (4 Kanten)', () => {
    const bottom: Curve[] = []
    for (let i = 0; i < 20; i++) {
      bottom.push({
        type: 'line',
        start: { x: (100 * i) / 20, y: 0 },
        end: { x: (100 * (i + 1)) / 20, y: 0 },
      })
    }
    const cutLine: Curve[] = [
      ...bottom,
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
      { type: 'line', start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
      { type: 'line', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
    ]
    const seam: Curve[] = [
      { type: 'line', start: { x: 10, y: 10 }, end: { x: 90, y: 10 } },
      { type: 'line', start: { x: 90, y: 10 }, end: { x: 90, y: 90 } },
      { type: 'line', start: { x: 90, y: 90 }, end: { x: 10, y: 90 } },
      { type: 'line', start: { x: 10, y: 90 }, end: { x: 10, y: 10 } },
    ]
    const piece = basePiece({ cutLine, seamLine: seam })
    expect(getCutLineContourMeasurements(piece)).toHaveLength(4)
  })

  it('ohne Nahtzugabe: weiche softVertices überspringen', () => {
    const piece = basePiece({
      seamAllowanceMm: null,
      seamLine: [],
      softVertices: [1],
      softVerticesMaster: [],
    })
    expect(getCutLineContourMeasurements(piece)).toHaveLength(4)
  })
})

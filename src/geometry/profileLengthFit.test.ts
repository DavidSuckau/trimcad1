import { describe, it, expect } from 'vitest'
import type { Curve, PatternPiece, ProfileAssignment } from '../types/model'
import {
  computeProfileFitAdjustTarget,
  fitPieceToProfileAssignment,
  snapProfileLengthMm,
} from './profileLengthFit'
import { profileAssignmentLengthMm as measureProfileLen } from './internalLineProfile'

describe('snapProfileLengthMm', () => {
  it('rundet auf 5-mm-Schritte', () => {
    expect(snapProfileLengthMm(0)).toBe(5)
    expect(snapProfileLengthMm(2.4)).toBe(5)
    expect(snapProfileLengthMm(7.4)).toBe(5)
    expect(snapProfileLengthMm(7.6)).toBe(10)
    expect(snapProfileLengthMm(23)).toBe(25)
    expect(snapProfileLengthMm(22.4)).toBe(20)
  })
})

describe('fitPieceToProfileAssignment', () => {
  function rectPiece(): PatternPiece {
    const cutLine: Curve[] = [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 80 } },
      { type: 'line', start: { x: 100, y: 80 }, end: { x: 0, y: 80 } },
      { type: 'line', start: { x: 0, y: 80 }, end: { x: 0, y: 0 } },
    ]
    return {
      id: 'p',
      number: '1',
      name: 'T',
      cutLine,
      seamLine: [],
      notches: [],
      internalLines: [],
      drills: [],
      grainLine: null,
      internalCircles: [],
      layer: 'default',
      transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    }
  }

  it('passt untere Kante auf 100 mm (von 100 mm) an', () => {
    const piece = rectPiece()
    const pa: ProfileAssignment = {
      id: 'pa1',
      pieceId: 'p',
      edgeIndex: 0,
      profileName: 'Band',
      profileKey: 'A',
    }
    const { piece: next, targetLengthMm } = fitPieceToProfileAssignment(piece, pa)
    expect(targetLengthMm).toBe(100)
    expect(measureProfileLen(next, pa)).toBeCloseTo(100, 1)
  })

  it('verkürzt Kante von 103 mm auf 105 mm (5-mm-Raster)', () => {
    const piece = rectPiece()
    piece.cutLine[0] = { type: 'line', start: { x: 0, y: 0 }, end: { x: 103, y: 0 } }
    piece.cutLine[1] = { ...piece.cutLine[1], start: { x: 103, y: 0 } }
    const pa: ProfileAssignment = {
      id: 'pa1',
      pieceId: 'p',
      edgeIndex: 0,
      profileName: 'Band',
      profileKey: 'A',
    }
    const { piece: next, targetLengthMm } = fitPieceToProfileAssignment(piece, pa)
    expect(targetLengthMm).toBe(105)
    expect(measureProfileLen(next, pa)).toBeCloseTo(105, 1)
  })

  it('passt Notch-zu-Notch-Strecke auf 65 mm an', () => {
    const piece = rectPiece()
    const cutTotal = 100 + 80 + 100 + 80
    piece.notches = [
      {
        id: 's',
        position: { x: 10, y: 0 },
        angle: 90,
        type: 'single',
        depth: 3,
        role: 'nahtanfang',
        sNormalized: 10 / cutTotal,
        arcLengthMm: 10,
      },
      {
        id: 'e',
        position: { x: 73, y: 0 },
        angle: 90,
        type: 'single',
        depth: 3,
        role: 'nahtende',
        sNormalized: 73 / cutTotal,
        arcLengthMm: 73,
      },
    ]
    const pa: ProfileAssignment = {
      id: 'pa1',
      pieceId: 'p',
      edgeIndex: 0,
      startNotchId: 's',
      endNotchId: 'e',
      profileName: 'Band',
      profileKey: 'A',
    }
    const { piece: next, targetLengthMm } = fitPieceToProfileAssignment(piece, pa)
    expect(targetLengthMm).toBe(65)
    expect(measureProfileLen(next, pa)).toBeCloseTo(65, 0)
    const end = next.notches.find((n) => n.id === 'e')
    expect(end?.position.x).toBeCloseTo(75, 0)
  })
})

describe('computeProfileFitAdjustTarget', () => {
  it('verlängert interne Linie wenn Ziel länger als Segment', () => {
    const piece: PatternPiece = {
      id: 'p',
      number: '1',
      name: 'T',
      cutLine: [{ type: 'line', start: { x: 0, y: 0 }, end: { x: 50, y: 0 } }],
      seamLine: [],
      notches: [],
      internalLines: [{ type: 'line', start: { x: 0, y: 0 }, end: { x: 50, y: 0 } }],
      drills: [],
      grainLine: null,
      internalCircles: [],
      layer: 'default',
      transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    }
    const pa: ProfileAssignment = {
      id: 'pa',
      pieceId: 'p',
      edgeIndex: 0,
      onInternalLine: true,
      profileName: 'X',
      profileKey: 'A',
      targetLengthMm: 80,
    }
    const target = computeProfileFitAdjustTarget(piece, pa, 80)
    expect(target?.kind).toBe('internalLineEnd')
    if (target?.kind === 'internalLineEnd') {
      expect(target.position.x).toBeCloseTo(80, 1)
    }
  })
})

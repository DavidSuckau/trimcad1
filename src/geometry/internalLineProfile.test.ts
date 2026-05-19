import { describe, it, expect } from 'vitest'
import type { Curve, PatternPiece } from '../types/model'
import {
  deriveInternalNotchRoleRangeOnPath,
  getInternalProfileCurvesInRange,
  getNotchesOnInternalProfilePath,
  getProfileAssignmentLabelPositions,
  hitProfileAssignment,
  profileAssignmentLengthMm,
} from './internalLineProfile'

function pieceWithInternal(): PatternPiece {
  const internalLines: Curve[] = [
    { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 50 } },
  ]
  return {
    id: 'p',
    number: '1',
    name: 'T',
    cutLine: [
      { type: 'line', start: { x: 0, y: 10 }, end: { x: 200, y: 10 } },
      { type: 'line', start: { x: 200, y: 10 }, end: { x: 200, y: 110 } },
      { type: 'line', start: { x: 200, y: 110 }, end: { x: 0, y: 110 } },
      { type: 'line', start: { x: 0, y: 110 }, end: { x: 0, y: 10 } },
    ],
    seamLine: [],
    notches: [
      {
        id: 's',
        position: { x: 20, y: 0 },
        angle: 90,
        type: 'single',
        depth: 3,
        internalLineIndex: 0,
        internalSNormalized: 0.2,
      },
      {
        id: 'e',
        position: { x: 80, y: 0 },
        angle: 90,
        type: 'single',
        depth: 3,
        internalLineIndex: 0,
        internalSNormalized: 0.8,
        role: 'nahtende',
      },
      {
        id: 'start',
        position: { x: 10, y: 0 },
        angle: 90,
        type: 'single',
        depth: 3,
        internalLineIndex: 0,
        internalSNormalized: 0.1,
        role: 'nahtanfang',
      },
    ],
    drills: [],
    grainLine: null,
    internalLines,
    internalCircles: [],
    layer: 'default',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
  }
}

describe('internalLineProfile', () => {
  it('lists only internal notches on path', () => {
    const piece = pieceWithInternal()
    const onPath = getNotchesOnInternalProfilePath(piece, [0, 1])
    expect(onPath.map((n) => n.notchId).sort()).toEqual(['e', 's', 'start'].sort())
  })

  it('derives role range between start and end', () => {
    const piece = pieceWithInternal()
    const range = deriveInternalNotchRoleRangeOnPath(piece, [0])
    expect(range).toEqual({ startNotchId: 'start', endNotchId: 'e' })
  })

  it('clips profile geometry between role notches', () => {
    const piece = pieceWithInternal()
    const range = { startNotchId: 'start', endNotchId: 'e' }
    const curves = getInternalProfileCurvesInRange(piece, [0, 1], range)
    expect(curves.length).toBeGreaterThan(0)
    const len = profileAssignmentLengthMm(piece, {
      id: 'pa',
      pieceId: 'p',
      edgeIndex: 0,
      onInternalLine: true,
      startNotchId: 'start',
      endNotchId: 'e',
      profileName: 'P',
      profileKey: 'A',
    })
    expect(len).toBeGreaterThan(50)
    expect(len).toBeLessThan(150)
  })

  it('erkennt Klick auf Profil-Kennung und interne Linie', () => {
    const piece = pieceWithInternal()
    const pa = {
      id: 'pa',
      pieceId: 'p',
      edgeIndex: 0,
      onInternalLine: true,
      profileName: 'Band',
      profileKey: 'A',
    }
    const labels = getProfileAssignmentLabelPositions(piece, pa)
    expect(labels).not.toBeNull()
    expect(hitProfileAssignment(piece, pa, labels!.key, 5)).toBe(true)
    expect(hitProfileAssignment(piece, pa, { x: 999, y: 999 }, 5)).toBe(false)
    expect(hitProfileAssignment(piece, pa, { x: 50, y: 25 }, 15)).toBe(true)
  })
})

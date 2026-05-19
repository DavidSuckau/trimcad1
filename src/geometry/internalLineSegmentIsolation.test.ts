import { describe, expect, it } from 'vitest'
import type { PatternPiece, ProfileAssignment, SeamAssignment } from '../types/model'
import {
  getProfileAssignmentDisplayCurves,
  getProfileAssignmentInternalCurveIndices,
  profileAssignmentLengthMm,
} from './internalLineProfile'
import { getInternalSeamAssignmentCurveIndices, internalSeamAssignmentLengthMm } from './internalSeamAssignment'
import { profileOverlapsInternalSeam } from './profileInternalSeamLink'

function pieceTwoSeparateInternalLines(): PatternPiece {
  return {
    id: 'p1',
    number: '1',
    name: 'Test',
    cutLine: [
      { type: 'line', start: { x: 0, y: 10 }, end: { x: 200, y: 10 } },
      { type: 'line', start: { x: 200, y: 10 }, end: { x: 200, y: 110 } },
      { type: 'line', start: { x: 200, y: 110 }, end: { x: 0, y: 110 } },
      { type: 'line', start: { x: 0, y: 110 }, end: { x: 0, y: 10 } },
    ],
    seamLine: [],
    notches: [],
    drills: [],
    grainLine: null,
    internalLines: [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 80, y: 0 } },
      { type: 'line', start: { x: 200, y: 50 }, end: { x: 280, y: 50 } },
    ],
    internalCircles: [],
    layer: 'default',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
  }
}

describe('internal line segment isolation', () => {
  it('Profil auf Segment 0 betrifft nur dieses Segment', () => {
    const piece = pieceTwoSeparateInternalLines()
    const pa: ProfileAssignment = {
      id: 'pa1',
      pieceId: 'p1',
      edgeIndex: 0,
      onInternalLine: true,
      profileName: 'Band',
      profileKey: 'A',
    }
    expect(getProfileAssignmentInternalCurveIndices(piece, pa)).toEqual([0])
    const curves = getProfileAssignmentDisplayCurves(piece, pa)
    expect(curves).toHaveLength(1)
    expect(curves[0].start).toEqual({ x: 0, y: 0 })
    expect(curves[0].end).toEqual({ x: 80, y: 0 })
    expect(profileAssignmentLengthMm(piece, pa)).toBeCloseTo(80, 1)
  })

  it('interne Nahtzuordnung nur auf angeklicktem Segment', () => {
    const piece = pieceTwoSeparateInternalLines()
    const seam: SeamAssignment = {
      id: 's1',
      pieceIdA: 'p1',
      curveIndicesA: [0, 1],
      clickedCurveA: 1,
      pieceIdB: 'p1',
      curveIndicesB: [],
      clickedCurveB: 0,
      isInternalSingle: true,
    }
    expect(getInternalSeamAssignmentCurveIndices(piece, seam)).toEqual([1])
    expect(internalSeamAssignmentLengthMm(piece, seam)).toBeCloseTo(80, 1)
  })

  it('Profil und Naht auf verschiedenen Segmenten überlappen nicht', () => {
    const piece = pieceTwoSeparateInternalLines()
    const profile: ProfileAssignment = {
      id: 'pa1',
      pieceId: 'p1',
      edgeIndex: 0,
      onInternalLine: true,
      internalLineAttachment: 'with_seam',
      profileName: 'Band',
      profileKey: 'A',
    }
    const seam: SeamAssignment = {
      id: 's1',
      pieceIdA: 'p1',
      curveIndicesA: [1],
      clickedCurveA: 1,
      pieceIdB: 'p1',
      curveIndicesB: [],
      clickedCurveB: 0,
      isInternalSingle: true,
    }
    expect(profileOverlapsInternalSeam(piece, profile, seam)).toBe(false)
  })
})

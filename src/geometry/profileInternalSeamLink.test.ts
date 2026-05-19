import { describe, expect, it } from 'vitest'
import type { Curve, PatternPiece, ProfileAssignment, SeamAssignment, Workspace } from '../types/model'
import {
  arcIntervalsOverlap,
  internalSeamForProfile,
  profileOverlapsInternalSeam,
  profilesForInternalSeam,
} from './profileInternalSeamLink'

function line(x1: number, y1: number, x2: number, y2: number): Curve {
  return { type: 'line', start: { x: x1, y: y1 }, end: { x: x2, y: y2 } }
}

function pieceWithInternalLine(id: string): PatternPiece {
  return {
    id,
    number: '001',
    name: 'Test',
    cutLine: [line(0, 0, 100, 0), line(100, 0, 100, 100), line(100, 100, 0, 100), line(0, 100, 0, 0)],
    seamLine: [],
    notches: [
      {
        id: 'n1',
        position: { x: 25, y: 10 },
        angle: 90,
        type: 'single',
        depth: 4,
        width: 6,
        internalLineIndex: 0,
        internalSNormalized: 0.25,
      },
      {
        id: 'n2',
        position: { x: 75, y: 10 },
        angle: 90,
        type: 'single',
        depth: 4,
        width: 6,
        internalLineIndex: 0,
        internalSNormalized: 0.75,
      },
    ],
    drills: [],
    grainLine: null,
    internalLines: [line(0, 10, 100, 10)],
    internalCircles: [],
    layer: 'CUT',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
  }
}

describe('profileInternalSeamLink', () => {
  it('erkennt Überlappung auf voller interner Linie', () => {
    const piece = pieceWithInternalLine('p1')
    const profile: ProfileAssignment = {
      id: 'pr1',
      pieceId: 'p1',
      edgeIndex: 0,
      onInternalLine: true,
      internalLineAttachment: 'with_seam',
      profileName: 'Bund',
      profileKey: 'A',
    }
    const seam: SeamAssignment = {
      id: 's1',
      pieceIdA: 'p1',
      curveIndicesA: [0],
      clickedCurveA: 0,
      pieceIdB: 'p1',
      curveIndicesB: [],
      clickedCurveB: 0,
      isInternalSingle: true,
    }
    expect(profileOverlapsInternalSeam(piece, profile, seam)).toBe(true)
  })

  it('arcIntervalsOverlap erkennt teilweise Überlappung', () => {
    expect(arcIntervalsOverlap({ startArc: 0, endArc: 100 }, { startArc: 40, endArc: 80 })).toBe(true)
    expect(arcIntervalsOverlap({ startArc: 0, endArc: 30 }, { startArc: 50, endArc: 100 })).toBe(false)
  })

  it('profilesForInternalSeam filtert nach with_seam', () => {
    const piece = pieceWithInternalLine('p1')
    const ws: Workspace = {
      id: 'w',
      name: 'T',
      pieces: [piece],
      view: { zoom: 1, panX: 0, panY: 0 },
      seamAssignments: [
        {
          id: 's1',
          pieceIdA: 'p1',
          curveIndicesA: [0],
          clickedCurveA: 0,
          pieceIdB: 'p1',
          curveIndicesB: [],
          clickedCurveB: 0,
          isInternalSingle: true,
        },
      ],
      profileAssignments: [
        {
          id: 'pr1',
          pieceId: 'p1',
          edgeIndex: 0,
          onInternalLine: true,
          internalLineAttachment: 'with_seam',
          profileName: 'Bund',
          profileKey: 'A',
        },
        {
          id: 'pr2',
          pieceId: 'p1',
          edgeIndex: 0,
          onInternalLine: true,
          internalLineAttachment: 'separate',
          profileName: 'Anders',
          profileKey: 'B',
        },
      ],
    }
    const linked = profilesForInternalSeam(ws, ws.seamAssignments[0])
    expect(linked).toHaveLength(1)
    expect(linked[0].profileKey).toBe('A')
    expect(internalSeamForProfile(ws, linked[0])?.id).toBe('s1')
  })
})

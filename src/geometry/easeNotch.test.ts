import { describe, expect, it } from 'vitest'
import type { Notch, PatternPiece, SeamAssignment } from '../types/model'
import {
  buildEasePairDrafts,
  isEaseNotch,
  suggestEaseRelativeTs,
} from './easeNotch'
import { getNotchesOnEdge, getSubSegments } from './seamUtils'

function line(x0: number, y0: number, x1: number, y1: number) {
  return { type: 'line' as const, start: { x: x0, y: y0 }, end: { x: x1, y: y1 } }
}

function bezier(
  x0: number,
  y0: number,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  x1: number,
  y1: number,
) {
  return {
    type: 'bezier' as const,
    start: { x: x0, y: y0 },
    cp1: { x: c1x, y: c1y },
    cp2: { x: c2x, y: c2y },
    end: { x: x1, y: y1 },
  }
}

function basePiece(id: string, cutLine: PatternPiece['cutLine']): PatternPiece {
  return {
    id,
    number: '1',
    name: id,
    cutLine,
    seamLine: [],
    notches: [],
    drills: [],
    grainLine: null,
    internalLines: [],
    internalCircles: [],
    layer: '1',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
  }
}

describe('easeNotch', () => {
  it('filtert Ease aus getNotchesOnEdge / Subsegmenten', () => {
    const cut = [
      line(0, 0, 100, 0),
      line(100, 0, 100, 40),
      line(100, 40, 0, 40),
      line(0, 40, 0, 0),
    ]
    const piece = basePiece('A', cut)
    const pass: Notch = {
      id: 'pass1',
      position: { x: 50, y: 0 },
      angle: 0,
      type: 'v',
      depth: 4,
      sNormalized: 50 / 280,
    }
    const ease: Notch = {
      id: 'ease1',
      position: { x: 30, y: 0 },
      angle: 0,
      type: 'single',
      depth: 2.5,
      purpose: 'ease',
      seamAssignmentId: 'asg1',
      easePairKey: 'pk1',
      sNormalized: 30 / 280,
    }
    piece.notches = [pass, ease]
    const onEdge = getNotchesOnEdge(piece, [0])
    expect(onEdge.map((n) => n.notchId)).toEqual(['pass1'])
    expect(isEaseNotch(ease)).toBe(true)
    const withEase = getNotchesOnEdge(piece, [0], undefined, { includeEase: true })
    expect(withEase.map((n) => n.notchId).sort()).toEqual(['ease1', 'pass1'])
    const subs = getSubSegments(piece, [0])
    // Nur Pass-Kerbe splittet → 2 Segmente
    expect(subs.length).toBe(2)
  })

  it('schlägt Ease auf gekrümmter Kante vor und baut Paare', () => {
    // Stark gekrümmte Oberkante + Rechteck-Rest
    const cutA = [
      bezier(0, 40, 30, 0, 70, 0, 100, 40),
      line(100, 40, 100, 80),
      line(100, 80, 0, 80),
      line(0, 80, 0, 40),
    ]
    const cutB = [
      bezier(0, 40, 30, 80, 70, 80, 100, 40),
      line(100, 40, 100, 0),
      line(100, 0, 0, 0),
      line(0, 0, 0, 40),
    ]
    const pieceA = basePiece('A', cutA)
    const pieceB = basePiece('B', cutB)
    const assignment: SeamAssignment = {
      id: 'asg-curve',
      pieceIdA: 'A',
      curveIndicesA: [0],
      clickedCurveA: 0,
      pieceIdB: 'B',
      curveIndicesB: [0],
      clickedCurveB: 0,
    }
    const suggestion = suggestEaseRelativeTs(assignment, pieceA, pieceB, 8)
    expect(suggestion).not.toBeNull()
    expect(suggestion!.relativeTs.length).toBeGreaterThan(0)

    let id = 0
    const drafts = buildEasePairDrafts(assignment, pieceA, pieceB, suggestion!, {
      generateId: () => `id-${id++}`,
    })
    expect(drafts.length).toBe(suggestion!.relativeTs.length)
    for (const d of drafts) {
      expect(d.notchA.purpose).toBe('ease')
      expect(d.notchB.purpose).toBe('ease')
      expect(d.notchA.easePairKey).toBe(d.notchB.easePairKey)
      expect(d.notchA.seamAssignmentId).toBe('asg-curve')
      expect(d.notchB.seamAssignmentId).toBe('asg-curve')
    }
  })

  it('setzt auf gerader Kante keine Ease-Vorschläge', () => {
    const cut = [
      line(0, 0, 120, 0),
      line(120, 0, 120, 40),
      line(120, 40, 0, 40),
      line(0, 40, 0, 0),
    ]
    const pieceA = basePiece('A', cut)
    const pieceB = basePiece('B', cut)
    const assignment: SeamAssignment = {
      id: 'asg-straight',
      pieceIdA: 'A',
      curveIndicesA: [0],
      clickedCurveA: 0,
      pieceIdB: 'B',
      curveIndicesB: [0],
      clickedCurveB: 0,
    }
    const suggestion = suggestEaseRelativeTs(assignment, pieceA, pieceB, 8)
    expect(suggestion).toBeNull()
  })
})

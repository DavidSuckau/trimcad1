import { describe, expect, it } from 'vitest'
import {
  dragTriggersSeamAdjustmentCheck,
  evaluateSeamAdjustment,
  seamAdjustmentFingerprint,
} from './seamAdjustmentCheck'
import type { PatternPiece, SeamAssignment } from '../types/model'

function square(size: number) {
  return [
    { type: 'line' as const, start: { x: 0, y: 0 }, end: { x: size, y: 0 } },
    { type: 'line' as const, start: { x: size, y: 0 }, end: { x: size, y: size } },
    { type: 'line' as const, start: { x: size, y: size }, end: { x: 0, y: size } },
    { type: 'line' as const, start: { x: 0, y: size }, end: { x: 0, y: 0 } },
  ]
}

function basePiece(id: string, notches: PatternPiece['notches'], transform?: PatternPiece['transform']): PatternPiece {
  return {
    id,
    number: id,
    name: id,
    cutLine: square(100),
    seamLine: [],
    notches,
    drills: [],
    grainLine: null,
    internalLines: [],
    internalCircles: [],
    layer: 'CUT',
    transform: transform ?? { x: 0, y: 0, rotation: 0, mirrored: false },
    softVertices: [],
    fillInterior: true,
    material: '',
    bomQuantity: 1,
  }
}

const assignment: SeamAssignment = {
  id: 's1',
  pieceIdA: 'A',
  curveIndicesA: [0],
  clickedCurveA: 0,
  pieceIdB: 'B',
  curveIndicesB: [0],
  clickedCurveB: 0,
}

describe('seamAdjustmentCheck', () => {
  it('erkennt Subsegment-Abweichung bei gleicher Kantenlänge und Notch-Anzahl', () => {
    const pieceA = basePiece('A', [
      { id: 'a1', position: { x: 25, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
      { id: 'a2', position: { x: 75, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
    ])
    const pieceB = basePiece('B', [
      { id: 'b1', position: { x: 40, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
      { id: 'b2', position: { x: 70, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
    ])
    const ev = evaluateSeamAdjustment(assignment, pieceA, pieceB)
    expect(ev?.needsDialog).toBe(true)
    expect(ev?.canAdjust).toBe(true)
    expect(ev?.diffs.length).toBeGreaterThan(0)
  })

  it('Fingerprint bleibt bei reiner Teilverschiebung/Drehung gleich', () => {
    const pieceA = basePiece('A', [
      { id: 'a1', position: { x: 25, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
    ])
    const pieceB = basePiece('B', [
      { id: 'b1', position: { x: 40, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
    ])
    const fp0 = seamAdjustmentFingerprint(assignment, pieceA, pieceB)
    const movedB = basePiece('B', pieceB.notches, { x: 120, y: -30, rotation: 45, mirrored: false })
    const fp1 = seamAdjustmentFingerprint(assignment, pieceA, movedB)
    expect(fp1).toBe(fp0)
  })

  it('dragTriggersSeamAdjustmentCheck ignoriert Teilverschiebung und Drehung', () => {
    expect(dragTriggersSeamAdjustmentCheck('piece')).toBe(false)
    expect(dragTriggersSeamAdjustmentCheck('rotate')).toBe(false)
    expect(dragTriggersSeamAdjustmentCheck('vertex')).toBe(true)
    expect(dragTriggersSeamAdjustmentCheck('notchMove')).toBe(true)
  })
})

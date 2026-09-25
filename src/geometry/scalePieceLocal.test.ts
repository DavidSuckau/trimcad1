import { describe, expect, it } from 'vitest'
import type { PatternPiece } from '../types/model'
import { getNotchPositionAndAngle } from './notchOnCurve'
import { getNotchPositionAndAngleOnInternalLine } from './notchOnInternalLine'
import { applyUniformScaleToPiece, scalePointAbout } from './scalePieceLocal'
import { totalPathLength } from './curveToPath'

function rectPiece(): PatternPiece {
  const cutLine = [
    { type: 'line' as const, start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    { type: 'line' as const, start: { x: 100, y: 0 }, end: { x: 100, y: 80 } },
    { type: 'line' as const, start: { x: 100, y: 80 }, end: { x: 0, y: 80 } },
    { type: 'line' as const, start: { x: 0, y: 80 }, end: { x: 0, y: 0 } },
  ]
  return {
    id: 'p1',
    name: 'Test',
    number: '1',
    layer: 'default',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    cutLine,
    seamLine: [],
    notches: [
      {
        id: 'n1',
        position: { x: 40, y: 0 },
        angle: 90,
        type: 'single',
        depth: 4,
        width: 6,
        sNormalized: 40 / 360,
        arcLengthMm: 40,
      },
      {
        id: 'n2',
        position: { x: 100, y: 40 },
        angle: 180,
        type: 'single',
        depth: 5,
        width: 6,
        sNormalized: (100 + 40) / 360,
        arcLengthMm: 140,
      },
    ],
    drills: [],
    internalLines: [
      { type: 'line' as const, start: { x: 20, y: 20 }, end: { x: 80, y: 20 } },
    ],
    internalCircles: [],
    grainLine: { start: { x: 50, y: 10 }, end: { x: 50, y: 70 } },
  }
}

describe('applyUniformScaleToPiece notches', () => {
  it('hält Kontur-Kerben am relativen Ort und skaliert Tiefe/Breite (×2)', () => {
    const piece = rectPiece()
    const pivot = { x: 0, y: 0 }
    const result = applyUniformScaleToPiece(piece, pivot, 2)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const n1 = result.piece.notches.find((n) => n.id === 'n1')!
    const n2 = result.piece.notches.find((n) => n.id === 'n2')!
    expect(n1.depth).toBeCloseTo(8, 6)
    expect(n1.width).toBeCloseTo(12, 6)
    expect(n1.sNormalized).toBeCloseTo(40 / 360, 5)
    expect(n1.arcLengthMm).toBeCloseTo(80, 3)

    const p1 = getNotchPositionAndAngle(n1, result.piece.cutLine).position
    expect(p1.x).toBeCloseTo(80, 3)
    expect(p1.y).toBeCloseTo(0, 3)

    const p2 = getNotchPositionAndAngle(n2, result.piece.cutLine).position
    expect(p2.x).toBeCloseTo(200, 3)
    expect(p2.y).toBeCloseTo(80, 3)
  })

  it('hält Kontur-Kerben beim Verkleinern (×0.5)', () => {
    const piece = rectPiece()
    const result = applyUniformScaleToPiece(piece, { x: 0, y: 0 }, 0.5)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const n1 = result.piece.notches.find((n) => n.id === 'n1')!
    const p1 = getNotchPositionAndAngle(n1, result.piece.cutLine).position
    expect(p1.x).toBeCloseTo(20, 3)
    expect(p1.y).toBeCloseTo(0, 3)
    expect(n1.depth).toBeCloseTo(2, 6)
    expect(totalPathLength(result.piece.cutLine)).toBeCloseTo(180, 3)
  })

  it('skaliert Kerben um nicht-Null-Pivot wie Konturpunkte', () => {
    const piece = rectPiece()
    const pivot = { x: 50, y: 40 }
    const s = 1.5
    const result = applyUniformScaleToPiece(piece, pivot, s)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const expected = scalePointAbout({ x: 40, y: 0 }, pivot, s)
    const n1 = result.piece.notches.find((n) => n.id === 'n1')!
    const p1 = getNotchPositionAndAngle(n1, result.piece.cutLine).position
    expect(p1.x).toBeCloseTo(expected.x, 2)
    expect(p1.y).toBeCloseTo(expected.y, 2)
  })

  it('skaliert Kerben auf internen Linien mit', () => {
    const piece = rectPiece()
    piece.notches.push({
      id: 'ni',
      position: { x: 50, y: 20 },
      angle: 90,
      type: 'single',
      depth: 3,
      width: 4,
      internalLineIndex: 0,
      internalSNormalized: 0.5,
      internalArcLengthMm: 30,
    })
    const result = applyUniformScaleToPiece(piece, { x: 0, y: 0 }, 2)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const ni = result.piece.notches.find((n) => n.id === 'ni')!
    expect(ni.internalLineIndex).toBe(0)
    expect(ni.internalSNormalized).toBeCloseTo(0.5, 5)
    expect(ni.depth).toBeCloseTo(6, 6)
    const pos = getNotchPositionAndAngleOnInternalLine(ni, result.piece.internalLines)!
    expect(pos.position.x).toBeCloseTo(100, 3)
    expect(pos.position.y).toBeCloseTo(40, 3)
  })

  it('große Faktoren (×3) verschieben Kerben nicht von der Kontur weg', () => {
    const piece = rectPiece()
    const result = applyUniformScaleToPiece(piece, { x: 0, y: 0 }, 3)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    for (const n of result.piece.notches) {
      if (n.internalLineIndex != null) continue
      const p = getNotchPositionAndAngle(n, result.piece.cutLine).position
      // Auf Unterkante oder rechter Seite
      const onBottom = Math.abs(p.y) < 0.5 && p.x >= -0.5 && p.x <= 300.5
      const onRight = Math.abs(p.x - 300) < 0.5 && p.y >= -0.5 && p.y <= 240.5
      expect(onBottom || onRight).toBe(true)
    }
  })
})

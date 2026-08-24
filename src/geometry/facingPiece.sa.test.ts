import { describe, expect, it } from 'vitest'
import type { Curve, PatternPiece } from '../types/model'
import { deriveCutLineForPiece } from './deriveCutLineForPiece'
import {
  buildFacingGeometryFromParent,
  chamferCollapsesSeamAllowance,
  seamToCutSampleDistances,
} from './facingPiece'

function base(seam: Curve[], cut: Curve[], softVertices: number[] = []): PatternPiece {
  return {
    id: 'p',
    number: '1',
    name: 't',
    cutLine: cut,
    seamLine: seam,
    seamAllowanceMm: 10,
    notches: [],
    drills: [],
    grainLine: null,
    internalLines: [],
    internalCircles: [],
    layer: 'CUT',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    softVertices,
    softVerticesMaster: [],
    fillInterior: true,
    material: '',
    bomQuantity: 1,
  }
}

describe('facing SA after parent-like rebuild', () => {
  const seam: Curve[] = [
    { type: 'line', start: { x: 10, y: 10 }, end: { x: 90, y: 10 } },
    { type: 'line', start: { x: 90, y: 10 }, end: { x: 90, y: 90 } },
    { type: 'line', start: { x: 90, y: 90 }, end: { x: 10, y: 90 } },
    { type: 'line', start: { x: 10, y: 90 }, end: { x: 10, y: 10 } },
  ]

  it('ignoriert veraltete softVertices der Mutter-cutLine', () => {
    const draft = base(seam, [])
    const derived = deriveCutLineForPiece(draft, seam, 10)
    expect(derived.ok).toBe(true)
    if (!derived.ok) return
    // Viele Cut-Indizes wie nach Edit/Remap — ungültig für neu abgeleitete Cut
    const bogusSoft = Array.from({ length: derived.cutLine.length }, (_, i) => i)
    const parent = {
      ...draft,
      cutLine: derived.cutLine,
      softVertices: bogusSoft,
      softVerticesMaster: [],
    }
    const facing = buildFacingGeometryFromParent(parent)
    const dists = seamToCutSampleDistances(facing.seamLine, facing.cutLine)
    for (const d of dists) expect(d).toBeGreaterThan(7)
  })

  it('Chamfer bleibt nach Mutter-Edit (kein Rollback an Kantenmitte)', () => {
    const editedSeam: Curve[] = [
      { type: 'line', start: { x: -15, y: -5 }, end: { x: 90, y: 10 } },
      { type: 'line', start: { x: 90, y: 10 }, end: { x: 110, y: 105 } },
      { type: 'line', start: { x: 110, y: 105 }, end: { x: 10, y: 90 } },
      { type: 'line', start: { x: 10, y: 90 }, end: { x: -15, y: -5 } },
    ]
    const draft = base(editedSeam, [])
    const derived = deriveCutLineForPiece(draft, editedSeam, 10)
    expect(derived.ok).toBe(true)
    if (!derived.ok) return
    const parent = { ...draft, cutLine: derived.cutLine }
    const facing = buildFacingGeometryFromParent(parent)
    expect(chamferCollapsesSeamAllowance(editedSeam, derived.cutLine, facing.cutLine, 10)).toBe(false)
    expect(facing.cutLine.length).toBeGreaterThanOrEqual(8)
  })

  it('chamferCollapsesSeamAllowance erkennt Einbruch pro Probe', () => {
    const cutOk: Curve[] = [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
      { type: 'line', start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
      { type: 'line', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
    ]
    // Cut kollabiert auf Naht (keine NZ)
    const cutBad = seam.map((c) =>
      c.type === 'line'
        ? { type: 'line' as const, start: { ...c.start }, end: { ...c.end } }
        : c
    )
    expect(chamferCollapsesSeamAllowance(seam, cutOk, cutBad, 10)).toBe(true)
    expect(chamferCollapsesSeamAllowance(seam, cutOk, cutOk, 10)).toBe(false)
  })
})

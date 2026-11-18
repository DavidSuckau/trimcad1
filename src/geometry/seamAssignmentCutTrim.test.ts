import { describe, expect, it } from 'vitest'
import type { Curve, PatternPiece, SeamMeasureDir } from '../types/model'
import { deriveCutLineFromSeamWithValidation } from './offset'
import { applySeamAssignmentCutTrim } from './seamAssignmentCutTrim'

function pieceFromSeam(id: string, seam: Curve[], sa: number): PatternPiece {
  const derived = deriveCutLineFromSeamWithValidation(seam, sa)
  if (!derived.ok) throw new Error(derived.message)
  return {
    id,
    number: '001',
    name: id,
    cutLine: derived.cutLine,
    seamLine: seam,
    seamAllowanceMm: sa,
    notches: [],
    drills: [],
    grainLine: null,
    internalLines: [],
    internalCircles: [],
    layer: 'CUT',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    softVertices: [],
    fillInterior: true,
    material: '',
    bomQuantity: 1,
  }
}

/** Rechteck, Naht = obere Kante (Index 0), beide Ecken 90°. */
function rectangle(id: string, sa: number): PatternPiece {
  return pieceFromSeam(id, [
    { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 80 } },
    { type: 'line', start: { x: 100, y: 80 }, end: { x: 0, y: 80 } },
    { type: 'line', start: { x: 0, y: 80 }, end: { x: 0, y: 0 } },
  ], sa)
}

/** Spitz links, 90° rechts. Naht = obere Kante. */
function sharpLeft(id: string, sa: number): PatternPiece {
  return pieceFromSeam(id, [
    { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 80 } },
    { type: 'line', start: { x: 100, y: 80 }, end: { x: 36, y: 80 } },
    { type: 'line', start: { x: 36, y: 80 }, end: { x: 0, y: 0 } },
  ], sa)
}

/** Spitz rechts, 90° links. Naht = obere Kante. */
function sharpRight(id: string, sa: number): PatternPiece {
  return pieceFromSeam(id, [
    { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    { type: 'line', start: { x: 100, y: 0 }, end: { x: 64, y: 80 } },
    { type: 'line', start: { x: 64, y: 80 }, end: { x: 0, y: 80 } },
    { type: 'line', start: { x: 0, y: 80 }, end: { x: 0, y: 0 } },
  ], sa)
}

function trim(
  a: PatternPiece,
  b: PatternPiece,
  dirA: SeamMeasureDir,
  dirB: SeamMeasureDir,
) {
  return applySeamAssignmentCutTrim(a, b, [0], [0], { measureDirA: dirA, measureDirB: dirB })
}

/** Längstes Cut-Segment, das parallel zur oberen Naht und um sa versetzt ist. */
function topAllowance(piece: PatternPiece, sa: number) {
  let best: Curve | null = null
  let bestLen = 0
  for (const c of piece.cutLine) {
    if (c.type !== 'line') continue
    const len = Math.hypot(c.end.x - c.start.x, c.end.y - c.start.y)
    const parallel = Math.abs(c.end.y - c.start.y) < 0.4 && Math.abs(c.start.y - -sa) < 0.6 && Math.abs(c.end.y - -sa) < 0.6
    if (parallel && len > bestLen) {
      best = c
      bestLen = len
    }
  }
  return best
}

describe('Naht-Ecken an der Messrichtung abschneiden', () => {
  const sa = 10

  it('schneidet die spitze Ecke am Nahtanfang ab und lässt die Zugabe parallel', () => {
    const sharp = sharpLeft('a', sa)
    const square = rectangle('b', sa)
    const before = topAllowance(sharp, sa)
    expect(before).toBeTruthy()
    const leftBefore = Math.min(before!.start.x, before!.end.x)

    const out = trim(sharp, square, 1, 1)
    expect(out).not.toBeNull()
    const top = topAllowance(out!.pieceA, sa)
    expect(top).toBeTruthy()
    const left = Math.min(top!.start.x, top!.end.x)
    const right = Math.max(top!.start.x, top!.end.x)
    expect(left).toBeGreaterThan(leftBefore + 5)
    expect(left).toBeCloseTo(-sa, 0)
    expect(right).toBeGreaterThan(100)
    expect(Math.abs(top!.start.y - -sa)).toBeLessThan(0.4)
    expect(Math.abs(top!.end.y - -sa)).toBeLessThan(0.4)
    expect(topAllowance(out!.pieceB, sa)).toBeTruthy()
  })

  it('folgt dem Pfeil: bei umgekehrter Richtung wird die andere Ecke abgeschnitten', () => {
    const sharp = sharpRight('a', sa)
    const square = rectangle('b', sa)
    const out = trim(sharp, square, -1, 1)
    expect(out).not.toBeNull()
    const top = topAllowance(out!.pieceA, sa)
    expect(top).toBeTruthy()
    const right = Math.max(top!.start.x, top!.end.x)
    expect(right).toBeLessThan(100 + sa + 2)
    expect(right).toBeCloseTo(100 + sa, 0)
    expect(Math.abs(top!.end.y - top!.start.y)).toBeLessThan(0.4)
  })

  it('schneidet die Ecke, die der Pfeil trifft, nicht die gegenüberliegende Spitze', () => {
    const leftSharp = sharpLeft('a', sa)
    const rightSharp = sharpRight('b', sa)
    const out = trim(leftSharp, rightSharp, 1, 1)
    expect(out).not.toBeNull()
    const topA = topAllowance(out!.pieceA, sa)
    const topB = topAllowance(out!.pieceB, sa)
    expect(topA && topB).toBeTruthy()
    expect(Math.min(topA!.start.x, topA!.end.x)).toBeCloseTo(-sa, 0)
    expect(Math.max(topB!.start.x, topB!.end.x)).toBeCloseTo(100 + sa, 0)
    expect(Math.abs(topA!.end.y - topA!.start.y)).toBeLessThan(0.4)
    expect(Math.abs(topB!.end.y - topB!.start.y)).toBeLessThan(0.4)
  })

  it('liegt nach dem Aufeinanderlegen deckungsgleich auf der Partner-Ecke', () => {
    const sa = 10
    const sharp = sharpLeft('a', sa)
    const square = rectangle('b', sa)
    const out = trim(sharp, square, 1, 1)
    expect(out).not.toBeNull()
    const cut = out!.pieceA.cutLine
    const partner = square.cutLine
    const near = (p: { x: number; y: number }) => p.x < 35 && p.y < 5 && p.y > -sa - 8
    const distSeg = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
      const abx = b.x - a.x
      const aby = b.y - a.y
      const ab2 = abx * abx + aby * aby
      const t = ab2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / ab2))
      return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby))
    }
    const distRing = (p: { x: number; y: number }, curves: typeof cut) =>
      Math.min(...curves.map((c) => distSeg(p, c.start, c.end)))
    for (const c of cut) {
      if (!near(c.start)) continue
      expect(distRing(c.start, partner)).toBeLessThan(0.4)
    }
    const partnerCorner = partner.map((c) => c.start).find((p) => Math.hypot(p.x - -sa, p.y - -sa) < 1)
    expect(partnerCorner).toBeTruthy()
    expect(distRing(partnerCorner!, cut)).toBeLessThan(0.4)
  })

  it('lässt gleiche 90°-Ecken unverändert und ist beim zweiten Mal stabil', () => {
    const a = rectangle('a', sa)
    const b = rectangle('b', sa)
    expect(trim(a, b, 1, 1)).toBeNull()

    const once = trim(sharpLeft('a', sa), rectangle('b', sa), 1, 1)
    expect(once).not.toBeNull()
    expect(trim(once!.pieceA, once!.pieceB, 1, 1)).toBeNull()
  })
})

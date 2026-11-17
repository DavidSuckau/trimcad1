import { describe, expect, it } from 'vitest'
import type { Curve, PatternPiece, Point } from '../types/model'
import { applyFaechernToPiece, planFaechern, type FaechernHit } from './faechern'
import { curvesToPolygon } from './pointInPolygon'

function rect(): Curve[] {
  const p: Point[] = [
    { x: 0, y: 80 },
    { x: 100, y: 80 },
    { x: 100, y: 0 },
    { x: 0, y: 0 },
  ]
  return p.map((start, i) => ({
    type: 'line' as const,
    start,
    end: p[(i + 1) % p.length],
  }))
}

function pieceOf(cut: Curve[], extra: Partial<PatternPiece> = {}): PatternPiece {
  return {
    id: 'p1',
    number: '001',
    name: 'Test',
    cutLine: cut,
    seamLine: [],
    notches: [],
    drills: [],
    grainLine: { start: { x: 50, y: 60 }, end: { x: 50, y: 20 } },
    internalLines: [],
    internalCircles: [],
    layer: 'CUT',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    ...extra,
  }
}

function hit(curves: Curve[], curveIndex: number, t: number): FaechernHit {
  const c = curves[curveIndex]
  return {
    curveIndex,
    t,
    point: {
      x: c.start.x + (c.end.x - c.start.x) * t,
      y: c.start.y + (c.end.y - c.start.y) * t,
    },
  }
}

function area(curves: Curve[]): number {
  const pts = curvesToPolygon(curves)
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    a += p.x * q.y - q.x * p.y
  }
  return Math.abs(a) / 2
}

function hasPointNear(curves: Curve[], p: Point, tol = 0.6): boolean {
  return curves.some((c) => Math.hypot(c.start.x - p.x, c.start.y - p.y) <= tol)
}

describe('Fächern', () => {
  const curves = rect()
  // Rechtsmitte = Drehpunkt, links zwei Öffnungen. Oben (A) bleibt, unten (B) dreht zu.
  const pivot = hit(curves, 1, 0.5)
  const openingA = hit(curves, 3, 0.625)
  const openingB = hit(curves, 3, 0.375)

  it('schließt den Keil und lässt die erste Öffnung liegen', () => {
    const plan = planFaechern(curves, pivot, openingA, openingB)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(Math.abs(plan.plan.angleRad)).toBeGreaterThan(0.05)
    expect(Math.abs(plan.plan.angleRad)).toBeLessThan(0.5)

    const r = applyFaechernToPiece(pieceOf(curves), pivot, openingA, openingB)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const next = r.piece.cutLine
    expect(next.length).toBeGreaterThanOrEqual(3)
    const first = next[0].start
    const last = next[next.length - 1].end
    expect(Math.hypot(first.x - last.x, first.y - last.y)).toBeLessThan(0.05)
    expect(hasPointNear(next, { x: 0, y: 80 })).toBe(true)
    expect(hasPointNear(next, { x: 0, y: 0 })).toBe(false)
    expect(area(next)).toBeLessThan(area(curves) - 50)
    expect(area(next)).toBeGreaterThan(area(curves) * 0.5)
  })

  it('entfernt eine Kerbe in der Öffnung und dreht eine Kerbe auf der bewegten Seite', () => {
    const base = pieceOf(curves, {
      notches: [
        { id: 'top', position: { x: 50, y: 80 }, angle: 0, type: 'single', depth: 3 },
        { id: 'mouth', position: { x: 0, y: 40 }, angle: 0, type: 'single', depth: 3 },
        { id: 'bottom', position: { x: 50, y: 0 }, angle: 0, type: 'single', depth: 3 },
      ],
    })
    const r = applyFaechernToPiece(base, pivot, openingA, openingB)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const ids = r.piece.notches.map((n) => n.id)
    expect(ids).toContain('top')
    expect(ids).not.toContain('mouth')
    expect(ids).toContain('bottom')
    const bottom = r.piece.notches.find((n) => n.id === 'bottom')!
    expect(Math.hypot(bottom.position.x - 50, bottom.position.y)).toBeGreaterThan(2)
    const top = r.piece.notches.find((n) => n.id === 'top')!
    expect(Math.hypot(top.position.x - 50, top.position.y - 80)).toBeLessThan(1)
  })

  it('lehnt zusammenfallende Punkte ab', () => {
    const r = planFaechern(curves, pivot, openingA, openingA)
    expect(r.ok).toBe(false)
  })
})

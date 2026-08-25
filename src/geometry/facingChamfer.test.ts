import { describe, expect, it } from 'vitest'
import type { Curve, PatternPiece } from '../types/model'
import { chamferCutLineCornersInSeamAllowance } from './facingChamfer'
import { curveSegmentArcLength } from './curveToPath'

function square(size: number, origin = 0): Curve[] {
  const o = origin
  const s = size
  return [
    { type: 'line', start: { x: o, y: o }, end: { x: o + s, y: o } },
    { type: 'line', start: { x: o + s, y: o }, end: { x: o + s, y: o + s } },
    { type: 'line', start: { x: o + s, y: o + s }, end: { x: o, y: o + s } },
    { type: 'line', start: { x: o, y: o + s }, end: { x: o, y: o } },
  ]
}

function basePiece(cutLine: Curve[], seamLine: Curve[], sa: number | null): PatternPiece {
  return {
    id: 'p1',
    number: '001',
    name: 'Test',
    cutLine,
    seamLine,
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

/** Abstand Punkt → Gerade durch a–b */
function distPointToSegLine(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y)
  return Math.abs(dx * (a.y - p.y) - dy * (a.x - p.x)) / len
}

describe('chamferCutLineCornersInSeamAllowance', () => {
  it('ohne NZ bleibt cutLine unverändert (4 Segmente)', () => {
    const cut = square(100)
    const piece = basePiece(cut, [], null)
    const out = chamferCutLineCornersInSeamAllowance(piece)
    expect(out).toHaveLength(4)
  })

  it('Rechteck mit NZ 10 mm: Fase geht durch Naht-Ecke (maximal)', () => {
    // Konzentrisch: Naht 10…110, Schnitt 0…120 → SA 10 mm
    const seam = square(100, 10)
    const cut = square(120, 0)
    const piece = basePiece(cut, seam, 10)
    const out = chamferCutLineCornersInSeamAllowance(piece)
    expect(out.length).toBe(8)
    // Untere Kante: von (20,0) bis (100,0) → Länge 80 (Trim je 20 mm = 2×SA)
    const bottom = out.find(
      (c) =>
        c.type === 'line' &&
        Math.abs(c.start.y) < 1e-6 &&
        Math.abs(c.end.y) < 1e-6 &&
        Math.min(c.start.x, c.end.x) > 15
    )
    expect(bottom).toBeTruthy()
    if (bottom && bottom.type === 'line') {
      expect(curveSegmentArcLength(bottom, 0, 1)).toBeCloseTo(80, 0)
    }
    // Fase durch Naht-Ecke (10,10), Länge 20√2
    const chamfer = out.find(
      (c) =>
        c.type === 'line' &&
        distPointToSegLine({ x: 10, y: 10 }, c.start, c.end) < 0.05 &&
        curveSegmentArcLength(c, 0, 1) > 20
    )
    expect(chamfer).toBeTruthy()
    if (chamfer && chamfer.type === 'line') {
      expect(curveSegmentArcLength(chamfer, 0, 1)).toBeCloseTo(Math.SQRT2 * 20, 0)
    }
  })

  it('weiche Ecke wird nicht abgeschrägt', () => {
    const cut = square(120, 0)
    const piece = basePiece(cut, square(100, 10), 10)
    piece.softVerticesMaster = [0, 1, 2, 3]
    const out = chamferCutLineCornersInSeamAllowance(piece)
    expect(out).toHaveLength(4)
  })

  it('tessellierte Kurve: Zwischenpunkte nicht chamfern, NZ bleibt erhalten', () => {
    const seam = square(100, 10)
    const cut: Curve[] = []
    cut.push({ type: 'line', start: { x: 0, y: 0 }, end: { x: 120, y: 0 } })
    cut.push({ type: 'line', start: { x: 120, y: 0 }, end: { x: 120, y: 120 } })
    cut.push({ type: 'line', start: { x: 120, y: 120 }, end: { x: 0, y: 120 } })
    const leftPts: { x: number; y: number }[] = []
    const steps = 12
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const y = 120 - t * 120
      const bulge = 15 * Math.sin(Math.PI * t)
      leftPts.push({ x: -bulge, y })
    }
    for (let i = 0; i < leftPts.length - 1; i++) {
      cut.push({ type: 'line', start: { ...leftPts[i] }, end: { ...leftPts[i + 1] } })
    }
    const piece = basePiece(cut, seam, 10)
    const out = chamferCutLineCornersInSeamAllowance(piece)
    // Tessellationspunkte auf der Kurve bleiben; Ecken bekommen lokale Fasen
    expect(out.length).toBeGreaterThanOrEqual(8)
    const midLeft = out.find(
      (c) =>
        c.type === 'line' &&
        Math.abs((c.start.y + c.end.y) / 2 - 60) < 8 &&
        c.start.x < 5 &&
        c.end.x < 5
    )
    expect(midLeft).toBeTruthy()
    if (midLeft && midLeft.type === 'line') {
      expect(Math.min(midLeft.start.x, midLeft.end.x)).toBeLessThan(-5)
    }
    // Gerade Kanten: NZ an der Mitte bleibt (~10 mm)
    for (const edge of [seam[0], seam[1], seam[2]]) {
      const mid = { x: (edge.start.x + edge.end.x) / 2, y: (edge.start.y + edge.end.y) / 2 }
      let best = Infinity
      for (const s of out) {
        if (s.type !== 'line') continue
        const ax = s.start.x,
          ay = s.start.y,
          bx = s.end.x,
          by = s.end.y
        const dx = bx - ax,
          dy = by - ay
        const len2 = dx * dx + dy * dy
        let t = len2 < 1e-12 ? 0 : ((mid.x - ax) * dx + (mid.y - ay) * dy) / len2
        t = Math.max(0, Math.min(1, t))
        best = Math.min(best, Math.hypot(mid.x - (ax + t * dx), mid.y - (ay + t * dy)))
      }
      expect(best).toBeGreaterThan(8)
    }
  })

  it('tessellierte Miter-Spitze: kurze Segmente an der Ecke werden mit abgeschnitten', () => {
    const seam = square(100, 10)
    // Spitze (0,0) mit Clipper-ähnlichen Kurzsegmenten, dann lange Kanten
    const cut: Curve[] = [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 1.5, y: 0 } },
      { type: 'line', start: { x: 1.5, y: 0 }, end: { x: 4, y: 0 } },
      { type: 'line', start: { x: 4, y: 0 }, end: { x: 120, y: 0 } },
      { type: 'line', start: { x: 120, y: 0 }, end: { x: 120, y: 120 } },
      { type: 'line', start: { x: 120, y: 120 }, end: { x: 0, y: 120 } },
      { type: 'line', start: { x: 0, y: 120 }, end: { x: 0, y: 4 } },
      { type: 'line', start: { x: 0, y: 4 }, end: { x: 0, y: 1.5 } },
      { type: 'line', start: { x: 0, y: 1.5 }, end: { x: 0, y: 0 } },
    ]
    const piece = basePiece(cut, seam, 10)
    const out = chamferCutLineCornersInSeamAllowance(piece)
    const tipStillPresent = out.some(
      (c) =>
        c.type === 'line' &&
        (Math.hypot(c.start.x, c.start.y) < 0.4 || Math.hypot(c.end.x, c.end.y) < 0.4),
    )
    expect(tipStillPresent).toBe(false)
    const chamferAtSeam = out.find(
      (c) =>
        c.type === 'line' &&
        distPointToSegLine({ x: 10, y: 10 }, c.start, c.end) < 0.5 &&
        curveSegmentArcLength(c, 0, 1) > 15,
    )
    expect(chamferAtSeam).toBeTruthy()
  })
})

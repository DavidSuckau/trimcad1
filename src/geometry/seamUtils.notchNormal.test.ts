import { describe, expect, it } from 'vitest'
import type { Curve, PatternPiece } from '../types/model'
import { deriveCutLineForPiece } from './deriveCutLineForPiece'
import { getNotchesOnEdge, materializeNotchAtEdgeArcLength } from './seamUtils'

function basePiece(cutLine: Curve[], seamLine: Curve[], sa: number): PatternPiece {
  return {
    id: 'p',
    number: '001',
    name: 'T',
    cutLine,
    seamLine,
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
    seamAllowanceMm: sa,
  }
}

describe('materializeNotchAtEdgeArcLength Normalen-Mapping', () => {
  it('Kerbe auf Kurve mit NZ bleibt nach Materialisieren auf derselben Master-Bogenlänge', () => {
    const seam: Curve[] = [
      { type: 'bezier', start: { x: 0, y: 0 }, cp1: { x: 30, y: 40 }, cp2: { x: 70, y: -40 }, end: { x: 100, y: 0 } },
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 50 } },
      { type: 'line', start: { x: 100, y: 50 }, end: { x: 0, y: 50 } },
      { type: 'line', start: { x: 0, y: 50 }, end: { x: 0, y: 0 } },
    ]
    const draft = basePiece(seam, seam, 10)
    const derived = deriveCutLineForPiece(draft, seam, 10)
    expect(derived.ok).toBe(true)
    if (!derived.ok) return
    const piece = { ...draft, cutLine: derived.cutLine, seamLine: seam }

    for (const target of [25, 55, 80]) {
      const n = materializeNotchAtEdgeArcLength(
        { id: `n${target}`, position: { x: 0, y: 0 }, angle: 90, type: 'single', depth: 4, width: 6 },
        piece,
        [0],
        target,
      )
      expect(n).toBeTruthy()
      const onEdge = getNotchesOnEdge({ ...piece, notches: [n!] }, [0])
      expect(onEdge).toHaveLength(1)
      expect(Math.abs(onEdge[0]!.arcLength - target)).toBeLessThan(1.0)
    }
  })
})

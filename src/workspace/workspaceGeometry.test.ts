import { describe, expect, it } from 'vitest'
import { buildCirclePolygonCutLine, buildRectangleCutLine } from './workspaceGeometry'

describe('workspaceGeometry', () => {
  it('Rechteck hat 4 Kontursegmente', () => {
    const c = buildRectangleCutLine(100, 80)
    expect(c.length).toBe(4)
  })

  it('Kreis-Polygon hat gewuenschte Segmentanzahl', () => {
    const c = buildCirclePolygonCutLine(50, 24)
    expect(c.length).toBe(24)
  })
})

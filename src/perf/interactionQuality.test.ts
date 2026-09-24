import { describe, expect, it } from 'vitest'
import {
  curveBoundsPad,
  nearestCurveQualityFor,
  pieceGeomEpoch,
  shouldRenderDetailNotchOverlay,
  shouldShowContourMeasurementsLive,
  shouldShowSeamPruefLive,
  shouldSimplifyNotchRender,
} from './interactionQuality'

describe('nearestCurveQualityFor', () => {
  it('returns coarse when dragging or performanceMode', () => {
    expect(nearestCurveQualityFor('dragging', false)).toBe('coarse')
    expect(nearestCurveQualityFor('normal', true)).toBe('coarse')
    expect(nearestCurveQualityFor('idle', true)).toBe('coarse')
  })

  it('returns fine otherwise', () => {
    expect(nearestCurveQualityFor('normal', false)).toBe('fine')
    expect(nearestCurveQualityFor('idle', false)).toBe('fine')
  })
})

describe('live overlay gates', () => {
  it('hides seam prüf during drag or performance mode', () => {
    expect(shouldShowSeamPruefLive('dragging', true, false)).toBe(false)
    expect(shouldShowSeamPruefLive('normal', true, true)).toBe(false)
    expect(shouldShowSeamPruefLive('normal', true, false)).toBe(true)
    expect(shouldShowSeamPruefLive('normal', false, false)).toBe(false)
  })

  it('hides contour measurements the same way', () => {
    expect(shouldShowContourMeasurementsLive('dragging', true, false)).toBe(false)
    expect(shouldShowContourMeasurementsLive('idle', true, false)).toBe(true)
  })

  it('simplifies notches when dragging or performanceMode', () => {
    expect(shouldSimplifyNotchRender('dragging', false)).toBe(true)
    expect(shouldSimplifyNotchRender('normal', true)).toBe(true)
    expect(shouldSimplifyNotchRender('normal', false)).toBe(false)
  })

  it('detail notch overlay only for selected/hovered/drag piece', () => {
    expect(
      shouldRenderDetailNotchOverlay({
        simplifyNotches: false,
        isSelected: false,
        isHovered: false,
        pieceHasDraggedNotch: false,
      }),
    ).toBe(false)
    expect(
      shouldRenderDetailNotchOverlay({
        simplifyNotches: false,
        isSelected: true,
        isHovered: false,
        pieceHasDraggedNotch: false,
      }),
    ).toBe(true)
    expect(
      shouldRenderDetailNotchOverlay({
        simplifyNotches: false,
        isSelected: false,
        isHovered: true,
        pieceHasDraggedNotch: false,
      }),
    ).toBe(true)
    expect(
      shouldRenderDetailNotchOverlay({
        simplifyNotches: true,
        isSelected: true,
        isHovered: true,
        pieceHasDraggedNotch: true,
      }),
    ).toBe(false)
  })
})

describe('pieceGeomEpoch', () => {
  it('builds a cheap fingerprint from lengths and counts', () => {
    const a = pieceGeomEpoch({
      id: 'p1',
      cutLine: [{}, {}, {}],
      seamLine: [{}, {}],
      notches: [{}, {}],
      softVertices: [0, 1],
      seamAllowanceMm: 10,
    })
    const b = pieceGeomEpoch({
      id: 'p1',
      cutLine: [{}, {}, {}],
      seamLine: [{}, {}],
      notches: [{}, {}],
      softVertices: [0, 1],
      seamAllowanceMm: 10,
    })
    expect(a).toBe(b)
    expect(a).toContain('p1')
    expect(a).toContain('3')
    expect(a).toContain('2')
  })

  it('changes when topology lengths change', () => {
    const a = pieceGeomEpoch({
      id: 'p1',
      cutLine: [{}, {}],
      seamLine: [],
      notches: [],
    })
    const b = pieceGeomEpoch({
      id: 'p1',
      cutLine: [{}, {}, {}],
      seamLine: [],
      notches: [],
    })
    expect(a).not.toBe(b)
  })

  it('ändert sich wenn nur Bézier-Kontrollpunkte verschoben werden', () => {
    const base = {
      id: 'p1',
      seamLine: [],
      notches: [] as [],
    }
    const a = pieceGeomEpoch({
      ...base,
      cutLine: [
        {
          type: 'bezier',
          start: { x: 0, y: 0 },
          end: { x: 100, y: 0 },
          cp1: { x: 30, y: 0 },
          cp2: { x: 70, y: 0 },
        },
      ],
    })
    const b = pieceGeomEpoch({
      ...base,
      cutLine: [
        {
          type: 'bezier',
          start: { x: 0, y: 0 },
          end: { x: 100, y: 0 },
          cp1: { x: 30, y: 40 },
          cp2: { x: 70, y: -40 },
        },
      ],
    })
    expect(a).not.toBe(b)
  })

  it('ändert sich wenn eine Kerbe verschoben wird (gleiche Anzahl)', () => {
    const base = {
      id: 'p1',
      cutLine: [{ type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } }],
      seamLine: [],
    }
    const a = pieceGeomEpoch({
      ...base,
      notches: [{ id: 'n1', position: { x: 40, y: 0 }, angle: 90, depth: 4, width: 6 }],
    })
    const b = pieceGeomEpoch({
      ...base,
      notches: [{ id: 'n1', position: { x: 70, y: 0 }, angle: 90, depth: 4, width: 6 }],
    })
    expect(a).not.toBe(b)
  })

  it('ändert sich wenn ein Eckpunkt jenseits Index 12 nur in Y bewegt wird', () => {
    const line = (x0: number, y0: number, x1: number, y1: number) => ({
      type: 'line' as const,
      start: { x: x0, y: y0 },
      end: { x: x1, y: y1 },
    })
    // 16 Segmente: früher wurden nur die ersten 12 gehasht → Vertex 14 blieb unsichtbar für den Cache.
    const cutA = Array.from({ length: 16 }, (_, i) => line(i * 10, 0, (i + 1) * 10, 0))
    const cutB = cutA.map((c, i) =>
      i === 14
        ? { ...c, start: { x: c.start.x, y: 25 }, end: { ...c.end } }
        : i === 13
          ? { ...c, end: { x: c.end.x, y: 25 } }
          : c,
    )
    const base = { id: 'p1', seamLine: [], notches: [] as [] }
    expect(pieceGeomEpoch({ ...base, cutLine: cutA })).not.toBe(pieceGeomEpoch({ ...base, cutLine: cutB }))
  })
})

describe('curveBoundsPad', () => {
  it('bounds line endpoints', () => {
    expect(
      curveBoundsPad({
        type: 'line',
        start: { x: 0, y: 10 },
        end: { x: 20, y: 0 },
      }),
    ).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 10 })
  })

  it('includes bezier control points', () => {
    const b = curveBoundsPad({
      type: 'bezier',
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
      cp1: { x: 2, y: 50 },
      cp2: { x: 8, y: -5 },
    })
    expect(b).toEqual({ minX: 0, minY: -5, maxX: 10, maxY: 50 })
  })
})

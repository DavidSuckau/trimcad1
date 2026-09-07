import { describe, expect, it } from 'vitest'
import {
  curveBoundsPad,
  nearestCurveQualityFor,
  pieceGeomEpoch,
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
})

describe('pieceGeomEpoch', () => {
  it('builds a cheap fingerprint from lengths and counts', () => {
    const a = pieceGeomEpoch({
      id: 'p1',
      cutLine: [{}, {}, {}],
      seamLine: [{}, {}],
      notches: { length: 2 },
      softVertices: [0, 1],
      seamAllowanceMm: 10,
    })
    const b = pieceGeomEpoch({
      id: 'p1',
      cutLine: [{}, {}, {}],
      seamLine: [{}, {}],
      notches: { length: 2 },
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
      notches: { length: 0 },
    })
    const b = pieceGeomEpoch({
      id: 'p1',
      cutLine: [{}, {}, {}],
      seamLine: [],
      notches: { length: 0 },
    })
    expect(a).not.toBe(b)
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

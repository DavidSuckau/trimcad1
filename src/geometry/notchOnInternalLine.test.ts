import { describe, it, expect } from 'vitest'
import type { Curve, Notch } from '../types/model'
import {
  isNotchOnInternalLine,
  materializeNotchAnchorsOnInternalLine,
  resolveNotchInternalLineAnchor,
  remapNotchesAfterInternalLineRemove,
} from './notchOnInternalLine'
import { isInternalNotchSpacingValid } from './notchMinSpacing'
import { cutLineWithNotchCutouts, getNotchCurveIndexAndT } from './notchOnCurve'
import type { PatternPiece } from '../types/model'

const internalLines: Curve[] = [
  { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
  { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 50 } },
]

describe('notchOnInternalLine', () => {
  it('materialize and resolve anchor along open polyline', () => {
    const raw: Notch = {
      id: 'n1',
      position: { x: 50, y: 0 },
      angle: 90,
      type: 'single',
      depth: 3,
      internalLineIndex: 0,
    }
    const m = materializeNotchAnchorsOnInternalLine(raw, internalLines)!
    expect(isNotchOnInternalLine(m)).toBe(true)
    expect(m.sNormalized).toBeUndefined()
    expect(m.internalSNormalized).toBeCloseTo(0.5, 3)
    const a = resolveNotchInternalLineAnchor(m, internalLines)!
    expect(a.curveIndex).toBe(0)
    expect(a.t).toBeCloseTo(0.5, 3)
  })

  it('removes notches on deleted segment and reindexes', () => {
    const notches: Notch[] = [
      {
        id: 'a',
        position: { x: 1, y: 0 },
        angle: 0,
        type: 'single',
        depth: 2,
        internalLineIndex: 1,
      },
      {
        id: 'b',
        position: { x: 1, y: 0 },
        angle: 0,
        type: 'single',
        depth: 2,
        internalLineIndex: 0,
      },
    ]
    const out = remapNotchesAfterInternalLineRemove(notches, 0)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('a')
    expect(out[0].internalLineIndex).toBe(0)
  })

  it('spacing along internal lines is independent of cut notches', () => {
    const piece: PatternPiece = {
      id: 'p',
      number: '1',
      name: 'T',
      cutLine: [
        { type: 'line', start: { x: 0, y: 10 }, end: { x: 200, y: 10 } },
        { type: 'line', start: { x: 200, y: 10 }, end: { x: 200, y: 110 } },
        { type: 'line', start: { x: 200, y: 110 }, end: { x: 0, y: 110 } },
        { type: 'line', start: { x: 0, y: 110 }, end: { x: 0, y: 10 } },
      ],
      seamLine: [],
      notches: [
        {
          id: 'i1',
          position: { x: 10, y: 0 },
          angle: 90,
          type: 'single',
          depth: 2,
          internalLineIndex: 0,
          internalSNormalized: 0.1,
        },
      ],
      drills: [],
      grainLine: null,
      internalLines,
      internalCircles: [],
      layer: 'default',
      transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    }
    expect(isInternalNotchSpacingValid(piece, 0, 0.12)).toBe(false)
    expect(isInternalNotchSpacingValid(piece, 0, 0.5)).toBe(true)
    expect(isInternalNotchSpacingValid(piece, 1, 0.12)).toBe(true)
  })

  it('internal notches do not cut or anchor on cutLine', () => {
    const cutLine: Curve[] = [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
      { type: 'line', start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
      { type: 'line', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
    ]
    const internalNotch: Notch = {
      id: 'v-int',
      position: { x: 50, y: 50 },
      angle: 90,
      type: 'v',
      depth: 4,
      width: 6,
      internalLineIndex: 0,
      internalSNormalized: 0.5,
    }
    expect(getNotchCurveIndexAndT(internalNotch, cutLine)).toBeNull()
    const withInternal = cutLineWithNotchCutouts(cutLine, [internalNotch], [])
    const baseline = cutLineWithNotchCutouts(cutLine, [], [])
    expect(withInternal.length).toBe(baseline.length)
  })
})

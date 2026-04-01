import { describe, it, expect } from 'vitest'
import {
  detectNotchesInPolyline,
  normalizeClosedPolylineVertices,
} from './notchDetection'

describe('normalizeClosedPolylineVertices', () => {
  it('entfernt doppelten Schließpunkt', () => {
    const v = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 0 },
    ]
    const n = normalizeClosedPolylineVertices(v)
    expect(n).toHaveLength(3)
    expect(n[0]).toEqual({ x: 0, y: 0 })
    expect(n[2]).toEqual({ x: 10, y: 10 })
  })
})

describe('detectNotchesInPolyline', () => {
  it('erkennt eine V-Kerbe auf geschlossener Kontur (CCW) und entfernt nur die Spitze', () => {
    // Rechteck CCW mit Kerbe an der unteren Kante: Schultern (4,0),(6,0), Spitze (5,2)
    const withDup = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 5, y: 2 },
      { x: 6, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ]
    const { cleanedVertices, notches } = detectNotchesInPolyline(withDup)
    expect(notches).toHaveLength(1)
    expect(notches[0].depth).toBeGreaterThan(1)
    expect(notches[0].width).toBeGreaterThan(1)
    // Eine Spitze entfernt → 7 statt 8 Vertices (mit Schließpunkt)
    expect(cleanedVertices.length).toBe(withDup.length - 1)
  })

  it('unterstützt geschlossene Polylinie ohne doppelten Schließpunkt (closedRing)', () => {
    const ring = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 5, y: 2 },
      { x: 6, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    const { cleanedVertices, notches } = detectNotchesInPolyline(ring, { closedRing: true })
    expect(notches).toHaveLength(1)
    expect(cleanedVertices.length).toBe(ring.length - 1)
  })

  it('liefert keine Kerben bei zu großen Segmenten', () => {
    const withDup = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 5, y: 5 },
      { x: 6, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ]
    const { notches } = detectNotchesInPolyline(withDup, { shortSegmentMaxMm: 3 })
    expect(notches).toHaveLength(0)
  })
})

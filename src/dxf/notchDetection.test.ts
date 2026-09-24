import { describe, it, expect } from 'vitest'
import {
  detectNotchesInPolyline,
  normalizeClosedPolylineVertices,
} from './notchDetection'
import { detectNotchesWithToleranceFallback } from './dxfImporter'

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

  it('erkennt U-förmige Strich-/Schlitzkerbe (langer Kantenabschnitt vor der Kerbe)', () => {
    // Untere Kante: langes Segment (0,0)→(4,0), dann Schlitz (4,0)→(4,2)→(8,2)→(8,0), dann weiter — V-Logik scheitert am ersten Eck wegen langem Schenkel.
    const withDup = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 8, y: 2 },
      { x: 8, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ]
    const { cleanedVertices, notches } = detectNotchesInPolyline(withDup)
    expect(notches).toHaveLength(1)
    expect(notches[0].isSlit).toBe(true)
    expect(notches[0].depth).toBeGreaterThan(0.5)
    expect(cleanedVertices.length).toBe(withDup.length - 2)
  })

  it('legLengthMode asymmetric: ein deutlich längerer Schenkel (kurzer + langer Schenkel)', () => {
    // Kürzeres Bein ~4.1 mm, längeres ~9.9 mm — bei shortMax=9 scheitert Modus both, asymmetric erlaubt bis ~16.6 mm auf der langen Seite.
    const withDup = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 5, y: 4 },
      { x: 14, y: 0 },
      { x: 15, y: 0 },
      { x: 15, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ]
    const bothMode = detectNotchesInPolyline(withDup, { shortSegmentMaxMm: 9, minAngleDeg: 35 })
    const asym = detectNotchesInPolyline(withDup, {
      shortSegmentMaxMm: 9,
      minAngleDeg: 35,
      legLengthMode: 'asymmetric',
    })
    expect(bothMode.notches.length).toBe(0)
    expect(asym.notches.length).toBe(1)
  })

  it('erkennt V-Kerbe auf schräger Geraden (rotationsinvariant bzgl. Winkel)', () => {
    // Diagonale Kante mit V-Einbuchtung nach innen: Schenkel 2.5 mm, Knickwinkel klar > 45°.
    const withDup = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 9, y: 11 },
      { x: 7.5, y: 9 },
      { x: 6, y: 11 },
      { x: 0, y: 20 },
      { x: 0, y: 0 },
    ]
    const { notches } = detectNotchesInPolyline(withDup)
    expect(notches.length).toBe(1)
  })
})

describe('detectNotchesWithToleranceFallback', () => {
  it('findet kurze Gerade-Kerbe und längere/schräge Kerbe zusammen (kein Early-Return auf strict)', () => {
    // Unten: klassische kurze V-Kerbe (strict). Rechts: längere Schenkel ~5.8 mm nach innen (erst relaxed).
    // Früher: strict fand 1 Kerbe und brach ab → rechte Einbuchtung blieb als große Konturgeometrie.
    const withDup = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 5, y: 2 },
      { x: 6, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 7 },
      { x: 15, y: 10 },
      { x: 20, y: 13 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
      { x: 0, y: 0 },
    ]
    const strictOnly = detectNotchesInPolyline(withDup)
    expect(strictOnly.notches.length).toBe(1)

    const { notches, notchTier, cleanedVertices } = detectNotchesWithToleranceFallback(withDup, true)
    expect(notches.length).toBe(2)
    expect(notchTier).not.toBe('strict')
    expect(notchTier).not.toBeNull()
    // Beide Spitzen entfernt (+ Schließpunkt bleibt)
    expect(cleanedVertices.length).toBe(withDup.length - 2)
  })
})

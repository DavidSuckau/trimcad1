import { describe, expect, it } from 'vitest'
import { generateFingerJointPanelPolyline, normalizeFingerCount } from './fingerJoints'

describe('normalizeFingerCount', () => {
  it('erzwingt ungerade Werte mit Mindestwert 3', () => {
    expect(normalizeFingerCount(2, 200, 3)).toBeGreaterThanOrEqual(3)
    expect(normalizeFingerCount(8, 200, 3) % 2).toBe(1)
  })

  it('begrenzt die Anzahl auf sinnvolle Fingerbreite', () => {
    const normalized = normalizeFingerCount(99, 60, 6)
    expect(normalized).toBeLessThan(99)
    expect(normalized % 2).toBe(1)
  })
})

describe('generateFingerJointPanelPolyline', () => {
  it('liefert eine geschlossene Polyline', () => {
    const pts = generateFingerJointPanelPolyline({
      panel: 'front',
      widthMm: 200,
      heightMm: 120,
      materialThicknessMm: 3,
      fingerCount: 7,
      kerfMm: 0.15,
      fitToleranceMm: 0.05,
      openTop: false,
      openBottom: false,
    })
    expect(pts.length).toBeGreaterThan(8)
    const first = pts[0]
    const last = pts[pts.length - 1]
    expect(last.x).toBeCloseTo(first.x, 6)
    expect(last.y).toBeCloseTo(first.y, 6)
  })

  it('bleibt bei offenen Kanten entlang der Grundkante', () => {
    const pts = generateFingerJointPanelPolyline({
      panel: 'left',
      widthMm: 160,
      heightMm: 100,
      materialThicknessMm: 3,
      fingerCount: 7,
      kerfMm: 0.15,
      fitToleranceMm: 0,
      openTop: true,
      openBottom: true,
    })
    const hasTopFingerOffset = pts.some((p) => p.y < -0.001)
    const hasBottomFingerOffset = pts.some((p) => p.y > 100.001)
    expect(hasTopFingerOffset).toBe(false)
    expect(hasBottomFingerOffset).toBe(false)
  })
})

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

  it('nutzt überall dieselbe Finger-Tiefe = Materialstärke', () => {
    const thickness = 4
    const pts = generateFingerJointPanelPolyline({
      panel: 'front',
      widthMm: 180,
      heightMm: 120,
      materialThicknessMm: thickness,
      fingerCount: 7,
      kerfMm: 0.2,
      fitToleranceMm: 0.3,
      openTop: false,
      openBottom: false,
    })

    // Nur obere Kantenzone auswerten (nahe y=0 und y=-thickness).
    const topBand = pts.filter((p) => p.y <= 0.0001 && p.y >= -(thickness + 0.0001))
    const distinctY = [...new Set(topBand.map((p) => Number(p.y.toFixed(6))))]
    const depthCandidates = distinctY.map((y) => Math.abs(y)).filter((v) => v > 0.0001)
    const nearThickness = depthCandidates.filter((v) => Math.abs(v - thickness) < 1e-6)
    expect(nearThickness.length).toBeGreaterThan(0)
    // Keine zusätzlichen "Mini-Tiefen" neben exakt materialThickness.
    const strayDepths = depthCandidates.filter((v) => Math.abs(v - thickness) >= 1e-6)
    expect(strayDepths.length).toBe(0)
  })
})

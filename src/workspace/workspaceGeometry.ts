import type { Curve } from '../types/model'

/** Rechteck in lokalen Teilkoordinaten: (0,0) bis (w,h), wie Rechteck-Werkzeug. */
export function buildRectangleCutLine(widthMm: number, heightMm: number): Curve[] {
  const w = Math.max(0.1, widthMm)
  const h = Math.max(0.1, heightMm)
  return [
    { type: 'line', start: { x: 0, y: 0 }, end: { x: w, y: 0 } },
    { type: 'line', start: { x: w, y: 0 }, end: { x: w, y: h } },
    { type: 'line', start: { x: w, y: h }, end: { x: 0, y: h } },
    { type: 'line', start: { x: 0, y: h }, end: { x: 0, y: 0 } },
  ]
}

/** Kreis als geschlossene Kontur um Ursprung (0,0); Mittelpunkt liegt bei transform in Weltkoordinaten. */
export function buildCirclePolygonCutLine(radiusMm: number, segments: number): Curve[] {
  const r = Math.max(0.5, radiusMm)
  const n = Math.min(128, Math.max(8, Math.floor(segments)))
  const curves: Curve[] = []
  for (let i = 0; i < n; i++) {
    const a0 = (i * 2 * Math.PI) / n
    const a1 = ((i + 1) * 2 * Math.PI) / n
    curves.push({
      type: 'line',
      start: { x: r * Math.cos(a0), y: r * Math.sin(a0) },
      end: { x: r * Math.cos(a1), y: r * Math.sin(a1) },
    })
  }
  return curves
}

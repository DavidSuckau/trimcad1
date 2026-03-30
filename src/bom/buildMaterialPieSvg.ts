import type { MaterialAreaShare } from './materialAreaShare'
import { MATERIAL_PIE_COLORS } from './materialAreaShare'

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmtPctDe(p: number): string {
  return p.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

function slicePath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const rad = Math.PI / 180
  const t0 = (startDeg - 90) * rad
  const t1 = (endDeg - 90) * rad
  const x0 = cx + r * Math.cos(t0)
  const y0 = cy + r * Math.sin(t0)
  const x1 = cx + r * Math.cos(t1)
  const y1 = cy + r * Math.sin(t1)
  const delta = endDeg - startDeg
  const largeArc = delta > 180 ? 1 : 0
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1} Z`
}

const PIE_SIZE = 168
const TITLE_Y = 16
const PIE_TOP = 22
const LEGEND_X = PIE_SIZE + 16
const LINE_H = 24

/**
 * SVG für Stücklisten-PDF / Rasterisierung (gleiche Logik wie UI-Komponente).
 */
export function buildMaterialPieSvgDocument(shares: MaterialAreaShare[]): string | null {
  if (shares.length === 0) return null

  const cx = PIE_SIZE / 2
  const cy = PIE_SIZE / 2
  const r = PIE_SIZE / 2 - 4
  const totalArea = shares.reduce((s, x) => s + x.totalAreaM2, 0)
  let angle = 0

  const paths: string[] = []
  if (shares.length === 1) {
    paths.push(
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${MATERIAL_PIE_COLORS[0]}" stroke="#ffffff" stroke-width="1"/>`,
    )
  } else {
    shares.forEach((row, i) => {
      const sweep = totalArea > 0 ? (row.totalAreaM2 / totalArea) * 360 : 360 / shares.length
      const start = angle
      const end = angle + sweep
      angle = end
      const color = MATERIAL_PIE_COLORS[i % MATERIAL_PIE_COLORS.length]
      paths.push(`<path d="${slicePath(cx, cy, r, start, end)}" fill="${color}" stroke="#ffffff" stroke-width="1"/>`)
    })
  }

  const legendBottom = PIE_TOP + 12 + shares.length * LINE_H + 16
  const totalH = Math.max(PIE_TOP + PIE_SIZE + 8, legendBottom)
  const totalW = LEGEND_X + 200

  const legendRows = shares
    .map((row, i) => {
      const y = PIE_TOP + 12 + i * LINE_H
      const color = MATERIAL_PIE_COLORS[i % MATERIAL_PIE_COLORS.length]
      const label = escapeXml(row.label)
      const pct = escapeXml(`${fmtPctDe(row.pct)} %`)
      return `<rect x="${LEGEND_X}" y="${y - 11}" width="10" height="10" fill="${color}" stroke="#dddddd" stroke-width="1" rx="1"/>
  <text x="${LEGEND_X + 16}" y="${y}" font-family="Helvetica,Arial,sans-serif" font-size="11" fill="#222222">${label}</text>
  <text x="${LEGEND_X + 16}" y="${y + 14}" font-family="Helvetica,Arial,sans-serif" font-size="10" fill="#555555">${pct}</text>`
    })
    .join('\n  ')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text x="0" y="${TITLE_Y}" font-family="Helvetica,Arial,sans-serif" font-size="12" font-weight="bold" fill="#333333">Fl&#228;chenanteil (&#931; m&#178; je Material)</text>
  <g transform="translate(0, ${PIE_TOP})">
    ${paths.join('\n    ')}
  </g>
  ${legendRows}
</svg>`
}

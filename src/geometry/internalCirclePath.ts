import type { InternalCircle } from '../types/model'

/** SVG-Subpfad für einen Kreis (für evenodd-Löcher in der Flächenfüllung). */
export function svgCircleSubpath(cx: number, cy: number, r: number): string {
  if (!(r > 0) || !Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r)) return ''
  return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`
}

export function isInternalCircleHole(ic: InternalCircle): boolean {
  return ic.mode === 'hole'
}

/** Äußere Kontur + Loch-Kreise (fill-rule: evenodd → durchsichtige Ausschnitte). */
export function pathWithInternalCircleHoles(outerPath: string, circles: InternalCircle[]): string {
  const holes = circles.filter(isInternalCircleHole)
  if (holes.length === 0) return outerPath
  const holeD = holes
    .map((ic) => svgCircleSubpath(ic.center.x, ic.center.y, ic.radius))
    .filter(Boolean)
    .join(' ')
  return holeD ? `${outerPath} ${holeD}` : outerPath
}

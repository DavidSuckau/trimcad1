export type InteractionQuality = 'normal' | 'dragging' | 'idle'
export type NearestCurveQuality = 'coarse' | 'fine'

export function nearestCurveQualityFor(
  iq: InteractionQuality,
  performanceMode: boolean,
): NearestCurveQuality {
  if (iq === 'dragging' || performanceMode) return 'coarse'
  return 'fine'
}

export function shouldShowSeamPruefLive(
  iq: InteractionQuality,
  showFlag: boolean,
  performanceMode: boolean,
): boolean {
  if (iq === 'dragging' || performanceMode) return false
  return showFlag
}

export function shouldShowContourMeasurementsLive(
  iq: InteractionQuality,
  showFlag: boolean,
  performanceMode: boolean,
): boolean {
  if (iq === 'dragging' || performanceMode) return false
  return showFlag
}

export function shouldSimplifyNotchRender(
  iq: InteractionQuality,
  performanceMode: boolean,
): boolean {
  return iq === 'dragging' || performanceMode
}

/**
 * Cheap fingerprint for path-cache keys — lengths / counts, not full geometry.
 */
export function pieceGeomEpoch(piece: {
  id: string
  cutLine: unknown
  seamLine: unknown
  notches: { length: number }
  softVertices?: unknown
  roundedCorners?: unknown
  seamAllowanceMm?: unknown
  edgeSeamAllowances?: unknown
}): string {
  const arrLen = (v: unknown): number => (Array.isArray(v) ? v.length : 0)
  return [
    piece.id,
    arrLen(piece.cutLine),
    arrLen(piece.seamLine),
    piece.notches.length,
    arrLen(piece.softVertices),
    arrLen(piece.roundedCorners),
    piece.seamAllowanceMm ?? '',
    arrLen(piece.edgeSeamAllowances),
    // Hinweis: reine Längen reichen nicht bei Vertex-Moves gleicher Segmentzahl.
    // Deshalb zusätzlich grobe Geometrie-Hashes der Endpunkte (billig).
    cheapCurveEndpointsHash(piece.cutLine),
    cheapCurveEndpointsHash(piece.seamLine),
  ].join('|')
}

function cheapCurveEndpointsHash(curves: unknown): string {
  if (!Array.isArray(curves) || curves.length === 0) return '0'
  let h = curves.length * 10007
  const n = Math.min(curves.length, 12)
  for (let i = 0; i < n; i++) {
    const c = curves[i] as { start?: { x: number; y: number }; end?: { x: number; y: number } } | null
    if (!c?.start || !c?.end) continue
    h = (h + Math.round(c.start.x * 10) * 31 + Math.round(c.start.y * 10) * 17 + Math.round(c.end.x * 10)) | 0
  }
  const last = curves[curves.length - 1] as { end?: { x: number; y: number } } | null
  if (last?.end) h = (h + Math.round(last.end.x * 10) * 13 + Math.round(last.end.y * 10)) | 0
  return String(h)
}

/** Axis-aligned bounds of curve control points (start/end + optional cps). */
export function curveBoundsPad(c: {
  type: string
  start: { x: number; y: number }
  end: { x: number; y: number }
  cp1?: { x: number; y: number }
  cp2?: { x: number; y: number }
}): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Math.min(c.start.x, c.end.x)
  let minY = Math.min(c.start.y, c.end.y)
  let maxX = Math.max(c.start.x, c.end.x)
  let maxY = Math.max(c.start.y, c.end.y)
  if (c.cp1) {
    minX = Math.min(minX, c.cp1.x)
    minY = Math.min(minY, c.cp1.y)
    maxX = Math.max(maxX, c.cp1.x)
    maxY = Math.max(maxY, c.cp1.y)
  }
  if (c.cp2) {
    minX = Math.min(minX, c.cp2.x)
    minY = Math.min(minY, c.cp2.y)
    maxX = Math.max(maxX, c.cp2.x)
    maxY = Math.max(maxY, c.cp2.y)
  }
  return { minX, minY, maxX, maxY }
}

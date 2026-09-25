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

/** Teilnamen: SVG-Text ist teuer — während Drag/Pan/PerformanceMode aus. */
export function shouldShowPieceNamesLive(
  iq: InteractionQuality,
  showFlag: boolean,
  performanceMode: boolean,
): boolean {
  if (iq === 'dragging' || performanceMode) return false
  return showFlag
}

/**
 * Profil-Linien (ohne Labels): während Drag/Pan aus, sonst Flag.
 * Labels separat via shouldShowProfileLabels.
 */
export function shouldShowProfileOverlaysLive(
  iq: InteractionQuality,
  showFlag: boolean,
  performanceMode: boolean,
): boolean {
  if (iq === 'dragging' || performanceMode) return false
  return showFlag
}

/** Ab so vielen Teilen: Annotation-Texte nur am Fokus-Teil (Selected/Hovered). */
export const DENSE_ANNOTATION_PIECE_THRESHOLD = 12

/**
 * SVG-Text-Labels (Profil-Keys, Längen, Teilnamen) nur am Fokus,
 * sobald viele Teile sichtbar sind — Linien können weiter laufen.
 */
export function shouldShowDenseAnnotationLabels(opts: {
  pieceCount: number
  isSelected: boolean
  isHovered: boolean
}): boolean {
  if (opts.pieceCount <= DENSE_ANNOTATION_PIECE_THRESHOLD) return true
  return opts.isSelected || opts.isHovered
}

export function shouldShowProfileLabels(opts: {
  showProfiles: boolean
  iq: InteractionQuality
  performanceMode: boolean
  pieceCount: number
  isSelected: boolean
  isHovered: boolean
}): boolean {
  if (!shouldShowProfileOverlaysLive(opts.iq, opts.showProfiles, opts.performanceMode)) return false
  return shouldShowDenseAnnotationLabels({
    pieceCount: opts.pieceCount,
    isSelected: opts.isSelected,
    isHovered: opts.isHovered,
  })
}

export function shouldSimplifyNotchRender(
  iq: InteractionQuality,
  performanceMode: boolean,
): boolean {
  return iq === 'dragging' || performanceMode
}

/**
 * Detail-Kerben-SVG-Overlay nur am Edit-/Hover-Teil.
 * Andere Teile behalten Kontur-Cutouts; Overlay = günstige Marker.
 * (Leitlinie: 200 sichtbar ≠ 200 mit vollem Edit-Overlay.)
 * Ändert KEINE Geometrie — nur Anzeigeaufwand.
 */
export function shouldRenderDetailNotchOverlay(opts: {
  simplifyNotches: boolean
  isSelected: boolean
  isHovered: boolean
  /** Dieses Teil hat die gerade gezogene Kerbe. */
  pieceHasDraggedNotch: boolean
}): boolean {
  if (opts.simplifyNotches) return false
  return opts.isSelected || opts.isHovered || opts.pieceHasDraggedNotch
}

/**
 * Cheap fingerprint for path-cache keys — lengths / counts, not full geometry.
 * Kerben-Positionen müssen rein: sonst bleibt nach Kerben-Verschieben der alte Cutout im Cache.
 */
export function pieceGeomEpoch(piece: {
  id: string
  cutLine: unknown
  seamLine: unknown
  notches: ReadonlyArray<{
    id?: string
    position?: { x: number; y: number }
    angle?: number
    depth?: number
    width?: number
    type?: string
    sNormalized?: number
    arcLengthMm?: number
    curveIndex?: number
    t?: number
    internalLineIndex?: number
  }>
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
    cheapNotchesHash(piece.notches),
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

function cheapNotchesHash(
  notches: ReadonlyArray<{
    id?: string
    position?: { x: number; y: number }
    angle?: number
    depth?: number
    width?: number
    type?: string
    sNormalized?: number
    arcLengthMm?: number
    curveIndex?: number
    t?: number
    internalLineIndex?: number
  }>,
): string {
  if (!notches.length) return '0'
  let h = notches.length * 10007
  for (let i = 0; i < notches.length; i++) {
    const n = notches[i]
    if (!n) continue
    h = (h + (n.id?.length ?? 0) * 19) | 0
    if (n.position) {
      h = (h + Math.round(n.position.x * 10) * 31 + Math.round(n.position.y * 10) * 17) | 0
    }
    if (Number.isFinite(n.angle)) h = (h + Math.round((n.angle as number) * 10) * 13) | 0
    if (Number.isFinite(n.depth)) h = (h + Math.round((n.depth as number) * 10) * 11) | 0
    if (Number.isFinite(n.width)) h = (h + Math.round((n.width as number) * 10) * 7) | 0
    if (Number.isFinite(n.sNormalized)) h = (h + Math.round((n.sNormalized as number) * 1000) * 23) | 0
    if (Number.isFinite(n.arcLengthMm)) h = (h + Math.round((n.arcLengthMm as number) * 10) * 29) | 0
    if (Number.isFinite(n.curveIndex)) h = (h + (n.curveIndex as number) * 37) | 0
    if (Number.isFinite(n.t)) h = (h + Math.round((n.t as number) * 1000) * 41) | 0
    if (Number.isFinite(n.internalLineIndex)) h = (h + (n.internalLineIndex as number) * 43) | 0
    if (n.type) h = (h + n.type.length * 47) | 0
  }
  return String(h)
}

function cheapCurveEndpointsHash(curves: unknown): string {
  if (!Array.isArray(curves) || curves.length === 0) return '0'
  let h = curves.length * 10007
  // Alle Segmente hashen — sonst bleibt der Path-Cache stehen, wenn ein Eckpunkt
  // jenseits der alten 12er-Grenze gezogen wird (roter Punkt bewegt sich, Linie nicht).
  for (let i = 0; i < curves.length; i++) {
    const c = curves[i] as {
      type?: string
      start?: { x: number; y: number }
      end?: { x: number; y: number }
      cp1?: { x: number; y: number }
      cp2?: { x: number; y: number }
    } | null
    if (!c?.start || !c?.end) continue
    h =
      (h +
        Math.round(c.start.x * 10) * 31 +
        Math.round(c.start.y * 10) * 17 +
        Math.round(c.end.x * 10) * 13 +
        Math.round(c.end.y * 10) * 11) |
      0
    // Bézier: cp1/cp2 müssen in den Hash — sonst bleibt der Path-Cache beim Kurvenpunkt-Ziehen stehen.
    if (c.type === 'bezier' && c.cp1 && c.cp2) {
      h =
        (h +
          Math.round(c.cp1.x * 10) * 41 +
          Math.round(c.cp1.y * 10) * 37 +
          Math.round(c.cp2.x * 10) * 29 +
          Math.round(c.cp2.y * 10) * 23) |
        0
    }
  }
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

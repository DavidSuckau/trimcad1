import type { Curve, PatternPiece, Point } from '../types/model'
import { pieceLocalToWorld } from '../geometry/pieceTransform'
import { getGrainArrowLayout } from '../geometry/grainArrowLayout'

export type WorldBounds = { minX: number; minY: number; maxX: number; maxY: number }

export function unionWorldBounds(a: WorldBounds | null, b: WorldBounds | null): WorldBounds | null {
  if (!a) return b
  if (!b) return a
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

/** Achsparallele Bounding-Box der Schnittkontur in Weltkoordinaten (inkl. Bézier-Kontrollpunkte). */
export function boundsForPieceCutLineWorld(piece: PatternPiece): WorldBounds | null {
  const { cutLine, transform } = piece
  if (!cutLine.length) {
    const o = pieceLocalToWorld({ x: 0, y: 0 }, transform)
    return { minX: o.x, minY: o.y, maxX: o.x, maxY: o.y }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const add = (p: Point) => {
    const w = pieceLocalToWorld(p, transform)
    minX = Math.min(minX, w.x)
    minY = Math.min(minY, w.y)
    maxX = Math.max(maxX, w.x)
    maxY = Math.max(maxY, w.y)
  }
  for (const c of cutLine) {
    if (c.type === 'line') {
      add(c.start)
      add(c.end)
    } else {
      add(c.start)
      add(c.cp1)
      add(c.cp2)
      add(c.end)
    }
  }
  return { minX, minY, maxX, maxY }
}

/** Bounding-Box beliebiger Kurven in Weltkoordinaten (z. B. Nahtlinie). */
export function boundsForPieceCurvesWorld(curves: Curve[], transform: PatternPiece['transform']): WorldBounds | null {
  if (!curves.length) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const add = (pt: Point) => {
    const w = pieceLocalToWorld(pt, transform)
    minX = Math.min(minX, w.x)
    minY = Math.min(minY, w.y)
    maxX = Math.max(maxX, w.x)
    maxY = Math.max(maxY, w.y)
  }
  for (const c of curves) {
    if (c.type === 'line') {
      add(c.start)
      add(c.end)
    } else {
      add(c.start)
      add(c.cp1)
      add(c.cp2)
      add(c.end)
    }
  }
  return { minX, minY, maxX, maxY }
}

/** Bounding-Box Laufrichtungspfeil (Teilkoordinaten → Welt). */
export function boundsForGrainArrowWorld(piece: PatternPiece): WorldBounds | null {
  const g = getGrainArrowLayout(piece)
  if (!g) return null
  const pts = [
    g.line.start,
    g.line.end,
    g.tickStart,
    g.tickEnd,
    g.endTip,
    g.baseLeft,
    g.baseRight,
    g.tickBaseLeft,
    g.tickBaseRight,
  ]
  let acc: WorldBounds | null = null
  for (const pt of pts) {
    const w = pieceLocalToWorld(pt, piece.transform)
    acc = unionWorldBounds(acc, { minX: w.x, minY: w.y, maxX: w.x, maxY: w.y })
  }
  return acc
}

export function boundsForWorkspaceImage(session: {
  imagePosition: Point
  imageSizePx: { width: number; height: number } | null
  renderMmPerPixel: number
}): WorldBounds | null {
  if (!session.imageSizePx) return null
  const w = session.imageSizePx.width * session.renderMmPerPixel
  const h = session.imageSizePx.height * session.renderMmPerPixel
  const cx = session.imagePosition.x
  const cy = session.imagePosition.y
  const left = cx - w / 2
  const top = cy - h / 2
  return { minX: left, minY: top, maxX: left + w, maxY: top + h }
}

export function unionBoundsForPieces(pieces: PatternPiece[]): WorldBounds | null {
  let acc: WorldBounds | null = null
  for (const p of pieces) {
    acc = unionWorldBounds(acc, boundsForPieceCutLineWorld(p))
  }
  return acc
}

/** Schnitt-, Nahtlinie, Laufrichtung — für viewBox der Übersicht. */
export function unionBoundsForPiecesOverview(pieces: PatternPiece[]): WorldBounds | null {
  let acc: WorldBounds | null = null
  for (const p of pieces) {
    acc = unionWorldBounds(acc, boundsForPieceCutLineWorld(p))
    if (p.seamLine.length >= 3) {
      acc = unionWorldBounds(acc, boundsForPieceCurvesWorld(p.seamLine, p.transform))
    }
    acc = unionWorldBounds(acc, boundsForGrainArrowWorld(p))
  }
  return acc
}

export type OverviewImageSession = {
  imagePosition: Point
  imageSizePx: { width: number; height: number } | null
  renderMmPerPixel: number
}

/**
 * viewBox-String für eine Übersicht aller Teile (optional Hintergrundbild).
 */
export function computeWorkspaceOverviewViewBox(
  pieces: PatternPiece[],
  imageSession: OverviewImageSession | null
): string | null {
  let b = unionBoundsForPiecesOverview(pieces)
  if (imageSession) {
    b = unionWorldBounds(b, boundsForWorkspaceImage(imageSession))
  }
  if (!b) return null
  const w = Math.max(b.maxX - b.minX, 1)
  const h = Math.max(b.maxY - b.minY, 1)
  const pad = Math.max(w, h) * 0.06 + 8
  return `${b.minX - pad} ${b.minY - pad} ${w + 2 * pad} ${h + 2 * pad}`
}

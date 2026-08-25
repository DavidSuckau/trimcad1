import type { Point } from '../types/model'

export const IMAGE_SCALE_REF_MM = 100

export function distancePx(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function computeMmPerPixel(lengthMm: number, referenceLinePx: { start: Point; end: Point }): number | null {
  const pxLen = distancePx(referenceLinePx.start, referenceLinePx.end)
  if (!Number.isFinite(lengthMm) || lengthMm <= 0) return null
  if (!Number.isFinite(pxLen) || pxLen <= 0) return null
  return lengthMm / pxLen
}

/**
 * Aus einem rechten Winkel (Ecke + zwei Schenkelenden) X-/Y-Maßstab in mm/Pixel.
 * Schenkel mit größerem |Δx| → horizontale Referenz; größerem |Δy| → vertikal.
 * Default-Referenzlänge: 100 mm (10×10 cm auf der Schablone).
 */
export function computeMmPerPixelXYFromRightAngle(args: {
  cornerPx: Point
  armAPx: Point
  armBPx: Point
  refMm?: number
}): { mmPerPixelX: number; mmPerPixelY: number } | null {
  const refMm = args.refMm ?? IMAGE_SCALE_REF_MM
  if (!Number.isFinite(refMm) || refMm <= 0) return null

  const ax = args.armAPx.x - args.cornerPx.x
  const ay = args.armAPx.y - args.cornerPx.y
  const bx = args.armBPx.x - args.cornerPx.x
  const by = args.armBPx.y - args.cornerPx.y
  const lenA = Math.hypot(ax, ay)
  const lenB = Math.hypot(bx, by)
  if (lenA < 1e-6 || lenB < 1e-6) return null

  // Welcher Schenkel ist eher horizontal / vertikal (Bildachsen)?
  const aHorizScore = Math.abs(ax) / lenA
  const bHorizScore = Math.abs(bx) / lenB
  let horizLen: number
  let vertLen: number
  if (aHorizScore >= bHorizScore) {
    horizLen = lenA
    vertLen = lenB
  } else {
    horizLen = lenB
    vertLen = lenA
  }

  const mmPerPixelX = refMm / horizLen
  const mmPerPixelY = refMm / vertLen
  if (!Number.isFinite(mmPerPixelX) || !Number.isFinite(mmPerPixelY)) return null
  if (mmPerPixelX <= 0 || mmPerPixelY <= 0) return null
  return { mmPerPixelX, mmPerPixelY }
}

export type ImageScaleSession = {
  imagePosition?: Point
  imageSizePx?: { width: number; height: number } | null
  renderMmPerPixel: number
  renderMmPerPixelX?: number
  renderMmPerPixelY?: number
}

/** Effektive mm/Pixel (X/Y); Fallback auf isotropes renderMmPerPixel. */
export function effectiveMmPerPixelXY(session: ImageScaleSession): { x: number; y: number } {
  const iso = session.renderMmPerPixel > 0 ? session.renderMmPerPixel : 1
  return {
    x: session.renderMmPerPixelX != null && session.renderMmPerPixelX > 0 ? session.renderMmPerPixelX : iso,
    y: session.renderMmPerPixelY != null && session.renderMmPerPixelY > 0 ? session.renderMmPerPixelY : iso,
  }
}

export function worldToImagePixel(args: {
  world: Point
  imagePosition: Point
  imageSizePx: { width: number; height: number }
  mmPerPixelEffective: number
  mmPerPixelX?: number
  mmPerPixelY?: number
}): Point {
  const mx = args.mmPerPixelX ?? args.mmPerPixelEffective
  const my = args.mmPerPixelY ?? args.mmPerPixelEffective
  return {
    x: (args.world.x - args.imagePosition.x) / mx + args.imageSizePx.width / 2,
    y: (args.world.y - args.imagePosition.y) / my + args.imageSizePx.height / 2,
  }
}

export function imagePixelToWorld(args: {
  pixel: Point
  imagePosition: Point
  imageSizePx: { width: number; height: number }
  mmPerPixelEffective: number
  mmPerPixelX?: number
  mmPerPixelY?: number
}): Point {
  const mx = args.mmPerPixelX ?? args.mmPerPixelEffective
  const my = args.mmPerPixelY ?? args.mmPerPixelEffective
  return {
    x: args.imagePosition.x + (args.pixel.x - args.imageSizePx.width / 2) * mx,
    y: args.imagePosition.y + (args.pixel.y - args.imageSizePx.height / 2) * my,
  }
}

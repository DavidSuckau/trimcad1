import type { Point } from '../types/model'

export function distancePx(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function computeMmPerPixel(lengthMm: number, referenceLinePx: { start: Point; end: Point }): number | null {
  const pxLen = distancePx(referenceLinePx.start, referenceLinePx.end)
  if (!Number.isFinite(lengthMm) || lengthMm <= 0) return null
  if (!Number.isFinite(pxLen) || pxLen <= 0) return null
  return lengthMm / pxLen
}

export function worldToImagePixel(args: {
  world: Point
  imagePosition: Point
  imageSizePx: { width: number; height: number }
  mmPerPixelEffective: number
}): Point {
  const { world, imagePosition, imageSizePx, mmPerPixelEffective } = args
  const pxPerMm = 1 / mmPerPixelEffective
  return {
    x: (world.x - imagePosition.x) * pxPerMm + imageSizePx.width / 2,
    y: (world.y - imagePosition.y) * pxPerMm + imageSizePx.height / 2,
  }
}

export function imagePixelToWorld(args: {
  pixel: Point
  imagePosition: Point
  imageSizePx: { width: number; height: number }
  mmPerPixelEffective: number
}): Point {
  const { pixel, imagePosition, imageSizePx, mmPerPixelEffective } = args
  return {
    x: imagePosition.x + (pixel.x - imageSizePx.width / 2) * mmPerPixelEffective,
    y: imagePosition.y + (pixel.y - imageSizePx.height / 2) * mmPerPixelEffective,
  }
}


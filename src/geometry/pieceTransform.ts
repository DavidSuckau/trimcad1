import type { Point, PatternPieceTransform, PatternPiece } from '../types/model'
import { curvesBounds } from './curveToPath'

/** Pivot in Teilkoordinaten: transform.pivotLocal oder Bounds-Mitte der cutLine. */
export function getPiecePivotLocal(piece: PatternPiece): Point {
  if (piece.transform.pivotLocal != null) return piece.transform.pivotLocal
  const bounds = curvesBounds(piece.cutLine)
  if (!bounds) return { x: 0, y: 0 }
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  }
}

export type RotationUiLayout = {
  pivot: Point
  /** Rotationsring-Radius; passt in die Schnitt-BBox um den Pivot. */
  rotationRadius: number
  /** Drehgriff auf dem Ring, immer innerhalb der Schnitt-BBox. */
  handleLocal: Point
}

/**
 * Layout für Pivot + Drehring + Drehgriff.
 * Der Griff liegt immer innerhalb der cutLine-Bounding-Box (nie außerhalb des Teils).
 */
export function getRotationUiLayout(piece: PatternPiece, handlePadMm = 6): RotationUiLayout | null {
  const bounds = curvesBounds(piece.cutLine)
  if (!bounds || piece.cutLine.length < 3) return null
  const pivot = getPiecePivotLocal(piece)
  const w = bounds.maxX - bounds.minX
  const h = bounds.maxY - bounds.minY
  if (w <= 0 || h <= 0) return null

  const insetUp = pivot.y - bounds.minY - handlePadMm
  const insetDown = bounds.maxY - pivot.y - handlePadMm
  const insetLeft = pivot.x - bounds.minX - handlePadMm
  const insetRight = bounds.maxX - pivot.x - handlePadMm
  const maxInscribed = Math.min(insetUp, insetDown, insetLeft, insetRight)
  if (maxInscribed <= 0) {
    return {
      pivot,
      rotationRadius: 1,
      handleLocal: { x: pivot.x, y: pivot.y },
    }
  }

  const baseRadius = Math.max(w, h) * 0.6
  const rotationRadius = Math.max(1, Math.min(baseRadius, maxInscribed * 0.95))

  const dirs = [
    { dx: 0, dy: -1, inset: insetUp },
    { dx: 0, dy: 1, inset: insetDown },
    { dx: 1, dy: 0, inset: insetRight },
    { dx: -1, dy: 0, inset: insetLeft },
  ]
  const pick =
    (insetUp >= rotationRadius ? dirs.find((d) => d.dy === -1) : undefined) ??
    dirs.reduce((a, b) => (a.inset > b.inset ? a : b))

  const dist = Math.min(rotationRadius, Math.max(1, pick.inset * 0.98))
  const handleLocal = {
    x: pivot.x + pick.dx * dist,
    y: pivot.y + pick.dy * dist,
  }

  return { pivot, rotationRadius, handleLocal }
}

/** Lokalen Punkt (Teilkoordinaten) in Weltkoordinaten transformieren. */
export function pieceLocalToWorld(local: Point, transform: PatternPieceTransform): Point {
  const { x: tx, y: ty, rotation, mirrored } = transform
  let lx = local.x
  const ly = local.y
  if (mirrored) lx = -lx
  const rad = (rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return {
    x: tx + lx * cos - ly * sin,
    y: ty + lx * sin + ly * cos,
  }
}

/** Weltkoordinaten in lokale Teilkoordinaten transformieren. */
export function worldToPieceLocal(world: Point, transform: PatternPieceTransform): Point {
  const { x: tx, y: ty, rotation, mirrored } = transform
  const dx = world.x - tx
  const dy = world.y - ty
  const rad = (-rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  let lx = dx * cos - dy * sin
  const ly = dx * sin + dy * cos
  if (mirrored) lx = -lx
  return { x: lx, y: ly }
}

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

/** Lokalen Punkt (Teilkoordinaten) in Weltkoordinaten transformieren. */
export function pieceLocalToWorld(local: Point, transform: PatternPieceTransform): Point {
  const { x: tx, y: ty, rotation, mirrored } = transform
  let lx = local.x
  let ly = local.y
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
  let ly = dx * sin + dy * cos
  if (mirrored) lx = -lx
  return { x: lx, y: ly }
}

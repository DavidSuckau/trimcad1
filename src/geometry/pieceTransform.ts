import type { Point, PatternPieceTransform } from '../types/model'

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

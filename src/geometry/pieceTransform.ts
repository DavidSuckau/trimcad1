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

/**
 * Dreht das Teil um seinen eigenen Pivot auf `rotationDeg`.
 * Welt-Pivot bleibt stehen; tx/ty werden angepasst (wie setPieceRotation).
 */
export function transformWithRotationAroundOwnPivot(
  piece: PatternPiece,
  rotationDeg: number,
): PatternPieceTransform {
  const pivot = getPiecePivotLocal(piece)
  const t = piece.transform
  const worldCenter = pieceLocalToWorld(pivot, t)
  const lx = t.mirrored ? -pivot.x : pivot.x
  const ly = pivot.y
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return {
    ...t,
    x: worldCenter.x - (lx * cos - ly * sin),
    y: worldCenter.y - (lx * sin + ly * cos),
    rotation: rotationDeg,
    pivotLocal: t.pivotLocal == null ? pivot : t.pivotLocal,
  }
}

export type RotationUiLayout = {
  pivot: Point
  /** Rotationsring-Radius; passt in die Schnitt-BBox um den Pivot. */
  rotationRadius: number
  /**
   * Drehgriff in Teilkoordinaten.
   * Nach der Teil-Drehung liegt er immer senkrecht über dem Pivot (Bildschirm), nicht mitdrehend.
   */
  handleLocal: Point
}

/**
 * Versatz in Teilkoordinaten, der nach Rotation/Spiegelung in der Welt nach oben zeigt (kleineres Y).
 */
function localOffsetForWorldUp(rotationDeg: number, mirrored: boolean, dist: number): Point {
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dlx = -dist * sin
  const oy = -dist * cos
  return { x: mirrored ? -dlx : dlx, y: oy }
}

/**
 * Layout für Pivot + Drehring + Drehgriff.
 * Der Griff bleibt auf dem Bildschirm fest über dem Drehpunkt, auch wenn das Teil gedreht wird.
 * Abstand so gewählt, dass er in der Schnitt-Bounding-Box liegt.
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
  const off = localOffsetForWorldUp(piece.transform.rotation, piece.transform.mirrored, rotationRadius)
  const handleLocal = {
    x: pivot.x + off.x,
    y: pivot.y + off.y,
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

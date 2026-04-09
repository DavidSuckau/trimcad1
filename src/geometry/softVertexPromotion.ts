import type { Curve, PatternPiece, Point } from '../types/model'
import { bezierDerivativeAt } from './curveToPath'
import { vertexPosition as vertexPos } from './geometryConstants'

function unit(dx: number, dy: number): Point | null {
  const len = Math.hypot(dx, dy)
  if (len < 1e-12) return null
  return { x: dx / len, y: dy / len }
}

/** Einheitsvektor von Ecke vi zum vorherigen Eck (Kontur rückwärts). */
function rayTowardPrevVertex(curves: Curve[], vi: number): Point | null {
  const n = curves.length
  const prevIdx = (vi - 1 + n) % n
  const prevC = curves[prevIdx]
  if (prevC.type === 'line') {
    const V = vertexPos(curves, vi)
    const P = vertexPos(curves, vi - 1)
    return unit(P.x - V.x, P.y - V.y)
  }
  const d = bezierDerivativeAt(prevC, 1)
  return unit(-d.x, -d.y)
}

/** Einheitsvektor von Ecke vi zum nächsten Eck (Kontur vorwärts). */
function rayTowardNextVertex(curves: Curve[], vi: number): Point | null {
  const n = curves.length
  const nextIdx = vi % n
  const nextC = curves[nextIdx]
  if (nextC.type === 'line') {
    const V = vertexPos(curves, vi)
    const N = vertexPos(curves, vi + 1)
    return unit(N.x - V.x, N.y - V.y)
  }
  const d = bezierDerivativeAt(nextC, 0)
  return unit(d.x, d.y)
}

/**
 * Innenwinkel an der Ecke `vertexIndex` in Grad (0…180 für typische konvexe Ecken).
 * Nutzt Tangenten an Bézier-Endpunkten.
 */
export function interiorAngleAtVertexDegrees(curves: Curve[], vertexIndex: number): number | null {
  const n = curves.length
  if (n < 3) return null
  const vi = ((vertexIndex % n) + n) % n
  const u = rayTowardPrevVertex(curves, vi)
  const v = rayTowardNextVertex(curves, vi)
  if (!u || !v) return null
  let dot = u.x * v.x + u.y * v.y
  dot = Math.max(-1, Math.min(1, dot))
  return (Math.acos(dot) * 180) / Math.PI
}

/**
 * Früher: weiche Punkte an spitzen/rechten Winkeln automatisch zu Eckpunkten „promoten“.
 * Das wird nicht mehr gemacht: Blau/Rot ändert sich nur bei expliziter Nutzeraktion (P/E).
 */
export function applySharpCornerPromotion(piece: PatternPiece): PatternPiece {
  return piece
}

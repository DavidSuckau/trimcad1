import type { Point } from '../types/model'

/** Toleranz: aufeinanderfolgende interne Segmente gelten als verbunden (gemeinsame Ecke). */
export const INTERNAL_LINE_JUNCTION_EPS_MM = 0.35

export function internalLineEndpointsTouch(aEnd: Point, bStart: Point): boolean {
  return Math.hypot(aEnd.x - bStart.x, aEnd.y - bStart.y) <= INTERNAL_LINE_JUNCTION_EPS_MM
}

/**
 * `j` = Index der gemeinsamen Ecke zwischen `internalLines[j-1]` und `internalLines[j]` (1 <= j < n).
 */
export function clampInternalLineSoftJunctions(
  soft: number[] | undefined,
  curveCount: number
): number[] | undefined {
  if (!soft?.length || curveCount < 2) return undefined
  const u = [...new Set(soft.filter((j) => Number.isInteger(j) && j >= 1 && j < curveCount))].sort((a, b) => a - b)
  return u.length > 0 ? u : undefined
}

export function remapSoftJunctionsAfterRemoveCurve(
  soft: number[] | undefined,
  removeIndex: number,
  newCurveCount: number
): number[] | undefined {
  if (!soft?.length) return undefined
  const out = soft
    .filter((j) => j !== removeIndex && j !== removeIndex + 1)
    .map((j) => (j > removeIndex ? j - 1 : j))
  return clampInternalLineSoftJunctions(out, newCurveCount)
}

export function remapSoftJunctionsAfterSplitCurve(
  soft: number[] | undefined,
  splitCurveIndex: number,
  newCurveCount: number
): number[] | undefined {
  const ci = splitCurveIndex
  const s = new Set(soft ?? [])
  const shifted: number[] = []
  for (const j of s) {
    if (j <= ci) shifted.push(j)
    else if (j === ci + 1) shifted.push(j + 1)
    else shifted.push(j + 1)
  }
  shifted.push(ci + 1)
  return clampInternalLineSoftJunctions(shifted, newCurveCount)
}

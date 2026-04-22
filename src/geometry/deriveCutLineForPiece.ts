import type { PatternPiece, Curve } from '../types/model'
import {
  deriveCutLineFromSeamWithValidation,
  deriveCutLineFromSeamWithVariableAllowance,
} from './offset'
import type { DeriveCutLineFromSeamResult, DeriveCutLineFromSeamOptions } from './offset'
import { hasVariableAllowance, buildCurveIndexAllowanceMap } from './edgeEnumeration'

/**
 * Wählt automatisch den richtigen Offset-Pfad: uniformer Clipper oder variabler per-Edge Offset.
 * Wenn das Teil `edgeSeamAllowances` hat die vom Default abweichen, wird der variable Algorithmus genutzt.
 */
export function deriveCutLineForPiece(
  piece: PatternPiece,
  seamLine: Curve[],
  seamAllowanceMm: number,
  options?: DeriveCutLineFromSeamOptions
): DeriveCutLineFromSeamResult {
  /** Standard: Clipper-Miter (scharfe Ecken). Tangentialer Fillet nur bei `cutCornerFillet: true` (opt-in). */
  const filletOpts: DeriveCutLineFromSeamOptions = {
    cutCornerFillet: options?.cutCornerFillet === true,
  }
  if (hasVariableAllowance(piece)) {
    const allowanceMap = buildCurveIndexAllowanceMap(piece)
    let maxMm = 0
    for (const v of allowanceMap.values()) maxMm = Math.max(maxMm, v)
    maxMm = Math.max(maxMm, seamAllowanceMm)
    return deriveCutLineFromSeamWithVariableAllowance(seamLine, allowanceMap, maxMm, filletOpts)
  }
  return deriveCutLineFromSeamWithValidation(seamLine, seamAllowanceMm, filletOpts)
}

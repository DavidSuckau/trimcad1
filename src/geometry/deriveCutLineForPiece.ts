import type { PatternPiece, Curve } from '../types/model'
import {
  deriveCutLineFromSeamWithValidation,
  deriveCutLineFromSeamWithVariableAllowance,
} from './offset'
import type { DeriveCutLineFromSeamResult, DeriveCutLineFromSeamOptions } from './offset'
import { hasVariableAllowance, buildCurveIndexAllowanceMap } from './edgeEnumeration'
import { applyCornerRoundings } from './cornerRounding'

/**
 * Wählt automatisch den richtigen Offset-Pfad: uniformer Clipper oder variabler per-Edge Offset.
 * Wenn das Teil `edgeSeamAllowances` hat die vom Default abweichen, wird der variable Algorithmus genutzt.
 *
 * Persistierte Eckenrundungen (`piece.roundedCorners`) werden auf die übergebene `seamLine` angewendet,
 * **bevor** der Offset gerechnet wird – die parallele cutLine entsteht damit automatisch aus der
 * Bézier-Bogen-Geometrie auf der Naht.
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
  const rounded = piece.roundedCorners ?? []
  const variable = hasVariableAllowance(piece)

  if (rounded.length === 0) {
    if (variable) {
      const allowanceMap = buildCurveIndexAllowanceMap(piece)
      let maxMm = 0
      for (const v of allowanceMap.values()) maxMm = Math.max(maxMm, v)
      maxMm = Math.max(maxMm, seamAllowanceMm)
      return deriveCutLineFromSeamWithVariableAllowance(seamLine, allowanceMap, maxMm, filletOpts)
    }
    return deriveCutLineFromSeamWithValidation(seamLine, seamAllowanceMm, filletOpts)
  }

  // Rundungen angewendet → effektive Naht ist um Bogen-Segmente erweitert.
  const roundedResult = applyCornerRoundings(seamLine, rounded)
  const effectiveSeam = roundedResult.curves

  if (variable) {
    // Allowance-Map auf die EFFEKTIVE Naht-Kontur abbilden.
    const sharpAllowanceMap = buildCurveIndexAllowanceMap(piece)
    const defaultMm = seamAllowanceMm
    const effectiveMap = new Map<number, number>()
    for (let i = 0; i < effectiveSeam.length; i++) {
      const sharpIdx = roundedResult.originCurveIndices[i]
      if (sharpIdx != null) {
        effectiveMap.set(i, sharpAllowanceMap.get(sharpIdx) ?? defaultMm)
        continue
      }
      // Bogen-Segment: zugehörige Rundung suchen, Mittel der prev/next Allowances verwenden.
      const ar = roundedResult.applied.find((a) => a.arcCurveIndices.includes(i))
      if (!ar) {
        effectiveMap.set(i, defaultMm)
        continue
      }
      const prevMm = ar.sharpPrevCurveIndex >= 0 ? sharpAllowanceMap.get(ar.sharpPrevCurveIndex) ?? defaultMm : defaultMm
      const nextMm = ar.sharpNextCurveIndex >= 0 ? sharpAllowanceMap.get(ar.sharpNextCurveIndex) ?? defaultMm : defaultMm
      effectiveMap.set(i, (prevMm + nextMm) / 2)
    }
    let maxMm = 0
    for (const v of effectiveMap.values()) maxMm = Math.max(maxMm, v)
    maxMm = Math.max(maxMm, seamAllowanceMm)
    return deriveCutLineFromSeamWithVariableAllowance(effectiveSeam, effectiveMap, maxMm, filletOpts)
  }
  return deriveCutLineFromSeamWithValidation(effectiveSeam, seamAllowanceMm, filletOpts)
}

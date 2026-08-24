import type { Curve, PatternPiece, Point } from '../types/model'
import { bezierAt, pointAtPathLength, signedAreaCurves, totalPathLength } from './curveToPath'
import { nearestCurveIndexAndPoint } from './nearestOnCurve'
import { isPointInClosedCurves } from './pointInPolygon'

export type SeamAllowanceInvariantReport = {
  ok: boolean
  reasons: string[]
  /** Min. Probenabstand Seam→Cut (mm) */
  minSampleDistMm: number
  /** Median Probenabstand Seam→Cut (mm) */
  medianSampleDistMm: number
  cutAreaAbs: number
  seamAreaAbs: number
}

/**
 * Abstände Naht→Schnitt entlang jeder Naht-Kurve (mehrere Proben).
 * Öffentlich für Tests und spätere Runtime-Guards (Facing/Chamfer).
 */
export function sampleSeamToCutDistances(seam: Curve[], cut: Curve[], samplesPerCurve = 3): number[] {
  const out: number[] = []
  if (cut.length < 3 || seam.length < 3) return out
  for (const c of seam) {
    const len = totalPathLength([c])
    if (len < 1e-9) continue
    for (let s = 1; s <= samplesPerCurve; s++) {
      const t = s / (samplesPerCurve + 1)
      const along = pointAtPathLength([c], t * len)
      const fallback =
        c.type === 'line'
          ? {
              x: c.start.x + (c.end.x - c.start.x) * t,
              y: c.start.y + (c.end.y - c.start.y) * t,
            }
          : bezierAt(c, t)
      const p = along?.point ?? fallback
      const d = nearestCurveIndexAndPoint(p, cut)?.distance
      if (d != null && Number.isFinite(d)) out.push(d)
    }
  }
  return out
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return NaN
  const m = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2
}

function seamSamplePoints(seam: Curve[], samplesPerCurve = 2): Point[] {
  const pts: Point[] = []
  for (const c of seam) {
    pts.push({ ...c.start })
    const len = totalPathLength([c])
    if (len < 1e-9) continue
    for (let s = 1; s <= samplesPerCurve; s++) {
      const t = s / (samplesPerCurve + 1)
      const along = pointAtPathLength([c], t * len)
      if (along) pts.push(along.point)
    }
  }
  return pts
}

function pointInsideOrOnCut(p: Point, cut: Curve[], onBoundaryEpsMm = 0.25): boolean {
  if (isPointInClosedCurves(p, cut)) return true
  // Nach Facing-Chamfer liegen Naht-Ecken oft auf der Fase (Grenze) — Ray-Cast zählt Grenze als außen.
  const near = nearestCurveIndexAndPoint(p, cut)
  return near != null && near.distance <= onBoundaryEpsMm
}

/**
 * Prüft NZ-Invarianten für Seam+Cut (kein Side-Effect).
 * - |cut| > |seam|
 * - gleiche Windungsrichtung
 * - Seam-Proben liegen im Cut (oder auf der Grenze)
 * - Probenabstand Seam→Cut nahe expectedSaMm (Median; Kurven dürfen lokal abweichen)
 */
export function evaluateSeamAllowanceInvariants(
  seam: Curve[],
  cut: Curve[],
  expectedSaMm: number,
  opts?: {
    /** Relative Untergrenze für Median-Abstand (Default 0.7) */
    minMedianRatio?: number
    /** Relative Obergrenze für Median-Abstand (Default 1.45) */
    maxMedianRatio?: number
    /** Absoluter Mindestabstand einer Probe (Default max(0.5, SA*0.25)) */
    minSampleFloorMm?: number
  }
): SeamAllowanceInvariantReport {
  const reasons: string[] = []
  const cutArea = signedAreaCurves(cut)
  const seamArea = signedAreaCurves(seam)
  const cutAreaAbs = Math.abs(cutArea)
  const seamAreaAbs = Math.abs(seamArea)
  const samples = sampleSeamToCutDistances(seam, cut)
  const sorted = [...samples].sort((a, b) => a - b)
  const minSampleDistMm = sorted.length ? sorted[0]! : NaN
  const medianSampleDistMm = median(sorted)

  if (seam.length < 3) reasons.push('seam zu kurz')
  if (cut.length < 3) reasons.push('cut zu kurz')
  if (!(expectedSaMm > 0)) reasons.push('expectedSaMm ungültig')

  if (seamAreaAbs >= 1 && cutAreaAbs < seamAreaAbs * 1.01) {
    reasons.push(`Cut-Fläche nicht größer als Seam (|cut|=${cutAreaAbs.toFixed(1)}, |seam|=${seamAreaAbs.toFixed(1)})`)
  }
  if (seamAreaAbs >= 1 && cutAreaAbs >= 1 && cutArea * seamArea < 0) {
    reasons.push('Cut und Seam haben entgegengesetzte Windung')
  }

  if (cut.length >= 3) {
    const probes = seamSamplePoints(seam, 2)
    let outside = 0
    for (const p of probes) {
      if (!pointInsideOrOnCut(p, cut)) outside++
    }
    // Bei starker Tessellation/Miter einzelne Grenzproben tolerieren
    if (probes.length > 0 && outside > Math.max(1, Math.floor(probes.length * 0.15))) {
      reasons.push(`zu viele Seam-Proben außerhalb Cut (${outside}/${probes.length})`)
    }
  }

  const minRatio = opts?.minMedianRatio ?? 0.7
  const maxRatio = opts?.maxMedianRatio ?? 1.45
  const floor = opts?.minSampleFloorMm ?? Math.max(0.5, expectedSaMm * 0.25)

  if (samples.length === 0) {
    reasons.push('keine Seam→Cut-Proben')
  } else {
    if (Number.isFinite(minSampleDistMm) && minSampleDistMm < floor) {
      reasons.push(`Min-Probenabstand ${minSampleDistMm.toFixed(2)} < floor ${floor.toFixed(2)}`)
    }
    if (Number.isFinite(medianSampleDistMm)) {
      if (medianSampleDistMm < expectedSaMm * minRatio) {
        reasons.push(
          `Median-Abstand ${medianSampleDistMm.toFixed(2)} < ${expectedSaMm}*${minRatio} (${(expectedSaMm * minRatio).toFixed(2)})`
        )
      }
      if (medianSampleDistMm > expectedSaMm * maxRatio) {
        reasons.push(
          `Median-Abstand ${medianSampleDistMm.toFixed(2)} > ${expectedSaMm}*${maxRatio} (${(expectedSaMm * maxRatio).toFixed(2)})`
        )
      }
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    minSampleDistMm,
    medianSampleDistMm,
    cutAreaAbs,
    seamAreaAbs,
  }
}

/**
 * Nach geometrischem Spiegeln: gespiegelte Cut behalten, wenn NZ noch ok;
 * sonst auf neu abgeleitete Cut wechseln (fail-soft, manuelle Trims nur wenn stabil).
 */
export function preferStableCutAfterGeometricMirror(
  seamLine: Curve[],
  mirroredCut: Curve[],
  derivedCut: Curve[] | null | undefined,
  expectedSaMm: number
): Curve[] {
  if (seamLine.length < 3 || mirroredCut.length < 3 || !(expectedSaMm > 0)) {
    return mirroredCut
  }
  const soft = {
    minMedianRatio: 0.55,
    maxMedianRatio: 1.6,
    minSampleFloorMm: Math.max(0.8, expectedSaMm * 0.2),
  }
  const invMirror = evaluateSeamAllowanceInvariants(seamLine, mirroredCut, expectedSaMm, soft)
  if (invMirror.ok) return mirroredCut
  if (!derivedCut || derivedCut.length < 3) return mirroredCut
  const invDerived = evaluateSeamAllowanceInvariants(seamLine, derivedCut, expectedSaMm, soft)
  if (invDerived.ok) return derivedCut
  // beide grenzwertig: näher am Soll-Median gewinnt
  const errM = Math.abs(invMirror.medianSampleDistMm - expectedSaMm)
  const errD = Math.abs(invDerived.medianSampleDistMm - expectedSaMm)
  if (Number.isFinite(errD) && (!Number.isFinite(errM) || errD + 0.5 < errM)) {
    return derivedCut
  }
  return mirroredCut
}

/** Convenience: Invarianten am PatternPiece mit gesetzter NZ. */
export function evaluatePieceSeamAllowanceInvariants(piece: PatternPiece): SeamAllowanceInvariantReport | null {
  const sa = piece.seamAllowanceMm
  if (sa == null || sa <= 0) return null
  if (piece.seamLine.length < 3 || piece.cutLine.length < 3) return null
  return evaluateSeamAllowanceInvariants(piece.seamLine, piece.cutLine, sa)
}

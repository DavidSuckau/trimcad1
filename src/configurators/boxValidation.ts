import type { ConfiguratorPartParams } from './types'
import { normalizeFingerCount } from '../geometry/laserBox/fingerJoints'

export type BoxValidationResult = {
  valid: boolean
  warnings: string[]
  suggestions: string[]
}

export function validateLaserBoxParams(params: ConfiguratorPartParams): BoxValidationResult {
  const width = Math.max(1, params.boxWidthMm ?? params.widthMm)
  const length = Math.max(1, params.boxLengthMm ?? params.widthMm)
  const height = Math.max(1, params.boxHeightMm ?? params.heightMm)
  const thickness = Math.max(0.5, params.materialThicknessMm ?? 3)
  const fingerCount = Math.max(3, Math.round(params.fingerCount ?? 7))
  const minEdge = Math.min(width, length, height)
  const normalized = normalizeFingerCount(fingerCount, minEdge, thickness)
  const kerf = Math.max(0, params.kerfMm ?? 0.15)
  const fit = params.fitToleranceMm ?? 0
  const warnings: string[] = []
  const suggestions: string[] = []

  if (width < thickness * 6 || length < thickness * 6 || height < thickness * 6) {
    warnings.push('Proportionen sind für die Materialstärke sehr klein und können instabil werden.')
  }
  if (fingerCount !== normalized) {
    warnings.push(`Fingeranzahl ${fingerCount} passt nicht gut zu den Kantenlängen.`)
    suggestions.push(`Empfehlung: Fingeranzahl auf ${normalized} setzen.`)
  }
  if (kerf > thickness * 0.35) {
    warnings.push('Kerf ist relativ groß zur Materialstärke; Passung kann ungenau werden.')
  }
  if (Math.abs(fit) > thickness * 0.2) {
    warnings.push('Toleranz ist relativ hoch; Verbindungen könnten zu locker/zu stramm sein.')
  }

  return {
    valid: warnings.length === 0,
    warnings,
    suggestions,
  }
}

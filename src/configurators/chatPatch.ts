import type { ConfiguratorPartParams } from './types'

export const CONFIGURATOR_PATCH_KEYS = [
  'widthMm',
  'heightMm',
  'offsetX',
  'offsetY',
  'waistToHipMm',
  'hipWidthMm',
  'hemWidthMm',
  'dartLengthMm',
  'dartOpeningMm',
  'dartPosLeftRatio',
  'dartPosRightRatio',
] as const

export type ConfiguratorPatchKey = (typeof CONFIGURATOR_PATCH_KEYS)[number]
export type ConfiguratorPatch = Partial<Pick<ConfiguratorPartParams, ConfiguratorPatchKey>>

export type ChatTargetScope = 'selected_part' | 'all_parts'

export type ConfiguratorPatchProposal = {
  scope: ChatTargetScope
  rationale: string
  patch: ConfiguratorPatch
}

export type ValidationResult =
  | { ok: true; value: ConfiguratorPatchProposal }
  | { ok: false; error: string }

const RANGES: Record<ConfiguratorPatchKey, { min: number; max: number }> = {
  widthMm: { min: 1, max: 10000 },
  heightMm: { min: 1, max: 10000 },
  offsetX: { min: -10000, max: 10000 },
  offsetY: { min: -10000, max: 10000 },
  waistToHipMm: { min: 1, max: 10000 },
  hipWidthMm: { min: 1, max: 10000 },
  hemWidthMm: { min: 1, max: 10000 },
  dartLengthMm: { min: 1, max: 10000 },
  dartOpeningMm: { min: 1, max: 10000 },
  dartPosLeftRatio: { min: 0, max: 1 },
  dartPosRightRatio: { min: 0, max: 1 },
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

function clampToRange(key: ConfiguratorPatchKey, value: number): number {
  const { min, max } = RANGES[key]
  return Math.min(max, Math.max(min, value))
}

export function validateProposal(input: unknown): ValidationResult {
  if (!isRecord(input)) return { ok: false, error: 'Antwort ist kein Objekt.' }
  const { scope, rationale, patch } = input
  if (scope !== 'selected_part' && scope !== 'all_parts') {
    return { ok: false, error: 'Ungueltiger Scope.' }
  }
  if (typeof rationale !== 'string' || rationale.trim().length === 0) {
    return { ok: false, error: 'Begruendung fehlt.' }
  }
  if (!isRecord(patch)) return { ok: false, error: 'Patch fehlt oder ist ungueltig.' }

  const cleanPatch: ConfiguratorPatch = {}
  for (const key of CONFIGURATOR_PATCH_KEYS) {
    if (!(key in patch)) continue
    const raw = patch[key]
    const n = toFiniteNumber(raw)
    if (n == null) return { ok: false, error: `Wert fuer ${key} ist keine Zahl.` }
    cleanPatch[key] = clampToRange(key, n)
  }

  if (Object.keys(cleanPatch).length === 0) {
    return { ok: false, error: 'Patch enthaelt keine erlaubten Felder.' }
  }

  return {
    ok: true,
    value: {
      scope,
      rationale: rationale.trim(),
      patch: cleanPatch,
    },
  }
}

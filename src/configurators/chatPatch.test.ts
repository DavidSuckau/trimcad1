import { describe, expect, it } from 'vitest'
import { validateProposal } from './chatPatch'

describe('validateProposal', () => {
  it('akzeptiert gueltigen Patch und laesst nur erlaubte Felder zu', () => {
    const result = validateProposal({
      scope: 'selected_part',
      rationale: 'Saum soll weiter werden',
      patch: {
        hemWidthMm: 620,
        unknownField: 999,
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.patch.hemWidthMm).toBe(620)
    expect((result.value.patch as Record<string, unknown>).unknownField).toBeUndefined()
  })

  it('lehnt leeren Patch ab', () => {
    const result = validateProposal({
      scope: 'selected_part',
      rationale: 'Keine echten Felder',
      patch: {
        something: 1,
      },
    })
    expect(result.ok).toBe(false)
  })

  it('clamped ratio in gueltigen Bereich', () => {
    const result = validateProposal({
      scope: 'all_parts',
      rationale: 'Abnaeherposition korrigieren',
      patch: {
        dartPosLeftRatio: -2,
        dartPosRightRatio: 99,
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.patch.dartPosLeftRatio).toBe(0)
    expect(result.value.patch.dartPosRightRatio).toBe(1)
  })
})

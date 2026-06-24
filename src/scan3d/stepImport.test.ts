import { describe, expect, it } from 'vitest'
import { isStepFileName } from './stepImport'

describe('isStepFileName', () => {
  it('erkennt .step und .stp', () => {
    expect(isStepFileName('part.step')).toBe(true)
    expect(isStepFileName('part.STP')).toBe(true)
    expect(isStepFileName('part.stl')).toBe(false)
  })
})

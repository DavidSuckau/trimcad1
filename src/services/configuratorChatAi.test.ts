import { describe, expect, it } from 'vitest'
import { extractFirstJsonObject } from './configuratorChatAi'

describe('extractFirstJsonObject', () => {
  it('liest direktes JSON', () => {
    const raw = '{"scope":"selected_part","rationale":"ok","patch":{"widthMm":500}}'
    expect(extractFirstJsonObject(raw)).toBe(raw)
  })

  it('extrahiert JSON aus gemischtem Text', () => {
    const raw = 'Hier ist dein Ergebnis:\n```json\n{"scope":"all_parts","rationale":"x","patch":{"hemWidthMm":700}}\n```'
    expect(extractFirstJsonObject(raw)).toBe('{"scope":"all_parts","rationale":"x","patch":{"hemWidthMm":700}}')
  })

  it('gibt null zurueck wenn kein JSON vorhanden', () => {
    expect(extractFirstJsonObject('kein objekt')).toBeNull()
  })
})

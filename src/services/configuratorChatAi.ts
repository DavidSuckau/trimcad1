import type { ConfiguratorKindId, ConfiguratorPartParams } from '../configurators/types'
import { CONFIGURATOR_PATCH_KEYS, validateProposal, type ConfiguratorPatchProposal } from '../configurators/chatPatch'

type RequestArgs = {
  kindId: ConfiguratorKindId
  partLabel: string
  freeText: string
  structuredMeasures: Partial<ConfiguratorPartParams>
  currentParams: ConfiguratorPartParams
}

type ChatCompletionsResponse = {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

const MODEL = 'gpt-4.1-mini'

function buildPrompt(args: RequestArgs): string {
  return [
    'Du bist ein Assistent fuer Schnitt-Parametrisierung.',
    'Gib AUSSCHLIESSLICH valides JSON ohne Markdown zurueck.',
    'Du darfst nur Felder aus der erlaubten Liste im patch setzen.',
    'units: mm fuer alle *Mm Felder, ratio 0..1 fuer dartPos*.',
    `Teiltyp: ${args.kindId}, Zielteil: ${args.partLabel}.`,
    `Nutzertext: ${args.freeText}`,
    `Aktuelle Parameter: ${JSON.stringify(args.currentParams)}`,
    `Strukturierte Zusatzmasse (optional): ${JSON.stringify(args.structuredMeasures)}`,
    `Erlaubte patch keys: ${CONFIGURATOR_PATCH_KEYS.join(', ')}`,
    'Rueckgabeformat:',
    '{"scope":"selected_part|all_parts","rationale":"kurz","patch":{"widthMm":123}}',
  ].join('\n')
}

export function extractFirstJsonObject(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed

  const start = raw.indexOf('{')
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '{') depth += 1
    if (ch === '}') {
      depth -= 1
      if (depth === 0) return raw.slice(start, i + 1)
    }
  }
  return null
}

export async function requestConfiguratorPatchProposal(args: RequestArgs): Promise<ConfiguratorPatchProposal> {
  if (!args.freeText.trim()) throw new Error('Bitte zuerst eine Chat-Anweisung eingeben.')

  const response = await fetch('/api/ai/configurator-proposal', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.1,
      messages: [{ role: 'user', content: buildPrompt(args) }],
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    const txt = await response.text()
    throw new Error(`KI-Fehler (${response.status}): ${txt.slice(0, 280)}`)
  }

  const data = (await response.json()) as ChatCompletionsResponse
  const rawContent = data.choices?.[0]?.message?.content ?? ''
  const jsonText = extractFirstJsonObject(rawContent)
  if (!jsonText) throw new Error('KI-Antwort enthaelt kein parsebares JSON.')

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new Error('KI-Antwort ist kein gueltiges JSON.')
  }

  const validation = validateProposal(parsed)
  if (!validation.ok) throw new Error(`KI-Vorschlag ungueltig: ${validation.error}`)
  return validation.value
}

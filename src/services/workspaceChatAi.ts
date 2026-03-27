import { extractFirstJsonObject } from './configuratorChatAi'
import { WORKSPACE_KI_DOCUMENTATION } from '../assistant/workspaceHelpContext'
import { validateWorkspaceProposal, type WorkspaceChatProposal } from '../workspace/workspaceChatActions'

type ChatCompletionsResponse = {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

/** gpt-4o-mini: Text + optional Bild (Vision) im gleichen Endpoint */
const MODEL = 'gpt-4o-mini'

const HELP_SYSTEM_PROMPT = [
  'Du bist die eingebettete Hilfe fuer TrimTex (Zuschnitt-Arbeitsflaeche, 2D-Schnittmuster).',
  'Beantworte Nutzerfragen ausschliesslich auf Basis des folgenden Dokuments.',
  'Wenn etwas dort nicht steht, sage ehrlich, dass du es nicht weisst oder der Nutzer Menue Hilfe / F1 nutzen soll.',
  'Antwort auf Deutsch, klar strukturiert, kurze Absaetze. Keine erfundenen Tastenkuerzel.',
  'Unterscheide: D = Digitalisieren ohne Alt; Alt+D (Mac: ⌥D) = Drehpunkt (nicht Digitalisieren).',
  '',
  '--- DOKUMENTATION (TrimTex KI-Nutzerhilfe-Quelle) ---',
  '',
].join('\n')

export type WorkspaceHelpRequestArgs = {
  apiKey: string
  question: string
  pieceCount: number
  selectedCount: number
  selectedNames: string[]
}

export async function requestWorkspaceHelpAnswer(args: WorkspaceHelpRequestArgs): Promise<string> {
  const key = args.apiKey.trim()
  if (!key) throw new Error('API-Key fehlt.')
  const q = args.question.trim()
  if (!q) throw new Error('Bitte eine Frage eingeben.')

  const ctx = [
    `Workspace: ${args.pieceCount} Teil(e), ${args.selectedCount} ausgewaehlt.`,
    args.selectedNames.length ? `Ausgewaehlte Namen: ${args.selectedNames.join(', ')}` : 'Keine Auswahl.',
    '',
    `Frage: ${q}`,
  ].join('\n')

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.25,
      max_tokens: 2000,
      messages: [
        { role: 'system', content: `${HELP_SYSTEM_PROMPT}\n${WORKSPACE_KI_DOCUMENTATION}` },
        { role: 'user', content: ctx },
      ],
    }),
  })

  if (!response.ok) {
    const txt = await response.text()
    throw new Error(`KI-Fehler (${response.status}): ${txt.slice(0, 280)}`)
  }

  const data = (await response.json()) as ChatCompletionsResponse
  const text = data.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('Leere KI-Antwort.')
  return text
}

export type WorkspaceChatRequestArgs = {
  apiKey: string
  freeText: string
  pieceCount: number
  selectedCount: number
  selectedNames: string[]
  /** Kurzinfos pro Teil fuer die KI (Index, Name, Bounding Box) */
  pieceSummaries: string[]
  imageBase64?: string
  imageMimeType?: string
}

function buildPrompt(args: WorkspaceChatRequestArgs): string {
  const parts = [
    'Du bist ein Assistent fuer die TrimTex-Zuschnitt-Arbeitsflaeche (2D-Teile).',
    'Gib AUSSCHLIESSLICH valides JSON ohne Markdown zurueck.',
    'Koordinaten immer in mm: Weltkoordinaten fuer neue Teile, lokale Teilkoordinaten fuer Kerben/Bohrungen auf einem bestehenden Teil.',
    'Erlaubte Aktionen (actions ist ein Array, Reihenfolge beachten):',
    '- NEUE TEILE:',
    '  {"type":"create_rectangle","widthMm":100,"heightMm":80,"originWorldX":0,"originWorldY":0,"name":"optional"} — Rechteck; origin = Ecke unten-links.',
    '  {"type":"create_circle","radiusMm":50,"centerWorldX":200,"centerWorldY":150,"segments":32,"name":"optional"} — Kreis als Polygon; center = Kreismittelpunkt in Welt-mm.',
    '  {"type":"add_empty_piece","name":"optional"}',
    '- Kerben / Bohrungen auf einem Teil (lokale Koordinaten im Teil):',
    '  {"type":"add_notch","piecePick":"selected_first"|"by_index","pieceIndex":0,"positionLocalX":50,"positionLocalY":120,"notchType":"single"|"double"|"v","depthMm":4,"widthMm":6,"angleDeg":optional}',
    '  {"type":"add_drill","piecePick":"selected_first"|"by_index","pieceIndex":0,"centerLocalX":100,"centerLocalY":50,"radiusMm":3}',
    '  piecePick: selected_first = erstes ausgewaehltes Teil; by_index = workspace.pieces[pieceIndex] (0-basiert).',
    '- BESTEHENDE TEILE (target):',
    '  {"type":"remove_seam_allowance","target":"all_pieces"|"selected_pieces"}',
    '  {"type":"clear_notches","target":"all_pieces"|"selected_pieces"}',
    '  {"type":"clear_drills","target":"all_pieces"|"selected_pieces"}',
    '  {"type":"delete_pieces","target":"all_pieces"|"selected_pieces"} — komplette Teile aus dem Workspace entfernen (irreversibel nach Bestätigung).',
    '  {"type":"clear_all_seam_assignments"} — alle Nahtzuordnungen (kein target).',
    'Wenn ein Bild dabei ist: interpretiere Skizze oder Screenshot; schlage passende create_* / add_notch Werte vor.',
    `Workspace: ${args.pieceCount} Teil(e), ${args.selectedCount} ausgewaehlt.`,
    args.selectedNames.length
      ? `Namen der Auswahl: ${args.selectedNames.join(', ')}`
      : 'Keine Auswahl.',
    'Teile-Uebersicht (lokal, mm):',
    ...(args.pieceSummaries.length ? args.pieceSummaries : ['(keine Teile)']),
    `Nutzertext: ${args.freeText || '(nur Bild)'}`,
    'Rueckgabeformat:',
    '{"rationale":"kurz","actions":[...]}',
  ]
  return parts.join('\n')
}

export async function requestWorkspaceChatProposal(args: WorkspaceChatRequestArgs): Promise<WorkspaceChatProposal> {
  const key = args.apiKey.trim()
  if (!key) throw new Error('API-Key fehlt.')
  if (!args.freeText.trim() && !args.imageBase64) {
    throw new Error('Bitte Text eingeben oder ein Bild anhaengen.')
  }

  const textBody = buildPrompt(args)
  const content: Array<
    { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
  > = [{ type: 'text', text: textBody }]

  if (args.imageBase64 != null && args.imageMimeType != null) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:${args.imageMimeType};base64,${args.imageBase64}` },
    })
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.1,
      messages: [{ role: 'user', content }],
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

  const validation = validateWorkspaceProposal(parsed)
  if (!validation.ok) throw new Error(`KI-Vorschlag ungueltig: ${validation.error}`)
  return validation.value
}

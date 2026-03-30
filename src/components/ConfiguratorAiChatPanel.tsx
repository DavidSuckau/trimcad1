import { useMemo, useState } from 'react'
import type { ConfiguratorKindId, ConfiguratorPartParams } from '../configurators/types'
import type { ConfiguratorPatchProposal } from '../configurators/chatPatch'
import { CONFIGURATOR_PATCH_KEYS } from '../configurators/chatPatch'
import { requestConfiguratorPatchProposal } from '../services/configuratorChatAi'

type Props = {
  kindId: ConfiguratorKindId
  partLabel: string
  currentParams: ConfiguratorPartParams
  onApplyProposal: (proposal: ConfiguratorPatchProposal) => void
}

const STRUCTURED_KEYS: Array<keyof ConfiguratorPartParams> = [
  'widthMm',
  'heightMm',
  'hipWidthMm',
  'hemWidthMm',
  'waistToHipMm',
  'dartLengthMm',
  'dartOpeningMm',
]

function toOptionalNumber(v: string): number | undefined {
  const t = v.trim()
  if (!t) return undefined
  const n = Number(t)
  if (!Number.isFinite(n)) return undefined
  return n
}

export function ConfiguratorAiChatPanel({ kindId, partLabel, currentParams, onApplyProposal }: Props) {
  const [openAiApiKey, setOpenAiApiKey] = useState('')
  const [freeText, setFreeText] = useState('')
  const [structuredInput, setStructuredInput] = useState<Record<string, string>>({})
  const [proposal, setProposal] = useState<ConfiguratorPatchProposal | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const structuredMeasures = useMemo(() => {
    const values: Partial<ConfiguratorPartParams> = {}
    for (const key of STRUCTURED_KEYS) {
      const n = toOptionalNumber(structuredInput[key] ?? '')
      if (n == null) continue
      values[key] = n
    }
    return values
  }, [structuredInput])

  const diffRows = useMemo(() => {
    if (!proposal) return []
    return CONFIGURATOR_PATCH_KEYS
      .filter((key) => key in proposal.patch)
      .map((key) => {
        const before = currentParams[key]
        const after = proposal.patch[key]
        return { key, before, after }
      })
  }, [currentParams, proposal])

  const requestSuggestion = async () => {
    setError(null)
    setIsLoading(true)
    try {
      const result = await requestConfiguratorPatchProposal({
        apiKey: openAiApiKey,
        kindId,
        partLabel,
        freeText,
        structuredMeasures,
        currentParams,
      })
      setProposal(result)
    } catch (err) {
      setProposal(null)
      setError(err instanceof Error ? err.message : 'Unbekannter KI-Fehler.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div style={{ marginTop: 18, borderTop: '1px solid #ddd', paddingTop: 12 }}>
      <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>KI-Chat (Text-zu-Schnitt)</h4>
      <p style={{ margin: '0 0 10px', fontSize: 12, color: '#555' }}>
        Freitext + strukturierte Maße. Vorschlaege werden erst nach deiner Bestaetigung angewendet.
      </p>

      <label className="nahtzugabe-dialog-label">
        <span>OpenAI API-Key</span>
        <input
          type="password"
          className="nahtzugabe-dialog-input"
          value={openAiApiKey}
          onChange={(e) => setOpenAiApiKey(e.target.value)}
          placeholder="sk-..."
        />
      </label>

      <label className="nahtzugabe-dialog-label" style={{ marginTop: 8 }}>
        <span>Anweisung</span>
        <textarea
          className="nahtzugabe-dialog-input"
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          rows={3}
          style={{ resize: 'vertical' }}
          placeholder="z.B. Mach den Saum 40mm weiter und die Abnaeher etwas laenger."
        />
      </label>

      <p style={{ margin: '10px 0 6px', fontSize: 12, color: '#666' }}>Strukturierte Maße (optional)</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(140px, 1fr))', gap: 8 }}>
        {STRUCTURED_KEYS.map((key) => (
          <label key={key} className="nahtzugabe-dialog-label" style={{ minWidth: 0 }}>
            <span>{key}</span>
            <input
              type="number"
              className="nahtzugabe-dialog-input"
              value={structuredInput[key] ?? ''}
              placeholder={String(currentParams[key] ?? '')}
              onChange={(e) => setStructuredInput((s) => ({ ...s, [key]: e.target.value }))}
            />
          </label>
        ))}
      </div>

      <div className="nahtzugabe-dialog-actions" style={{ marginTop: 10 }}>
        <button type="button" className="sidebar-btn primary" onClick={requestSuggestion} disabled={isLoading}>
          {isLoading ? 'Analysiere…' : 'KI-Vorschlag holen'}
        </button>
        <button
          type="button"
          className="sidebar-btn"
          onClick={() => {
            setProposal(null)
            setError(null)
          }}
          disabled={!proposal && !error}
        >
          Zuruecksetzen
        </button>
      </div>

      {error && <p style={{ margin: '8px 0 0', color: '#c62828', fontSize: 12 }}>{error}</p>}

      {proposal && (
        <div style={{ marginTop: 12, border: '1px solid #ddd', borderRadius: 6, padding: 10, background: '#fafafa' }}>
          <p style={{ margin: 0, fontSize: 12, color: '#333' }}>
            <strong>Scope:</strong> {proposal.scope === 'all_parts' ? 'Alle Teile' : 'Nur aktuelles Teil'}
          </p>
          <p style={{ margin: '4px 0 8px', fontSize: 12, color: '#333' }}>
            <strong>Begruendung:</strong> {proposal.rationale}
          </p>
          <div style={{ fontSize: 12, color: '#222' }}>
            {diffRows.map((row) => (
              <div key={row.key}>
                {row.key}: {String(row.before ?? '—')} → <strong>{String(row.after ?? '—')}</strong>
              </div>
            ))}
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 12, color: '#9a6700' }}>
            Hinweis: Neu erzeugen setzt Notches, Drills und Seam-Zuordnungen des betroffenen Teils zurueck.
          </p>
          <div className="nahtzugabe-dialog-actions" style={{ marginTop: 10 }}>
            <button type="button" className="sidebar-btn primary" onClick={() => onApplyProposal(proposal)}>
              Vorschlag anwenden
            </button>
            <button type="button" className="sidebar-btn" onClick={() => setProposal(null)}>
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

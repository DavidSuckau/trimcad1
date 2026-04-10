import { useMemo, useRef, useState } from 'react'
import { curvesBounds } from '../geometry/curveToPath'
import { useStore } from '../store/useStore'
import type { WorkspaceChatAction, WorkspaceChatProposal } from '../workspace/workspaceChatActions'
import { requestWorkspaceChatProposal, requestWorkspaceHelpAnswer } from '../services/workspaceChatAi'
import { applyWorkspaceChatProposal } from '../workspace/applyWorkspaceChatProposal'

function actionLabel(a: WorkspaceChatAction): string {
  switch (a.type) {
    case 'clear_all_seam_assignments':
      return 'Alle Nahtzuordnungen im Workspace löschen'
    case 'create_rectangle': {
      const n = a.name ? ` „${a.name}“` : ''
      return `Rechteck${n}: ${Math.round(a.widthMm)}×${Math.round(a.heightMm)} mm, Ecke (${Math.round(a.originWorldX)}, ${Math.round(a.originWorldY)})`
    }
    case 'create_circle': {
      const n = a.name ? ` „${a.name}“` : ''
      return `Kreis${n}: r=${Math.round(a.radiusMm)} mm, Mittelpunkt (${Math.round(a.centerWorldX)}, ${Math.round(a.centerWorldY)}), ${a.segments} Segmente`
    }
    case 'add_empty_piece':
      return a.name ? `Leeres Teil „${a.name}“` : 'Leeres Teil (ohne Kontur)'
    case 'add_notch':
      return `Kerbe (${a.notchType}) bei (${Math.round(a.positionLocalX)}, ${Math.round(a.positionLocalY)}) mm lokal, ${
        a.piecePick === 'by_index' ? `Teil [${a.pieceIndex ?? 0}]` : 'erstes ausgewähltes Teil'
      }`
    case 'add_drill':
      return `Bohrung r=${Math.round(a.radiusMm * 10) / 10} mm bei (${Math.round(a.centerLocalX)}, ${Math.round(a.centerLocalY)}) lokal, ${
        a.piecePick === 'by_index' ? `Teil [${a.pieceIndex ?? 0}]` : 'erstes ausgewähltes Teil'
      }`
    case 'remove_seam_allowance':
    case 'clear_notches':
    case 'clear_drills':
    case 'delete_pieces': {
      const scope = a.target === 'all_pieces' ? 'alle Teile' : 'nur Auswahl'
      if (a.type === 'remove_seam_allowance') return `Nahtzugabe entfernen (${scope})`
      if (a.type === 'clear_notches') return `Alle Kerben löschen (${scope})`
      if (a.type === 'clear_drills') return `Alle Bohrungen löschen (${scope})`
      return `Teile löschen (${scope})`
    }
    default: {
      const _x: never = a
      return String(_x)
    }
  }
}

type AttachedImage = { mime: string; base64: string; previewUrl: string }

export function WorkspaceAiChatPanel() {
  const pieces = useStore((s) => s.workspace.pieces)
  const selectedPieceIds = useStore((s) => s.selectedPieceIds)

  const [expanded, setExpanded] = useState(false)
  const [openAiApiKey, setOpenAiApiKey] = useState('')
  const [freeText, setFreeText] = useState('')
  const [attachedImage, setAttachedImage] = useState<AttachedImage | null>(null)
  const [proposal, setProposal] = useState<WorkspaceChatProposal | null>(null)
  const [helpAnswer, setHelpAnswer] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [loadingKind, setLoadingKind] = useState<'help' | 'proposal' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const selectedNames = useMemo(() => {
    const set = new Set(selectedPieceIds)
    return pieces.filter((p) => set.has(p.id)).map((p) => p.name || p.number)
  }, [pieces, selectedPieceIds])

  const pieceSummaries = useMemo(() => {
    return pieces.map((p, i) => {
      const b = curvesBounds(p.cutLine)
      const bb = b
        ? `${Math.round(b.minX)}…${Math.round(b.maxX)} × ${Math.round(b.minY)}…${Math.round(b.maxY)} mm`
        : 'keine Kontur'
      return `[${i}] ${p.name} (${p.number}): ${p.cutLine.length} Segm., lokal ${bb}`
    })
  }, [pieces])

  const canAskHelp =
    openAiApiKey.trim().length > 0 && freeText.trim().length > 0 && !isLoading
  const canRequestProposal =
    openAiApiKey.trim().length > 0 && (freeText.trim().length > 0 || attachedImage != null) && !isLoading

  const requestHelpFromDocs = async () => {
    setError(null)
    setProposal(null)
    setIsLoading(true)
    setLoadingKind('help')
    try {
      const text = await requestWorkspaceHelpAnswer({
        apiKey: openAiApiKey,
        question: freeText,
        pieceCount: pieces.length,
        selectedCount: selectedPieceIds.length,
        selectedNames,
      })
      setHelpAnswer(text)
    } catch (err) {
      setHelpAnswer(null)
      setError(err instanceof Error ? err.message : 'Unbekannter KI-Fehler.')
    } finally {
      setIsLoading(false)
      setLoadingKind(null)
    }
  }

  const requestSuggestion = async () => {
    setError(null)
    setHelpAnswer(null)
    setIsLoading(true)
    setLoadingKind('proposal')
    try {
      const result = await requestWorkspaceChatProposal({
        apiKey: openAiApiKey,
        freeText,
        pieceCount: pieces.length,
        selectedCount: selectedPieceIds.length,
        selectedNames,
        pieceSummaries,
        imageBase64: attachedImage?.base64,
        imageMimeType: attachedImage?.mime,
      })
      setProposal(result)
    } catch (err) {
      setProposal(null)
      setError(err instanceof Error ? err.message : 'Unbekannter KI-Fehler.')
    } finally {
      setIsLoading(false)
      setLoadingKind(null)
    }
  }

  const onConfirm = () => {
    if (!proposal) return
    setError(null)
    try {
      applyWorkspaceChatProposal(proposal)
      setProposal(null)
      setHelpAnswer(null)
      setFreeText('')
      setAttachedImage(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Aktion konnte nicht ausgeführt werden.')
    }
  }

  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f || !f.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl)
      if (!m) return
      setAttachedImage({ mime: m[1], base64: m[2], previewUrl: dataUrl })
    }
    reader.readAsDataURL(f)
  }

  if (!expanded) {
    return (
      <button
        type="button"
        className="workspace-ai-chat-tab"
        onClick={() => setExpanded(true)}
        title="KI-Assistent öffnen"
      >
        KI
      </button>
    )
  }

  return (
    <aside className="workspace-ai-chat-panel" aria-label="KI-Assistent Arbeitsfläche">
      <div className="workspace-ai-chat-header">
        <span className="workspace-ai-chat-title">KI</span>
        <button type="button" className="workspace-ai-chat-collapse" onClick={() => setExpanded(false)} title="Einklappen">
          «
        </button>
      </div>
      <p className="workspace-ai-chat-hint">
        <strong>Bedienung:</strong> Frage eingeben (z. B. „Welche Taste für Drehpunkt?“) → <em>Antwort aus Doku</em> nutzt die
        Projekt-Dokumentation. <strong>Aktionen:</strong> Text und optional Screenshot/Skizze → <em>Vorschlag holen</em> für
        Kerben, Bohrungen, neue Teile (erst nach Bestätigung).
      </p>
      <label className="nahtzugabe-dialog-label">
        <span>OpenAI API-Key</span>
        <input
          type="password"
          className="nahtzugabe-dialog-input"
          value={openAiApiKey}
          onChange={(e) => setOpenAiApiKey(e.target.value)}
          placeholder="sk-..."
          autoComplete="off"
        />
      </label>
      <label className="nahtzugabe-dialog-label" style={{ marginTop: 8 }}>
        <span>Anweisung</span>
        <textarea
          className="nahtzugabe-dialog-input"
          value={freeText}
          onChange={(e) => {
            setFreeText(e.target.value)
            setHelpAnswer(null)
            setProposal(null)
          }}
          rows={3}
          style={{ resize: 'vertical' }}
          placeholder="Bedienung: z. B. Wie setze ich den Drehpunkt? — Aktionen: z. B. Kerbe oben, oder Bild anhängen."
        />
      </label>
      <div className="workspace-ai-chat-image-row" style={{ marginTop: 8 }}>
        <input ref={fileInputRef} type="file" accept="image/*" className="workspace-ai-chat-file" onChange={onPickImage} />
        {attachedImage && (
          <div className="workspace-ai-chat-thumb-wrap">
            <img src={attachedImage.previewUrl} alt="" className="workspace-ai-chat-thumb" />
            <button
              type="button"
              className="sidebar-btn"
              style={{ marginTop: 4, padding: '2px 8px', fontSize: 11 }}
              onClick={() => {
                setAttachedImage(null)
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
            >
              Bild entfernen
            </button>
          </div>
        )}
      </div>
      <p className="workspace-ai-chat-meta">
        {pieces.length} Teil(e), {selectedPieceIds.length} ausgewählt
        {selectedNames.length > 0 ? `: ${selectedNames.join(', ')}` : ''}
      </p>
      <div className="workspace-ai-chat-actions-row" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="sidebar-btn primary"
          onClick={requestHelpFromDocs}
          disabled={!canAskHelp}
          title="Nutzt die eingebettete Dokumentation (docs/KI-NUTZERHILFE-QUELLE.md)"
        >
          {isLoading && loadingKind === 'help' ? 'Doku…' : 'Antwort aus Doku'}
        </button>
        <button
          type="button"
          className="sidebar-btn primary"
          onClick={requestSuggestion}
          disabled={!canRequestProposal}
          title="JSON-Aktionen für die Arbeitsfläche"
        >
          {isLoading && loadingKind === 'proposal' ? 'Analysiere…' : 'Vorschlag holen'}
        </button>
      </div>
      {error && <p className="workspace-ai-chat-error">{error}</p>}
      {helpAnswer && (
        <div className="workspace-ai-chat-help-answer" role="region" aria-label="Hilfe aus Dokumentation">
          <strong className="workspace-ai-chat-help-answer-title">Antwort (aus Doku)</strong>
          <div className="workspace-ai-chat-help-answer-body">{helpAnswer}</div>
        </div>
      )}
      {proposal && (
        <div className="workspace-ai-chat-preview">
          <p className="workspace-ai-chat-preview-rationale">
            <strong>Vorschlag:</strong> {proposal.rationale}
          </p>
          <ul className="workspace-ai-chat-action-list">
            {proposal.actions.map((a, i) => (
              <li key={i}>{actionLabel(a)}</li>
            ))}
          </ul>
          <div className="nahtzugabe-dialog-actions">
            <button type="button" className="sidebar-btn primary" onClick={onConfirm}>
              Ausführen
            </button>
            <button type="button" className="sidebar-btn" onClick={() => setProposal(null)}>
              Verwerfen
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}

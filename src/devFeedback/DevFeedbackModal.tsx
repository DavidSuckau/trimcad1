import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import {
  createFeedbackIssue,
  fetchFeedbackSnapshot,
  type FeedbackIssue,
} from './devFeedbackApi'
import { FeedbackStatsPanel } from './FeedbackStatsPanel'
import { formatOpenDays, type FeedbackIssueStats } from './feedbackStats'
import { useDevFeedbackStore } from './useDevFeedbackStore'
import { validateFeedbackForm } from './validateFeedback'
import { APP_VERSION_LABEL } from '../branding'
import './devFeedback.css'

const APP_VERSION = APP_VERSION_LABEL

type Tab = 'new' | 'list'

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export function DevFeedbackModal() {
  const open = useDevFeedbackStore((s) => s.open)
  const setOpen = useDevFeedbackStore((s) => s.setOpen)
  const trapRef = useFocusTrap<HTMLDivElement>(open)

  const [tab, setTab] = useState<Tab>('new')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [authorName, setAuthorName] = useState(() => {
    try {
      return localStorage.getItem('trimtex-feedback-author') ?? ''
    } catch {
      return ''
    }
  })
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const [issues, setIssues] = useState<FeedbackIssue[]>([])
  const [stats, setStats] = useState<FeedbackIssueStats | null>(null)
  const [statsExpanded, setStatsExpanded] = useState(false)
  const [loadingList, setLoadingList] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  const activeIssues = useMemo(
    () => issues.filter((i) => i.status === 'open' || i.status === 'in_progress'),
    [issues],
  )

  const loadIssues = useCallback(async () => {
    setLoadingList(true)
    setListError(null)
    try {
      const snap = await fetchFeedbackSnapshot()
      setIssues(snap.issues)
      setStats(snap.stats)
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Liste konnte nicht geladen werden.')
      setIssues([])
      setStats(null)
    } finally {
      setLoadingList(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  useEffect(() => {
    if (open && tab === 'list') void loadIssues()
  }, [open, tab, loadIssues])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMessage(null)
    const form = { title, body, authorName }
    const err = validateFeedbackForm(form)
    if (err) {
      setMessage({ kind: 'error', text: err })
      return
    }
    setSubmitting(true)
    try {
      if (authorName.trim()) {
        try {
          localStorage.setItem('trimtex-feedback-author', authorName.trim())
        } catch {
          /* ignore */
        }
      }
      const created = await createFeedbackIssue(form, {
        appVersion: APP_VERSION,
        userAgent: navigator.userAgent.slice(0, 200),
      })
      if (created.openedExternally) {
        setMessage({
          kind: 'ok',
          text: 'GitHub-Issue im neuen Tab geöffnet — bitte dort auf „Submit new issue“ klicken.',
        })
      } else {
        setMessage({
          kind: 'ok',
          text: `Eintrag #${created.number} wurde angelegt.`,
        })
        setTitle('')
        setBody('')
      }
      void loadIssues()
    } catch (e) {
      setMessage({
        kind: 'error',
        text: e instanceof Error ? e.message : 'Senden fehlgeschlagen.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="dev-feedback-overlay"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dev-feedback-title"
    >
      <div className="dev-feedback-modal" onClick={(ev) => ev.stopPropagation()} ref={trapRef}>
        <header className="dev-feedback-header">
          <div>
            <h2 id="dev-feedback-title" className="dev-feedback-title">
              Entwickler-Todo / Feedback
            </h2>
            <p className="dev-feedback-subtitle">
              Einträge landen als GitHub-Issues — Liste für alle sichtbar. Senden öffnet ggf. GitHub
              (GitHub Pages) oder geht direkt (lokal mit Proxy).
            </p>
          </div>
          <button type="button" className="dev-feedback-close" onClick={() => setOpen(false)}>
            Schließen
          </button>
        </header>

        <div className="dev-feedback-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'new'}
            className={`dev-feedback-tab${tab === 'new' ? ' is-active' : ''}`}
            onClick={() => setTab('new')}
          >
            Neuer Eintrag
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'list'}
            className={`dev-feedback-tab${tab === 'list' ? ' is-active' : ''}`}
            onClick={() => setTab('list')}
          >
            Offene Liste
          </button>
        </div>

        <div className="dev-feedback-body">
          {tab === 'new' ? (
            <form onSubmit={(e) => void handleSubmit(e)}>
              <div className="dev-feedback-field">
                <label htmlFor="df-title">Titel</label>
                <input
                  id="df-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="z. B. Kaschierung an Ecke fehlt nach Spiegeln"
                  maxLength={120}
                  disabled={submitting}
                />
              </div>
              <div className="dev-feedback-field">
                <label htmlFor="df-author">Dein Name (optional)</label>
                <input
                  id="df-author"
                  value={authorName}
                  onChange={(e) => setAuthorName(e.target.value)}
                  placeholder="Wird im Issue vermerkt"
                  maxLength={80}
                  disabled={submitting}
                />
              </div>
              <div className="dev-feedback-field">
                <label htmlFor="df-body">Beschreibung</label>
                <textarea
                  id="df-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Was soll geändert werden? Schritte zum Nachstellen…"
                  maxLength={8000}
                  disabled={submitting}
                />
              </div>
              <div className="dev-feedback-actions">
                <button type="submit" className="dev-feedback-btn" disabled={submitting}>
                  {submitting ? 'Sende…' : 'An GitHub senden'}
                </button>
              </div>
              {message && (
                <p className={`dev-feedback-msg is-${message.kind}`} role="status">
                  {message.text}
                </p>
              )}
            </form>
          ) : (
            <>
              {stats && (
                <FeedbackStatsPanel
                  stats={stats}
                  issues={issues}
                  expanded={statsExpanded}
                  onToggle={() => setStatsExpanded((v) => !v)}
                />
              )}
              <div className="dev-feedback-actions">
                <button
                  type="button"
                  className="dev-feedback-btn dev-feedback-btn-secondary"
                  onClick={() => void loadIssues()}
                  disabled={loadingList}
                >
                  {loadingList ? 'Lade…' : 'Aktualisieren'}
                </button>
              </div>
              {listError && (
                <p className="dev-feedback-msg is-error" role="alert">
                  {listError}
                </p>
              )}
              {!listError && !loadingList && activeIssues.length === 0 && (
                <p className="dev-feedback-empty">
                  Keine offenen trim-cad.de-Einträge. Nach dem Senden ggf. „Aktualisieren“ — oder direkt
                  auf{' '}
                  <a
                    href={`https://github.com/DavidSuckau/trimcad1/issues?q=is%3Aissue+is%3Aopen+label%3A${encodeURIComponent('trimtex-feedback')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    GitHub
                  </a>
                  .
                </p>
              )}
              <div className="dev-feedback-list-wrap">
                <div className="dev-feedback-list-head" aria-hidden="true">
                  <span className="dev-feedback-col dev-feedback-col--nr">#</span>
                  <span className="dev-feedback-col dev-feedback-col--title">Titel</span>
                  <span className="dev-feedback-col dev-feedback-col--status">Status</span>
                  <span className="dev-feedback-col dev-feedback-col--age">Offen seit</span>
                  <span className="dev-feedback-col dev-feedback-col--date">Erstellt</span>
                  <span className="dev-feedback-col dev-feedback-col--link" />
                </div>
                <ul className="dev-feedback-list">
                  {activeIssues.map((issue) => (
                    <li key={issue.number} className={`dev-feedback-item dev-feedback-item--${issue.status}`}>
                      <span className="dev-feedback-col dev-feedback-col--nr">#{issue.number}</span>
                      <span className="dev-feedback-col dev-feedback-col--title" title={issue.title}>
                        {issue.title}
                      </span>
                      <span className="dev-feedback-col dev-feedback-col--status">
                        <span className={`dev-feedback-badge dev-feedback-badge--${issue.status}`}>
                          {issue.status === 'in_progress' ? 'Bearbeitung' : 'Offen'}
                        </span>
                      </span>
                      <span className="dev-feedback-col dev-feedback-col--age">
                        {formatOpenDays(issue.openDays)}
                      </span>
                      <span className="dev-feedback-col dev-feedback-col--date">
                        {formatDate(issue.createdAt)}
                      </span>
                      <span className="dev-feedback-col dev-feedback-col--link">
                        <a
                          className="dev-feedback-item-link"
                          href={issue.htmlUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          GitHub
                        </a>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store/useStore'
import { HELP_ENTRIES, HELP_CATEGORIES_ORDER } from '../data/helpEntries'
import { useFocusTrap } from '../hooks/useFocusTrap'

export function HelpModal() {
  const { showHelpModal, setShowHelpModal } = useStore(
    useShallow((s) => ({ showHelpModal: s.showHelpModal, setShowHelpModal: s.setShowHelpModal })),
  )
  const trapRef = useFocusTrap<HTMLDivElement>(showHelpModal)

  useEffect(() => {
    if (!showHelpModal) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowHelpModal(false)
        e.preventDefault()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [showHelpModal, setShowHelpModal])

  if (!showHelpModal) return null

  const byCategory = HELP_CATEGORIES_ORDER.map((cat) => ({
    category: cat,
    entries: HELP_ENTRIES.filter((e) => e.category === cat),
  })).filter((g) => g.entries.length > 0)

  return (
    <div
      className="help-overlay"
      onClick={() => setShowHelpModal(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-modal-title"
    >
      <div className="help-modal" onClick={(e) => e.stopPropagation()} ref={trapRef}>
        <div className="help-header">
          <h2 id="help-modal-title" className="help-title">
            Anleitung
          </h2>
          <button
            type="button"
            className="help-close"
            onClick={() => setShowHelpModal(false)}
            aria-label="Schließen"
          >
            &times;
          </button>
        </div>
        <div className="help-body">
          <p className="help-intro">
            Alle Funktionen mit Kurzbeschreibung, Zugriff und Tastenkürzeln. Escape oder Klick außerhalb schließt.
          </p>
          {byCategory.map(({ category, entries }) => (
            <section key={category} className="help-category">
              <h3 className="help-category-title">{category}</h3>
              <ul className="help-entry-list">
                {entries.map((entry, i) => (
                  <li key={`${entry.name}-${i}`} className="help-entry">
                    <div className="help-entry-name">{entry.name}</div>
                    <p className="help-entry-description">{entry.description}</p>
                    <div className="help-entry-meta">
                      <span className="help-entry-access">
                        <strong>Zugriff:</strong> {entry.access}
                      </span>
                      {entry.shortcut && (
                        <span className="help-shortcut">
                          <strong>Shortcut:</strong> <kbd>{entry.shortcut}</kbd>
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

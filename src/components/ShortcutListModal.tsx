import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store/useStore'
import { getShortcutListGrouped } from '../data/helpEntries'
import { useFocusTrap } from '../hooks/useFocusTrap'

export function ShortcutListModal() {
  const { showShortcutListModal, setShowShortcutListModal } = useStore(
    useShallow((s) => ({
      showShortcutListModal: s.showShortcutListModal,
      setShowShortcutListModal: s.setShowShortcutListModal,
    })),
  )
  const trapRef = useFocusTrap<HTMLDivElement>(showShortcutListModal)

  useEffect(() => {
    if (!showShortcutListModal) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowShortcutListModal(false)
        e.preventDefault()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [showShortcutListModal, setShowShortcutListModal])

  if (!showShortcutListModal) return null

  const grouped = getShortcutListGrouped()

  return (
    <div
      className="help-overlay"
      onClick={() => setShowShortcutListModal(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcut-list-title"
    >
      <div className="help-modal shortcut-list-modal" onClick={(e) => e.stopPropagation()} ref={trapRef}>
        <div className="help-header">
          <h2 id="shortcut-list-title" className="help-title">
            Tastenkürzel
          </h2>
          <button
            type="button"
            className="help-close"
            onClick={() => setShowShortcutListModal(false)}
            aria-label="Schließen"
          >
            &times;
          </button>
        </div>
        <div className="help-body">
          <p className="help-intro">
            Übersicht aller Tastenkürzel. Escape oder Klick außerhalb schließt. Details stehen in der Anleitung (F1).
          </p>
          {grouped.map(({ category, rows }) => (
            <section key={category} className="help-category shortcut-list-category">
              <h3 className="help-category-title">{category}</h3>
              <ul className="shortcut-list-ul">
                {rows.map((row) => (
                  <li key={`${category}-${row.name}`} className="shortcut-list-row">
                    <span className="shortcut-list-name">{row.name}</span>
                    <kbd className="shortcut-list-kbd">{row.shortcut}</kbd>
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

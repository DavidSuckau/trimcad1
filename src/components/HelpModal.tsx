import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store/useStore'
import { HELP_ENTRIES, HELP_CATEGORIES_ORDER } from '../data/helpEntries'
import { useFocusTrap } from '../hooks/useFocusTrap'

const HELP_SCREENSHOTS: Record<string, { file: string; alt: string; caption: string }> = {
  'Datei::DXF exportieren (einfach)': {
    file: 'datei-export.png',
    alt: 'Menü Datei mit geöffnetem Export-Untermenü',
    caption: 'Beispiel: Datei → Exportieren',
  },
  'Naht::Nahtzugabe …': {
    file: 'nahtzugabe.png',
    alt: 'Dialog für Nahtzugabe in Millimetern',
    caption: 'Beispiel: Nahtzugabe-Dialog',
  },
  'Naht::Nahtzuordnung': {
    file: 'nahtzuordnung.png',
    alt: 'Nahtzuordnung-Modus mit Hinweis zur Kantenauswahl',
    caption: 'Beispiel: Nahtzuordnung starten',
  },
  'Werkzeuge::Nahtkante exakt auf Längengleichheit (0 mm Differenz)': {
    file: 'nahtzuordnung.png',
    alt: 'Nahtzuordnung-Kontext für den Längenabgleich an Nahtkanten',
    caption: 'Kontext: Nahtkante auf Längengleichheit angleichen',
  },
  'Profil::Profil zuordnen': {
    file: 'profil-zuordnung.png',
    alt: 'Profil-zuordnen-Modus mit Hinweis zur Kantenauswahl',
    caption: 'Beispiel: Profil zuordnen',
  },
  'Werkzeuge::Notch': {
    file: 'notch-setzen.png',
    alt: 'Aktives Notch-Werkzeug beim Setzen auf einer Kante',
    caption: 'Beispiel: Notch setzen',
  },
  'Werkzeuge::Drehpunkt auf Ecke, Kerbe oder Kurve setzen': {
    file: 'drehpunkt-alt-d.png',
    alt: 'Gesetzter Drehpunkt mit Alt+D an einem Teil',
    caption: 'Beispiel: Drehpunkt setzen mit Alt+D',
  },
}

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
          <div className="help-header-actions">
            <button type="button" className="help-print" onClick={() => window.print()} aria-label="Anleitung drucken">
              Drucken
            </button>
            <button
              type="button"
              className="help-close"
              onClick={() => setShowHelpModal(false)}
              aria-label="Schließen"
            >
              &times;
            </button>
          </div>
        </div>
        <div className="help-body">
          <p className="help-intro">
            Alle Funktionen mit Kurzbeschreibung, Zugriff und Tastenkürzeln. Escape oder Klick außerhalb schließt.
          </p>
          {byCategory.map(({ category, entries }) => (
            <section key={category} className="help-category">
              <h3 className="help-category-title">{category}</h3>
              <ul className="help-entry-list">
                {entries.map((entry, i) => {
                  const key = `${entry.category}::${entry.name}`
                  const screenshot = HELP_SCREENSHOTS[key]
                  const screenshotUrl = screenshot ? `${import.meta.env.BASE_URL}help-screenshots/${screenshot.file}` : ''
                  return (
                  <li key={`${entry.name}-${i}`} className="help-entry">
                    <div className="help-entry-name">{entry.name}</div>
                    <p className="help-entry-description">{entry.description}</p>
                    {screenshot && (
                      <figure className="help-entry-screenshot">
                        <img src={screenshotUrl} alt={screenshot.alt} loading="lazy" />
                        <figcaption>{screenshot.caption}</figcaption>
                      </figure>
                    )}
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
                )})}
              </ul>
            </section>
          ))}
        </div>
        <div className="help-print-footer" aria-hidden="true" />
      </div>
    </div>
  )
}

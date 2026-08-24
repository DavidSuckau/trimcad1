import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useStore } from '../store/useStore'
import { formatDeDecimal, parseDeDecimal } from '../material/materialCatalogFormat'
import { loadMaterialCatalog, saveMaterialCatalog } from '../material/materialCatalogStorage'
import type { GrainDirection, MaterialCatalogRow, MaterialPriceBasis } from '../material/materialCatalogTypes'
import { collectMaterialCatalogProjectNames, createEmptyMaterialCatalogRow } from '../material/materialCatalogTypes'

const DEBOUNCE_MS = 300

const GRAIN_LABELS: Record<GrainDirection, string> = {
  kette: 'Kette',
  schuss: 'Schuss',
  frei: 'frei',
}

const PRICE_BASIS_LABELS: Record<MaterialPriceBasis, string> = {
  m2: 'm² (EK / m²)',
  lfm: 'Lfm (EK / m Rolle)',
}

function mergeRowsWithNumericDrafts(
  list: MaterialCatalogRow[],
  priceDraft: Record<string, string>,
  qtyDraft: Record<string, string>,
): MaterialCatalogRow[] {
  return list.map((row) => ({
    ...row,
    purchasePrice: priceDraft[row.id] !== undefined ? parseDeDecimal(priceDraft[row.id]) : row.purchasePrice,
    quantityOnHand: qtyDraft[row.id] !== undefined ? parseDeDecimal(qtyDraft[row.id]) : row.quantityOnHand,
  }))
}

export function MaterialCatalogModal() {
  const { showMaterialCatalogModal, setShowMaterialCatalogModal, workspace } = useStore(
    useShallow((s) => ({
      showMaterialCatalogModal: s.showMaterialCatalogModal,
      setShowMaterialCatalogModal: s.setShowMaterialCatalogModal,
      workspace: s.workspace,
    })),
  )

  const [rows, setRows] = useState<MaterialCatalogRow[]>([])
  const [projects, setProjects] = useState<string[]>([])
  const [projectFilter, setProjectFilter] = useState<string>('')
  const [newProjectName, setNewProjectName] = useState('')
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({})
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({})
  const skipNextSaveRef = useRef(true)
  const trapRef = useFocusTrap<HTMLDivElement>(showMaterialCatalogModal)

  const currentWorkspaceProjectLabel = useMemo(() => {
    const file = workspace.projectFileName?.trim()
    if (file) return file.replace(/\.[^.]+$/, '')
    const name = workspace.name?.trim()
    return name || ''
  }, [workspace.projectFileName, workspace.name])

  useEffect(() => {
    if (!showMaterialCatalogModal) return
    skipNextSaveRef.current = true
    const file = loadMaterialCatalog()
    setRows(file.rows)
    setProjects(collectMaterialCatalogProjectNames(file.rows, file.projects))
    setProjectFilter('')
    setNewProjectName('')
    setPriceDraft({})
    setQtyDraft({})
  }, [showMaterialCatalogModal])

  const catalogPayload = useMemo(
    () => ({
      version: 1 as const,
      rows: mergeRowsWithNumericDrafts(rows, priceDraft, qtyDraft),
      ...(projects.length > 0 ? { projects } : {}),
    }),
    [rows, priceDraft, qtyDraft, projects],
  )

  useEffect(() => {
    if (!showMaterialCatalogModal) return
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false
      return
    }
    const id = window.setTimeout(() => {
      saveMaterialCatalog(catalogPayload)
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [catalogPayload, showMaterialCatalogModal])

  const close = useCallback(() => {
    saveMaterialCatalog(catalogPayload)
    setShowMaterialCatalogModal(false)
  }, [catalogPayload, setShowMaterialCatalogModal])

  const projectOptions = useMemo(
    () => collectMaterialCatalogProjectNames(rows, projects),
    [rows, projects],
  )

  const sortedRows = useMemo(() => {
    const filtered =
      projectFilter === ''
        ? rows
        : rows.filter((r) => r.projectName.trim() === projectFilter)
    return [...filtered].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }, [rows, projectFilter])

  const rowIndexById = useMemo(() => {
    const m = new Map<string, number>()
    sortedRows.forEach((r, i) => m.set(r.id, i + 1))
    return m
  }, [sortedRows])

  const mergedForTotals = useMemo(
    () => mergeRowsWithNumericDrafts(rows, priceDraft, qtyDraft),
    [rows, priceDraft, qtyDraft],
  )

  const lagerwertEuro = useMemo(() => {
    let sum = 0
    for (const r of mergedForTotals) {
      const p = r.purchasePrice
      const q = r.quantityOnHand
      if (p != null && q != null && Number.isFinite(p) && Number.isFinite(q)) {
        sum += p * q
      }
    }
    return sum
  }, [mergedForTotals])

  const updateRow = useCallback((id: string, patch: Partial<MaterialCatalogRow>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }, [])

  const addRow = useCallback(() => {
    const row = createEmptyMaterialCatalogRow()
    if (projectFilter) row.projectName = projectFilter
    setRows((prev) => [...prev, row])
  }, [projectFilter])

  const addProject = useCallback(() => {
    const name = newProjectName.trim()
    if (!name) return
    setProjects((prev) => collectMaterialCatalogProjectNames(rows, [...prev, name]))
    setNewProjectName('')
    if (!projectFilter) setProjectFilter(name)
  }, [newProjectName, rows, projectFilter])

  const adoptWorkspaceProject = useCallback(() => {
    const name = currentWorkspaceProjectLabel.trim()
    if (!name) return
    setProjects((prev) => collectMaterialCatalogProjectNames(rows, [...prev, name]))
    setProjectFilter(name)
  }, [currentWorkspaceProjectLabel, rows])

  const removeRow = useCallback((id: string) => {
    setRows((prev) => prev.filter((row) => row.id !== id))
    setPriceDraft((d) => {
      const next = { ...d }
      delete next[id]
      return next
    })
    setQtyDraft((d) => {
      const next = { ...d }
      delete next[id]
      return next
    })
  }, [])

  const commitPriceDraft = useCallback((id: string) => {
    setPriceDraft((d) => {
      const raw = d[id]
      if (raw === undefined) return d
      const n = parseDeDecimal(raw)
      const { [id]: _removed, ...rest } = d
      setRows((prev) => prev.map((row) => (row.id === id ? { ...row, purchasePrice: n } : row)))
      return rest
    })
  }, [])

  const commitQtyDraft = useCallback((id: string) => {
    setQtyDraft((d) => {
      const raw = d[id]
      if (raw === undefined) return d
      const n = parseDeDecimal(raw)
      const { [id]: _removed, ...rest } = d
      setRows((prev) => prev.map((row) => (row.id === id ? { ...row, quantityOnHand: n } : row)))
      return rest
    })
  }, [])

  if (!showMaterialCatalogModal) return null

  return (
    <div
      className="settings-overlay"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Materialdatenbank"
    >
      <div
        className="settings-modal stueckliste-modal material-catalog-modal"
        onClick={(e) => e.stopPropagation()}
        ref={trapRef}
        style={{ maxWidth: 'min(1200px, 96vw)' }}
      >
        <div className="settings-header">
          <h2 className="settings-title">Materialdatenbank</h2>
          <button type="button" className="settings-close" onClick={close} aria-label="Schließen">
            &times;
          </button>
        </div>

        <div className="settings-body" style={{ minHeight: 160 }}>
          <p className="settings-placeholder" style={{ marginTop: 0, marginBottom: 12 }}>
            Einträge werden lokal im Browser gespeichert (localStorage). Materialien können einem Projekt zugeordnet
            werden.
          </p>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span>Filter Projekt</span>
              <select
                className="notch-input"
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                aria-label="Projektfilter"
              >
                <option value="">Alle Projekte</option>
                {projectOptions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <input
              type="text"
              className="notch-input"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Neues Projekt …"
              autoComplete="off"
              aria-label="Neues Projekt"
              style={{ minWidth: 160 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addProject()
                }
              }}
            />
            <button type="button" className="sidebar-btn" onClick={addProject} disabled={!newProjectName.trim()}>
              Projekt anlegen
            </button>
            {currentWorkspaceProjectLabel ? (
              <button type="button" className="sidebar-btn" onClick={adoptWorkspaceProject}>
                Aktuelles Projekt: {currentWorkspaceProjectLabel}
              </button>
            ) : null}
          </div>
          <div style={{ marginBottom: 12 }}>
            <button type="button" className="sidebar-btn primary" onClick={addRow}>
              Zeile hinzufügen
            </button>
          </div>
          <p
            className="stueckliste-doc-row"
            style={{ marginBottom: 12, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}
          >
            <span className="stueckliste-doc-label">Lagerwert (EK × Menge)</span>
            <span className="stueckliste-doc-value">
              {lagerwertEuro.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
            </span>
          </p>
          <p className="settings-placeholder" style={{ marginBottom: 12, fontSize: 12, lineHeight: 1.45 }}>
            <strong>Preisbezug:</strong> bei Stoff oft Laufmeter mit Rollenbreite (vereinfachte Kosten in der Stückliste:
            Fläche ÷ Rollenbreite). Bei Leder typisch <strong>m²</strong>, Rollenbreite leer lassen.
          </p>
          <div className="settings-notches" style={{ overflowX: 'auto' }}>
            <table className="settings-notch-table material-catalog-table">
              <thead>
                <tr>
                  <th className="notch-nr">Nr.</th>
                  <th>Materialnr.</th>
                  <th>Lief.-Nr.</th>
                  <th>Beschreibung</th>
                  <th>Lieferant</th>
                  <th>EK (€)</th>
                  <th>Preis</th>
                  <th>Rolle mm</th>
                  <th>Kategorie</th>
                  <th>Dicke</th>
                  <th>Laufrichtung</th>
                  <th>Lagerplatz</th>
                  <th>Projekt</th>
                  <th>Menge</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sortedRows.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="settings-placeholder" style={{ padding: '1rem' }}>
                      Noch keine Materialien. „Zeile hinzufügen“ wählen.
                    </td>
                  </tr>
                ) : (
                  sortedRows.map((r) => (
                    <tr key={r.id}>
                      <td className="notch-nr">{rowIndexById.get(r.id)}</td>
                      <td>
                        <input
                          type="text"
                          className="notch-input"
                          value={r.materialNumber}
                          onChange={(e) => updateRow(r.id, { materialNumber: e.target.value })}
                          autoComplete="off"
                          aria-label={`Materialnummer Zeile ${rowIndexById.get(r.id)}`}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="notch-input"
                          value={r.supplierSku}
                          onChange={(e) => updateRow(r.id, { supplierSku: e.target.value })}
                          autoComplete="off"
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="notch-input"
                          value={r.description}
                          onChange={(e) => updateRow(r.id, { description: e.target.value })}
                          autoComplete="off"
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="notch-input"
                          value={r.supplierName}
                          onChange={(e) => updateRow(r.id, { supplierName: e.target.value })}
                          autoComplete="off"
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="notch-input"
                          inputMode="decimal"
                          value={priceDraft[r.id] ?? formatDeDecimal(r.purchasePrice)}
                          onFocus={() =>
                            setPriceDraft((d) => ({
                              ...d,
                              [r.id]: formatDeDecimal(r.purchasePrice),
                            }))
                          }
                          onChange={(e) => setPriceDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                          onBlur={() => commitPriceDraft(r.id)}
                          autoComplete="off"
                        />
                      </td>
                      <td>
                        <select
                          className="notch-input"
                          value={r.priceBasis}
                          onChange={(e) =>
                            updateRow(r.id, { priceBasis: e.target.value as MaterialPriceBasis })
                          }
                          aria-label="Preisbezug"
                        >
                          {(Object.keys(PRICE_BASIS_LABELS) as MaterialPriceBasis[]).map((k) => (
                            <option key={k} value={k}>
                              {PRICE_BASIS_LABELS[k]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          className="notch-input"
                          style={{ width: 72, minWidth: 0 }}
                          min={0}
                          step={1}
                          value={r.rollWidthMm ?? ''}
                          onChange={(e) => {
                            const raw = e.target.value
                            if (raw === '') updateRow(r.id, { rollWidthMm: null })
                            else {
                              const n = parseFloat(raw)
                              updateRow(r.id, {
                                rollWidthMm: Number.isFinite(n) && n > 0 ? n : null,
                              })
                            }
                          }}
                          placeholder="—"
                          title="Rollenbreite Nutz in mm (bei EK pro Laufmeter)"
                          aria-label="Rollenbreite mm"
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="notch-input"
                          value={r.category}
                          onChange={(e) => updateRow(r.id, { category: e.target.value })}
                          autoComplete="off"
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="notch-input"
                          value={r.thicknessLabel}
                          onChange={(e) => updateRow(r.id, { thicknessLabel: e.target.value })}
                          placeholder="z. B. 200 gr"
                          autoComplete="off"
                        />
                      </td>
                      <td>
                        <select
                          className="notch-input"
                          value={r.grainDirection}
                          onChange={(e) =>
                            updateRow(r.id, { grainDirection: e.target.value as GrainDirection })
                          }
                          aria-label="Laufrichtung"
                        >
                          {(Object.keys(GRAIN_LABELS) as GrainDirection[]).map((k) => (
                            <option key={k} value={k}>
                              {GRAIN_LABELS[k]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="text"
                          className="notch-input"
                          value={r.storageLocation}
                          onChange={(e) => updateRow(r.id, { storageLocation: e.target.value })}
                          autoComplete="off"
                        />
                      </td>
                      <td>
                        <select
                          className="notch-input"
                          value={r.projectName}
                          onChange={(e) => updateRow(r.id, { projectName: e.target.value })}
                          aria-label={`Projekt Zeile ${rowIndexById.get(r.id)}`}
                        >
                          <option value="">—</option>
                          {projectOptions.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="text"
                          className="notch-input"
                          inputMode="decimal"
                          value={qtyDraft[r.id] ?? formatDeDecimal(r.quantityOnHand)}
                          onFocus={() =>
                            setQtyDraft((d) => ({
                              ...d,
                              [r.id]: formatDeDecimal(r.quantityOnHand),
                            }))
                          }
                          onChange={(e) => setQtyDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                          onBlur={() => commitQtyDraft(r.id)}
                          autoComplete="off"
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="sidebar-btn"
                          style={{ padding: '4px 8px', fontSize: 12 }}
                          onClick={() => removeRow(r.id)}
                        >
                          Löschen
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="settings-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="sidebar-btn primary" onClick={close}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useStore } from '../store/useStore'
import {
  aggregateBomByMaterial,
  getCutLineAreaMm2,
  getCutLinePerimeterMm,
  materialKeyForBom,
  materialLabelForBom,
} from '../bom/pieceBomStats'
import {
  findCatalogRowByMaterialKey,
  catalogMaterialDescription,
  materialCostSumByMaterialKey,
  pieceMaterialCostEuro,
  totalMaterialCostEuro,
} from '../bom/materialCatalogCost'
import { loadMaterialCatalog } from '../material/materialCatalogStorage'
import {
  buildNaehplanRows,
  buildNaehplanSeamKindTotals,
  buildProfilnahtRows,
  profilnahtTotalLengthMm,
  PROFILNAHT_KIND_LABEL,
} from '../bom/naehplan'
import { computeMaterialAreaShares } from '../bom/materialAreaShare'
import { aggregateProfileBom } from '../bom/profileBomStats'
import { StuecklisteMaterialPie } from './StuecklisteMaterialPie'
import { WorkspaceOverviewPreview } from './WorkspaceOverviewPreview'

function fmtAreaM2(mm2: number): string {
  return (mm2 / 1_000_000).toLocaleString('de-DE', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}

function fmtLenM(mm: number): string {
  return (mm / 1000).toLocaleString('de-DE', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
}

function fmtTotalArea(m2: number): string {
  return m2.toLocaleString('de-DE', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}

function fmtTotalPerimeter(m: number): string {
  return m.toLocaleString('de-DE', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
}

function fmtEuro(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
}

export function StuecklisteModal() {
  const {
    workspace,
    showStuecklisteModal,
    setShowStuecklisteModal,
    updatePiece,
    updateWorkspace,
    imageDigitizeSession,
    setToastMessage,
  } = useStore(
    useShallow((s) => ({
      workspace: s.workspace,
      showStuecklisteModal: s.showStuecklisteModal,
      setShowStuecklisteModal: s.setShowStuecklisteModal,
      updatePiece: s.updatePiece,
      updateWorkspace: s.updateWorkspace,
      imageDigitizeSession: s.imageDigitizeSession,
      setToastMessage: s.setToastMessage,
    })),
  )
  const { pieces } = workspace
  const [pdfExporting, setPdfExporting] = useState(false)

  const docDateLabel = useMemo(() => {
    if (!showStuecklisteModal) return ''
    return new Intl.DateTimeFormat('de-DE', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date())
  }, [showStuecklisteModal])

  const aggregate = useMemo(() => {
    const rows = pieces.map((p) => ({
      materialKey: p.material ?? '',
      quantity: p.bomQuantity ?? 1,
      areaMm2: getCutLineAreaMm2(p),
      perimeterMm: getCutLinePerimeterMm(p),
    }))
    return aggregateBomByMaterial(rows)
  }, [pieces])

  const catalogRows = useMemo(() => loadMaterialCatalog().rows, [pieces, showStuecklisteModal])

  const materialCostByKey = useMemo(
    () => materialCostSumByMaterialKey(pieces, catalogRows),
    [pieces, catalogRows],
  )

  const grandMaterialEuro = useMemo(
    () => totalMaterialCostEuro(pieces, catalogRows),
    [pieces, catalogRows],
  )

  const naehplanRows = useMemo(() => buildNaehplanRows(workspace), [workspace])

  const naehplanSeamKindTotals = useMemo(() => buildNaehplanSeamKindTotals(workspace), [workspace])

  const profilnahtRows = useMemo(() => buildProfilnahtRows(workspace), [workspace])

  const profilnahtTotalMm = useMemo(() => profilnahtTotalLengthMm(workspace), [workspace, profilnahtRows])

  const profileBomRows = useMemo(
    () => aggregateProfileBom(workspace.profileAssignments ?? [], pieces),
    [workspace.profileAssignments, pieces],
  )

  const materialAreaShares = useMemo(
    () => computeMaterialAreaShares(aggregate.byMaterial, aggregate.grand.totalAreaM2),
    [aggregate],
  )

  const trapRef = useFocusTrap<HTMLDivElement>(showStuecklisteModal)

  if (!showStuecklisteModal) return null

  return (
    <div className="settings-overlay" onClick={() => setShowStuecklisteModal(false)} role="dialog" aria-modal="true" aria-label="Stückliste">
      <div className="settings-modal stueckliste-modal" onClick={(e) => e.stopPropagation()} ref={trapRef}>
        <div className="settings-header">
          <h2 className="settings-title">Stückliste</h2>
          <button
            type="button"
            className="settings-close"
            onClick={() => setShowStuecklisteModal(false)}
            aria-label="Schließen"
          >
            &times;
          </button>
        </div>

        <div className="settings-body" style={{ minHeight: 200 }}>
          <div className="stueckliste-doc-meta">
            {workspace.projectFileName ? (
              <div className="stueckliste-doc-row">
                <span className="stueckliste-doc-label">Datei</span>
                <span className="stueckliste-doc-value">{workspace.projectFileName}</span>
              </div>
            ) : null}
            <div className="stueckliste-doc-row">
              <span className="stueckliste-doc-label">Datum</span>
              <span className="stueckliste-doc-value">{docDateLabel}</span>
            </div>
            <label className="stueckliste-doc-field">
              <span>Version</span>
              <input
                type="text"
                className="nahtzugabe-dialog-input"
                value={workspace.bomDocumentVersion ?? ''}
                onChange={(e) => updateWorkspace({ bomDocumentVersion: e.target.value })}
                placeholder="z. B. 1.0"
                autoComplete="off"
              />
            </label>
            <label className="stueckliste-doc-field">
              <span>Entwickler</span>
              <input
                type="text"
                className="nahtzugabe-dialog-input"
                value={workspace.bomDeveloperName ?? ''}
                onChange={(e) => updateWorkspace({ bomDeveloperName: e.target.value })}
                placeholder="Name"
                autoComplete="name"
              />
            </label>
            <label className="stueckliste-doc-field">
              <span>Ingenieur</span>
              <input
                type="text"
                className="nahtzugabe-dialog-input"
                value={workspace.bomEngineerName ?? ''}
                onChange={(e) => updateWorkspace({ bomEngineerName: e.target.value })}
                placeholder="Name"
                autoComplete="off"
              />
            </label>
          </div>

          <div className="settings-notches">
            <table className="settings-notch-table">
              <thead>
                <tr>
                  <th className="notch-nr">Nr.</th>
                  <th>Name</th>
                  <th>Beschreibung</th>
                  <th>Stückzahl</th>
                  <th>Fläche (m²)</th>
                  <th>Umfang (m)</th>
                  <th>Kerben</th>
                  <th>Materialnr.</th>
                  <th>Materialbezeichnung</th>
                  <th>Material (€)</th>
                </tr>
              </thead>
              <tbody>
                {pieces.map((p, i) => {
                  const areaMm2 = getCutLineAreaMm2(p)
                  const perMm = getCutLinePerimeterMm(p)
                  const q = p.bomQuantity ?? 1
                  const matKey = materialKeyForBom(p.material)
                  const rowCatalog = findCatalogRowByMaterialKey(catalogRows, matKey)
                  const lineEuro = pieceMaterialCostEuro(p, rowCatalog)
                  const matDesc = catalogMaterialDescription(catalogRows, matKey)
                  return (
                    <tr key={p.id}>
                      <td className="notch-nr">{i + 1}</td>
                      <td>{p.name}</td>
                      <td>
                        <textarea
                          className="notch-input stueckliste-material-input"
                          rows={2}
                          value={p.description ?? ''}
                          onChange={(e) => updatePiece(p.id, { description: e.target.value })}
                          placeholder="—"
                          autoComplete="off"
                          aria-label={`Beschreibung ${p.name}`}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          className="notch-input"
                          min={1}
                          step={1}
                          value={q}
                          onChange={(e) => {
                            const n = parseInt(e.target.value, 10)
                            const next = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1
                            updatePiece(p.id, { bomQuantity: next })
                          }}
                          aria-label={`Stückzahl ${p.name}`}
                        />
                      </td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtAreaM2(areaMm2)}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtLenM(perMm)}</td>
                      <td style={{ textAlign: 'center' }}>{p.notches.length}</td>
                      <td>
                        <input
                          type="text"
                          className="notch-input stueckliste-material-input"
                          value={p.material ?? ''}
                          onChange={(e) => updatePiece(p.id, { material: e.target.value })}
                          placeholder="—"
                          autoComplete="off"
                          aria-label={`Materialnummer ${p.name}`}
                        />
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--muted, #555)' }}>{matDesc}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtEuro(lineEuro)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="stueckliste-summary">
            <h4>Summen je Material</h4>
            {aggregate.byMaterial.length === 0 ? (
              <p className="settings-placeholder" style={{ padding: '0.5rem 0' }}>
                Keine Teile.
              </p>
            ) : (
              <div className="stueckliste-summary-material-row">
                <div className="stueckliste-summary-table-wrap">
                  <table className="stueckliste-summary-table">
                    <thead>
                      <tr>
                        <th>Materialnr.</th>
                        <th>Bezeichnung</th>
                        <th>Σ Stückzahl</th>
                        <th>Σ Fläche (m²)</th>
                        <th>Σ Umfang (m)</th>
                        <th>Σ Material (€)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aggregate.byMaterial.map((g) => (
                        <tr key={g.materialKey || '__empty__'}>
                          <td>{materialLabelForBom(g.materialKey)}</td>
                          <td>{catalogMaterialDescription(catalogRows, g.materialKey)}</td>
                          <td>{g.quantitySum}</td>
                          <td>{fmtTotalArea(g.totalAreaM2)}</td>
                          <td>{fmtTotalPerimeter(g.totalPerimeterM)}</td>
                          <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {fmtEuro(materialCostByKey.get(g.materialKey))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {materialAreaShares.length > 0 ? (
                  <div className="stueckliste-material-pie-column">
                    <p className="stueckliste-material-pie-caption">Flächenanteil (Σ&nbsp;m² je Material)</p>
                    <StuecklisteMaterialPie shares={materialAreaShares} />
                  </div>
                ) : null}
              </div>
            )}

            <div className="stueckliste-grand">
              Gesamt: Fläche {fmtTotalArea(aggregate.grand.totalAreaM2)} m² · Umfang{' '}
              {fmtTotalPerimeter(aggregate.grand.totalPerimeterM)} m · Σ Material (Katalog){' '}
              {fmtEuro(grandMaterialEuro)}
            </div>

            <div className="stueckliste-overview-section">
              <h4>Vorschau Arbeitsfläche</h4>
              <p className="stueckliste-overview-hint">
                Vektorvorschau: Schnitt- und Nahtkontur (bei Nahtzugabe), Laufrichtung, kein Pixel-Screenshot.
              </p>
              <WorkspaceOverviewPreview
                pieces={pieces}
                imageSession={imageDigitizeSession}
                imageDataUrl={imageDigitizeSession?.imageDataUrl ?? null}
                profileAssignments={workspace.profileAssignments}
              />
            </div>

            {naehplanRows.length > 0 ? (
              <div className="stueckliste-naehplan-section">
                <h4>Nähplan</h4>
                <p className="stueckliste-overview-hint">
                  Reihenfolge nach Nahtnummer (Arbeitsfläche); ohne Nummer ans Ende der Liste. Längen in mm.
                </p>
                <ul className="stueckliste-naehplan-list">
                  {naehplanRows.map((row) => (
                    <li key={`${row.stepNr}-${row.line}`}>{row.line}</li>
                  ))}
                </ul>
                {naehplanSeamKindTotals.length > 0 ? (
                  <div className="stueckliste-naehplan-totals">
                    <h5>Summen je Nahtart</h5>
                    <ul className="stueckliste-naehplan-list">
                      {naehplanSeamKindTotals.map((t) => (
                        <li key={t.kindKey}>
                          Σ {t.kindLabel}:{' '}
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {t.totalLengthMm.toLocaleString('de-DE', {
                              minimumFractionDigits: 1,
                              maximumFractionDigits: 1,
                            })}{' '}
                            mm
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {profilnahtRows.length > 0 ? (
              <div className="stueckliste-naehplan-section">
                <h4>{PROFILNAHT_KIND_LABEL}</h4>
                <ul className="stueckliste-naehplan-list">
                  {profilnahtRows.map((row) => (
                    <li key={row.line}>{row.line}</li>
                  ))}
                </ul>
                <p className="stueckliste-grand" style={{ marginTop: '0.5rem' }}>
                  Σ {PROFILNAHT_KIND_LABEL}:{' '}
                  {profilnahtTotalMm.toLocaleString('de-DE', {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}{' '}
                  mm
                </p>
              </div>
            ) : null}

            {profileBomRows.length > 0 ? (
              <div className="stueckliste-naehplan-section">
                <h4>Komponenten / Profile (Übersicht)</h4>
                <table className="stueckliste-summary-table">
                  <thead>
                    <tr>
                      <th>Kennung</th>
                      <th>Bezeichnung</th>
                      <th>Artikelnr.</th>
                      <th>Lieferant</th>
                      <th>Σ Länge (mm)</th>
                      <th>Anzahl</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profileBomRows.map((row) => (
                      <tr key={`${row.profileKey}-${row.internalArticleNumber ?? ''}`}>
                        <td style={{ fontWeight: 700 }}>{row.profileKey}</td>
                        <td>{row.profileName}</td>
                        <td>{row.internalArticleNumber ?? '—'}</td>
                        <td>{row.supplierNumber ?? '—'}</td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>{row.totalLengthMm.toFixed(1)}</td>
                        <td style={{ textAlign: 'center' }}>{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </div>

        <div className="settings-footer stueckliste-footer-actions">
          <button
            type="button"
            className="sidebar-btn"
            disabled={pdfExporting}
            onClick={async () => {
              setPdfExporting(true)
              try {
                const { downloadStuecklistePdf } = await import('../bom/stuecklistePdf')
                await downloadStuecklistePdf({
                  workspace,
                  docDateLabel,
                  imageSession: imageDigitizeSession,
                  imageDataUrl: imageDigitizeSession?.imageDataUrl ?? null,
                })
              } catch {
                setToastMessage('error:PDF konnte nicht erstellt werden.')
              } finally {
                setPdfExporting(false)
              }
            }}
          >
            {pdfExporting ? 'PDF wird erstellt…' : 'PDF (DIN A3 Quer)'}
          </button>
          <button type="button" className="sidebar-btn primary" onClick={() => setShowStuecklisteModal(false)}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  )
}

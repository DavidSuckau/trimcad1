import { useCallback, useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useStore } from '../store/useStore'
import { loadMaterialCatalog } from '../material/materialCatalogStorage'
import { getCutLineAreaMm2 } from '../bom/pieceBomStats'
import { listNestingMaterialOptions, piecesForMaterial } from '../nesting/nestingMaterial'
import { buildGeometriesForPlan } from '../nesting/nestingDxfExport'
import { downloadNestingPlanDxf } from '../nesting/nestingDxfExport'
import { buildNestingJobRequest, runNestingJobAsync } from '../nesting/runNestingJob'
import { fmtEuroNesting, summarizeNestingMaterialCosts } from '../nesting/nestingMaterialCost'
import { NestingCanvas } from './NestingCanvas'
import type { NestingPieceInput } from '../nesting/nestingTypes'

function fmtAreaM2(mm2: number): string {
  return (mm2 / 1_000_000).toLocaleString('de-DE', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}

export function NestingModal() {
  const {
    workspace,
    showNestingModal,
    setShowNestingModal,
    nestingSelectedMaterialKey,
    setNestingSelectedMaterialKey,
    nestingInputs,
    setNestingInputQuantity,
    importNestingQuantitiesFromBom,
    nestingSpacingMm,
    setNestingSpacingMm,
    nestingMaxRollLengthMm,
    setNestingMaxRollLengthMm,
    nestingPlan,
    setNestingPlan,
    nestingStatus,
    setNestingStatus,
    nestingError,
    setNestingError,
    materializeMissingGrainLines,
    setToastMessage,
    dxfExportScale,
  } = useStore(
    useShallow((s) => ({
      workspace: s.workspace,
      showNestingModal: s.showNestingModal,
      setShowNestingModal: s.setShowNestingModal,
      nestingSelectedMaterialKey: s.nestingSelectedMaterialKey,
      setNestingSelectedMaterialKey: s.setNestingSelectedMaterialKey,
      nestingInputs: s.nestingInputs,
      setNestingInputQuantity: s.setNestingInputQuantity,
      importNestingQuantitiesFromBom: s.importNestingQuantitiesFromBom,
      nestingSpacingMm: s.nestingSpacingMm,
      setNestingSpacingMm: s.setNestingSpacingMm,
      nestingMaxRollLengthMm: s.nestingMaxRollLengthMm,
      setNestingMaxRollLengthMm: s.setNestingMaxRollLengthMm,
      nestingPlan: s.nestingPlan,
      setNestingPlan: s.setNestingPlan,
      nestingStatus: s.nestingStatus,
      setNestingStatus: s.setNestingStatus,
      nestingError: s.nestingError,
      setNestingError: s.setNestingError,
      materializeMissingGrainLines: s.materializeMissingGrainLines,
      setToastMessage: s.setToastMessage,
      dxfExportScale: s.dxfExportScale,
    })),
  )

  const { pieces } = workspace
  const catalogRows = useMemo(() => loadMaterialCatalog().rows, [pieces])
  const materialOptions = useMemo(() => listNestingMaterialOptions(pieces, catalogRows), [pieces, catalogRows])

  const [computing, setComputing] = useState(false)
  const [nestingProgress, setNestingProgress] = useState(0)
  const [nestingProgressPhase, setNestingProgressPhase] = useState<'placing' | 'optimizing'>('placing')

  useEffect(() => {
    if (!showNestingModal) return
    if (nestingSelectedMaterialKey && materialOptions.some((o) => o.materialKey === nestingSelectedMaterialKey)) return
    if (materialOptions.length > 0) setNestingSelectedMaterialKey(materialOptions[0].materialKey)
  }, [showNestingModal, materialOptions, nestingSelectedMaterialKey, setNestingSelectedMaterialKey])

  useEffect(() => {
    if (!showNestingModal) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowNestingModal(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showNestingModal, setShowNestingModal])

  const materialPieces = useMemo(() => {
    if (!nestingSelectedMaterialKey) return []
    return piecesForMaterial(pieces, nestingSelectedMaterialKey)
  }, [pieces, nestingSelectedMaterialKey])

  const trapRef = useFocusTrap<HTMLDivElement>(showNestingModal)

  const handleCompute = useCallback(async () => {
    if (!nestingSelectedMaterialKey) {
      setToastMessage('warn:Bitte ein Material wählen.')
      return
    }
    materializeMissingGrainLines()
    const inputs: NestingPieceInput[] = materialPieces.map((p) => ({
      pieceId: p.id,
      quantity: nestingInputs[p.id] ?? 0,
      allowRotate180: true,
    }))
    const built = buildNestingJobRequest(
      nestingSelectedMaterialKey,
      pieces,
      inputs,
      catalogRows,
      nestingSpacingMm,
      nestingMaxRollLengthMm,
    )
    if (!built.ok) {
      setNestingError(built.error)
      setNestingStatus('error')
      setToastMessage(`warn:${built.error}`)
      return
    }
    setComputing(true)
    setNestingStatus('running')
    setNestingError(null)
    setNestingProgress(2)
    setNestingProgressPhase('placing')
    let result: Awaited<ReturnType<typeof runNestingJobAsync>>
    try {
      result = await runNestingJobAsync(built.request, (pct, phase) => {
        setNestingProgress(pct)
        setNestingProgressPhase(phase)
      })
    } catch (err) {
      setComputing(false)
      setNestingProgress(0)
      const msg = err instanceof Error ? err.message : 'Nesting-Berechnung fehlgeschlagen.'
      setNestingError(msg)
      setNestingStatus('error')
      setToastMessage(`warn:${msg}`)
      return
    }
    setComputing(false)
    setNestingProgress(0)
    if (!result.ok) {
      setNestingError(result.error)
      setNestingStatus('error')
      setToastMessage(`warn:${result.error}`)
      return
    }
    setNestingPlan(result.plan)
    setNestingStatus('done')
    if (result.plan.warnings.length) {
      setToastMessage(`warn:${result.plan.warnings.join(' ')}`)
    }
  }, [
    nestingSelectedMaterialKey,
    materialPieces,
    nestingInputs,
    pieces,
    catalogRows,
    nestingSpacingMm,
    nestingMaxRollLengthMm,
    materializeMissingGrainLines,
    setToastMessage,
    setNestingError,
    setNestingStatus,
    setNestingPlan,
  ])

  const geometries = useMemo(() => {
    if (!nestingPlan) return new Map()
    return buildGeometriesForPlan(pieces, nestingPlan)
  }, [nestingPlan, pieces])

  const selectedOption = materialOptions.find((o) => o.materialKey === nestingSelectedMaterialKey)

  const costSummary = useMemo(
    () =>
      summarizeNestingMaterialCosts({
        materialOptions,
        pieces,
        nestingInputs,
        catalogRows,
        selectedMaterialKey: nestingSelectedMaterialKey,
        selectedPlanUsedLengthMm: nestingPlan?.usedLengthMm ?? null,
      }),
    [
      materialOptions,
      pieces,
      nestingInputs,
      catalogRows,
      nestingSelectedMaterialKey,
      nestingPlan?.usedLengthMm,
    ],
  )

  if (!showNestingModal) return null

  return (
    <div className="nesting-window" ref={trapRef} role="dialog" aria-modal="true" aria-label="Zuschnittplan">
      <header className="nesting-window-header">
        <div className="nesting-window-title">
          <h2>Zuschnittplan</h2>
          {selectedOption && (
            <span className="nesting-window-subtitle">
              {selectedOption.label} · Rollenbreite {selectedOption.rollWidthMm} mm
            </span>
          )}
        </div>
        <div className="nesting-window-header-actions">
          {nestingPlan && (
            <button
              type="button"
              className="sidebar-btn"
              onClick={() => downloadNestingPlanDxf(nestingPlan, pieces, dxfExportScale)}
            >
              DXF exportieren
            </button>
          )}
          <button
            type="button"
            className="settings-close"
            onClick={() => setShowNestingModal(false)}
            aria-label="Fenster schließen"
          >
            ×
          </button>
        </div>
      </header>

      {materialOptions.length === 0 ? (
        <div className="nesting-window-empty">
          <p>
            Kein Stoff mit Rollenbreite im Materialkatalog. Teilen Sie den Teilen eine Materialnummer zu und pflegen Sie
            die Nutzbreite in der Materialdatenbank.
          </p>
          <button type="button" className="sidebar-btn primary" onClick={() => setShowNestingModal(false)}>
            Schließen
          </button>
        </div>
      ) : (
        <div className="nesting-window-body">
          <aside className="nesting-window-sidebar">
            <div className="nesting-controls">
              <label className="nesting-field">
                <span>Material</span>
                <select
                  className="notch-input"
                  value={nestingSelectedMaterialKey ?? ''}
                  onChange={(e) => {
                    setNestingSelectedMaterialKey(e.target.value)
                    setNestingPlan(null)
                    setNestingStatus('idle')
                  }}
                >
                  {materialOptions.map((o) => (
                    <option key={o.materialKey} value={o.materialKey}>
                      {o.label} ({o.rollWidthMm} mm)
                    </option>
                  ))}
                </select>
              </label>
              <label className="nesting-field">
                <span>Zuschnittspalt (mm)</span>
                <input
                  type="number"
                  className="notch-input"
                  min={0}
                  step={0.5}
                  value={nestingSpacingMm}
                  onChange={(e) => setNestingSpacingMm(parseFloat(e.target.value) || 0)}
                />
              </label>
              <label className="nesting-field">
                <span>Max. Rollenlänge (mm)</span>
                <input
                  type="number"
                  className="notch-input"
                  min={0}
                  step={100}
                  placeholder="auto"
                  value={nestingMaxRollLengthMm ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value
                    setNestingMaxRollLengthMm(raw === '' ? null : parseFloat(raw) || null)
                  }}
                />
              </label>
            </div>

            <div className="nesting-sidebar-actions">
              <button type="button" className="sidebar-btn" onClick={() => importNestingQuantitiesFromBom()}>
                Aus Stückliste
              </button>
              <button
                type="button"
                className="sidebar-btn primary"
                disabled={computing || nestingStatus === 'running'}
                onClick={() => void handleCompute()}
              >
                {computing ? 'Berechne…' : 'Zuschnitt berechnen'}
              </button>
            </div>

            {(computing || nestingStatus === 'running') && (
              <div className="nesting-progress" role="status" aria-live="polite">
                <div className="nesting-progress-track">
                  <div
                    className={`nesting-progress-fill${nestingProgress <= 2 ? ' nesting-progress-fill--indeterminate' : ''}`}
                    style={{ width: nestingProgress <= 2 ? undefined : `${nestingProgress}%` }}
                  />
                </div>
                <span className="nesting-progress-label">
                  {nestingProgressPhase === 'optimizing'
                    ? `Optimierung … ${nestingProgress} %`
                    : `Platziere Teile … ${nestingProgress} %`}
                </span>
              </div>
            )}

            <div className="nesting-table-wrap">
              <table className="stueckliste-table nesting-table">
                <thead>
                  <tr>
                    <th>Teil</th>
                    <th>m²</th>
                    <th>Stk.</th>
                  </tr>
                </thead>
                <tbody>
                  {materialPieces.map((p) => (
                    <tr key={p.id}>
                      <td title={p.name}>{p.name}</td>
                      <td>{fmtAreaM2(getCutLineAreaMm2(p))}</td>
                      <td>
                        <input
                          type="number"
                          className="notch-input"
                          min={0}
                          step={1}
                          style={{ width: 52 }}
                          value={nestingInputs[p.id] ?? 0}
                          onChange={(e) => {
                            const n = parseInt(e.target.value, 10)
                            setNestingInputQuantity(p.id, Number.isFinite(n) ? Math.max(0, n) : 0)
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {nestingError && nestingStatus === 'error' && (
              <p className="nesting-error" role="alert">
                {nestingError}
              </p>
            )}

            {nestingPlan && (
              <div className="nesting-sidebar-stats">
                <div>
                  Effizienz <strong>{nestingPlan.efficiencyPct.toFixed(1)} %</strong>
                </div>
                <div>
                  Verbrauch <strong>{(nestingPlan.usedLengthMm / 1000).toFixed(3)} m</strong>
                </div>
                {costSummary?.current.costEuro != null && (
                  <div className="nesting-cost-block">
                    <div>
                      {costSummary.current.materialLabel}{' '}
                      <strong>{fmtEuroNesting(costSummary.current.costEuro)}</strong>
                      {costSummary.current.isEstimate ? ' (geschätzt)' : ''}
                    </div>
                    {costSummary.current.formulaLabel && (
                      <p className="nesting-cost-formula">{costSummary.current.formulaLabel}</p>
                    )}
                  </div>
                )}
                {costSummary &&
                  costSummary.materialCountInTotal > 1 &&
                  costSummary.totalAllMaterialsEuro != null && (
                    <div className="nesting-cost-total">
                      Gesamt ({costSummary.materialCountInTotal} Materialien){' '}
                      <strong>{fmtEuroNesting(costSummary.totalAllMaterialsEuro)}</strong>
                    </div>
                  )}
                <div>
                  Platziert <strong>{nestingPlan.placements.length}</strong>
                </div>
                {selectedOption && (
                  <p className="nesting-grain-hint">
                    Kette nach unten (+Y)
                    {selectedOption.grainDirection === 'frei' ? ' · Stoff frei' : ` · ${selectedOption.grainDirection}`}
                  </p>
                )}
              </div>
            )}

            {!nestingPlan && costSummary && costSummary.materialCountInTotal > 1 && (
              <div className="nesting-sidebar-stats">
                <div className="nesting-cost-total">
                  Geschätzt gesamt ({costSummary.materialCountInTotal} Materialien){' '}
                  <strong>{fmtEuroNesting(costSummary.totalAllMaterialsEuro)}</strong>
                </div>
                <p className="nesting-grain-hint">Nach „Zuschnitt berechnen“ Verbrauch und Preis pro Material.</p>
              </div>
            )}
          </aside>

          <main className="nesting-window-main" aria-label="Stoffbahn">
            {nestingPlan && nestingSelectedMaterialKey ? (
              <NestingCanvas
                mode="plan"
                plan={nestingPlan}
                pieces={pieces}
                geometries={geometries}
                materialKey={nestingSelectedMaterialKey}
              />
            ) : selectedOption ? (
              <NestingCanvas
                mode="preview"
                rollWidthMm={selectedOption.rollWidthMm}
                materialLabel={selectedOption.label}
                hint="Stückzahlen setzen und „Zuschnitt berechnen“"
              />
            ) : (
              <div className="nesting-main-placeholder">Material wählen …</div>
            )}
          </main>
        </div>
      )}
    </div>
  )
}

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

  useEffect(() => {
    if (!showNestingModal) return
    if (nestingSelectedMaterialKey && materialOptions.some((o) => o.materialKey === nestingSelectedMaterialKey)) return
    if (materialOptions.length > 0) setNestingSelectedMaterialKey(materialOptions[0].materialKey)
  }, [showNestingModal, materialOptions, nestingSelectedMaterialKey, setNestingSelectedMaterialKey])

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
    const result = await runNestingJobAsync(built.request)
    setComputing(false)
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

  if (!showNestingModal) return null

  return (
    <div
      className="settings-overlay nesting-overlay"
      onClick={() => setShowNestingModal(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Zuschnitt / Nesting"
    >
      <div
        className="settings-panel nesting-panel"
        ref={trapRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2>Zuschnittplan (Nesting)</h2>
          <button type="button" className="settings-close" onClick={() => setShowNestingModal(false)} aria-label="Schließen">
            ×
          </button>
        </div>

        {materialOptions.length === 0 ? (
          <p className="nesting-empty-hint">
            Kein Stoff mit Rollenbreite im Materialkatalog. Teilen Sie den Teilen eine Materialnummer zu und pflegen Sie die
            Nutzbreite in der Materialdatenbank.
          </p>
        ) : (
          <>
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
                      {o.label} ({o.rollWidthMm} mm, {o.pieceCount} Teil(e))
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
              <div className="nesting-actions">
                <button type="button" className="sidebar-btn" onClick={() => importNestingQuantitiesFromBom()}>
                  Aus Stückliste übernehmen
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
            </div>

            <div className="nesting-table-wrap">
              <table className="stueckliste-table nesting-table">
                <thead>
                  <tr>
                    <th>Teil</th>
                    <th>Fläche (m²)</th>
                    <th>Stückzahl</th>
                  </tr>
                </thead>
                <tbody>
                  {materialPieces.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>{fmtAreaM2(getCutLineAreaMm2(p))}</td>
                      <td>
                        <input
                          type="number"
                          className="notch-input"
                          min={0}
                          step={1}
                          style={{ width: 64 }}
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

            {nestingPlan && nestingSelectedMaterialKey && (
              <div className="nesting-result">
                <div className="nesting-stats">
                  <span>
                    Effizienz: <strong>{nestingPlan.efficiencyPct.toFixed(1)} %</strong>
                  </span>
                  <span>
                    Verbrauch: <strong>{(nestingPlan.usedLengthMm / 1000).toFixed(3)} m</strong>
                  </span>
                  <span>
                    Breite: <strong>{nestingPlan.rollWidthMm} mm</strong>
                  </span>
                  <span>
                    Teile platziert: <strong>{nestingPlan.placements.length}</strong>
                  </span>
                  {selectedOption && (
                    <span className="nesting-grain-hint">
                      Laufrichtung: Kette nach unten (+Y){' '}
                      {selectedOption.grainDirection === 'frei' ? '(Stoff frei)' : `(Katalog: ${selectedOption.grainDirection})`}
                    </span>
                  )}
                </div>
                <NestingCanvas
                  plan={nestingPlan}
                  pieces={pieces}
                  geometries={geometries}
                  materialKey={nestingSelectedMaterialKey}
                />
                <div className="nesting-export-row">
                  <button
                    type="button"
                    className="sidebar-btn"
                    onClick={() => downloadNestingPlanDxf(nestingPlan, pieces, dxfExportScale)}
                  >
                    Zuschnittplan als DXF exportieren
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        <div className="settings-footer">
          <button type="button" className="sidebar-btn primary" onClick={() => setShowNestingModal(false)}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  )
}

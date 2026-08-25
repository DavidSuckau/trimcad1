import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import type { ConfiguratorPartParams } from '../configurators/types'
import { validateLaserBoxParams } from '../configurators/boxValidation'
import { mergeLaserBoxParamsForPart } from '../configurators/laserBoxSync'

function clampFiniteNumber(v: string, fallback: number, min: number, max: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export function ConfiguratorModal() {
  const configuratorModalOpen = useStore((s) => s.configuratorModalOpen)
  const configuratorInstances = useStore((s) => s.configuratorInstances)
  const setShowConfiguratorModal = useStore((s) => s.setShowConfiguratorModal)
  const updateConfiguratorPartParams = useStore((s) => s.updateConfiguratorPartParams)
  const regenerateConfiguratorPart = useStore((s) => s.regenerateConfiguratorPart)

  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null)
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ConfiguratorPartParams | null>(null)

  useEffect(() => {
    if (!configuratorModalOpen) return
    if (configuratorInstances.length === 0) {
      setSelectedInstanceId(null)
      setSelectedPartId(null)
      setDraft(null)
      return
    }
    const newest = configuratorInstances[configuratorInstances.length - 1]?.id
    if (!newest) return
    setSelectedInstanceId(newest)
    setSelectedPartId(null)
    setDraft(null)
  }, [configuratorModalOpen, configuratorInstances])

  const selectedInstance = useMemo(
    () => (selectedInstanceId ? configuratorInstances.find((i) => i.id === selectedInstanceId) ?? null : null),
    [configuratorInstances, selectedInstanceId],
  )
  const isRock = selectedInstance?.kindId === 'rock'
  const isLaserBox = selectedInstance?.kindId === 'laserBox'

  const instanceLabel = selectedInstance?.kindId === 'tshirt' ? 'T-Shirt' : selectedInstance?.kindId === 'rock' ? 'Rock' : 'Laser-Cut Box'

  useEffect(() => {
    if (!configuratorModalOpen) return
    if (!selectedInstance) return
    if (!selectedPartId) setSelectedPartId(selectedInstance.parts[0]?.id ?? null)
  }, [configuratorModalOpen, selectedInstance, selectedPartId])

  const selectedPart = useMemo(() => {
    if (!selectedInstance || !selectedPartId) return null
    return selectedInstance.parts.find((p) => p.id === selectedPartId) ?? null
  }, [selectedInstance, selectedPartId])

  useEffect(() => {
    if (!selectedPart) {
      setDraft(null)
      return
    }
    setDraft({ ...selectedPart.params })
  }, [selectedPart])

  if (!configuratorModalOpen) return null

  const close = () => setShowConfiguratorModal(false)

  const onRegenerate = () => {
    if (!selectedInstance || !selectedPart || !draft) return
    if (isLaserBox) {
      for (const part of selectedInstance.parts) {
        const nextParams = mergeLaserBoxParamsForPart(part.partId, draft, {
          offsetX: part.params.offsetX,
          offsetY: part.params.offsetY,
        })
        updateConfiguratorPartParams(selectedInstance.id, part.id, nextParams)
      }
      for (const part of selectedInstance.parts) {
        regenerateConfiguratorPart(selectedInstance.id, part.id)
      }
      return
    }
    updateConfiguratorPartParams(selectedInstance.id, selectedPart.id, draft)
    regenerateConfiguratorPart(selectedInstance.id, selectedPart.id)
  }

  const isValidDraft = draft
    ? (() => {
        const widthMm = draft.widthMm
        const heightMm = draft.heightMm
        const hipWidthMm = draft.hipWidthMm ?? widthMm
        const hemWidthMm = draft.hemWidthMm ?? hipWidthMm
        const waistToHipMm = draft.waistToHipMm ?? 180
        const dartLengthMm = draft.dartLengthMm ?? waistToHipMm * 0.78
        const dartOpeningMm = draft.dartOpeningMm ?? widthMm * 0.06
        const dartPosLeftRatio = draft.dartPosLeftRatio ?? 0.28
        const dartPosRightRatio = draft.dartPosRightRatio ?? 0.72

        const baseOk = Number.isFinite(widthMm) && Number.isFinite(heightMm) && widthMm >= 1 && heightMm >= 1
        const offsetsOk = Number.isFinite(draft.offsetX) && Number.isFinite(draft.offsetY)
        if (!baseOk || !offsetsOk) return false
        if (isLaserBox) {
          const boxWidthMm = draft.boxWidthMm ?? widthMm
          const boxLengthMm = draft.boxLengthMm ?? widthMm
          const boxHeightMm = draft.boxHeightMm ?? heightMm
          const materialThicknessMm = draft.materialThicknessMm ?? 3
          const fingerCount = draft.fingerCount ?? 7
          const kerfMm = draft.kerfMm ?? 0.15
          const fitToleranceMm = draft.fitToleranceMm ?? 0
          return (
            Number.isFinite(boxWidthMm) &&
            Number.isFinite(boxLengthMm) &&
            Number.isFinite(boxHeightMm) &&
            Number.isFinite(materialThicknessMm) &&
            Number.isFinite(fingerCount) &&
            Number.isFinite(kerfMm) &&
            Number.isFinite(fitToleranceMm) &&
            boxWidthMm >= 1 &&
            boxLengthMm >= 1 &&
            boxHeightMm >= 1 &&
            materialThicknessMm >= 0.5 &&
            fingerCount >= 3 &&
            kerfMm >= 0
          )
        }
        if (!isRock) return true

        return (
          Number.isFinite(hipWidthMm) &&
          Number.isFinite(hemWidthMm) &&
          Number.isFinite(waistToHipMm) &&
          Number.isFinite(dartLengthMm) &&
          Number.isFinite(dartOpeningMm) &&
          Number.isFinite(dartPosLeftRatio) &&
          Number.isFinite(dartPosRightRatio) &&
          hipWidthMm >= 1 &&
          hemWidthMm >= 1 &&
          waistToHipMm >= 1 &&
          dartLengthMm >= 1 &&
          dartOpeningMm >= 1 &&
          dartPosLeftRatio >= 0 &&
          dartPosLeftRatio <= 1 &&
          dartPosRightRatio >= 0 &&
          dartPosRightRatio <= 1
        )
      })()
    : false
  const boxValidation = isLaserBox && draft ? validateLaserBoxParams(draft) : null

  return (
    <div className="nahtzugabe-dialog-overlay" onClick={close} role="dialog" aria-modal="true" aria-label="Konfigurator bearbeiten">
      <div className="nahtzugabe-dialog" onClick={(e) => e.stopPropagation()} style={{ minWidth: 520 }}>
        <h3 className="nahtzugabe-dialog-title">Konfigurator bearbeiten</h3>

        {configuratorInstances.length === 0 ? (
          <p className="nahtzugabe-dialog-hint" style={{ marginTop: 6 }}>
            Noch keine Konfigurator-Instanz vorhanden. Nutze im Menü „Erzeugen“ → „Konfigurator“.
          </p>
        ) : (
          <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
            <div style={{ flex: '0 0 220px' }}>
              <p style={{ margin: '0 0 8px', fontSize: 12, color: '#555' }}>Instanzen</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {configuratorInstances.map((inst) => (
                  <button
                    key={inst.id}
                    type="button"
                    className="menubar-dropdown-btn"
                    onClick={() => setSelectedInstanceId(inst.id)}
                    style={{
                      textAlign: 'left',
                      ...(inst.id === selectedInstanceId
                        ? { background: '#1976d2', color: '#fff' }
                        : { background: '#fff' }),
                    }}
                  >
                    {inst.kindId === 'tshirt' ? 'T-Shirt' : inst.kindId === 'rock' ? 'Rock' : 'Laser-Cut Box'} ({inst.parts.length} Teile)
                  </button>
                ))}
              </div>
            </div>

            <div style={{ flex: 1 }}>
              {selectedInstance && selectedPart ? (
                <>
                  <p className="nahtzugabe-dialog-hint" style={{ marginTop: 0 }}>
                    {instanceLabel}: {selectedPart.label}
                    <span style={{ display: 'block', marginTop: 4 }}>
                      {isLaserBox ? (
                        <>
                          Hinweis: „Neu erzeugen“ wendet die Box-Maße auf alle Laser-Box-Teile an und überschreibt jeweils
                          die Cut-Kontur (Notches/Bohrungen gehen verloren).
                        </>
                      ) : (
                        <>
                          Hinweis: „Neu erzeugen“ überschreibt Cut-Kontur und leert aktuelle Notches/Bohrungen für dieses
                          Teil.
                        </>
                      )}
                    </span>
                  </p>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
                    <label className="nahtzugabe-dialog-label" style={{ minWidth: 150 }}>
                      <span>{isRock ? 'Taillen-Breite (mm)' : 'Breite (mm)'}</span>
                      <input
                        type="number"
                        className="nahtzugabe-dialog-input"
                        value={draft?.widthMm ?? 0}
                        onChange={(e) => {
                          const widthMm = clampFiniteNumber(e.target.value, draft?.widthMm ?? 0, 1, 5000)
                          setDraft((d) => (d ? { ...d, widthMm } : d))
                        }}
                      />
                    </label>
                    <label className="nahtzugabe-dialog-label" style={{ minWidth: 150 }}>
                      <span>Höhe (mm)</span>
                      <input
                        type="number"
                        className="nahtzugabe-dialog-input"
                        value={draft?.heightMm ?? 0}
                        onChange={(e) => {
                          const heightMm = clampFiniteNumber(e.target.value, draft?.heightMm ?? 0, 1, 5000)
                          setDraft((d) => (d ? { ...d, heightMm } : d))
                        }}
                      />
                    </label>
                    <label className="nahtzugabe-dialog-label" style={{ minWidth: 150 }}>
                      <span>Offset X (mm)</span>
                      <input
                        type="number"
                        className="nahtzugabe-dialog-input"
                        value={draft?.offsetX ?? 0}
                        onChange={(e) => {
                          const offsetX = clampFiniteNumber(e.target.value, draft?.offsetX ?? 0, -5000, 5000)
                          setDraft((d) => (d ? { ...d, offsetX } : d))
                        }}
                      />
                    </label>
                    <label className="nahtzugabe-dialog-label" style={{ minWidth: 150 }}>
                      <span>Offset Y (mm)</span>
                      <input
                        type="number"
                        className="nahtzugabe-dialog-input"
                        value={draft?.offsetY ?? 0}
                        onChange={(e) => {
                          const offsetY = clampFiniteNumber(e.target.value, draft?.offsetY ?? 0, -5000, 5000)
                          setDraft((d) => (d ? { ...d, offsetY } : d))
                        }}
                      />
                    </label>

                    {isRock && (
                      <>
                        <label className="nahtzugabe-dialog-label" style={{ minWidth: 150 }}>
                          <span>Taillen zu Hüfte (mm)</span>
                          <input
                            type="number"
                            className="nahtzugabe-dialog-input"
                            value={draft?.waistToHipMm ?? 0}
                            onChange={(e) => {
                              const waistToHipMm = clampFiniteNumber(
                                e.target.value,
                                draft?.waistToHipMm ?? 180,
                                1,
                                5000,
                              )
                              setDraft((d) => (d ? { ...d, waistToHipMm } : d))
                            }}
                          />
                        </label>
                        <label className="nahtzugabe-dialog-label" style={{ minWidth: 150 }}>
                          <span>Hüft-Breite (mm)</span>
                          <input
                            type="number"
                            className="nahtzugabe-dialog-input"
                            value={draft?.hipWidthMm ?? 0}
                            onChange={(e) => {
                              const hipWidthMm = clampFiniteNumber(e.target.value, draft?.hipWidthMm ?? draft?.widthMm ?? 0, 1, 10000)
                              setDraft((d) => (d ? { ...d, hipWidthMm } : d))
                            }}
                          />
                        </label>
                        <label className="nahtzugabe-dialog-label" style={{ minWidth: 150 }}>
                          <span>Saum-Breite (mm)</span>
                          <input
                            type="number"
                            className="nahtzugabe-dialog-input"
                            value={draft?.hemWidthMm ?? 0}
                            onChange={(e) => {
                              const hemWidthMm = clampFiniteNumber(e.target.value, draft?.hemWidthMm ?? draft?.hipWidthMm ?? draft?.widthMm ?? 0, 1, 10000)
                              setDraft((d) => (d ? { ...d, hemWidthMm } : d))
                            }}
                          />
                        </label>
                        <label className="nahtzugabe-dialog-label" style={{ minWidth: 150 }}>
                          <span>Abnäher-Länge (mm)</span>
                          <input
                            type="number"
                            className="nahtzugabe-dialog-input"
                            value={draft?.dartLengthMm ?? 0}
                            onChange={(e) => {
                              const dartLengthMm = clampFiniteNumber(
                                e.target.value,
                                draft?.dartLengthMm ?? draft?.waistToHipMm ?? 140,
                                1,
                                10000,
                              )
                              setDraft((d) => (d ? { ...d, dartLengthMm } : d))
                            }}
                          />
                        </label>
                        <label className="nahtzugabe-dialog-label" style={{ minWidth: 150 }}>
                          <span>Abnäher-Öffnung (mm)</span>
                          <input
                            type="number"
                            className="nahtzugabe-dialog-input"
                            value={draft?.dartOpeningMm ?? 0}
                            onChange={(e) => {
                              const dartOpeningMm = clampFiniteNumber(e.target.value, draft?.dartOpeningMm ?? 24, 1, 10000)
                              setDraft((d) => (d ? { ...d, dartOpeningMm } : d))
                            }}
                          />
                        </label>
                        <label className="nahtzugabe-dialog-label" style={{ minWidth: 150 }}>
                          <span>Abnäher links Position (0..1)</span>
                          <input
                            type="number"
                            step={0.01}
                            className="nahtzugabe-dialog-input"
                            value={draft?.dartPosLeftRatio ?? 0}
                            onChange={(e) => {
                              const dartPosLeftRatio = clampFiniteNumber(e.target.value, draft?.dartPosLeftRatio ?? 0.28, 0, 1)
                              setDraft((d) => (d ? { ...d, dartPosLeftRatio } : d))
                            }}
                          />
                        </label>
                        <label className="nahtzugabe-dialog-label" style={{ minWidth: 150 }}>
                          <span>Abnäher rechts Position (0..1)</span>
                          <input
                            type="number"
                            step={0.01}
                            className="nahtzugabe-dialog-input"
                            value={draft?.dartPosRightRatio ?? 0}
                            onChange={(e) => {
                              const dartPosRightRatio = clampFiniteNumber(e.target.value, draft?.dartPosRightRatio ?? 0.72, 0, 1)
                              setDraft((d) => (d ? { ...d, dartPosRightRatio } : d))
                            }}
                          />
                        </label>
                      </>
                    )}
                    {isLaserBox && (
                      <>
                        <label className="nahtzugabe-dialog-label" style={{ minWidth: 150 }}>
                          <span>Box Breite (mm)</span>
                          <input
                            type="number"
                            className="nahtzugabe-dialog-input"
                            value={draft?.boxWidthMm ?? draft?.widthMm ?? 0}
                            onChange={(e) => {
                              const boxWidthMm = clampFiniteNumber(e.target.value, draft?.boxWidthMm ?? draft?.widthMm ?? 0, 1, 10000)
                              setDraft((d) => (d ? { ...d, boxWidthMm, widthMm: boxWidthMm } : d))
                            }}
                          />
                        </label>
                        <label className="nahtzugabe-dialog-label" style={{ minWidth: 150 }}>
                          <span>Box Länge (mm)</span>
                          <input
                            type="number"
                            className="nahtzugabe-dialog-input"
                            value={draft?.boxLengthMm ?? draft?.widthMm ?? 0}
                            onChange={(e) => {
                              const boxLengthMm = clampFiniteNumber(e.target.value, draft?.boxLengthMm ?? draft?.widthMm ?? 0, 1, 10000)
                              setDraft((d) => (d ? { ...d, boxLengthMm } : d))
                            }}
                          />
                        </label>
                        <label className="nahtzugabe-dialog-label" style={{ minWidth: 150 }}>
                          <span>Box Höhe (mm)</span>
                          <input
                            type="number"
                            className="nahtzugabe-dialog-input"
                            value={draft?.boxHeightMm ?? draft?.heightMm ?? 0}
                            onChange={(e) => {
                              const boxHeightMm = clampFiniteNumber(e.target.value, draft?.boxHeightMm ?? draft?.heightMm ?? 0, 1, 10000)
                              setDraft((d) => (d ? { ...d, boxHeightMm, heightMm: boxHeightMm } : d))
                            }}
                          />
                        </label>
                        <label className="nahtzugabe-dialog-label" style={{ minWidth: 150 }}>
                          <span>Materialstärke (mm)</span>
                          <input
                            type="number"
                            step={0.1}
                            className="nahtzugabe-dialog-input"
                            value={draft?.materialThicknessMm ?? 3}
                            onChange={(e) => {
                              const materialThicknessMm = clampFiniteNumber(e.target.value, draft?.materialThicknessMm ?? 3, 0.5, 20)
                              setDraft((d) => (d ? { ...d, materialThicknessMm } : d))
                            }}
                          />
                        </label>
                        <label className="nahtzugabe-dialog-label" style={{ minWidth: 150 }}>
                          <span>Fingeranzahl</span>
                          <input
                            type="number"
                            className="nahtzugabe-dialog-input"
                            value={draft?.fingerCount ?? 7}
                            onChange={(e) => {
                              const fingerCount = clampFiniteNumber(e.target.value, draft?.fingerCount ?? 7, 3, 99)
                              setDraft((d) => (d ? { ...d, fingerCount: Math.round(fingerCount) } : d))
                            }}
                          />
                        </label>
                        <label className="nahtzugabe-dialog-label" style={{ minWidth: 150 }}>
                          <span>Kerf (mm)</span>
                          <input
                            type="number"
                            step={0.01}
                            className="nahtzugabe-dialog-input"
                            value={draft?.kerfMm ?? 0.15}
                            onChange={(e) => {
                              const kerfMm = clampFiniteNumber(e.target.value, draft?.kerfMm ?? 0.15, 0, 2)
                              setDraft((d) => (d ? { ...d, kerfMm } : d))
                            }}
                          />
                        </label>
                        <label className="nahtzugabe-dialog-label" style={{ minWidth: 150 }}>
                          <span>Passung (mm)</span>
                          <input
                            type="number"
                            step={0.01}
                            className="nahtzugabe-dialog-input"
                            value={draft?.fitToleranceMm ?? 0}
                            onChange={(e) => {
                              const fitToleranceMm = clampFiniteNumber(e.target.value, draft?.fitToleranceMm ?? 0, -1, 1)
                              setDraft((d) => (d ? { ...d, fitToleranceMm } : d))
                            }}
                          />
                        </label>
                        <label className="nahtzugabe-dialog-label" style={{ minWidth: 150 }}>
                          <span>Deckel</span>
                          <select
                            className="nahtzugabe-dialog-input"
                            value={draft?.lidType ?? 'removable'}
                            onChange={(e) => {
                              const lidType = e.target.value as 'none' | 'removable' | 'sliding'
                              setDraft((d) => (d ? { ...d, lidType, openTop: lidType === 'none' } : d))
                            }}
                          >
                            <option value="none">Keiner (offen)</option>
                            <option value="removable">Abnehmbar</option>
                            <option value="sliding">Schiebedeckel (MVP: wie abnehmbar)</option>
                          </select>
                        </label>
                      </>
                    )}
                  </div>
                  {boxValidation && (boxValidation.warnings.length > 0 || boxValidation.suggestions.length > 0) && (
                    <div style={{ marginTop: 10, fontSize: 12 }}>
                      {boxValidation.warnings.map((w, i) => (
                        <p key={`w-${i}`} style={{ margin: '2px 0', color: '#b26a00' }}>
                          Warnung: {w}
                        </p>
                      ))}
                      {boxValidation.suggestions.map((s, i) => (
                        <p key={`s-${i}`} style={{ margin: '2px 0', color: '#2e7d32' }}>
                          Hinweis: {s}
                        </p>
                      ))}
                    </div>
                  )}

                  <div className="nahtzugabe-dialog-actions" style={{ marginTop: 16 }}>
                    <button type="button" className="sidebar-btn" onClick={close}>
                      Schließen
                    </button>
                    <button type="button" className="sidebar-btn primary" disabled={!isValidDraft} onClick={onRegenerate}>
                      Neu erzeugen
                    </button>
                  </div>

                </>
              ) : (
                <>
                  <p className="nahtzugabe-dialog-hint" style={{ marginTop: 6 }}>
                    Wähle links eine Instanz und dann einen Teil.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                    {selectedInstance?.parts.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="menubar-dropdown-btn"
                        onClick={() => setSelectedPartId(p.id)}
                        style={{
                          textAlign: 'left',
                          ...(p.id === selectedPartId ? { background: '#1976d2', color: '#fff' } : { background: '#fff' }),
                        }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {selectedInstance && selectedPartId && (
                <div style={{ marginTop: 14 }}>
                  <p style={{ margin: '0 0 8px', fontSize: 12, color: '#555' }}>Teile</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {selectedInstance.parts.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="menubar-dropdown-btn"
                        onClick={() => setSelectedPartId(p.id)}
                        style={{
                          textAlign: 'left',
                          ...(p.id === selectedPartId ? { background: '#1976d2', color: '#fff' } : { background: '#fff' }),
                        }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import type { ConfiguratorPartParams } from '../configurators/types'

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
    updateConfiguratorPartParams(selectedInstance.id, selectedPart.id, draft)
    regenerateConfiguratorPart(selectedInstance.id, selectedPart.id)
  }

  const isValidDraft = !!draft
    ? (() => {
        const widthMm = draft.widthMm
        const heightMm = draft.heightMm
        const hipWidthMm = draft.hipWidthMm ?? widthMm
        const hemWidthMm = draft.hemWidthMm ?? hipWidthMm
        const waistToHipMm = draft.waistToHipMm ?? 180

        const baseOk = Number.isFinite(widthMm) && Number.isFinite(heightMm) && widthMm >= 1 && heightMm >= 1
        const offsetsOk = Number.isFinite(draft.offsetX) && Number.isFinite(draft.offsetY)
        if (!baseOk || !offsetsOk) return false
        if (!isRock) return true

        return (
          Number.isFinite(hipWidthMm) &&
          Number.isFinite(hemWidthMm) &&
          Number.isFinite(waistToHipMm) &&
          hipWidthMm >= 1 &&
          hemWidthMm >= 1 &&
          waistToHipMm >= 1
        )
      })()
    : false

  return (
    <div className="nahtzugabe-dialog-overlay" onClick={close} role="presentation">
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
                    {inst.kindId === 'tshirt' ? 'T-Shirt' : 'Rock'} ({inst.parts.length} Teile)
                  </button>
                ))}
              </div>
            </div>

            <div style={{ flex: 1 }}>
              {selectedInstance && selectedPart ? (
                <>
                  <p className="nahtzugabe-dialog-hint" style={{ marginTop: 0 }}>
                    {selectedInstance.kindId === 'tshirt' ? 'T-Shirt' : 'Rock'}: {selectedPart.label}
                    <span style={{ display: 'block', marginTop: 4 }}>
                      Hinweis: „Neu erzeugen“ überschreibt Cut-Kontur und leert aktuelle Notches/Bohrungen für dieses Teil.
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
                      </>
                    )}
                  </div>

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


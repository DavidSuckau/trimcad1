import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useStore } from '../store/useStore'
import { parseDeDecimal, formatDeDecimal } from '../material/materialCatalogFormat'
import {
  DEFAULT_THICKNESS_MEAN_RADIUS_MM,
  lengthScaleFromThickness,
  resolveNeutralFactor,
} from '../geometry/thicknessCorrection'
import type { ThicknessCorrectionMode } from '../types/model'

const MODE_OPTIONS: { value: ThicknessCorrectionMode; label: string; hint: string }[] = [
  { value: 'outer', label: 'Außenkontur beibehalten', hint: 'Neutralfaktor 0 – Abwicklung bleibt (3D = Außenhaut)' },
  { value: 'mid', label: 'Mittelfläche beibehalten', hint: 'Neutralfaktor 0,5 – Standard für Schaum/Leder' },
  { value: 'inner', label: 'Innenkontur beibehalten', hint: 'Neutralfaktor 1 – volle Dicke nach innen' },
  { value: 'custom', label: 'Neutralfaktor frei', hint: 'Beliebiger Wert 0,0 … 1,0' },
]

export function ThicknessCorrectionModal() {
  const {
    workspace,
    thicknessCorrectionDialogPieceId,
    setThicknessCorrectionDialogPieceId,
    createThicknessCorrectedPiece,
  } = useStore(
    useShallow((s) => ({
      workspace: s.workspace,
      thicknessCorrectionDialogPieceId: s.thicknessCorrectionDialogPieceId,
      setThicknessCorrectionDialogPieceId: s.setThicknessCorrectionDialogPieceId,
      createThicknessCorrectedPiece: s.createThicknessCorrectedPiece,
    })),
  )

  const piece =
    thicknessCorrectionDialogPieceId != null
      ? workspace.pieces.find((p) => p.id === thicknessCorrectionDialogPieceId)
      : null

  const [thicknessStr, setThicknessStr] = useState('5')
  const [mode, setMode] = useState<ThicknessCorrectionMode>('mid')
  const [neutralStr, setNeutralStr] = useState('0,5')
  const [radiusStr, setRadiusStr] = useState(String(DEFAULT_THICKNESS_MEAN_RADIUS_MM))

  useEffect(() => {
    if (!thicknessCorrectionDialogPieceId) return
    setThicknessStr('5')
    setMode('mid')
    setNeutralStr('0,5')
    setRadiusStr(String(DEFAULT_THICKNESS_MEAN_RADIUS_MM))
  }, [thicknessCorrectionDialogPieceId])

  const trapRef = useFocusTrap<HTMLDivElement>(!!thicknessCorrectionDialogPieceId && !!piece)

  const preview = useMemo(() => {
    const thicknessMm = parseDeDecimal(thicknessStr)
    const radiusMm = parseDeDecimal(radiusStr)
    const nf = mode === 'custom' ? parseDeDecimal(neutralStr) : resolveNeutralFactor(mode)
    if (thicknessMm == null || thicknessMm <= 0) return null
    if (radiusMm == null || radiusMm <= 0) return null
    if (nf == null) return null
    const scale = lengthScaleFromThickness({
      thicknessMm,
      meanRadiusMm: radiusMm,
      neutralFactor: nf,
    })
    return {
      scale,
      pct: (scale - 1) * 100,
      nf,
      thicknessMm,
      radiusMm,
    }
  }, [thicknessStr, mode, neutralStr, radiusStr])

  if (!thicknessCorrectionDialogPieceId || !piece) return null

  const close = () => setThicknessCorrectionDialogPieceId(null)

  const apply = () => {
    if (!preview) return
    createThicknessCorrectedPiece(piece.id, {
      thicknessMm: preview.thicknessMm,
      mode,
      neutralFactor: preview.nf,
      meanRadiusMm: preview.radiusMm,
    })
  }

  return (
    <div
      className="nahtzugabe-dialog-overlay"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Dickenkorrektur"
    >
      <div
        className="nahtzugabe-dialog"
        style={{ minWidth: 360, maxWidth: 440 }}
        onClick={(e) => e.stopPropagation()}
        ref={trapRef}
      >
        <h3 className="nahtzugabe-dialog-title">Dickenkorrektur</h3>
        <p className="nahtzugabe-dialog-hint" style={{ marginTop: 0 }}>
          Erzeugt <strong>{piece.name || `Teil ${piece.number}`}_…mm</strong> als neues Schnittteil. Das Original bleibt
          unangetastet. Kontur-Segmente und Kerben bleiben topologisch erhalten (kein Clipper-Umbau).
        </p>

        <label className="nahtzugabe-dialog-label">
          <span>Materialdicke (mm)</span>
          <input
            type="text"
            className="nahtzugabe-dialog-input"
            inputMode="decimal"
            value={thicknessStr}
            onChange={(e) => setThicknessStr(e.target.value)}
            autoComplete="off"
          />
        </label>

        <fieldset style={{ border: 'none', margin: '12px 0 0', padding: 0 }}>
          <legend className="nahtzugabe-dialog-label" style={{ marginBottom: 8, padding: 0 }}>
            Berechnungsmodus
          </legend>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
            {MODE_OPTIONS.map((opt) => (
              <label key={opt.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="thicknessMode"
                  checked={mode === opt.value}
                  onChange={() => setMode(opt.value)}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <strong>{opt.label}</strong>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--muted, #666)', marginTop: 2 }}>
                    {opt.hint}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {mode === 'custom' ? (
          <label className="nahtzugabe-dialog-label" style={{ marginTop: 12 }}>
            <span>Neutralfaktor (0 … 1)</span>
            <input
              type="text"
              className="nahtzugabe-dialog-input"
              inputMode="decimal"
              value={neutralStr}
              onChange={(e) => setNeutralStr(e.target.value)}
              autoComplete="off"
            />
          </label>
        ) : null}

        <label className="nahtzugabe-dialog-label" style={{ marginTop: 12 }}>
          <span>Mittlerer Krümmungsradius (mm)</span>
          <input
            type="text"
            className="nahtzugabe-dialog-input"
            inputMode="decimal"
            value={radiusStr}
            onChange={(e) => setRadiusStr(e.target.value)}
            autoComplete="off"
          />
          <span style={{ fontSize: 11, color: 'var(--muted, #666)', marginTop: 4 }}>
            Variante 1 ohne 3D-Mapping. Kleinere Radien → stärkere Korrektur. Standard{' '}
            {DEFAULT_THICKNESS_MEAN_RADIUS_MM} mm.
          </span>
        </label>

        {preview ? (
          <p style={{ margin: '12px 0 0', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
            Vorschau λ = {formatDeDecimal(preview.scale, 4)} (
            {preview.pct >= 0 ? '+' : ''}
            {formatDeDecimal(preview.pct, 2)} %)
          </p>
        ) : (
          <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--muted, #666)' }}>
            Bitte gültige positive Werte eingeben.
          </p>
        )}

        <div className="nahtzugabe-dialog-actions" style={{ marginTop: 16 }}>
          <button type="button" className="sidebar-btn" onClick={close}>
            Abbrechen
          </button>
          <button type="button" className="sidebar-btn primary" onClick={apply} disabled={!preview}>
            Teil erzeugen
          </button>
        </div>
      </div>
    </div>
  )
}

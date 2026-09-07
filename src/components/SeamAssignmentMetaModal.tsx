import { useState, useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store/useStore'
import { useFocusTrap } from '../hooks/useFocusTrap'
import {
  SEAM_ASSIGNMENT_KIND_IDS,
  SEAM_ASSIGNMENT_KIND_LABELS,
  type SeamAssignmentKindId,
} from '../types/model'
import { isInternalSeamAssignment } from '../geometry/internalSeamAssignment'
import {
  countEasePairsForAssignment,
  EASE_DEFAULT_SPACING_MM,
} from '../geometry/easeNotch'

export function SeamAssignmentMetaModal() {
  const {
    seamAssignmentMetaDialogId,
    setSeamAssignmentMetaDialogId,
    updateSeamAssignmentMeta,
    setToastMessage,
    updateWorkspace,
    workspace,
    easePreview,
    suggestEaseForAssignment,
    clearEasePreview,
    applyEasePreview,
    clearEaseForAssignment,
  } =
    useStore(
      useShallow((s) => ({
        seamAssignmentMetaDialogId: s.seamAssignmentMetaDialogId,
        setSeamAssignmentMetaDialogId: s.setSeamAssignmentMetaDialogId,
        updateSeamAssignmentMeta: s.updateSeamAssignmentMeta,
        setToastMessage: s.setToastMessage,
        updateWorkspace: s.updateWorkspace,
        workspace: s.workspace,
        easePreview: s.easePreview,
        suggestEaseForAssignment: s.suggestEaseForAssignment,
        clearEasePreview: s.clearEasePreview,
        applyEasePreview: s.applyEasePreview,
        clearEaseForAssignment: s.clearEaseForAssignment,
      })),
    )
  const assignment = workspace.seamAssignments.find((a) => a.id === seamAssignmentMetaDialogId)
  const pieceA = assignment ? workspace.pieces.find((p) => p.id === assignment.pieceIdA) : null
  const pieceB =
    assignment && !isInternalSeamAssignment(assignment)
      ? workspace.pieces.find((p) => p.id === assignment.pieceIdB)
      : null

  const trapRef = useFocusTrap<HTMLDivElement>(
    !!(seamAssignmentMetaDialogId && assignment && pieceA && (pieceB || isInternalSeamAssignment(assignment))),
  )

  const [orderStr, setOrderStr] = useState('')
  const [kind, setKind] = useState<SeamAssignmentKindId | ''>('')
  const [autoCornerAdjust, setAutoCornerAdjust] = useState(true)
  const [easeSpacingStr, setEaseSpacingStr] = useState(String(EASE_DEFAULT_SPACING_MM))

  useEffect(() => {
    if (!assignment) return
    setOrderStr(assignment.orderNumber != null ? String(assignment.orderNumber) : '')
    setKind((assignment.seamKind as SeamAssignmentKindId | undefined) ?? '')
    setAutoCornerAdjust(workspace.autoAdjustSeamAssignmentCorners !== false)
    if (easePreview?.assignmentId === assignment.id) {
      setEaseSpacingStr(String(easePreview.spacingMm))
    } else {
      setEaseSpacingStr(String(EASE_DEFAULT_SPACING_MM))
    }
  }, [assignment?.id, assignment?.orderNumber, assignment?.seamKind, workspace.autoAdjustSeamAssignmentCorners, easePreview?.assignmentId, easePreview?.spacingMm])

  if (!seamAssignmentMetaDialogId || !assignment || !pieceA) return null
  if (!isInternalSeamAssignment(assignment) && !pieceB) return null

  const nameA = pieceA.name || `Teil ${pieceA.number}`
  const nameB = pieceB ? pieceB.name || `Teil ${pieceB.number}` : null
  const internal = isInternalSeamAssignment(assignment)
  const existingEasePairs = countEasePairsForAssignment(workspace.pieces, assignment.id)
  const previewForThis =
    easePreview?.assignmentId === assignment.id ? easePreview : null

  const save = () => {
    const trimmed = orderStr.trim()
    let orderNumber: number | null
    if (trimmed === '') {
      orderNumber = null
    } else {
      if (!/^\d+$/.test(trimmed)) {
        setToastMessage('error:Bitte eine ganze Zahl ≥ 1 oder leer lassen.')
        return
      }
      const n = parseInt(trimmed, 10)
      if (n < 1) {
        setToastMessage('error:Bitte eine ganze Zahl ≥ 1 oder leer lassen.')
        return
      }
      orderNumber = n
    }
    updateSeamAssignmentMeta(assignment.id, {
      orderNumber,
      seamKind: kind === '' ? null : kind,
    })
    if (!isInternalSeamAssignment(assignment)) {
      updateWorkspace({ autoAdjustSeamAssignmentCorners: autoCornerAdjust })
    }
    clearEasePreview()
    setSeamAssignmentMetaDialogId(null)
  }

  const parseSpacing = (): number | null => {
    const n = Number(String(easeSpacingStr).replace(',', '.'))
    if (!Number.isFinite(n) || n < 2 || n > 50) return null
    return n
  }

  const onSuggestEase = () => {
    const spacing = parseSpacing()
    if (spacing == null) {
      setToastMessage('error:Abstand: Zahl zwischen 2 und 50 mm.')
      return
    }
    suggestEaseForAssignment(assignment.id, spacing)
  }

  return (
    <div
      className="nahtzugabe-dialog-overlay"
      onClick={() => {
        clearEasePreview()
        setSeamAssignmentMetaDialogId(null)
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Nahtzuordnung"
    >
      <div className="nahtzugabe-dialog" onClick={(e) => e.stopPropagation()} style={{ minWidth: 360 }} ref={trapRef}>
        <h3 className="nahtzugabe-dialog-title">Nahtzuordnung</h3>
        <p className="nahtzugabe-dialog-hint" style={{ marginBottom: '0.75rem' }}>
          {internal ? `${nameA} – interne Linie (Einzelnaht)` : `${nameA} ↔ ${nameB}`}
        </p>
        <label className="nahtzugabe-dialog-label">
          <span>Näh-Reihenfolge (Nummer, je Nummer nur einmal)</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            className="nahtzugabe-dialog-input"
            value={orderStr}
            onChange={(e) => setOrderStr(e.target.value.replace(/\D/g, ''))}
            placeholder="Leer = keine Reihenfolge"
          />
        </label>
        <label className="nahtzugabe-dialog-label">
          <span>Art der Naht</span>
          <select
            className="nahtzugabe-dialog-input"
            value={kind}
            onChange={(e) => setKind((e.target.value || '') as SeamAssignmentKindId | '')}
          >
            <option value="">— nicht festgelegt —</option>
            {SEAM_ASSIGNMENT_KIND_IDS.map((id) => (
              <option key={id} value={id}>
                {SEAM_ASSIGNMENT_KIND_LABELS[id]}
              </option>
            ))}
          </select>
        </label>
        {!internal ? (
          <label className="nahtzugabe-dialog-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={autoCornerAdjust}
              onChange={(e) => setAutoCornerAdjust(e.target.checked)}
            />
            <span>Ecken bei Nahtzuordnung automatisch anpassen</span>
          </label>
        ) : null}

        {!internal ? (
          <div
            style={{
              marginTop: '1rem',
              paddingTop: '0.75rem',
              borderTop: '1px solid #e0e0e0',
            }}
          >
            <p className="nahtzugabe-dialog-hint" style={{ marginBottom: '0.5rem' }}>
              Entspannung (Ease) — nur auf Kurven, immer paarweise A+B; zählt nicht in der
              Nahtanpassung.
              {existingEasePairs > 0
                ? ` Aktuell ${existingEasePairs} Paar${existingEasePairs === 1 ? '' : 'e'}.`
                : ''}
            </p>
            <label className="nahtzugabe-dialog-label">
              <span>Abstand (mm)</span>
              <input
                type="text"
                inputMode="decimal"
                className="nahtzugabe-dialog-input"
                value={easeSpacingStr}
                onChange={(e) => setEaseSpacingStr(e.target.value)}
              />
            </label>
            {previewForThis ? (
              <p className="nahtzugabe-dialog-hint" style={{ color: '#c2410c', marginBottom: '0.5rem' }}>
                Vorschau: {previewForThis.relativeTs.length} Paare (orange Geister auf der Fläche).
              </p>
            ) : null}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.35rem' }}>
              <button
                type="button"
                className="menubar-dropdown-btn"
                style={{ background: '#fff7ed', color: '#9a3412' }}
                onClick={onSuggestEase}
              >
                Vorschlagen
              </button>
              <button
                type="button"
                className="menubar-dropdown-btn"
                style={{ background: '#ea580c', color: '#fff' }}
                disabled={!previewForThis}
                onClick={() => applyEasePreview()}
              >
                Übernehmen
              </button>
              <button
                type="button"
                className="menubar-dropdown-btn"
                style={{ background: '#fff' }}
                disabled={!previewForThis}
                onClick={() => clearEasePreview()}
              >
                Vorschau verwerfen
              </button>
              <button
                type="button"
                className="menubar-dropdown-btn"
                style={{ background: '#fff' }}
                disabled={existingEasePairs === 0}
                onClick={() => clearEaseForAssignment(assignment.id)}
              >
                Entspannung entfernen
              </button>
            </div>
          </div>
        ) : null}

        <div className="nahtzugabe-dialog-actions" style={{ justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
          <button
            type="button"
            className="menubar-dropdown-btn"
            style={{ background: '#fff' }}
            onClick={() => {
              clearEasePreview()
              setSeamAssignmentMetaDialogId(null)
            }}
          >
            Abbrechen
          </button>
          <button
            type="button"
            className="menubar-dropdown-btn"
            style={{ background: '#1976d2', color: '#fff' }}
            onClick={save}
          >
            Speichern
          </button>
        </div>
      </div>
    </div>
  )
}

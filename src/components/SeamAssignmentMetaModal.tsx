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

export function SeamAssignmentMetaModal() {
  const {
    seamAssignmentMetaDialogId,
    setSeamAssignmentMetaDialogId,
    updateSeamAssignmentMeta,
    setToastMessage,
    updateWorkspace,
    workspace,
  } =
    useStore(
      useShallow((s) => ({
        seamAssignmentMetaDialogId: s.seamAssignmentMetaDialogId,
        setSeamAssignmentMetaDialogId: s.setSeamAssignmentMetaDialogId,
        updateSeamAssignmentMeta: s.updateSeamAssignmentMeta,
        setToastMessage: s.setToastMessage,
        updateWorkspace: s.updateWorkspace,
        workspace: s.workspace,
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

  useEffect(() => {
    if (!assignment) return
    setOrderStr(assignment.orderNumber != null ? String(assignment.orderNumber) : '')
    setKind((assignment.seamKind as SeamAssignmentKindId | undefined) ?? '')
    setAutoCornerAdjust(workspace.autoAdjustSeamAssignmentCorners !== false)
  }, [assignment?.id, assignment?.orderNumber, assignment?.seamKind, workspace.autoAdjustSeamAssignmentCorners])

  if (!seamAssignmentMetaDialogId || !assignment || !pieceA) return null
  if (!isInternalSeamAssignment(assignment) && !pieceB) return null

  const nameA = pieceA.name || `Teil ${pieceA.number}`
  const nameB = pieceB ? pieceB.name || `Teil ${pieceB.number}` : null

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
    setSeamAssignmentMetaDialogId(null)
  }

  const internal = isInternalSeamAssignment(assignment)

  return (
    <div
      className="nahtzugabe-dialog-overlay"
      onClick={() => setSeamAssignmentMetaDialogId(null)}
      role="dialog"
      aria-modal="true"
      aria-label="Nahtzuordnung"
    >
      <div className="nahtzugabe-dialog" onClick={(e) => e.stopPropagation()} style={{ minWidth: 340 }} ref={trapRef}>
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
        <div className="nahtzugabe-dialog-actions" style={{ justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
          <button
            type="button"
            className="menubar-dropdown-btn"
            style={{ background: '#fff' }}
            onClick={() => setSeamAssignmentMetaDialogId(null)}
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
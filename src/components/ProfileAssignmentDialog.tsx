import { useState, useEffect, useMemo } from 'react'
import { useStore } from '../store/useStore'
import { enumerateEdges } from '../geometry/edgeEnumeration'
import { edgeTotalLength } from '../geometry/seamUtils'

export function ProfileAssignmentDialog() {
  const {
    workspace,
    profileDialogAssignmentId,
    setProfileDialogAssignmentId,
    updateProfileAssignment,
    removeProfileAssignment,
  } = useStore()

  const assignment =
    profileDialogAssignmentId != null
      ? (workspace.profileAssignments ?? []).find((pa) => pa.id === profileDialogAssignmentId)
      : null

  const piece = assignment ? workspace.pieces.find((p) => p.id === assignment.pieceId) : null

  const [profileName, setProfileName] = useState('')
  const [profileKey, setProfileKey] = useState('')
  const [supplierNumber, setSupplierNumber] = useState('')
  const [internalArticleNumber, setInternalArticleNumber] = useState('')
  const [seamAllowanceStr, setSeamAllowanceStr] = useState('')
  const [pdfDocumentUrl, setPdfDocumentUrl] = useState('')

  useEffect(() => {
    if (assignment) {
      setProfileName(assignment.profileName)
      setProfileKey(assignment.profileKey)
      setSupplierNumber(assignment.supplierNumber ?? '')
      setInternalArticleNumber(assignment.internalArticleNumber ?? '')
      setSeamAllowanceStr(assignment.seamAllowanceMm != null ? String(assignment.seamAllowanceMm) : '')
      setPdfDocumentUrl(assignment.pdfDocumentUrl ?? '')
    }
  }, [assignment?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const edgeLengthMm = useMemo(() => {
    if (!piece || !assignment) return 0
    const edges = enumerateEdges(piece)
    const edge = edges.find((e) => e.edgeIndex === assignment.edgeIndex)
    if (!edge) return 0
    return edgeTotalLength(piece, edge.curveIndices)
  }, [piece, assignment])

  useEffect(() => {
    if (profileDialogAssignmentId && !assignment) {
      setProfileDialogAssignmentId(null)
    }
  }, [profileDialogAssignmentId, assignment, setProfileDialogAssignmentId])

  if (!profileDialogAssignmentId || !assignment || !piece) return null

  const isValid = profileName.trim().length > 0 && profileKey.trim().length > 0

  const handleSave = () => {
    if (!isValid) return
    const seamMm = parseFloat(seamAllowanceStr)
    updateProfileAssignment(assignment.id, {
      profileName: profileName.trim(),
      profileKey: profileKey.trim(),
      supplierNumber: supplierNumber.trim() || undefined,
      internalArticleNumber: internalArticleNumber.trim() || undefined,
      seamAllowanceMm: Number.isFinite(seamMm) && seamMm > 0 ? seamMm : undefined,
      pdfDocumentUrl: pdfDocumentUrl.trim() || undefined,
    })
    setProfileDialogAssignmentId(null)
  }

  const handleDelete = () => {
    removeProfileAssignment(assignment.id)
  }

  const handleClose = () => {
    setProfileDialogAssignmentId(null)
  }

  return (
    <div className="nahtzugabe-dialog-overlay" onClick={handleClose} role="presentation">
      <div className="nahtzugabe-dialog" style={{ minWidth: 360 }} onClick={(e) => e.stopPropagation()}>
        <h3 className="nahtzugabe-dialog-title">Profil – Kante {assignment.edgeIndex + 1}</h3>

        <label className="nahtzugabe-dialog-label">
          <span>Profilbezeichnung *</span>
          <input
            type="text"
            className="nahtzugabe-dialog-input"
            style={{ width: '100%', boxSizing: 'border-box' }}
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            autoComplete="off"
            autoFocus
          />
        </label>

        <label className="nahtzugabe-dialog-label">
          <span>Kennung (Buchstabe) *</span>
          <input
            type="text"
            className="nahtzugabe-dialog-input"
            style={{ width: 80, boxSizing: 'border-box' }}
            value={profileKey}
            maxLength={3}
            onChange={(e) => setProfileKey(e.target.value.toUpperCase())}
            autoComplete="off"
          />
        </label>

        <label className="nahtzugabe-dialog-label">
          <span>Lieferantennummer</span>
          <input
            type="text"
            className="nahtzugabe-dialog-input"
            style={{ width: '100%', boxSizing: 'border-box' }}
            value={supplierNumber}
            onChange={(e) => setSupplierNumber(e.target.value)}
            autoComplete="off"
          />
        </label>

        <label className="nahtzugabe-dialog-label">
          <span>Interne Artikelnummer</span>
          <input
            type="text"
            className="nahtzugabe-dialog-input"
            style={{ width: '100%', boxSizing: 'border-box' }}
            value={internalArticleNumber}
            onChange={(e) => setInternalArticleNumber(e.target.value)}
            autoComplete="off"
          />
        </label>

        <label className="nahtzugabe-dialog-label">
          <span>Nahtzugabe (mm)</span>
          <input
            type="number"
            className="nahtzugabe-dialog-input"
            style={{ width: 100, boxSizing: 'border-box' }}
            value={seamAllowanceStr}
            min={0}
            step={0.5}
            onChange={(e) => setSeamAllowanceStr(e.target.value)}
            placeholder="optional"
          />
        </label>

        <div className="nahtzugabe-dialog-label" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <span>Profillänge:</span>
          <strong>{edgeLengthMm.toFixed(1)} mm</strong>
        </div>

        <label className="nahtzugabe-dialog-label">
          <span>PDF-Dokument (Pfad/URL)</span>
          <input
            type="text"
            className="nahtzugabe-dialog-input"
            style={{ width: '100%', boxSizing: 'border-box' }}
            value={pdfDocumentUrl}
            onChange={(e) => setPdfDocumentUrl(e.target.value)}
            placeholder="optional"
            autoComplete="off"
          />
        </label>

        <div className="nahtzugabe-dialog-actions" style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="sidebar-btn primary"
            onClick={handleSave}
            disabled={!isValid}
          >
            Speichern
          </button>
          <button
            type="button"
            className="sidebar-btn"
            style={{ color: '#c62828' }}
            onClick={handleDelete}
          >
            Löschen
          </button>
          <button type="button" className="sidebar-btn" onClick={handleClose}>
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  )
}

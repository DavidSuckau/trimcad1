import { useStore } from '../store/useStore'
import type { PiecePickTarget, WorkspaceChatProposal } from './workspaceChatActions'
import { createNotchForAiPlacement } from './aiNotchPlacement'
import { buildCirclePolygonCutLine, buildRectangleCutLine } from './workspaceGeometry'

function resolvePieceIdForPick(
  pick: PiecePickTarget,
  pieceIndex: number | undefined,
  pieces: { id: string }[],
  selectedIds: string[],
): string | null {
  if (pick === 'by_index') {
    const i = pieceIndex ?? 0
    if (i < 0 || i >= pieces.length) return null
    return pieces[i].id
  }
  return selectedIds[0] ?? null
}

export function applyWorkspaceChatProposal(proposal: WorkspaceChatProposal): void {
  for (const action of proposal.actions) {
    if (action.type === 'clear_all_seam_assignments') {
      useStore.setState((s) => ({
        workspace: { ...s.workspace, seamAssignments: [] },
      }))
      continue
    }

    if (action.type === 'create_rectangle') {
      const { addPiece } = useStore.getState()
      const cutLine = buildRectangleCutLine(action.widthMm, action.heightMm)
      addPiece({
        name: action.name,
        cutLine,
        transform: { x: action.originWorldX, y: action.originWorldY, rotation: 0, mirrored: false },
      })
      continue
    }

    if (action.type === 'create_circle') {
      const { addPiece } = useStore.getState()
      const cutLine = buildCirclePolygonCutLine(action.radiusMm, action.segments)
      addPiece({
        name: action.name,
        cutLine,
        transform: { x: action.centerWorldX, y: action.centerWorldY, rotation: 0, mirrored: false },
      })
      continue
    }

    if (action.type === 'add_empty_piece') {
      const { addPiece } = useStore.getState()
      addPiece(action.name ? { name: action.name } : undefined)
      continue
    }

    if (action.type === 'add_notch') {
      const { addNotch, workspace, selectedPieceIds } = useStore.getState()
      const pieceId = resolvePieceIdForPick(
        action.piecePick,
        action.pieceIndex,
        workspace.pieces,
        selectedPieceIds,
      )
      if (!pieceId) {
        throw new Error('Kein Zielteil: Teil auswählen oder pieceIndex setzen.')
      }
      const piece = workspace.pieces.find((p) => p.id === pieceId)
      if (!piece) throw new Error('Teil nicht gefunden.')
      const placed = createNotchForAiPlacement(
        piece,
        action.positionLocalX,
        action.positionLocalY,
        action.notchType,
        action.depthMm,
        action.widthMm,
        action.angleDeg,
      )
      if (!placed.ok) throw new Error(placed.error)
      addNotch(pieceId, placed.notch)
      continue
    }

    if (action.type === 'add_drill') {
      const { addDrill, workspace, selectedPieceIds } = useStore.getState()
      const pieceId = resolvePieceIdForPick(
        action.piecePick,
        action.pieceIndex,
        workspace.pieces,
        selectedPieceIds,
      )
      if (!pieceId) {
        throw new Error('Kein Zielteil: Teil auswählen oder pieceIndex setzen.')
      }
      const id = 'd' + Math.random().toString(36).slice(2, 9)
      addDrill(pieceId, {
        id,
        center: { x: action.centerLocalX, y: action.centerLocalY },
        radius: action.radiusMm,
      })
      continue
    }

    const { workspace, selectedPieceIds, updatePiece, deletePiece } = useStore.getState()
    const pieceIds =
      action.target === 'all_pieces'
        ? workspace.pieces.map((p) => p.id)
        : [...selectedPieceIds]

    if (action.target === 'selected_pieces' && pieceIds.length === 0) {
      throw new Error('Keine Teile ausgewaehlt: „nur Auswahl“ ist nicht moeglich.')
    }

    for (const id of pieceIds) {
      if (action.type === 'delete_pieces') {
        deletePiece(id)
      } else if (action.type === 'remove_seam_allowance') {
        updatePiece(id, { seamAllowanceMm: null })
      } else if (action.type === 'clear_notches') {
        updatePiece(id, { notches: [] })
      } else if (action.type === 'clear_drills') {
        updatePiece(id, { drills: [] })
      }
    }
  }
}

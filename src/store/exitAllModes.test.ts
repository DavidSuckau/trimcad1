import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'

describe('exitAllModes', () => {
  beforeEach(() => {
    useStore.setState({
      tool: 'notch',
      pendingNahtzugabeClick: true,
      nahtzugabeDialogPieceId: 'p1',
      piecePropertiesDialogPieceId: 'p2',
      edgeSeamPickingActive: true,
      profileDialogAssignmentId: 'prof-1',
      rulerMode: true,
      rulerLine: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      seamAdjustmentDialog: 'sa-1',
      seamAssignmentMetaDialogId: 'meta-1',
      massstabDialog: { pieceId: 'p1', curveIndices: [0], currentLengthMm: 100 },
      showHelpModal: true,
      showShortcutListModal: true,
      showSettingsModal: true,
      showStuecklisteModal: true,
      configuratorModalOpen: true,
      rockGeneratorModalOpen: true,
      toastMessage: 'warn:test',
      batchSelectionFilter: 'softVertices',
      batchSelectionTargets: [{ kind: 'vertex', pieceId: 'p1', vertexIndex: 0 }],
      batchUiHighlightByTargetId: { 'v:p1:0': '#f00' },
    })
  })

  it('setzt tool auf select', () => {
    useStore.getState().exitAllModes()
    expect(useStore.getState().tool).toBe('select')
  })

  it('setzt alle Dialog-IDs zurück', () => {
    useStore.getState().exitAllModes()
    const s = useStore.getState()
    expect(s.nahtzugabeDialogPieceId).toBeNull()
    expect(s.piecePropertiesDialogPieceId).toBeNull()
    expect(s.profileDialogAssignmentId).toBeNull()
    expect(s.seamAdjustmentDialog).toBeNull()
    expect(s.seamAssignmentMetaDialogId).toBeNull()
    expect(s.massstabDialog).toBeNull()
  })

  it('setzt alle Modal-Flags zurück', () => {
    useStore.getState().exitAllModes()
    const s = useStore.getState()
    expect(s.showHelpModal).toBe(false)
    expect(s.showShortcutListModal).toBe(false)
    expect(s.showSettingsModal).toBe(false)
    expect(s.showStuecklisteModal).toBe(false)
    expect(s.configuratorModalOpen).toBe(false)
    expect(s.rockGeneratorModalOpen).toBe(false)
  })

  it('setzt Batch-Selection und Highlight zurück', () => {
    useStore.getState().exitAllModes()
    const s = useStore.getState()
    expect(s.batchSelectionFilter).toBe('all')
    expect(s.batchSelectionTargets).toEqual([])
    expect(s.batchUiHighlightByTargetId).toEqual({})
  })

  it('setzt transiente UI-Flags zurück', () => {
    useStore.getState().exitAllModes()
    const s = useStore.getState()
    expect(s.pendingNahtzugabeClick).toBe(false)
    expect(s.edgeSeamPickingActive).toBe(false)
    expect(s.rulerMode).toBe(false)
    expect(s.rulerLine).toBeNull()
    expect(s.toastMessage).toBeNull()
  })
})

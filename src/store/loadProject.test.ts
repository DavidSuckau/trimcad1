import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import type { TrimTexProjectFileV1 } from '../persistence/trimtexProjectJson'
import { TRIMTEX_PROJECT_FORMAT, TRIMTEX_PROJECT_VERSION } from '../persistence/trimtexProjectJson'

const square = [
  { type: 'line' as const, start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
  { type: 'line' as const, start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
  { type: 'line' as const, start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
  { type: 'line' as const, start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
]

const makeProject = (): TrimTexProjectFileV1 => ({
  format: TRIMTEX_PROJECT_FORMAT,
  version: TRIMTEX_PROJECT_VERSION,
  savedAt: new Date().toISOString(),
  workspace: {
    id: 'ws-load',
    name: 'Loaded',
    pieces: [
      {
        id: 'loaded-1',
        number: '001',
        name: 'Teil',
        cutLine: square,
        seamLine: [],
        seamAllowanceMm: null,
        notches: [],
        drills: [],
        grainLine: null,
        internalLines: [],
        layer: 'CUT',
        transform: { x: 0, y: 0, rotation: 0, mirrored: false },
        softVertices: [],
        fillInterior: true,
        material: '',
        bomQuantity: 1,
      },
    ],
    view: { zoom: 1, panX: 0, panY: 0 },
    seamAssignments: [],
    notes: [],
    profileAssignments: [],
  },
  dxfExportScale: 1,
  dxfImportExtraCutLayers: '',
  dxfImportScale: 1,
  dxfImportDetectVNotches: true,
  dxfImportCreateSeamLine: false,
  dxfImportSeamAllowanceMm: 10,
  notchSettings: [
    { type: 'kerbe', widthMm: 6, depthMm: 4 },
    { type: 'strich', widthMm: 2.5, depthMm: 2 },
    { type: 'strich', widthMm: 2.5, depthMm: 2 },
    { type: 'strich', widthMm: 2.5, depthMm: 2 },
    { type: 'strich', widthMm: 2.5, depthMm: 2 },
    { type: 'strich', widthMm: 2.5, depthMm: 2 },
    { type: 'strich', widthMm: 2.5, depthMm: 2 },
    { type: 'strich', widthMm: 2.5, depthMm: 2 },
    { type: 'strich', widthMm: 2.5, depthMm: 2 },
    { type: 'strich', widthMm: 2.5, depthMm: 2 },
  ],
  imageDigitizeSession: null,
})

describe('loadProjectFromFile', () => {
  beforeEach(() => {
    useStore.setState({
      configuratorModalOpen: true,
      rockGeneratorModalOpen: true,
      profileDialogAssignmentId: 'some-id',
      seamAdjustmentDialog: 'adj-dialog-id',
      seamAssignmentMetaDialogId: 'meta-id',
      massstabDialog: { pieceId: 'p1', curveIndices: [0, 1], currentLengthMm: 200 },
      showHelpModal: true,
      showShortcutListModal: true,
      showSettingsModal: true,
      showStuecklisteModal: true,
      toastMessage: 'warn:old toast',
    })
  })

  it('setzt configuratorModalOpen zurück', () => {
    useStore.getState().loadProjectFromFile(makeProject())
    expect(useStore.getState().configuratorModalOpen).toBe(false)
  })

  it('setzt rockGeneratorModalOpen zurück', () => {
    useStore.getState().loadProjectFromFile(makeProject())
    expect(useStore.getState().rockGeneratorModalOpen).toBe(false)
  })

  it('setzt profileDialogAssignmentId zurück', () => {
    useStore.getState().loadProjectFromFile(makeProject())
    expect(useStore.getState().profileDialogAssignmentId).toBeNull()
  })

  it('setzt seamAdjustmentDialog zurück', () => {
    useStore.getState().loadProjectFromFile(makeProject())
    expect(useStore.getState().seamAdjustmentDialog).toBeNull()
  })

  it('setzt seamAssignmentMetaDialogId zurück', () => {
    useStore.getState().loadProjectFromFile(makeProject())
    expect(useStore.getState().seamAssignmentMetaDialogId).toBeNull()
  })

  it('setzt massstabDialog zurück', () => {
    useStore.getState().loadProjectFromFile(makeProject())
    expect(useStore.getState().massstabDialog).toBeNull()
  })

  it('setzt alle Modal-Flags zurück', () => {
    useStore.getState().loadProjectFromFile(makeProject())
    const s = useStore.getState()
    expect(s.showHelpModal).toBe(false)
    expect(s.showShortcutListModal).toBe(false)
    expect(s.showSettingsModal).toBe(false)
    expect(s.showStuecklisteModal).toBe(false)
  })

  it('setzt toastMessage zurück', () => {
    useStore.getState().loadProjectFromFile(makeProject())
    expect(useStore.getState().toastMessage).toBeNull()
  })

  it('selektiert das erste Teil', () => {
    useStore.getState().loadProjectFromFile(makeProject())
    expect(useStore.getState().selectedPieceIds).toEqual(['loaded-1'])
  })

  it('setzt tool auf select', () => {
    useStore.setState({ tool: 'line' })
    useStore.getState().loadProjectFromFile(makeProject())
    expect(useStore.getState().tool).toBe('select')
  })
})

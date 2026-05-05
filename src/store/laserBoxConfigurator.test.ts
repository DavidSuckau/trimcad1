import { describe, expect, it } from 'vitest'
import { mergeLaserBoxParamsForPart } from '../configurators/laserBoxSync'
import { useStore } from './useStore'

describe('laserBox configurator flow', () => {
  it('legt fünf Box-Teile an und erzeugt Fingerjoint-Konturen', () => {
    const beforePieces = useStore.getState().workspace.pieces.length
    const beforeInstances = useStore.getState().configuratorInstances.length

    const instanceId = useStore.getState().createConfiguratorInstance('laserBox')
    const state = useStore.getState()
    const inst = state.configuratorInstances.find((x) => x.id === instanceId)

    expect(state.configuratorInstances.length).toBe(beforeInstances + 1)
    expect(inst).toBeTruthy()
    expect(inst?.parts.length).toBe(5)
    expect(state.workspace.pieces.length).toBe(beforePieces + 5)
    expect(inst?.parts.every((p) => p.params.fingerCount != null)).toBe(true)

    const firstPiece = state.workspace.pieces.find((p) => p.id === inst!.parts[0]!.pieceId)
    expect(firstPiece).toBeTruthy()
    expect(firstPiece!.cutLine.length).toBeGreaterThan(12)
  })

  it('regeneriert ein Box-Teil nach Parameteränderung', () => {
    const instanceId = useStore.getState().createConfiguratorInstance('laserBox')
    const inst = useStore.getState().configuratorInstances.find((x) => x.id === instanceId)!
    const part = inst.parts[0]!
    const before = useStore.getState().workspace.pieces.find((p) => p.id === part.pieceId)!
    const beforeSegments = before.cutLine.length

    useStore.getState().updateConfiguratorPartParams(instanceId, part.id, { fingerCount: 13, kerfMm: 0.1 })
    useStore.getState().regenerateConfiguratorPart(instanceId, part.id)
    const after = useStore.getState().workspace.pieces.find((p) => p.id === part.pieceId)!

    expect(after.cutLine.length).toBeGreaterThanOrEqual(beforeSegments)
    expect(after.seamLine).toEqual([])
    expect(after.notches).toEqual([])
  })

  it('synchronisiert alle Teile wenn gemeinsame Box-Parameter auf jedes Teil angewendet werden', () => {
    const instanceId = useStore.getState().createConfiguratorInstance('laserBox')
    let inst = useStore.getState().configuratorInstances.find((x) => x.id === instanceId)!
    const baseParams = inst.parts[0]!.params
    const draft = {
      ...baseParams,
      boxWidthMm: 500,
      boxLengthMm: 400,
      boxHeightMm: 300,
    }

    for (const part of inst.parts) {
      const nextParams = mergeLaserBoxParamsForPart(part.partId, draft, {
        offsetX: part.params.offsetX,
        offsetY: part.params.offsetY,
      })
      useStore.getState().updateConfiguratorPartParams(instanceId, part.id, nextParams)
    }
    for (const part of inst.parts) {
      useStore.getState().regenerateConfiguratorPart(instanceId, part.id)
    }

    inst = useStore.getState().configuratorInstances.find((x) => x.id === instanceId)!
    for (const part of inst.parts) {
      expect(part.params.boxWidthMm).toBe(500)
      expect(part.params.boxLengthMm).toBe(400)
      expect(part.params.boxHeightMm).toBe(300)
      const piece = useStore.getState().workspace.pieces.find((p) => p.id === part.pieceId)!
      expect(piece.cutLine.length).toBeGreaterThan(12)
    }
  })
})

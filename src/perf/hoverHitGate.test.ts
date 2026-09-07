import { describe, expect, it } from 'vitest'
import { hoverHitAllowed, hoverHitKindsAllowed, type HoverHitContext } from './hoverHitGate'

function ctx(over: Partial<HoverHitContext> = {}): HoverHitContext {
  return {
    tool: 'select',
    contourEditEnabled: true,
    nahtzuordnungMode: 'idle',
    edgeSeamPickingActive: false,
    horizontalLevelPickingActive: false,
    pieceSymmetryState: null,
    showPivotRotationUi: false,
    performanceMode: false,
    ...over,
  }
}

describe('hoverHitKindsAllowed', () => {
  it('limits to seamAssignment + piece in nahtzuordnung modes', () => {
    for (const mode of ['first', 'second', 'internal'] as const) {
      const kinds = hoverHitKindsAllowed(ctx({ nahtzuordnungMode: mode }))
      expect([...kinds].sort()).toEqual(['piece', 'seamAssignment'])
    }
  })

  it('limits to seamAssignment + piece when edge/level picking', () => {
    expect([...hoverHitKindsAllowed(ctx({ edgeSeamPickingActive: true }))].sort()).toEqual([
      'piece',
      'seamAssignment',
    ])
    expect([...hoverHitKindsAllowed(ctx({ horizontalLevelPickingActive: true }))].sort()).toEqual([
      'piece',
      'seamAssignment',
    ])
  })

  it('allows symmetry + piece when symmetry state active', () => {
    const kinds = hoverHitKindsAllowed(ctx({ pieceSymmetryState: { phase: 'choose' } }))
    expect([...kinds].sort()).toEqual(['piece', 'symmetry'])
  })

  it('allows notch + piece for notch tool', () => {
    expect([...hoverHitKindsAllowed(ctx({ tool: 'notch' }))].sort()).toEqual(['notch', 'piece'])
  })

  it('allows vertex + curveMid + piece for point/kante with contour edit', () => {
    expect([...hoverHitKindsAllowed(ctx({ tool: 'point' }))].sort()).toEqual([
      'curveMid',
      'piece',
      'vertex',
    ])
    expect([...hoverHitKindsAllowed(ctx({ tool: 'kante' }))].sort()).toEqual([
      'curveMid',
      'piece',
      'vertex',
    ])
  })

  it('select + contourEdit includes edit hits', () => {
    const kinds = hoverHitKindsAllowed(ctx({ tool: 'select', contourEditEnabled: true, showPivotRotationUi: true }))
    expect(kinds.has('piece')).toBe(true)
    expect(kinds.has('vertex')).toBe(true)
    expect(kinds.has('curveMid')).toBe(true)
    expect(kinds.has('notch')).toBe(true)
    expect(kinds.has('internalLine')).toBe(true)
    expect(kinds.has('internalCircle')).toBe(true)
    expect(kinds.has('pivotRotation')).toBe(true)
    expect(kinds.has('grain')).toBe(true)
  })

  it('select without contourEdit is piece + optional pivot + grain', () => {
    const kinds = hoverHitKindsAllowed(
      ctx({ tool: 'select', contourEditEnabled: false, showPivotRotationUi: true }),
    )
    expect([...kinds].sort()).toEqual(['grain', 'piece', 'pivotRotation'])
  })

  it('select + performanceMode keeps only piece (+ notch if contourEdit)', () => {
    expect([...hoverHitKindsAllowed(ctx({ performanceMode: true, contourEditEnabled: true }))].sort()).toEqual([
      'notch',
      'piece',
    ])
    expect([...hoverHitKindsAllowed(ctx({ performanceMode: true, contourEditEnabled: false }))].sort()).toEqual([
      'piece',
    ])
  })

  it('drops profile in performanceMode', () => {
    const kinds = hoverHitKindsAllowed(ctx({ tool: 'profil', performanceMode: true }))
    expect(kinds.has('profile')).toBe(false)
    expect(kinds.has('piece')).toBe(true)
  })

  it('keeps image for digitize even in performanceMode', () => {
    const kinds = hoverHitKindsAllowed(ctx({ tool: 'digitize', performanceMode: true }))
    expect(kinds.has('image')).toBe(true)
    expect(kinds.has('piece')).toBe(true)
  })

  it('default unknown tool: piece + notch + vertex if contourEdit', () => {
    expect([...hoverHitKindsAllowed(ctx({ tool: 'rectangle' }))].sort()).toEqual([
      'notch',
      'piece',
      'vertex',
    ])
  })
})

describe('hoverHitAllowed', () => {
  it('checks membership', () => {
    const kinds = hoverHitKindsAllowed(ctx({ tool: 'notch' }))
    expect(hoverHitAllowed(kinds, 'notch')).toBe(true)
    expect(hoverHitAllowed(kinds, 'vertex')).toBe(false)
  })
})

export type HoverHitKind =
  | 'piece'
  | 'vertex'
  | 'curveMid'
  | 'notch'
  | 'seamAssignment'
  | 'profile'
  | 'internalLine'
  | 'internalCircle'
  | 'pivotRotation'
  | 'symmetry'
  | 'image'
  | 'grain'

export type HoverHitContext = {
  tool: string
  contourEditEnabled: boolean
  nahtzuordnungMode: string
  edgeSeamPickingActive: boolean
  horizontalLevelPickingActive: boolean
  pieceSymmetryState: unknown | null
  showPivotRotationUi: boolean
  performanceMode: boolean
}

function dropHeavyKinds(kinds: Set<HoverHitKind>, ctx: HoverHitContext): Set<HoverHitKind> {
  if (!ctx.performanceMode) return kinds
  kinds.delete('profile')
  if (ctx.tool !== 'digitize') kinds.delete('image')
  return kinds
}

/** Returns which hit kinds to run this frame. Empty set = skip all hover hits. */
export function hoverHitKindsAllowed(ctx: HoverHitContext): Set<HoverHitKind> {
  const kinds = new Set<HoverHitKind>()

  if (
    ctx.nahtzuordnungMode === 'first' ||
    ctx.nahtzuordnungMode === 'second' ||
    ctx.nahtzuordnungMode === 'internal'
  ) {
    kinds.add('seamAssignment')
    kinds.add('piece')
    return kinds
  }

  if (ctx.edgeSeamPickingActive || ctx.horizontalLevelPickingActive) {
    kinds.add('seamAssignment')
    kinds.add('piece')
    return kinds
  }

  if (ctx.pieceSymmetryState != null) {
    kinds.add('symmetry')
    kinds.add('piece')
    return kinds
  }

  if (ctx.tool === 'notch') {
    kinds.add('notch')
    kinds.add('piece')
    return dropHeavyKinds(kinds, ctx)
  }

  if ((ctx.tool === 'point' || ctx.tool === 'kante') && ctx.contourEditEnabled) {
    kinds.add('vertex')
    kinds.add('curveMid')
    kinds.add('piece')
    return dropHeavyKinds(kinds, ctx)
  }

  if (ctx.tool === 'digitize') {
    kinds.add('image')
    kinds.add('piece')
    return kinds
  }

  if (ctx.tool === 'profil') {
    kinds.add('profile')
    kinds.add('piece')
    return dropHeavyKinds(kinds, ctx)
  }

  if (ctx.tool === 'select') {
    if (ctx.performanceMode) {
      kinds.add('piece')
      if (ctx.contourEditEnabled) kinds.add('notch')
      return kinds
    }
    kinds.add('piece')
    if (ctx.contourEditEnabled) {
      kinds.add('vertex')
      kinds.add('curveMid')
      kinds.add('notch')
      kinds.add('internalLine')
      kinds.add('internalCircle')
      if (ctx.showPivotRotationUi) kinds.add('pivotRotation')
      kinds.add('grain')
    } else {
      if (ctx.showPivotRotationUi) kinds.add('pivotRotation')
      kinds.add('grain')
    }
    return kinds
  }

  // Default for unknown / other tools
  kinds.add('piece')
  kinds.add('notch')
  if (ctx.contourEditEnabled) kinds.add('vertex')
  return dropHeavyKinds(kinds, ctx)
}

export function hoverHitAllowed(kinds: Set<HoverHitKind>, kind: HoverHitKind): boolean {
  return kinds.has(kind)
}

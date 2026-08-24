import { beforeEach, describe, expect, it } from 'vitest'
import type { Curve, PatternPiece, Workspace } from '../types/model'
import { deriveCutLineForPiece } from './deriveCutLineForPiece'
import { buildFacingGeometryFromParent } from './facingPiece'
import {
  evaluatePieceSeamAllowanceInvariants,
  evaluateSeamAllowanceInvariants,
  sampleSeamToCutDistances,
} from './seamAllowanceInvariants'
import { useStore } from '../store/useStore'

function squareSeam(origin: number, size: number): Curve[] {
  const o = origin
  const s = size
  return [
    { type: 'line', start: { x: o, y: o }, end: { x: o + s, y: o } },
    { type: 'line', start: { x: o + s, y: o }, end: { x: o + s, y: o + s } },
    { type: 'line', start: { x: o + s, y: o + s }, end: { x: o, y: o + s } },
    { type: 'line', start: { x: o, y: o + s }, end: { x: o, y: o } },
  ]
}

function pieceFromSeam(id: string, seam: Curve[], sa: number): PatternPiece {
  const draft: PatternPiece = {
    id,
    number: '001',
    name: id,
    cutLine: [],
    seamLine: seam,
    seamAllowanceMm: sa,
    notches: [],
    drills: [],
    grainLine: { start: { x: 50, y: 20 }, end: { x: 50, y: 80 } },
    internalLines: [],
    internalCircles: [],
    layer: 'CUT',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    softVertices: [],
    fillInterior: true,
    material: '',
    bomQuantity: 1,
  }
  const derived = deriveCutLineForPiece(draft, seam, sa)
  draft.cutLine = derived.ok ? derived.cutLine : [...seam]
  return draft
}

describe('seamAllowanceInvariants (Gold / NZ-Härte Phase 0)', () => {
  it('Rechteck: deriveCut hält Median-Abstand ≈ SA', () => {
    const seam = squareSeam(10, 100)
    const p = pieceFromSeam('sq', seam, 10)
    const report = evaluateSeamAllowanceInvariants(p.seamLine, p.cutLine, 10)
    expect(report.ok, report.reasons.join('; ')).toBe(true)
    expect(report.medianSampleDistMm).toBeGreaterThan(8)
    expect(report.medianSampleDistMm).toBeLessThan(13)
  })

  it('Kurve (Bézier-Kante): Cut umschließt Seam und hält NZ-Band', () => {
    const seam: Curve[] = [
      { type: 'line', start: { x: 10, y: 10 }, end: { x: 90, y: 10 } },
      { type: 'line', start: { x: 90, y: 10 }, end: { x: 90, y: 90 } },
      { type: 'line', start: { x: 90, y: 90 }, end: { x: 10, y: 90 } },
      {
        type: 'bezier',
        start: { x: 10, y: 90 },
        end: { x: 10, y: 10 },
        cp1: { x: -40, y: 70 },
        cp2: { x: -40, y: 30 },
      },
    ]
    const p = pieceFromSeam('bez', seam, 10)
    const report = evaluatePieceSeamAllowanceInvariants(p)
    expect(report).not.toBeNull()
    expect(report!.ok, report!.reasons.join('; ')).toBe(true)
  })

  it('Kaschierung aus Mutter: Invarianten nach buildFacingGeometryFromParent', () => {
    const parent = pieceFromSeam('parent', squareSeam(10, 100), 10)
    const facing = buildFacingGeometryFromParent(parent)
    const report = evaluateSeamAllowanceInvariants(facing.seamLine, facing.cutLine, 10, {
      // Chamfer darf lokal kürzen; Median bleibt nahe SA
      minMedianRatio: 0.65,
      minSampleFloorMm: 2,
    })
    expect(report.ok, report.reasons.join('; ')).toBe(true)
    const dists = sampleSeamToCutDistances(facing.seamLine, facing.cutLine)
    expect(dists.length).toBeGreaterThan(0)
    expect(Math.min(...dists)).toBeGreaterThan(2)
  })

  it('Kaschierung mit Bézier-Mutter hält NZ nach Ableitung', () => {
    const seam: Curve[] = [
      { type: 'line', start: { x: 10, y: 10 }, end: { x: 90, y: 10 } },
      { type: 'line', start: { x: 90, y: 10 }, end: { x: 90, y: 90 } },
      { type: 'line', start: { x: 90, y: 90 }, end: { x: 10, y: 90 } },
      {
        type: 'bezier',
        start: { x: 10, y: 90 },
        end: { x: 10, y: 10 },
        cp1: { x: -35, y: 65 },
        cp2: { x: -35, y: 35 },
      },
    ]
    const parent = pieceFromSeam('parent-bez', seam, 8)
    const facing = buildFacingGeometryFromParent(parent)
    const report = evaluateSeamAllowanceInvariants(facing.seamLine, facing.cutLine, 8, {
      minMedianRatio: 0.6,
      minSampleFloorMm: 1.5,
    })
    expect(report.ok, report.reasons.join('; ')).toBe(true)
  })
})

describe('seamAllowanceInvariants via Store (Flip + Facing)', () => {
  beforeEach(() => {
    const seam = squareSeam(10, 80)
    const draft = pieceFromSeam('parent', seam, 10)
    const workspace: Workspace = {
      id: 'ws-nz-gold',
      name: 'Gold',
      pieces: [draft],
      view: { zoom: 1, panX: 0, panY: 0 },
      seamAssignments: [],
      notes: [],
      profileAssignments: [],
    }
    useStore.setState({
      workspace,
      selectedPieceIds: [],
      toastMessage: null,
      seamAdjustmentDialog: null,
      seamAdjustmentAcknowledged: {},
    })
  })

  it('Mutter nach Flip: NZ-Invarianten bleiben', () => {
    useStore.getState().flipPieceAlongGrain('parent')
    const parent = useStore.getState().workspace.pieces.find((p) => p.id === 'parent')!
    const report = evaluatePieceSeamAllowanceInvariants(parent)
    expect(report).not.toBeNull()
    expect(report!.ok, report!.reasons.join('; ')).toBe(true)
  })

  it('Kaschierung nach Flip der Mutter: NZ-Invarianten bleiben', () => {
    const childId = useStore.getState().createFacingPiece('parent')!
    useStore.getState().flipPieceAlongGrain('parent')
    const child = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    const report = evaluateSeamAllowanceInvariants(child.seamLine, child.cutLine, child.seamAllowanceMm ?? 10, {
      minMedianRatio: 0.65,
      minSampleFloorMm: 2,
    })
    expect(report.ok, report.reasons.join('; ')).toBe(true)
  })

  it('Kaschierung nach Mutter-Vertex-Edit: NZ-Invarianten bleiben', () => {
    const childId = useStore.getState().createFacingPiece('parent')!
    useStore.getState().updateVertex('parent', 0, { x: 5, y: 5 })
    const child = useStore.getState().workspace.pieces.find((p) => p.id === childId)!
    const report = evaluateSeamAllowanceInvariants(child.seamLine, child.cutLine, child.seamAllowanceMm ?? 10, {
      minMedianRatio: 0.6,
      minSampleFloorMm: 1.5,
    })
    expect(report.ok, report.reasons.join('; ')).toBe(true)
  })
})

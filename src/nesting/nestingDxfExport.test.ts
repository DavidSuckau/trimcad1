import { describe, expect, it } from 'vitest'
import { exportNestingPlanToDxf } from './nestingDxfExport'
import type { NestingPartGeometry, NestingPlan } from './nestingTypes'
import type { PatternPiece } from '../types/model'

function boxGeom(): NestingPartGeometry {
  return {
    pieceId: 'p1',
    name: 'Teil',
    areaMm2: 10000,
    polygon0: [
      { x: -50, y: -50 },
      { x: 50, y: -50 },
      { x: 50, y: 50 },
      { x: -50, y: 50 },
    ],
    polygon180: null,
    grain0: { start: { x: 0, y: -40 }, end: { x: 0, y: 40 } },
    grain180: null,
  }
}

describe('exportNestingPlanToDxf', () => {
  it('contains INSUNITS and CUT polylines', () => {
    const plan: NestingPlan = {
      materialKey: 'X',
      rollWidthMm: 1500,
      spacingMm: 4,
      placements: [{ pieceId: 'p1', instanceIndex: 0, x: 10, y: 10, rotationDeg: 0, mirrored: false }],
      usedLengthMm: 200,
      efficiencyPct: 50,
      totalPieceAreaMm2: 10000,
      warnings: [],
    }
    const piece: PatternPiece = {
      id: 'p1',
      number: '1',
      name: 'Teil',
      cutLine: [],
      seamLine: [],
      notches: [],
      drills: [],
      grainLine: null,
      internalLines: [],
      internalCircles: [],
      layer: 'CUT',
      transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    }
    const geo = new Map([['p1', boxGeom()]])
    const dxf = exportNestingPlanToDxf(plan, [piece], geo, 1)
    expect(dxf).toContain('$INSUNITS')
    expect(dxf).toContain('POLYLINE')
    expect(dxf).toContain('CUT')
    expect(dxf).toContain('GRAIN')
  })
})

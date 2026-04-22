import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../store/useStore'
import { deriveCutLineForPiece } from './deriveCutLineForPiece'
import { deriveCutLineFromSeamWithValidation } from './offset'
import { signedAreaCurves } from './curveToPath'
import type { Workspace } from '../types/model'

const square = (size: number) => [
  { type: 'line' as const, start: { x: 0, y: 0 }, end: { x: size, y: 0 } },
  { type: 'line' as const, start: { x: size, y: 0 }, end: { x: size, y: size } },
  { type: 'line' as const, start: { x: size, y: size }, end: { x: 0, y: size } },
  { type: 'line' as const, start: { x: 0, y: size }, end: { x: 0, y: 0 } },
]

describe('deriveCutLineForPiece', () => {
  beforeEach(() => {
    const workspace: Workspace = {
      id: 'ws-dcl',
      name: 'Test',
      pieces: [
        {
          id: 'p1',
          number: '001',
          name: 'Teil',
          cutLine: square(100),
          seamLine: [],
          seamAllowanceMm: null,
          notches: [],
          drills: [],
          grainLine: null,
          internalLines: [],
          internalCircles: [],
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
    }
    useStore.setState({ workspace, selectedPieceIds: ['p1'] })
  })

  it('leitet aus Nahtlinie dieselbe Schnittkontur ab wie im Store (uniforme NZ)', () => {
    useStore.getState().updatePiece('p1', { seamAllowanceMm: 10 })
    const p = useStore.getState().workspace.pieces[0]
    expect(p.seamLine.length).toBeGreaterThanOrEqual(3)
    const r = deriveCutLineForPiece(p, p.seamLine, p.seamAllowanceMm ?? 10)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.cutLine.length).toBe(p.cutLine.length)
    for (let i = 0; i < r.cutLine.length; i++) {
      expect(r.cutLine[i].type).toBe(p.cutLine[i].type)
    }
  })

  it('deriveCutLineFromSeamWithValidation: opt-in Fillet vs. Standard Clipper-Miter', () => {
    const seam = square(50)
    const clipperMiter = deriveCutLineFromSeamWithValidation(seam, 5)
    const tangentFillet = deriveCutLineFromSeamWithValidation(seam, 5, { cutCornerFillet: true })
    expect(clipperMiter.ok && tangentFillet.ok).toBe(true)
    if (!clipperMiter.ok || !tangentFillet.ok) return
    expect(Math.sign(signedAreaCurves(clipperMiter.cutLine))).toBe(Math.sign(signedAreaCurves(tangentFillet.cutLine)))
    expect(Math.abs(signedAreaCurves(tangentFillet.cutLine))).toBeGreaterThan(Math.abs(signedAreaCurves(seam)))
    expect(tangentFillet.cutLine.length).toBeGreaterThan(clipperMiter.cutLine.length)
  })

  it('deriveCutLineForPiece: Standard Clipper-Miter vs. opt-in tangentialer Fillet', () => {
    const seam = square(40)
    const piece = useStore.getState().workspace.pieces[0]
    const sharpDefault = deriveCutLineForPiece({ ...piece, seamAllowanceMm: 6 }, seam, 6)
    const sharpExplicit = deriveCutLineForPiece({ ...piece, seamAllowanceMm: 6 }, seam, 6, {
      cutCornerFillet: false,
    })
    const fillet = deriveCutLineForPiece({ ...piece, seamAllowanceMm: 6 }, seam, 6, { cutCornerFillet: true })
    expect(sharpDefault.ok && sharpExplicit.ok && fillet.ok).toBe(true)
    if (!sharpDefault.ok || !sharpExplicit.ok || !fillet.ok) return
    expect(sharpDefault.cutLine.length).toBe(sharpExplicit.cutLine.length)
    expect(fillet.cutLine.length).toBeGreaterThan(sharpDefault.cutLine.length)
  })
})

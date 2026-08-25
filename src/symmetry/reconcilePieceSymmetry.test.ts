import { describe, expect, it } from 'vitest'
import {
  appendSymmetricMirroredNotches,
  finalizePieceContourEdit,
  findKeepSidePartnerVertex,
  mapContourVertexEditForSymmetry,
  syncMasterCurvesByMirroring,
  symmetryConstraintFromAxis,
} from './reconcilePieceSymmetry'
import { applyPieceSymmetryToPiece } from './applyPieceSymmetryToPiece'
import type { Curve, PatternPiece } from '../types/model'

const square = (size: number): Curve[] => [
  { type: 'line', start: { x: 0, y: 0 }, end: { x: size, y: 0 } },
  { type: 'line', start: { x: size, y: 0 }, end: { x: size, y: size } },
  { type: 'line', start: { x: size, y: size }, end: { x: 0, y: size } },
  { type: 'line', start: { x: 0, y: size }, end: { x: 0, y: 0 } },
]

function basePiece(cutLine: Curve[]): PatternPiece {
  return {
    id: 'p',
    number: '1',
    name: 't',
    cutLine,
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
    softVerticesMaster: [],
  }
}

describe('reconcilePieceSymmetry', () => {
  it('symmetryConstraintFromAxis speichert Achse', () => {
    const sc = symmetryConstraintFromAxis({ x: 0, y: 0 }, { x: 0, y: 100 }, 'left')
    expect(sc.keepSide).toBe('left')
    expect(sc.axisA).toEqual({ x: 0, y: 0 })
  })

  it('mapContourVertexEditForSymmetry spiegelt Bearbeitung auf Vorlagen-Seite', () => {
    const piece = basePiece(square(100))
    const sc = symmetryConstraintFromAxis({ x: 50, y: -10 }, { x: 50, y: 110 }, 'left')
    const withSc = { ...piece, symmetryConstraint: sc }
    const mapped = mapContourVertexEditForSymmetry(withSc, 1, { x: 80, y: 20 })
    expect(mapped.point.x).toBeCloseTo(20, 5)
    expect(mapped.vertexIndex).not.toBe(1)
  })

  it('syncMasterCurvesByMirroring erhält Segmentanzahl', () => {
    const curves = square(100)
    const sc = symmetryConstraintFromAxis({ x: 50, y: -10 }, { x: 50, y: 110 }, 'left')
    const synced = syncMasterCurvesByMirroring(curves, sc.axisA, sc.axisB, sc.keepSide)
    expect(synced.length).toBe(curves.length)
    expect(synced[1].end.x).toBeCloseTo(100, 5)
    expect(synced[3].start.x).toBeCloseTo(0, 5)
  })

  it('finalizePieceContourEdit behält Kurvenstruktur', () => {
    const piece = basePiece(square(100))
    const sc = symmetryConstraintFromAxis({ x: 50, y: -10 }, { x: 50, y: 110 }, 'left')
    const sym = applyPieceSymmetryToPiece(piece, sc.axisA, sc.axisB, sc.keepSide)
    expect(sym.ok).toBe(true)
    if (!sym.ok) return
    const withSc = { ...sym.piece, symmetryConstraint: sc }
    const nBefore = withSc.cutLine.length
    const curves = withSc.cutLine.map((c) =>
      c.type === 'line'
        ? { type: 'line' as const, start: { ...c.start }, end: { ...c.end } }
        : { type: 'bezier' as const, start: { ...c.start }, end: { ...c.end }, cp1: { ...c.cp1 }, cp2: { ...c.cp2 } }
    )
    curves[1] = { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 40 } }
    curves[2] = { ...curves[2], start: { x: 100, y: 40 } } as Curve
    const edited = { ...withSc, cutLine: curves }
    const fin = finalizePieceContourEdit(edited)
    expect(fin.ok).toBe(true)
    if (!fin.ok) return
    expect(fin.piece.cutLine.length).toBe(nBefore)
    expect(fin.piece.symmetryConstraint).toEqual(sc)
  })

  it('appendSymmetricMirroredNotches erzeugt Paar', () => {
    const piece = basePiece(square(100))
    const sc = symmetryConstraintFromAxis({ x: 50, y: -10 }, { x: 50, y: 110 }, 'left')
    const withSc = { ...piece, symmetryConstraint: sc }
    const notch = {
      id: 'n1',
      position: { x: 20, y: 0 },
      angle: 90,
      type: 'single' as const,
      depth: 4,
      width: 6,
    }
    const out = appendSymmetricMirroredNotches(withSc, notch)
    expect(out.length).toBe(2)
    expect(out[1]!.position.x).toBeCloseTo(80, 5)
  })

  it('findKeepSidePartnerVertex findet Gegenstück', () => {
    const curves = square(100)
    const axisA = { x: 50, y: -10 }
    const axisB = { x: 50, y: 110 }
    const partner = findKeepSidePartnerVertex(curves, 1, axisA, axisB, 'left')
    expect(partner).toBe(0)
  })

  it('syncMasterCurvesByMirroring folgt großem keep-Vertex-Zug', () => {
    const curves = square(100)
    const sc = symmetryConstraintFromAxis({ x: 50, y: -10 }, { x: 50, y: 110 }, 'left')
    // keep-Seite: Vertex 0 bei (0,0) → nach (0,40) — Abstand 40 mm > altes Limit 20 mm
    curves[0] = { type: 'line', start: { x: 0, y: 40 }, end: { ...curves[0].end } }
    curves[3] = { type: 'line', start: { ...curves[3].start }, end: { x: 0, y: 40 } }
    const synced = syncMasterCurvesByMirroring(curves, sc.axisA, sc.axisB, sc.keepSide)
    // Spiegel von (0,40) an x=50 ist (100,40)
    let found = false
    for (let i = 0; i < synced.length; i++) {
      const p = i === 0 ? synced[0].start : synced[i].start
      if (Math.hypot(p.x - 100, p.y - 40) < 0.5) found = true
    }
    expect(found).toBe(true)
  })

  it('finalizePieceContourEdit spiegelt großen Vertex-Zug auf die Gegenseite', () => {
    const piece = basePiece(square(100))
    const sc = symmetryConstraintFromAxis({ x: 50, y: -10 }, { x: 50, y: 110 }, 'left')
    const sym = applyPieceSymmetryToPiece(piece, sc.axisA, sc.axisB, sc.keepSide)
    expect(sym.ok).toBe(true)
    if (!sym.ok) return
    const withSc = { ...sym.piece, symmetryConstraint: sc }
    const curves = withSc.cutLine.map((c) =>
      c.type === 'line'
        ? { type: 'line' as const, start: { ...c.start }, end: { ...c.end } }
        : {
            type: 'bezier' as const,
            start: { ...c.start },
            end: { ...c.end },
            cp1: { ...c.cp1 },
            cp2: { ...c.cp2 },
          }
    )
    let keepVi = -1
    let keepPos = { x: 0, y: 0 }
    for (let i = 0; i < curves.length; i++) {
      const p = i === 0 ? curves[0].start : curves[i].start
      if (p.x < 40 && p.y < 40) {
        keepVi = i
        keepPos = { ...p }
        break
      }
    }
    expect(keepVi).toBeGreaterThanOrEqual(0)
    const moved = { x: keepPos.x - 5, y: keepPos.y + 45 }
    if (keepVi === 0) {
      curves[0] = { ...curves[0], start: moved } as Curve
      curves[curves.length - 1] = { ...curves[curves.length - 1], end: moved } as Curve
    } else {
      curves[keepVi - 1] = { ...curves[keepVi - 1], end: moved } as Curve
      curves[keepVi] = { ...curves[keepVi], start: moved } as Curve
    }
    const fin = finalizePieceContourEdit({ ...withSc, cutLine: curves })
    expect(fin.ok).toBe(true)
    if (!fin.ok) return
    const idealMirror = { x: 100 - moved.x, y: moved.y }
    let found = false
    for (let i = 0; i < fin.piece.cutLine.length; i++) {
      const p = i === 0 ? fin.piece.cutLine[0].start : fin.piece.cutLine[i].start
      if (Math.hypot(p.x - idealMirror.x, p.y - idealMirror.y) < 2) found = true
    }
    expect(found).toBe(true)
  })
})

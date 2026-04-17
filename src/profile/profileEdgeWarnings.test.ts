import { describe, expect, it } from 'vitest'
import { formatProfileEdgeGeometryWarnings } from './profileEdgeWarnings'
import type { PatternPiece, ProfileAssignment } from '../types/model'

const squarePiece = (id: string): PatternPiece => ({
  id,
  number: '001',
  name: 'T',
  cutLine: [
    { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
    { type: 'line', start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
    { type: 'line', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
  ],
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
})

describe('formatProfileEdgeGeometryWarnings', () => {
  it('meldet sehr kurze Kante', () => {
    const prev = squarePiece('p1')
    const next: PatternPiece = {
      ...prev,
      cutLine: [
        { type: 'line', start: { x: 0, y: 0 }, end: { x: 2, y: 0 } },
        { type: 'line', start: { x: 2, y: 0 }, end: { x: 100, y: 0 } },
        ...prev.cutLine.slice(2),
      ],
    }
    const pa: ProfileAssignment = {
      id: 'a1',
      pieceId: 'p1',
      edgeIndex: 0,
      profileName: 'X',
      profileKey: 'A',
    }
    const msg = formatProfileEdgeGeometryWarnings(prev, next, [pa], [pa])
    expect(msg).toBeTruthy()
    expect(msg).toContain('kurz')
  })

  it('meldet große relative Längenänderung', () => {
    const prev = squarePiece('p1')
    const next: PatternPiece = {
      ...prev,
      cutLine: [
        { type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
        ...prev.cutLine.slice(1),
      ],
    }
    const pa: ProfileAssignment = {
      id: 'a1',
      pieceId: 'p1',
      edgeIndex: 0,
      profileName: 'X',
      profileKey: 'B',
    }
    const msg = formatProfileEdgeGeometryWarnings(prev, next, [pa], [pa])
    expect(msg).toBeTruthy()
    expect(msg).toMatch(/geändert|%/)
  })
})

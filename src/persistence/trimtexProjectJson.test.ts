import { describe, it, expect } from 'vitest'
import { normalizeWorkspaceForLoad } from './trimtexProjectJson'
import type { Curve, PatternPiece, Workspace } from '../types/model'

const triangleCutLine: Curve[] = [
  { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
  { type: 'line', start: { x: 100, y: 0 }, end: { x: 50, y: 80 } },
  { type: 'line', start: { x: 50, y: 80 }, end: { x: 0, y: 0 } },
]

const minimalPiece: PatternPiece = {
  id: 'p1',
  number: '001',
  name: 'Teil',
  cutLine: triangleCutLine,
  seamLine: [],
  seamAllowanceMm: null,
  notches: [],
  drills: [],
  grainLine: null,
  internalLines: [],
  layer: 'CUT',
  transform: { x: 0, y: 0, rotation: 0, mirrored: false },
}

describe('normalizeWorkspaceForLoad', () => {
  it('liefert leeres notes-Array wenn notes fehlen', () => {
    const w: Workspace = {
      id: 'ws1',
      name: 'A',
      pieces: [minimalPiece],
      view: { zoom: 1, panX: 0, panY: 0 },
      seamAssignments: [],
    }
    const out = normalizeWorkspaceForLoad(w)
    expect(out.notes).toEqual([])
  })

  it('normalisiert Notizen mit pieceId und lokaler position', () => {
    const w: Workspace = {
      id: 'ws1',
      name: 'A',
      pieces: [minimalPiece],
      view: { zoom: 1, panX: 0, panY: 0 },
      seamAssignments: [],
      notes: [
        { id: 'n1', pieceId: 'p1', position: { x: 50, y: 20 }, text: 'Hallo' },
        { id: 'bad', pieceId: 'p1', position: { x: NaN, y: 0 }, text: 'x' },
      ],
    }
    const out = normalizeWorkspaceForLoad(w)
    expect(out.notes).toHaveLength(1)
    expect(out.notes![0]).toEqual({
      id: 'n1',
      pieceId: 'p1',
      position: { x: 50, y: 20 },
      text: 'Hallo',
    })
  })

  it('wandelt alte Welt-Notizen ohne pieceId in Teilkoordinaten um', () => {
    const w = {
      id: 'ws1',
      name: 'A',
      pieces: [minimalPiece],
      view: { zoom: 1, panX: 0, panY: 0 },
      seamAssignments: [],
      /** V1 ohne pieceId (position = Welt-mm) */
      notes: [{ id: 'legacy', position: { x: 50, y: 20 }, text: 'Alt' }],
    } as unknown as Workspace
    const out = normalizeWorkspaceForLoad(w)
    expect(out.notes).toHaveLength(1)
    expect(out.notes![0].pieceId).toBe('p1')
    expect(out.notes![0].position.x).toBeCloseTo(50, 5)
    expect(out.notes![0].position.y).toBeCloseTo(20, 5)
    expect(out.notes![0].text).toBe('Alt')
  })
})

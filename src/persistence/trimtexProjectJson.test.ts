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

  it('normalisiert gültige Workspace-Notizen und verwirft ungültige Einträge', () => {
    const w: Workspace = {
      id: 'ws1',
      name: 'A',
      pieces: [minimalPiece],
      view: { zoom: 1, panX: 0, panY: 0 },
      seamAssignments: [],
      notes: [
        { id: 'n1', position: { x: 10, y: 20 }, text: 'Hallo' },
        { id: 'bad', position: { x: NaN, y: 0 }, text: 'x' },
      ],
    }
    const out = normalizeWorkspaceForLoad(w)
    expect(out.notes).toHaveLength(1)
    expect(out.notes![0]).toEqual({ id: 'n1', position: { x: 10, y: 20 }, text: 'Hallo' })
  })
})

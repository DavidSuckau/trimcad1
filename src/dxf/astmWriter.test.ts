import { describe, it, expect } from 'vitest'
import type { PatternPiece, Workspace } from '../types/model'
import { exportWorkspaceToAstmDxf } from './astmWriter'

function minimalPiece(overrides: Partial<PatternPiece> = {}): PatternPiece {
  return {
    id: 'p1',
    name: 'Test',
    number: '1',
    cutLine: [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 80 } },
      { type: 'line', start: { x: 100, y: 80 }, end: { x: 0, y: 80 } },
      { type: 'line', start: { x: 0, y: 80 }, end: { x: 0, y: 0 } },
    ],
    seamLine: [
      { type: 'line', start: { x: 8, y: 8 }, end: { x: 92, y: 8 } },
      { type: 'line', start: { x: 92, y: 8 }, end: { x: 92, y: 72 } },
      { type: 'line', start: { x: 92, y: 72 }, end: { x: 8, y: 72 } },
      { type: 'line', start: { x: 8, y: 72 }, end: { x: 8, y: 8 } },
    ],
    seamAllowanceMm: 8,
    notches: [
      {
        id: 'n1',
        type: 'v',
        position: { x: 50, y: 0 },
        depth: 5,
        width: 6,
        sNormalized: 0.25,
        angle: 90,
      },
    ],
    drills: [],
    internalLines: [],
    internalCircles: [],
    grainLine: { start: { x: 50, y: 10 }, end: { x: 50, y: 70 } },
    layer: 'CUT',
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
    ...overrides,
  }
}

describe('exportWorkspaceToAstmDxf', () => {
  it('exportiert geschlossene Kontur mit 70=1, Grain auf 7, Kerben ohne Layer 7', () => {
    const workspace: Workspace = {
      id: 'ws-astm',
      name: 'Test',
      pieces: [minimalPiece()],
      view: { zoom: 1, panX: 0, panY: 0 },
      seamAssignments: [],
      notes: [],
    }
    const dxf = exportWorkspaceToAstmDxf(workspace, 1)
    expect(dxf).toContain('AC1009')
    expect(dxf).toMatch(/POLYLINE[\s\S]*?70\r?\n1/)
    expect(dxf).toContain('8\r\n7\r\n')
    expect(dxf).toContain('LINE\r\n8\r\n7\r\n')
    expect(dxf).not.toMatch(/LINE\r\n8\r\n7\r\n[\s\S]*?LINE\r\n8\r\n7\r\n[\s\S]*?LINE\r\n8\r\n7\r\n/)
    expect(dxf).toContain('8\r\n4\r\n')
    expect(dxf).toContain('8\r\n82\r\n')
    expect(dxf).toContain('8\r\n14\r\n')
  })
})

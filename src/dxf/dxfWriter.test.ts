import { describe, expect, it } from 'vitest'
import { exportWorkspaceToDxfR12 } from './dxfWriter'
import type { Curve, Notch, PatternPiece, Workspace } from '../types/model'

function square(size: number): Curve[] {
  return [
    { type: 'line', start: { x: 0, y: 0 }, end: { x: size, y: 0 } },
    { type: 'line', start: { x: size, y: 0 }, end: { x: size, y: size } },
    { type: 'line', start: { x: size, y: size }, end: { x: 0, y: size } },
    { type: 'line', start: { x: 0, y: size }, end: { x: 0, y: 0 } },
  ]
}

function piece(notches: Notch[], extra: Partial<PatternPiece> = {}): PatternPiece {
  return {
    id: 'p1',
    number: '001',
    name: 'Teil',
    cutLine: square(100),
    seamLine: [],
    notches,
    drills: [],
    grainLine: null,
    internalLines: [],
    internalCircles: [],
    layer: 'CUT',
    transform: { x: 10, y: 20, rotation: 0, mirrored: false },
    ...extra,
  }
}

function workspace(p: PatternPiece): Workspace {
  return {
    id: 'ws',
    name: 'Test',
    pieces: [p],
    view: { zoom: 1, panX: 0, panY: 0 },
    seamAssignments: [],
  }
}

describe('exportWorkspaceToDxfR12 notches', () => {
  it('legt jede Kerbe auf den Layer NOTCH', () => {
    const dxf = exportWorkspaceToDxfR12(
      workspace(
        piece(
          [
            {
              id: 'n-cut',
              position: { x: 40, y: 0 },
              angle: 90,
              type: 'single',
              depth: 4,
              width: 6,
            },
            {
              id: 'n-internal',
              position: { x: 10, y: 10 },
              angle: 0,
              type: 'v',
              depth: 5,
              width: 4,
              internalLineIndex: 0,
            },
          ],
          {
            internalLines: [{ type: 'line', start: { x: 0, y: 10 }, end: { x: 80, y: 10 } }],
          },
        ),
      ),
    )
    const notchPolys = dxf.split('0\r\nPOLYLINE\r\n8\r\n').slice(1).filter((block) => block.startsWith('NOTCH'))
    expect(notchPolys).toHaveLength(2)
    expect(dxf).toContain('8\r\nCUT\r\n')
    expect(notchPolys.some((block) => block.includes('10\r\n50\r\n') && block.includes('20\r\n20\r\n'))).toBe(true)
  })
})

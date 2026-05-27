import { describe, it, expect } from 'vitest'
import {
  extractConnectedClosedRingsFromLineCurves,
  stripDuplicateContourInternalLines,
  isPolylineDuplicateOfAnyContour,
} from './dxfImportInternalFilter'
import { dxfVerticesToLineCurves } from './dxfCollectCutDrafts'

describe('dxfImportInternalFilter', () => {
  it('erkennt geschlossene Ringe in concatenated internal lines', () => {
    const cut = dxfVerticesToLineCurves(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      true,
    )
    const seam = dxfVerticesToLineCurves(
      [
        { x: 1, y: 1 },
        { x: 9, y: 1 },
        { x: 9, y: 9 },
        { x: 1, y: 9 },
      ],
      true,
    )
    const internal = [...cut, ...seam]
    const rings = extractConnectedClosedRingsFromLineCurves(internal)
    expect(rings.length).toBe(2)

    const refs = [
      { verts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], closed: true },
      { verts: [{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 9 }, { x: 1, y: 9 }], closed: true },
    ]
    const filtered = stripDuplicateContourInternalLines(internal, refs)
    expect(filtered.length).toBe(0)
  })

  it('isPolylineDuplicateOfAnyContour erkennt Naht-Ring', () => {
    const refs = [
      {
        verts: [
          { x: 1, y: 1 },
          { x: 9, y: 1 },
          { x: 9, y: 9 },
          { x: 1, y: 9 },
        ],
        closed: true,
      },
    ]
    expect(
      isPolylineDuplicateOfAnyContour(
        [
          { x: 1, y: 1 },
          { x: 9, y: 1 },
          { x: 9, y: 9 },
          { x: 1, y: 9 },
        ],
        true,
        refs,
      ),
    ).toBe(true)
  })
})

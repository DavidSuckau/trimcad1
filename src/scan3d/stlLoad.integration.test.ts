import { describe, expect, it } from 'vitest'
import { loadObjAssets } from './objImport'

function makeBinaryStl(tris: [number, number, number][][]): ArrayBuffer {
  const buf = new ArrayBuffer(84 + tris.length * 50)
  const view = new DataView(buf)
  const enc = new TextEncoder()
  const header = enc.encode('solid binary-looking-header           ')
  new Uint8Array(buf, 0, Math.min(80, header.length)).set(header.subarray(0, 80))
  view.setUint32(80, tris.length, true)
  let o = 84
  for (const t of tris) {
    view.setFloat32(o, 0, true); view.setFloat32(o + 4, 0, true); view.setFloat32(o + 8, 1, true)
    o += 12
    for (const v of t) {
      view.setFloat32(o, v[0], true)
      view.setFloat32(o + 4, v[1], true)
      view.setFloat32(o + 8, v[2], true)
      o += 12
    }
    view.setUint16(o, 0, true)
    o += 2
  }
  return buf
}

describe('STL binary load integration', () => {
  it('lädt binary STL mit solid-Header', async () => {
    const buf = makeBinaryStl([
      [[0, 0, 0], [100, 0, 0], [0, 100, 0]],
      [[100, 0, 0], [100, 100, 0], [0, 100, 0]],
    ])
    const file = new File([buf], 'seat.stl', { type: 'model/stl' })
    const result = await loadObjAssets([file], 'mm')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.triangleCount).toBe(2)
    expect(result.mesh.vertexCount).toBeGreaterThanOrEqual(3)
  })
})

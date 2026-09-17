import { describe, expect, it } from 'vitest'
import {
  meshBoundingRadius,
  parseObjText,
  parseStlText,
  pickPrimaryTextureFile,
  reduceMeshToTriangleBudget,
} from './objImport'
import type { MeshHandle } from './types'

const MINI_OBJ = `
o Cube
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
f 1 2 3
f 1 3 4
`

describe('pickPrimaryTextureFile', () => {
  const obj = new File([''], 'scan.obj', { type: 'text/plain' })

  it('findet Textur mit gleichem Stammnamen (Polycam)', () => {
    const tex = new File([''], 'scan.jpg', { type: 'image/jpeg' })
    expect(pickPrimaryTextureFile(obj, [obj, tex], null)?.name).toBe('scan.jpg')
  })

  it('findet einzige Textur im Set', () => {
    const tex = new File([''], 'texture.png', { type: 'image/png' })
    expect(pickPrimaryTextureFile(obj, [obj, tex], null)?.name).toBe('texture.png')
  })

  it('nutzt map_Kd aus MTL', () => {
    const tex = new File([''], 'albedo.jpg', { type: 'image/jpeg' })
    const mtl = 'newmtl m\nmap_Kd albedo.jpg\n'
    expect(pickPrimaryTextureFile(obj, [obj, tex], mtl)?.name).toBe('albedo.jpg')
  })
})

describe('parseObjText', () => {
  it('parst minimales OBJ in mm bei Einheit m', async () => {
    const result = await parseObjText(MINI_OBJ, 'm')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.triangleCount).toBe(2)
    expect(result.mesh.vertexCount).toBe(4)
    const dx = result.mesh.positions[3] - result.mesh.positions[0]
    const dy = result.mesh.positions[4] - result.mesh.positions[1]
    const dz = result.mesh.positions[5] - result.mesh.positions[2]
    expect(Math.sqrt(dx * dx + dy * dy + dz * dz)).toBeCloseTo(1000, 0)
  })

  it('meldet Fehler bei leerem Inhalt', async () => {
    const result = await parseObjText('# empty\n', 'mm')
    expect(result.ok).toBe(false)
  })
})

describe('parseStlText', () => {
  const MINI_STL = `solid test
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 1 0 0
      vertex 0 1 0
    endloop
  endfacet
endsolid test
`

  it('parst minimales STL in mm bei Einheit m', async () => {
    const result = await parseStlText(MINI_STL, 'm')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.triangleCount).toBe(1)
    // 1-Einheiten-Dreieck bei „m“ bleibt Meter (auto-korrigiert nicht unter 5)
    const dx = result.mesh.positions[3] - result.mesh.positions[0]
    const dy = result.mesh.positions[4] - result.mesh.positions[1]
    const dz = result.mesh.positions[5] - result.mesh.positions[2]
    expect(Math.sqrt(dx * dx + dy * dy + dz * dz)).toBeCloseTo(1000, 0)
  })

  it('korrigiert typische mm-STL von Einheit m auf mm', async () => {
    const stl = `solid test
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 100 0 0
      vertex 0 100 0
    endloop
  endfacet
endsolid test
`
    const result = await parseStlText(stl, 'm')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.some((w) => w.includes('Millimeter'))).toBe(true)
    const dx = result.mesh.positions[3] - result.mesh.positions[0]
    expect(Math.abs(dx)).toBeCloseTo(100, 0)
  })
})

describe('meshBoundingRadius', () => {
  it('berechnet Radius nach Zentrierung', async () => {
    const result = await parseObjText(MINI_OBJ, 'mm')
    if (!result.ok) return
    expect(meshBoundingRadius(result.mesh)).toBeGreaterThan(0)
  })
})

describe('reduceMeshToTriangleBudget', () => {
  function denseGridMesh(n: number): MeshHandle {
    // (n+1)² Vertices, 2*n² Dreiecke auf XY-Ebene
    const positions: number[] = []
    for (let y = 0; y <= n; y++) {
      for (let x = 0; x <= n; x++) {
        positions.push(x, y, 0)
      }
    }
    const indices: number[] = []
    const row = n + 1
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const a = y * row + x
        const b = a + 1
        const c = a + row
        const d = c + 1
        indices.push(a, b, d, a, d, c)
      }
    }
    return {
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices),
      vertexCount: positions.length / 3,
    }
  }

  it('lässt kleine Meshes unverändert', async () => {
    const mesh = denseGridMesh(2)
    const out = await reduceMeshToTriangleBudget(mesh, 500_000)
    expect(out.indices.length).toBe(mesh.indices.length)
  })

  it('reduziert dichtes Mesh unter das Budget', async () => {
    const mesh = denseGridMesh(40) // 3200 Dreiecke
    expect(mesh.indices.length / 3).toBe(3200)
    const out = await reduceMeshToTriangleBudget(mesh, 800)
    expect(out.indices.length / 3).toBeLessThanOrEqual(800)
    expect(out.indices.length / 3).toBeGreaterThanOrEqual(3)
    expect(out.vertexCount).toBeGreaterThanOrEqual(3)
  })
})

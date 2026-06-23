import { describe, expect, it } from 'vitest'
import { meshBoundingRadius, parseObjText, pickPrimaryTextureFile } from './objImport'

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

describe('meshBoundingRadius', () => {
  it('berechnet Radius nach Zentrierung', async () => {
    const result = await parseObjText(MINI_OBJ, 'mm')
    if (!result.ok) return
    expect(meshBoundingRadius(result.mesh)).toBeGreaterThan(0)
  })
})

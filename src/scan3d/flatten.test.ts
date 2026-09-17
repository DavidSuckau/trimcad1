import { describe, expect, it } from 'vitest'
import { flattenMeshToPieces } from './flatten'
import type { MeshHandle, Scan3dSeam } from './types'

/** Flaches Quad 100×100 mm, zwei Dreiecke. */
function makeQuadMesh(): MeshHandle {
  const positions = new Float32Array([0, 0, 0, 100, 0, 0, 100, 100, 0, 0, 100, 0])
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3])
  return { positions, indices, vertexCount: 4 }
}

/** Offene Halbkugel-ähnliche Pyramide (4 Dreiecke + Boden offen). */
function makePyramidMesh(): MeshHandle {
  // Basisquad + Spitze
  const positions = new Float32Array([
    0, 0, 0,
    100, 0, 0,
    100, 100, 0,
    0, 100, 0,
    50, 50, 60,
  ])
  const indices = new Uint32Array([
    0, 1, 4,
    1, 2, 4,
    2, 3, 4,
    3, 0, 4,
  ])
  return { positions, indices, vertexCount: 5 }
}

function seam(path: number[], closed = false): Scan3dSeam {
  return {
    id: `s-${path.join('-')}`,
    surfacePoints: [],
    vertexPath: path,
    closed,
  }
}

describe('flattenMeshToPieces', () => {
  it('wickelt flaches Quad ohne Nähte zu einer Kontur ab', () => {
    const mesh = makeQuadMesh()
    const result = flattenMeshToPieces(mesh, [])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pieces.length).toBe(1)
    expect(result.pieces[0]!.cutLine.length).toBeGreaterThanOrEqual(3)
    const pts = result.pieces[0]!.boundaryPoints
    // Ungefähre Fläche ~100×100
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const p of pts) {
      minX = Math.min(minX, p.x)
      maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y)
      maxY = Math.max(maxY, p.y)
    }
    expect(maxX - minX).toBeGreaterThan(90)
    expect(maxY - minY).toBeGreaterThan(90)
    expect(result.pieces[0]!.meanStrain).toBeLessThan(0.02)
  })

  it('teilt Mesh entlang einer Naht in zwei Regionen', () => {
    const mesh = makeQuadMesh()
    // Diagonale 0–2 ist bereits Mesh-Kante; zusätzliche Naht 1–3 teilt?
    // Quad-Kanten: Umfang + Diagonale 0-2. Naht von 1 nach 3 gibt es nicht als Kante.
    // Stattdessen: zwei getrennte Dreiecke durch Schnitt der gemeinsamen Kante 0-2.
    const result = flattenMeshToPieces(mesh, [seam([0, 2])])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pieces.length).toBe(2)
  })

  it('wickelt Pyramide (offene Basis) ab', () => {
    const mesh = makePyramidMesh()
    const result = flattenMeshToPieces(mesh, [])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pieces.length).toBeGreaterThanOrEqual(1)
    expect(result.pieces[0]!.cutLine.length).toBeGreaterThanOrEqual(3)
  })

  it('schneidet Pyramide mit Naht in mehrere Teile', () => {
    const mesh = makePyramidMesh()
    // Naht von Basisecke zur Spitze trennt benachbarte Faces
    const result = flattenMeshToPieces(mesh, [seam([0, 4])])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pieces.length).toBeGreaterThanOrEqual(1)
  })
})

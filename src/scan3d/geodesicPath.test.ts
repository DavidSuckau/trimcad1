import { describe, expect, it } from 'vitest'
import { buildMeshGraph } from './meshGraph'
import { mergeVertexPaths, shortestPath, simplifySurfacePolyline, simplifyVertexPath } from './geodesicPath'

/** 3×3-Gitter in der XY-Ebene, Einheiten mm. */
function makeGridMesh(rows: number, cols: number, spacing: number) {
  const positions: number[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      positions.push(c * spacing, r * spacing, 0)
    }
  }
  const indices: number[] = []
  const idx = (r: number, c: number) => r * cols + c
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = idx(r, c)
      const b = idx(r, c + 1)
      const d = idx(r + 1, c)
      const e = idx(r + 1, c + 1)
      indices.push(a, b, e, a, e, d)
    }
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    vertexCount: rows * cols,
  }
}

describe('shortestPath', () => {
  it('findet kürzesten Weg entlang des Gitters', () => {
    const mesh = makeGridMesh(3, 3, 10)
    const graph = buildMeshGraph(mesh)
    const path = shortestPath(graph, 0, 8)
    expect(path[0]).toBe(0)
    expect(path[path.length - 1]).toBe(8)
    // Über Mesh-Diagonalen kann der Pfad kürzer sein als rein orthogonal
    expect(path.length).toBeGreaterThanOrEqual(3)
  })

  it('liefert Einzelpunkt bei gleichem Start und Ziel', () => {
    const mesh = makeGridMesh(2, 2, 10)
    const graph = buildMeshGraph(mesh)
    expect(shortestPath(graph, 1, 1)).toEqual([1])
  })
})

describe('mergeVertexPaths', () => {
  it('vermeidet doppelte Ecke an der Verbindung', () => {
    expect(mergeVertexPaths([0, 1, 2], [2, 3, 4])).toEqual([0, 1, 2, 3, 4])
  })
})

describe('simplifySurfacePolyline', () => {
  it('reduziert Punkte auf einer geraden Linie', () => {
    const flat = [0, 0, 0, 10, 0, 0, 20, 0, 0, 30, 0, 0]
    const out = simplifySurfacePolyline(flat, 2)
    expect(out.length / 3).toBeLessThanOrEqual(3)
    expect(out[0]).toBe(0)
    expect(out[out.length - 3]).toBe(30)
  })
})

describe('simplifyVertexPath', () => {
  it('reduziert kollineare Zwischenpunkte', () => {
    const mesh = makeGridMesh(2, 4, 10)
    const path = [0, 1, 2, 3]
    const simplified = simplifyVertexPath(mesh, path, 2)
    expect(simplified[0]).toBe(0)
    expect(simplified[simplified.length - 1]).toBe(3)
    expect(simplified.length).toBeLessThanOrEqual(path.length)
  })
})

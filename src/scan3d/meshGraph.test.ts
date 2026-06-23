import { describe, expect, it } from 'vitest'
import { buildMeshGraph, getNeighbors } from './meshGraph'

/** Einfaches Quad aus zwei Dreiecken (Einheiten in mm). */
function makeQuadMesh() {
  const positions = new Float32Array([
    0, 0, 0,
    100, 0, 0,
    100, 100, 0,
    0, 100, 0,
  ])
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3])
  return { positions, indices, vertexCount: 4 }
}

describe('buildMeshGraph', () => {
  it('erzeugt Nachbarn entlang des Quad-Umfangs', () => {
    const mesh = makeQuadMesh()
    const graph = buildMeshGraph(mesh)

    expect(graph.vertexCount).toBe(4)
    // Zwei Dreiecke mit Diagonale 0–2: Ecke 0 verbindet 1, 2 und 3
    expect(getNeighbors(graph, 0).sort()).toEqual([1, 2, 3])
    expect(getNeighbors(graph, 1).sort()).toEqual([0, 2])
    expect(getNeighbors(graph, 2).sort()).toEqual([0, 1, 3])
    expect(getNeighbors(graph, 3).sort()).toEqual([0, 2])
  })
})

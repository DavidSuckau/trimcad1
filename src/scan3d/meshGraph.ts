import type { MeshGraph, MeshHandle } from './types'

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

function vertexPosition(mesh: MeshHandle, index: number): [number, number, number] {
  const i = index * 3
  return [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]
}

function edgeLength(mesh: MeshHandle, a: number, b: number): number {
  const [ax, ay, az] = vertexPosition(mesh, a)
  const [bx, by, bz] = vertexPosition(mesh, b)
  const dx = bx - ax
  const dy = by - ay
  const dz = bz - az
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

export function buildMeshGraph(mesh: MeshHandle): MeshGraph {
  const vertexCount = mesh.vertexCount
  const neighbors: number[][] = Array.from({ length: vertexCount }, () => [])
  const edgeWeights = new Map<string, number>()

  const addEdge = (a: number, b: number) => {
    if (a === b || a < 0 || b < 0 || a >= vertexCount || b >= vertexCount) return
    const key = edgeKey(a, b)
    if (edgeWeights.has(key)) return
    const w = edgeLength(mesh, a, b)
    edgeWeights.set(key, w)
    neighbors[a].push(b)
    neighbors[b].push(a)
  }

  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i]
    const b = mesh.indices[i + 1]
    const c = mesh.indices[i + 2]
    addEdge(a, b)
    addEdge(b, c)
    addEdge(c, a)
  }

  return { vertexCount, neighbors, edgeWeights }
}

export function getEdgeWeight(graph: MeshGraph, a: number, b: number): number {
  return graph.edgeWeights.get(edgeKey(a, b)) ?? Infinity
}

export function getNeighbors(graph: MeshGraph, vertexIndex: number): number[] {
  return graph.neighbors[vertexIndex] ?? []
}

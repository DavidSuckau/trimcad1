import * as THREE from 'three'
import { getEdgeWeight, getNeighbors } from './meshGraph'
import type { MeshGraph, MeshHandle } from './types'

function vertexPos(mesh: MeshHandle, vi: number): [number, number, number] {
  return [mesh.positions[vi * 3], mesh.positions[vi * 3 + 1], mesh.positions[vi * 3 + 2]]
}

function distSq3(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const dx = ax - bx
  const dy = ay - by
  const dz = az - bz
  return dx * dx + dy * dy + dz * dz
}

function bfsWithinHops(graph: MeshGraph, start: number, maxHops: number): Set<number> {
  const seen = new Set<number>([start])
  let frontier = [start]
  for (let hop = 0; hop < maxHops; hop++) {
    const next: number[] = []
    for (const v of frontier) {
      for (const nb of getNeighbors(graph, v)) {
        if (!seen.has(nb)) {
          seen.add(nb)
          next.push(nb)
        }
      }
    }
    frontier = next
  }
  return seen
}

type MinHeapItem = { vertex: number; dist: number }

class MinHeap {
  private items: MinHeapItem[] = []

  get size(): number {
    return this.items.length
  }

  push(vertex: number, dist: number): void {
    this.items.push({ vertex, dist })
    this.bubbleUp(this.items.length - 1)
  }

  pop(): MinHeapItem | undefined {
    if (this.items.length === 0) return undefined
    const top = this.items[0]
    const last = this.items.pop()!
    if (this.items.length > 0) {
      this.items[0] = last
      this.bubbleDown(0)
    }
    return top
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2)
      if (this.items[parent].dist <= this.items[i].dist) break
      ;[this.items[parent], this.items[i]] = [this.items[i], this.items[parent]]
      i = parent
    }
  }

  private bubbleDown(i: number): void {
    const n = this.items.length
    while (true) {
      let smallest = i
      const left = 2 * i + 1
      const right = 2 * i + 2
      if (left < n && this.items[left].dist < this.items[smallest].dist) smallest = left
      if (right < n && this.items[right].dist < this.items[smallest].dist) smallest = right
      if (smallest === i) break
      ;[this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]]
      i = smallest
    }
  }
}

/** Dijkstra auf dem Mesh-Kantengraph; liefert Vertex-Pfad inkl. Start und Ende. */
export function shortestPath(graph: MeshGraph, fromVertex: number, toVertex: number): number[] {
  if (fromVertex === toVertex) return [fromVertex]
  if (fromVertex < 0 || toVertex < 0 || fromVertex >= graph.vertexCount || toVertex >= graph.vertexCount) {
    return [fromVertex]
  }

  const dist = new Float64Array(graph.vertexCount).fill(Infinity)
  const prev = new Int32Array(graph.vertexCount).fill(-1)
  const visited = new Uint8Array(graph.vertexCount)

  dist[fromVertex] = 0
  const heap = new MinHeap()
  heap.push(fromVertex, 0)

  while (heap.size > 0) {
    const current = heap.pop()!
    if (visited[current.vertex]) continue
    visited[current.vertex] = 1
    if (current.vertex === toVertex) break

    for (const nb of getNeighbors(graph, current.vertex)) {
      if (visited[nb]) continue
      const alt = current.dist + getEdgeWeight(graph, current.vertex, nb)
      if (alt < dist[nb]) {
        dist[nb] = alt
        prev[nb] = current.vertex
        heap.push(nb, alt)
      }
    }
  }

  if (!Number.isFinite(dist[toVertex])) return [fromVertex, toVertex]

  const path: number[] = []
  let cur = toVertex
  while (cur !== -1) {
    path.push(cur)
    cur = prev[cur]
  }
  path.reverse()
  return path
}

/** Nächster Vertex eines getroffenen Dreiecks (baryzentrische Nähe). */
export function nearestVertexOnFace(
  mesh: MeshHandle,
  faceIndex: number,
  hitX: number,
  hitY: number,
  hitZ: number,
): number {
  const i0 = mesh.indices[faceIndex * 3]
  const i1 = mesh.indices[faceIndex * 3 + 1]
  const i2 = mesh.indices[faceIndex * 3 + 2]
  const verts = [i0, i1, i2]

  let best = i0
  let bestDist = Infinity
  for (const vi of verts) {
    const px = mesh.positions[vi * 3]
    const py = mesh.positions[vi * 3 + 1]
    const pz = mesh.positions[vi * 3 + 2]
    const dx = px - hitX
    const dy = py - hitY
    const dz = pz - hitZ
    const d = dx * dx + dy * dy + dz * dz
    if (d < bestDist) {
      bestDist = d
      best = vi
    }
  }
  return best
}

/** Nächster Mesh-Vertex zu einem 3D-Punkt (für Raycast auf texturiertem Modell). */
export function nearestVertexByPosition(mesh: MeshHandle, hitX: number, hitY: number, hitZ: number): number {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < mesh.vertexCount; i++) {
    const dx = mesh.positions[i * 3] - hitX
    const dy = mesh.positions[i * 3 + 1] - hitY
    const dz = mesh.positions[i * 3 + 2] - hitZ
    const d = dx * dx + dy * dy + dz * dz
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

/**
 * Stabiler Vertex für gezogene Nähte: bevorzugt Vertices nahe dem Trefferpunkt,
 * die topologisch zum letzten Vertex gehören (verhindert Sprünge).
 */
export function nearestVertexForStroke(
  mesh: MeshHandle,
  graph: MeshGraph,
  hitX: number,
  hitY: number,
  hitZ: number,
  lastVertex: number | null,
  localRadiusMm: number,
): number {
  const r2 = localRadiusMm * localRadiusMm
  const candidates: { vi: number; d2: number }[] = []

  for (let i = 0; i < mesh.vertexCount; i++) {
    const [px, py, pz] = vertexPos(mesh, i)
    const d2 = distSq3(px, py, pz, hitX, hitY, hitZ)
    if (d2 <= r2) candidates.push({ vi: i, d2 })
  }

  if (candidates.length === 0) return nearestVertexByPosition(mesh, hitX, hitY, hitZ)

  candidates.sort((a, b) => a.d2 - b.d2)

  if (lastVertex === null) return candidates[0].vi

  const nearLast = bfsWithinHops(graph, lastVertex, 14)
  const connected = candidates.filter((c) => nearLast.has(c.vi))
  if (connected.length > 0) return connected[0].vi

  return candidates[0].vi
}

/** Entfernt fast kollineare Zwischenpunkte entlang des gespeicherten Pfads (RDP in 3D). */
export function simplifyVertexPath(mesh: MeshHandle, path: number[], epsilonMm: number): number[] {
  if (path.length <= 2) return [...path]

  const pts = path.map((vi) => {
    const [x, y, z] = vertexPos(mesh, vi)
    return { vi, x, y, z }
  })

  const eps2 = epsilonMm * epsilonMm

  const rdp = (start: number, end: number, out: number[]) => {
    if (end <= start + 1) {
      if (out.length === 0 || out[out.length - 1] !== pts[start].vi) out.push(pts[start].vi)
      out.push(pts[end].vi)
      return
    }
    const ax = pts[start].x
    const ay = pts[start].y
    const az = pts[start].z
    const bx = pts[end].x
    const by = pts[end].y
    const bz = pts[end].z
    const abx = bx - ax
    const aby = by - ay
    const abz = bz - az
    const abLen2 = abx * abx + aby * aby + abz * abz

    let maxD2 = 0
    let maxIdx = start
    for (let i = start + 1; i < end; i++) {
      const px = pts[i].x
      const py = pts[i].y
      const pz = pts[i].z
      let d2: number
      if (abLen2 < 1e-12) {
        d2 = distSq3(px, py, pz, ax, ay, az)
      } else {
        const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / abLen2))
        const qx = ax + t * abx
        const qy = ay + t * aby
        const qz = az + t * abz
        d2 = distSq3(px, py, pz, qx, qy, qz)
      }
      if (d2 > maxD2) {
        maxD2 = d2
        maxIdx = i
      }
    }

    if (maxD2 > eps2) {
      rdp(start, maxIdx, out)
      if (out[out.length - 1] !== pts[maxIdx].vi) out.push(pts[maxIdx].vi)
      rdp(maxIdx, end, out)
    } else {
      if (out.length === 0 || out[out.length - 1] !== pts[start].vi) out.push(pts[start].vi)
      out.push(pts[end].vi)
    }
  }

  const simplified: number[] = []
  rdp(0, pts.length - 1, simplified)

  const unique: number[] = []
  for (const vi of simplified) {
    if (unique.length === 0 || unique[unique.length - 1] !== vi) unique.push(vi)
  }
  return unique.length >= 2 ? unique : [...path]
}

/** Glättete Anzeige-Punkte entlang des Vertex-Pfads (Catmull-Rom). */
export function smoothPathPoints(mesh: MeshHandle, path: number[], segmentsPerSpan = 4): [number, number, number][] {
  if (path.length < 2) {
    return path.map((vi) => vertexPos(mesh, vi))
  }
  if (path.length === 2) {
    const out: [number, number, number][] = []
    const a = vertexPos(mesh, path[0])
    const b = vertexPos(mesh, path[1])
    for (let i = 0; i <= segmentsPerSpan; i++) {
      const t = i / segmentsPerSpan
      out.push([
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ])
    }
    return out
  }

  const ctrl = path.map((vi) => new THREE.Vector3(...vertexPos(mesh, vi)))
  const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal', 0.35)
  const samples = Math.max(path.length * segmentsPerSpan, 12)
  return curve.getPoints(samples).map((p) => [p.x, p.y, p.z] as [number, number, number])
}

type SurfacePt = { x: number; y: number; z: number }

function surfacePtsFromFlat(flat: number[]): SurfacePt[] {
  const out: SurfacePt[] = []
  for (let i = 0; i + 2 < flat.length; i += 3) {
    out.push({ x: flat[i], y: flat[i + 1], z: flat[i + 2] })
  }
  return out
}

function flatFromSurfacePts(pts: SurfacePt[]): number[] {
  const out: number[] = []
  for (const p of pts) out.push(p.x, p.y, p.z)
  return out
}

/** RDP-Glättung auf Oberflächenpunkten (flaches xyz-Array). */
export function simplifySurfacePolyline(flat: number[], epsilonMm: number): number[] {
  const pts = surfacePtsFromFlat(flat)
  if (pts.length <= 2) return [...flat]

  const eps2 = epsilonMm * epsilonMm

  const rdp = (start: number, end: number, out: SurfacePt[]) => {
    if (end <= start + 1) {
      if (out.length === 0) out.push(pts[start])
      out.push(pts[end])
      return
    }
    const a = pts[start]
    const b = pts[end]
    const abx = b.x - a.x
    const aby = b.y - a.y
    const abz = b.z - a.z
    const abLen2 = abx * abx + aby * aby + abz * abz

    let maxD2 = 0
    let maxIdx = start
    for (let i = start + 1; i < end; i++) {
      const p = pts[i]
      let d2: number
      if (abLen2 < 1e-12) {
        d2 = distSq3(p.x, p.y, p.z, a.x, a.y, a.z)
      } else {
        const t = Math.max(
          0,
          Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / abLen2),
        )
        d2 = distSq3(p.x, p.y, p.z, a.x + t * abx, a.y + t * aby, a.z + t * abz)
      }
      if (d2 > maxD2) {
        maxD2 = d2
        maxIdx = i
      }
    }

    if (maxD2 > eps2) {
      rdp(start, maxIdx, out)
      const last = out[out.length - 1]
      const mid = pts[maxIdx]
      if (!last || last.x !== mid.x || last.y !== mid.y || last.z !== mid.z) out.push(mid)
      rdp(maxIdx, end, out)
    } else {
      if (out.length === 0) out.push(pts[start])
      out.push(pts[end])
    }
  }

  const simplified: SurfacePt[] = []
  rdp(0, pts.length - 1, simplified)
  return flatFromSurfacePts(simplified)
}

/** Glatte 3D-Kurve durch Oberflächenpunkte (liegt auf dem Modell, keine Mesh-Kanten). */
export function smoothSurfacePolyline(flat: number[], segmentsPerSpan = 8): THREE.Vector3[] {
  const ctrl = surfacePtsFromFlat(flat).map((p) => new THREE.Vector3(p.x, p.y, p.z))
  if (ctrl.length < 2) return ctrl
  if (ctrl.length === 2) {
    const out: THREE.Vector3[] = []
    for (let i = 0; i <= segmentsPerSpan; i++) {
      const t = i / segmentsPerSpan
      out.push(new THREE.Vector3().lerpVectors(ctrl[0], ctrl[1], t))
    }
    return out
  }
  const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal', 0.5)
  const samples = Math.max(ctrl.length * segmentsPerSpan, 24)
  return curve.getPoints(samples)
}

/** Topologischen Vertex-Pfad aus wenigen Wegpunkten ableiten (für späteres Schneiden). */
export function rebuildVertexPathFromSurface(
  mesh: MeshHandle,
  graph: MeshGraph,
  flat: number[],
  snapRadiusMm: number,
): number[] {
  const pts = surfacePtsFromFlat(flat)
  if (pts.length === 0) return []
  if (pts.length === 1) {
    const p = pts[0]
    return [nearestVertexForStroke(mesh, graph, p.x, p.y, p.z, null, snapRadiusMm)]
  }

  const waypoints: number[] = []
  for (const p of pts) {
    const last = waypoints.length > 0 ? waypoints[waypoints.length - 1] : null
    const vi = nearestVertexForStroke(mesh, graph, p.x, p.y, p.z, last, snapRadiusMm)
    if (waypoints.length === 0 || waypoints[waypoints.length - 1] !== vi) waypoints.push(vi)
  }
  if (waypoints.length === 0) return []

  let path = [waypoints[0]]
  for (let i = 1; i < waypoints.length; i++) {
    path = mergeVertexPaths(path, shortestPath(graph, path[path.length - 1], waypoints[i]))
  }
  return path
}

/** Zwei Pfade an einer gemeinsamen Ecke zusammenführen (ohne Duplikat an der Naht). */
export function mergeVertexPaths(existing: number[], extension: number[]): number[] {
  if (existing.length === 0) return [...extension]
  if (extension.length === 0) return [...existing]
  if (existing[existing.length - 1] === extension[0]) {
    return [...existing, ...extension.slice(1)]
  }
  return [...existing, ...extension]
}

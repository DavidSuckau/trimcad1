/**
 * 3D-Mesh → 2D-Schnittteile: Nähte als Schnitte, Regionen isometrisch abwickeln.
 * Spanning-Tree-Unfold (Papercraft-Stil) — lokal längentreu, bei starker Krümmung mit Dehnung.
 */

import { closedPointsToLineCurves } from '../geometry/offset'
import type { Curve, PatternPiece, Point } from '../types/model'
import type { MeshHandle, Scan3dSeam } from './types'

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

function vertPos(mesh: MeshHandle, vi: number): [number, number, number] {
  const i = vi * 3
  return [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]
}

function dist3(mesh: MeshHandle, a: number, b: number): number {
  const [ax, ay, az] = vertPos(mesh, a)
  const [bx, by, bz] = vertPos(mesh, b)
  return Math.hypot(bx - ax, by - ay, bz - az)
}

function area3(mesh: MeshHandle, a: number, b: number, c: number): number {
  const [ax, ay, az] = vertPos(mesh, a)
  const [bx, by, bz] = vertPos(mesh, b)
  const [cx, cy, cz] = vertPos(mesh, c)
  const abx = bx - ax
  const aby = by - ay
  const abz = bz - az
  const acx = cx - ax
  const acy = cy - ay
  const acz = cz - az
  const nx = aby * acz - abz * acy
  const ny = abz * acx - abx * acz
  const nz = abx * acy - aby * acx
  return 0.5 * Math.hypot(nx, ny, nz)
}

function polyArea2(pts: Point[]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!
    const q = pts[(i + 1) % pts.length]!
    a += p.x * q.y - q.x * p.y
  }
  return a * 0.5
}

function ensureCcw(pts: Point[]): Point[] {
  return polyArea2(pts) < 0 ? [...pts].reverse() : pts
}

/** Dritter Punkt in 2D über zwei Kreise; Seite entgegen alreadyOpposite. */
function placeThird2d(
  a: Point,
  b: Point,
  lenAc: number,
  lenBc: number,
  alreadyOpposite: Point | null,
): Point | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const d = Math.hypot(dx, dy)
  if (d < 1e-9) return null
  if (d > lenAc + lenBc + 1e-6 || d < Math.abs(lenAc - lenBc) - 1e-6) {
    // Leichte numerische Toleranz: auf die Linie projizieren
    const t = Math.max(0, Math.min(1, lenAc / (lenAc + lenBc || 1)))
    return { x: a.x + dx * t, y: a.y + dy * t }
  }
  const ux = dx / d
  const uy = dy / d
  const x = (d * d + lenAc * lenAc - lenBc * lenBc) / (2 * d)
  const hSq = Math.max(0, lenAc * lenAc - x * x)
  const h = Math.sqrt(hSq)
  const px = a.x + ux * x
  const py = a.y + uy * x
  const vx = -uy * h
  const vy = ux * h
  const c1: Point = { x: px + vx, y: py + vy }
  const c2: Point = { x: px - vx, y: py - vy }
  if (!alreadyOpposite) return c1
  // Wähle die Seite, die von alreadyOpposite weg zeigt (gegenüber der gemeinsamen Kante)
  const side = (p: Point) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
  const oppSide = side(alreadyOpposite)
  const s1 = side(c1)
  if (oppSide === 0) return c1
  return s1 * oppSide <= 0 ? c1 : c2
}

function collectSeamCutEdges(mesh: MeshHandle, seams: Scan3dSeam[]): Set<string> {
  const cuts = new Set<string>()
  for (const seam of seams) {
    const path =
      seam.vertexPath.length >= 2
        ? seam.vertexPath
        : surfacePointsToNearestVertices(mesh, seam.surfacePoints)
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]!
      const b = path[i + 1]!
      if (a !== b) cuts.add(edgeKey(a, b))
    }
    if (seam.closed && path.length >= 3) {
      const a = path[path.length - 1]!
      const b = path[0]!
      if (a !== b) cuts.add(edgeKey(a, b))
    }
  }
  return cuts
}

function surfacePointsToNearestVertices(mesh: MeshHandle, flat: number[]): number[] {
  const out: number[] = []
  for (let i = 0; i + 2 < flat.length; i += 3) {
    const x = flat[i]!
    const y = flat[i + 1]!
    const z = flat[i + 2]!
    let best = 0
    let bestD = Infinity
    for (let v = 0; v < mesh.vertexCount; v++) {
      const [px, py, pz] = vertPos(mesh, v)
      const d = (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2
      if (d < bestD) {
        bestD = d
        best = v
      }
    }
    if (out.length === 0 || out[out.length - 1] !== best) out.push(best)
  }
  return out
}

type FaceAdj = {
  faceCount: number
  /** face → Nachbar-Faces (über nicht-geschnittene Kanten) */
  neighbors: number[][]
  /** face → [a,b,c] Vertex-Indizes */
  faces: Int32Array
  /** edgeKey → Face-Indizes (1 oder 2) */
  edgeFaces: Map<string, number[]>
}

function buildFaceAdjacency(mesh: MeshHandle, cutEdges: Set<string>): FaceAdj {
  const faceCount = mesh.indices.length / 3
  const faces = new Int32Array(faceCount * 3)
  const edgeFaces = new Map<string, number[]>()

  for (let f = 0; f < faceCount; f++) {
    const i = f * 3
    const a = mesh.indices[i]!
    const b = mesh.indices[i + 1]!
    const c = mesh.indices[i + 2]!
    faces[i] = a
    faces[i + 1] = b
    faces[i + 2] = c
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const key = edgeKey(u, v)
      let list = edgeFaces.get(key)
      if (!list) {
        list = []
        edgeFaces.set(key, list)
      }
      list.push(f)
    }
  }

  const neighbors: number[][] = Array.from({ length: faceCount }, () => [])
  for (const [key, flist] of edgeFaces) {
    if (cutEdges.has(key)) continue
    if (flist.length !== 2) continue
    const [f0, f1] = flist
    neighbors[f0!]!.push(f1!)
    neighbors[f1!]!.push(f0!)
  }

  return { faceCount, neighbors, faces, edgeFaces }
}

function connectedFaceRegions(adj: FaceAdj, mesh: MeshHandle, minAreaMm2: number): number[][] {
  const visited = new Uint8Array(adj.faceCount)
  const regions: number[][] = []

  for (let seed = 0; seed < adj.faceCount; seed++) {
    if (visited[seed]) continue
    const region: number[] = []
    const stack = [seed]
    visited[seed] = 1
    let area = 0
    while (stack.length > 0) {
      const f = stack.pop()!
      region.push(f)
      const i = f * 3
      area += area3(mesh, adj.faces[i]!, adj.faces[i + 1]!, adj.faces[i + 2]!)
      for (const nb of adj.neighbors[f]!) {
        if (!visited[nb]) {
          visited[nb] = 1
          stack.push(nb)
        }
      }
    }
    if (region.length >= 1 && area >= minAreaMm2) regions.push(region)
  }

  regions.sort((a, b) => b.length - a.length)
  return regions
}

type UvMap = Map<number, Point>

function unfoldRegion(mesh: MeshHandle, adj: FaceAdj, regionFaces: number[]): UvMap | null {
  if (regionFaces.length === 0) return null
  const inRegion = new Set(regionFaces)
  const uv: UvMap = new Map()
  const faceVisited = new Set<number>()

  const seed = regionFaces[0]!
  const i0 = seed * 3
  const a = adj.faces[i0]!
  const b = adj.faces[i0 + 1]!
  const c = adj.faces[i0 + 2]!
  const lab = dist3(mesh, a, b)
  const lac = dist3(mesh, a, c)
  const lbc = dist3(mesh, b, c)
  uv.set(a, { x: 0, y: 0 })
  uv.set(b, { x: lab, y: 0 })
  const c2 = placeThird2d({ x: 0, y: 0 }, { x: lab, y: 0 }, lac, lbc, null)
  if (!c2) return null
  uv.set(c, c2)
  faceVisited.add(seed)

  const queue = [seed]
  while (queue.length > 0) {
    const f = queue.shift()!
    for (const nb of adj.neighbors[f]!) {
      if (!inRegion.has(nb) || faceVisited.has(nb)) continue
      const ni = nb * 3
      const verts = [adj.faces[ni]!, adj.faces[ni + 1]!, adj.faces[ni + 2]!]
      const placed = verts.filter((v) => uv.has(v))
      const missing = verts.filter((v) => !uv.has(v))
      if (placed.length >= 2 && missing.length === 1) {
        const [p0, p1] = placed
        const m = missing[0]!
        const opp = verts.find((v) => v !== p0 && v !== p1 && uv.has(v)) ?? null
        // Gegenüberliegender Punkt der Nachbar-Face auf der gemeinsamen Kante
        const sharedOpp =
          opp != null
            ? uv.get(opp)!
            : (() => {
                const fi = f * 3
                const fv = [adj.faces[fi]!, adj.faces[fi + 1]!, adj.faces[fi + 2]!]
                const other = fv.find((v) => v !== p0 && v !== p1)
                return other != null ? uv.get(other) ?? null : null
              })()
        const pA = uv.get(p0!)!
        const pB = uv.get(p1!)!
        const placedPt = placeThird2d(pA, pB, dist3(mesh, p0!, m), dist3(mesh, p1!, m), sharedOpp)
        if (placedPt) uv.set(m, placedPt)
      } else if (placed.length < 2) {
        // Face noch nicht anschließbar — später erneut versuchen
        continue
      }
      faceVisited.add(nb)
      queue.push(nb)
    }
  }

  // Zweiter Pass für Faces, die beim ersten Mal übersprungen wurden
  let grew = true
  while (grew) {
    grew = false
    for (const f of regionFaces) {
      if (faceVisited.has(f)) continue
      const fi = f * 3
      const verts = [adj.faces[fi]!, adj.faces[fi + 1]!, adj.faces[fi + 2]!]
      const placed = verts.filter((v) => uv.has(v))
      const missing = verts.filter((v) => !uv.has(v))
      if (placed.length >= 2 && missing.length === 1) {
        const [p0, p1] = placed
        const m = missing[0]!
        let sharedOpp: Point | null = null
        for (const nb of adj.neighbors[f]!) {
          if (!faceVisited.has(nb)) continue
          const ni = nb * 3
          const nv = [adj.faces[ni]!, adj.faces[ni + 1]!, adj.faces[ni + 2]!]
          const other = nv.find((v) => v !== p0 && v !== p1 && uv.has(v))
          if (other != null) {
            sharedOpp = uv.get(other)!
            break
          }
        }
        const placedPt = placeThird2d(
          uv.get(p0!)!,
          uv.get(p1!)!,
          dist3(mesh, p0!, m),
          dist3(mesh, p1!, m),
          sharedOpp,
        )
        if (placedPt) {
          uv.set(m, placedPt)
          faceVisited.add(f)
          grew = true
        }
      } else if (missing.length === 0) {
        faceVisited.add(f)
        grew = true
      }
    }
  }

  return uv.size >= 3 ? uv : null
}

function extractBoundaryLoops(
  adj: FaceAdj,
  regionFaces: number[],
  cutEdges: Set<string>,
): number[][] {
  const inRegion = new Set(regionFaces)
  const boundaryEdges = new Map<string, [number, number]>()

  for (const f of regionFaces) {
    const i = f * 3
    const tri = [adj.faces[i]!, adj.faces[i + 1]!, adj.faces[i + 2]!]
    for (let e = 0; e < 3; e++) {
      const u = tri[e]!
      const v = tri[(e + 1) % 3]!
      const key = edgeKey(u, v)
      const facesOnEdge = adj.edgeFaces.get(key) ?? []
      const regionCount = facesOnEdge.filter((ff) => inRegion.has(ff)).length
      const isCut = cutEdges.has(key)
      if (regionCount === 1 || isCut) {
        if (!boundaryEdges.has(key)) boundaryEdges.set(key, [u, v])
      }
    }
  }

  if (boundaryEdges.size === 0) return []

  // Adjazenz für gerichtetes Walken
  const nextMap = new Map<number, number[]>()
  for (const [u, v] of boundaryEdges.values()) {
    if (!nextMap.has(u)) nextMap.set(u, [])
    if (!nextMap.has(v)) nextMap.set(v, [])
    nextMap.get(u)!.push(v)
    nextMap.get(v)!.push(u)
  }

  const used = new Set<string>()
  const loops: number[][] = []

  for (const [startU, startV] of boundaryEdges.values()) {
    const startKey = edgeKey(startU, startV)
    if (used.has(startKey)) continue

    const loop: number[] = [startU]
    let prev = startU
    let cur = startV
    used.add(startKey)

    for (let guard = 0; guard < boundaryEdges.size + 2; guard++) {
      loop.push(cur)
      if (cur === startU) break
      const nbs = nextMap.get(cur) ?? []
      let next = -1
      for (const cand of nbs) {
        if (cand === prev) continue
        const k = edgeKey(cur, cand)
        if (!boundaryEdges.has(k)) continue
        if (used.has(k) && cand !== startU) continue
        next = cand
        used.add(k)
        break
      }
      if (next < 0) {
        // Dead end — unvollständige Schleife
        break
      }
      prev = cur
      cur = next
    }

    if (loop.length >= 4 && loop[0] === loop[loop.length - 1]) {
      loop.pop()
      loops.push(loop)
    }
  }

  loops.sort((a, b) => b.length - a.length)
  return loops
}

function loopToPoints(uv: UvMap, loop: number[]): Point[] {
  const pts: Point[] = []
  for (const v of loop) {
    const p = uv.get(v)
    if (p) pts.push({ x: p.x, y: p.y })
  }
  return pts
}

function normalizeRing(pts: Point[]): Point[] {
  if (pts.length < 3) return pts
  let minX = Infinity
  let minY = Infinity
  for (const p of pts) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
  }
  return pts.map((p) => ({ x: p.x - minX, y: p.y - minY }))
}

function meanEdgeStrain(mesh: MeshHandle, uv: UvMap, adj: FaceAdj, regionFaces: number[]): number {
  let sum = 0
  let n = 0
  const seen = new Set<string>()
  for (const f of regionFaces) {
    const i = f * 3
    const tri = [adj.faces[i]!, adj.faces[i + 1]!, adj.faces[i + 2]!]
    for (let e = 0; e < 3; e++) {
      const a = tri[e]!
      const b = tri[(e + 1) % 3]!
      const key = edgeKey(a, b)
      if (seen.has(key)) continue
      seen.add(key)
      const pa = uv.get(a)
      const pb = uv.get(b)
      if (!pa || !pb) continue
      const d3 = dist3(mesh, a, b)
      if (d3 < 1e-9) continue
      const d2 = Math.hypot(pb.x - pa.x, pb.y - pa.y)
      sum += Math.abs(d2 - d3) / d3
      n++
    }
  }
  return n > 0 ? sum / n : 0
}

function simplifyToleranceForRing(pts: Point[]): number {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  const diag = Math.hypot(maxX - minX, maxY - minY)
  return Math.max(0.4, Math.min(2.5, diag * 0.004))
}

export type FlattenPieceDraft = {
  name: string
  cutLine: Curve[]
  boundaryPoints: Point[]
  faceCount: number
  meanStrain: number
}

export type FlattenResult =
  | { ok: true; pieces: FlattenPieceDraft[]; warnings: string[] }
  | { ok: false; error: string; warnings: string[] }

export type FlattenOptions = {
  /** Minimale Flächengröße einer Region (mm²). Default 50. */
  minRegionAreaMm2?: number
  /** Max. Anzahl Teile (größte zuerst). Default 40. */
  maxPieces?: number
  baseName?: string
}

/**
 * Schneidet das Mesh entlang der Nähte und wickelt jede Region in die Ebene ab.
 * Ohne Nähte: eine Region (gesamtes Mesh), sofern eine Außengrenze existiert.
 */
export function flattenMeshToPieces(
  mesh: MeshHandle,
  seams: Scan3dSeam[],
  options: FlattenOptions = {},
): FlattenResult {
  const warnings: string[] = []
  const minArea = options.minRegionAreaMm2 ?? 50
  const maxPieces = options.maxPieces ?? 40
  const baseName = options.baseName ?? 'Abwicklung'

  if (mesh.indices.length < 3 || mesh.vertexCount < 3) {
    return { ok: false, error: 'Mesh ist leer oder ungültig.', warnings }
  }

  const cutEdges = collectSeamCutEdges(mesh, seams)
  if (seams.length === 0) {
    warnings.push('Keine Nähte: das gesamte Mesh wird als eine Region abgewickelt.')
  } else if (cutEdges.size === 0) {
    warnings.push('Nähte konnten nicht auf Mesh-Kanten abgebildet werden — Abwicklung ohne Schnitte.')
  }

  const adj = buildFaceAdjacency(mesh, cutEdges)
  const regions = connectedFaceRegions(adj, mesh, minArea)
  if (regions.length === 0) {
    return { ok: false, error: 'Keine abwickelbaren Regionen gefunden.', warnings }
  }

  const pieces: FlattenPieceDraft[] = []
  let cursorX = 0
  const gap = 25

  for (let ri = 0; ri < regions.length && pieces.length < maxPieces; ri++) {
    const region = regions[ri]!
    const uv = unfoldRegion(mesh, adj, region)
    if (!uv) {
      warnings.push(`Region ${ri + 1}: Abwicklung fehlgeschlagen.`)
      continue
    }

    const loops = extractBoundaryLoops(adj, region, cutEdges)
    if (loops.length === 0) {
      warnings.push(
        `Region ${ri + 1}: keine Außengrenze (geschlossene Fläche?). Weitere Nähte zeichnen, um zu öffnen.`,
      )
      continue
    }
    if (loops.length > 1) {
      warnings.push(
        `Region ${ri + 1}: ${loops.length} Randschleifen — äußere Kontur wird verwendet (Löcher ignoriert).`,
      )
    }

    let ring = loopToPoints(uv, loops[0]!)
    if (ring.length < 3) {
      warnings.push(`Region ${ri + 1}: Rand zu kurz.`)
      continue
    }
    ring = ensureCcw(normalizeRing(ring))
    // Nebeneinander legen
    const shifted = ring.map((p) => ({ x: p.x + cursorX, y: p.y }))
    const tol = simplifyToleranceForRing(shifted)
    const cutLine = closedPointsToLineCurves(shifted, tol)
    if (cutLine.length < 3) {
      warnings.push(`Region ${ri + 1}: Kontur nach Vereinfachung ungültig.`)
      continue
    }

    const strain = meanEdgeStrain(mesh, uv, adj, region)
    if (strain > 0.08) {
      warnings.push(
        `Region ${ri + 1}: mittlere Kanten-Dehnung ${(strain * 100).toFixed(1)} % — mehr Nähte/Abnäher verbessern die Passform.`,
      )
    }

    let maxX = 0
    for (const p of shifted) maxX = Math.max(maxX, p.x)
    cursorX = maxX + gap

    pieces.push({
      name: `${baseName} ${pieces.length + 1}`,
      cutLine,
      boundaryPoints: shifted,
      faceCount: region.length,
      meanStrain: strain,
    })
  }

  if (pieces.length === 0) {
    return {
      ok: false,
      error:
        'Keine 2D-Konturen erzeugt. Zeichne Nähte, die das Mesh in offene Regionen teilen (Schnitte bis zum Rand oder geschlossene Schnittschlaufen).',
      warnings,
    }
  }

  if (regions.length > maxPieces) {
    warnings.push(`Nur die ${maxPieces} größten Regionen wurden übernommen (${regions.length} gefunden).`)
  }

  return { ok: true, pieces, warnings }
}

/** Hilfsfunktion: Drafts → partielle PatternPieces für addPiece. */
export function flattenDraftsToPiecePartials(
  drafts: FlattenPieceDraft[],
): Partial<PatternPiece>[] {
  return drafts.map((d, i) => ({
    name: d.name,
    number: String(i + 1).padStart(3, '0'),
    cutLine: d.cutLine,
    seamLine: [],
    seamAllowanceMm: null,
    notches: [],
    drills: [],
    grainLine: null,
    internalLines: [],
    internalCircles: [],
    layer: 'CUT',
    fillInterior: true,
    description: `3D-Abwicklung · ${d.faceCount} Dreiecke · Dehnung ~${(d.meanStrain * 100).toFixed(1)} %`,
    transform: { x: 0, y: 0, rotation: 0, mirrored: false },
  }))
}

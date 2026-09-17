import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import * as THREE from 'three'
import { isStepFileName, loadStepGroup } from './stepImport'
import type { MeshHandle, ObjImportResult, ObjUnit, Scan3dLoadPhase, Scan3dLoadProgress } from './types'

export type LoadProgressCallback = (progress: Scan3dLoadProgress) => void

const WELD_CHUNK = 50_000

const LOAD_PHASE_LABELS: Record<Scan3dLoadPhase, string> = {
  reading: 'Datei wird gelesen…',
  parsing: '3D-Modell wird verarbeitet…',
  textures: 'Texturen werden geladen…',
  mesh: 'Mesh wird aufbereitet…',
  graph: 'Kantengraph wird erstellt…',
  done: 'Fertig',
}

const LOAD_PHASE_RANGE: Record<Scan3dLoadPhase, [number, number]> = {
  reading: [2, 15],
  parsing: [15, 42],
  textures: [42, 55],
  mesh: [55, 82],
  graph: [82, 98],
  done: [100, 100],
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function reportLoadProgress(
  onProgress: LoadProgressCallback | undefined,
  phase: Scan3dLoadPhase,
  subPct = 0,
): void {
  if (!onProgress) return
  const [lo, hi] = LOAD_PHASE_RANGE[phase]
  const pct =
    phase === 'done'
      ? 100
      : Math.round(lo + ((hi - lo) * Math.min(100, Math.max(0, subPct))) / 100)
  onProgress({ pct, phase, label: LOAD_PHASE_LABELS[phase] })
}

/** Zielgröße nach Auto-Vereinfachung (Graph/Zeichnen bleibt flüssig). */
const TARGET_TRIANGLES = 500_000
/** Harte Obergrenze: darüber wird gar nicht erst versucht (Browser-RAM). */
const HARD_MAX_TRIANGLES = 8_000_000
const WELD_TOLERANCE = 1e-4

const UNIT_TO_MM: Record<ObjUnit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
}

const TEXTURE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tga'])

function quantizeKey(x: number, y: number, z: number, tol: number): string {
  const q = (v: number) => Math.round(v / tol)
  return `${q(x)}:${q(y)}:${q(z)}`
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] ?? path
}

function fileExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

function fileStem(name: string): string {
  const base = basename(name)
  const i = base.lastIndexOf('.')
  return (i >= 0 ? base.slice(0, i) : base).toLowerCase()
}

function fileKey(file: File): string {
  return basename(file.name).toLowerCase()
}

function isTextureFile(file: File): boolean {
  return TEXTURE_EXT.has(fileExt(file.name))
}

function buildAssetUrlMap(files: File[]): { urls: Map<string, string>; blobUrls: string[] } {
  const urls = new Map<string, string>()
  const blobUrls: string[] = []
  for (const file of files) {
    const blobUrl = URL.createObjectURL(file)
    blobUrls.push(blobUrl)
    urls.set(fileKey(file), blobUrl)
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath
    if (rel) {
      const norm = rel.replace(/\\/g, '/').toLowerCase()
      urls.set(norm, blobUrl)
      urls.set(basename(norm).toLowerCase(), blobUrl)
    }
  }
  return { urls, blobUrls }
}

function resolveAssetUrl(urls: Map<string, string>, requestUrl: string): string {
  const normalized = requestUrl.replace(/\\/g, '/').toLowerCase()
  const base = basename(normalized).toLowerCase()
  return urls.get(normalized) ?? urls.get(base) ?? requestUrl
}

function findTextureFiles(files: File[]): File[] {
  return files.filter(isTextureFile)
}

/** Polycam: model.obj + model.jpg oder eine einzelne Textur im Set. */
export function pickPrimaryTextureFile(objFile: File, files: File[], mtlText?: string | null): File | null {
  const textures = findTextureFiles(files)
  if (textures.length === 0) return null

  if (mtlText) {
    const mapRefs = [...mtlText.matchAll(/^\s*map_[A-Za-z]+\s+(.+)\s*$/gim)]
    for (const match of mapRefs) {
      const ref = basename(match[1].trim()).toLowerCase()
      const hit = textures.find((t) => fileKey(t) === ref)
      if (hit) return hit
    }
  }

  const objStem = fileStem(objFile.name)
  const stemHit = textures.find((t) => fileStem(t.name) === objStem)
  if (stemHit) return stemHit

  if (textures.length === 1) return textures[0]

  const textureNamed = textures.find((t) => /texture|diffuse|color|albedo|material/i.test(t.name))
  if (textureNamed) return textureNamed

  return textures[0]
}

function patchMtlTexturePaths(mtlText: string, urls: Map<string, string>, fallbackTexture: File | null): string {
  const patched = mtlText.replace(/^\s*(map_[A-Za-z]+)\s+(.+)\s*$/gim, (_line, key: string, rawPath: string) => {
    const ref = basename(rawPath.trim())
    const resolved = resolveAssetUrl(urls, ref)
    if (resolved.startsWith('blob:')) return `${key} ${resolved}`
    if (fallbackTexture) return `${key} ${resolveAssetUrl(urls, fallbackTexture.name)}`
    return `${key} ${ref}`
  })
  return patched
}

function objHasUvCoords(objText: string): boolean {
  return /^\s*vt\s+/m.test(objText)
}

function parseMtlLibName(objText: string): string | null {
  const match = objText.match(/^\s*mtllib\s+(.+)\s*$/im)
  if (!match) return null
  return basename(match[1].trim().split(/\s+/)[0])
}

function materialsHaveTextureMap(group: THREE.Object3D): boolean {
  let found = false
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const mats = Array.isArray(child.material) ? child.material : [child.material]
    for (const m of mats) {
      if (!m) continue
      const map = (m as THREE.MeshStandardMaterial).map
      if (map) found = true
    }
  })
  return found
}

async function loadTextureFromUrl(url: string): Promise<THREE.Texture> {
  const texture = await new THREE.TextureLoader().loadAsync(url)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = false
  return texture
}

async function applyTextureToGroup(group: THREE.Group, textureUrl: string): Promise<void> {
  const texture = await loadTextureFromUrl(textureUrl)
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const applyOne = (mat: THREE.Material) => {
      const next = mat.clone() as THREE.MeshStandardMaterial
      next.map = texture
      next.side = THREE.DoubleSide
      next.roughness = 0.88
      next.metalness = 0.04
      next.needsUpdate = true
      return next
    }
    if (Array.isArray(child.material)) {
      child.material = child.material.map((m) => (m ? applyOne(m) : m))
    } else if (child.material) {
      child.material = applyOne(child.material)
    } else {
      child.material = new THREE.MeshStandardMaterial({
        map: texture,
        side: THREE.DoubleSide,
        roughness: 0.88,
        metalness: 0.04,
      })
    }
  })
}

function setDoubleSided(group: THREE.Group): void {
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const mats = Array.isArray(child.material) ? child.material : [child.material]
    for (const m of mats) {
      if (m) m.side = THREE.DoubleSide
    }
  })
}

async function loadObjGroup(
  objText: string,
  objFile: File,
  files: File[],
  urls: Map<string, string>,
): Promise<{ group: THREE.Group; warnings: string[] }> {
  const warnings: string[] = []
  const manager = new THREE.LoadingManager()
  manager.setURLModifier((url) => resolveAssetUrl(urls, url))

  const mtlName = parseMtlLibName(objText)
  const mtlFile = mtlName ? files.find((f) => fileKey(f) === mtlName.toLowerCase()) : undefined
  let mtlText: string | null = null
  if (mtlFile) mtlText = await mtlFile.text()

  const textureFile = pickPrimaryTextureFile(objFile, files, mtlText)
  const objLoader = new OBJLoader(manager)

  if (mtlFile && mtlText) {
    try {
      const patched = patchMtlTexturePaths(mtlText, urls, textureFile)
      const mtlBlobUrl = URL.createObjectURL(new Blob([patched], { type: 'text/plain' }))
      const mtlLoader = new MTLLoader(manager)
      const materials = await mtlLoader.loadAsync(mtlBlobUrl)
      URL.revokeObjectURL(mtlBlobUrl)
      materials.preload()
      objLoader.setMaterials(materials)
    } catch {
      warnings.push(`MTL „${mtlName}“ konnte nicht geladen werden.`)
    }
  } else if (mtlName && textureFile) {
    try {
      const syntheticMtl = [
        'newmtl polycam_material',
        'Kd 1.000 1.000 1.000',
        `map_Kd ${resolveAssetUrl(urls, textureFile.name)}`,
        '',
      ].join('\n')
      const mtlBlobUrl = URL.createObjectURL(new Blob([syntheticMtl], { type: 'text/plain' }))
      const mtlLoader = new MTLLoader(manager)
      const materials = await mtlLoader.loadAsync(mtlBlobUrl)
      URL.revokeObjectURL(mtlBlobUrl)
      materials.preload()
      objLoader.setMaterials(materials)
      warnings.push(`MTL „${mtlName}“ fehlte — Textur automatisch zugeordnet (Polycam).`)
    } catch {
      warnings.push('MTL fehlte und automatische Texturzuordnung ist fehlgeschlagen.')
    }
  } else if (mtlName && !textureFile) {
    warnings.push(`MTL „${mtlName}“ vermisst — bitte Texturdatei (.jpg/.png) mit laden.`)
  }

  const group = objLoader.parse(objText) as THREE.Group
  setDoubleSided(group)

  if (!materialsHaveTextureMap(group) && textureFile) {
    if (!objHasUvCoords(objText)) {
      warnings.push('OBJ ohne UV-Koordinaten (vt) — Textur kann nicht korrekt angezeigt werden.')
    } else {
      await applyTextureToGroup(group, resolveAssetUrl(urls, textureFile.name))
    }
  } else if (!materialsHaveTextureMap(group) && !textureFile) {
    warnings.push('Keine Texturdatei gefunden — bitte .jpg/.png zusammen mit der OBJ laden.')
  }

  return { group, warnings }
}

function defaultScanMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: '#c5d0dc',
    roughness: 0.55,
    metalness: 0.08,
    side: THREE.DoubleSide,
    flatShading: false,
  })
}

function loadStlGroup(buffer: ArrayBuffer): THREE.Group {
  const loader = new STLLoader()
  let geometry: THREE.BufferGeometry | null = null
  try {
    geometry = loader.parse(buffer)
  } catch (err) {
    geometry = parseBinaryStlForced(buffer)
    if (!geometry) {
      throw err instanceof Error ? err : new Error('STL konnte nicht gelesen werden.')
    }
  }

  let pos = geometry.getAttribute('position')
  if (!pos || pos.count < 3) {
    const forced = parseBinaryStlForced(buffer)
    if (forced) {
      geometry.dispose()
      geometry = forced
      pos = geometry.getAttribute('position')
    }
  }
  if (!geometry || !pos || pos.count < 3) {
    throw new Error('STL enthält keine gültige Geometrie.')
  }

  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  const mesh = new THREE.Mesh(geometry, defaultScanMaterial())
  mesh.frustumCulled = false
  const group = new THREE.Group()
  group.add(mesh)
  return group
}

/** Fallback, wenn Three.js eine Binary-STL fälschlich als ASCII liest. */
function parseBinaryStlForced(buffer: ArrayBuffer): THREE.BufferGeometry | null {
  if (buffer.byteLength < 84) return null
  const reader = new DataView(buffer)
  const faces = reader.getUint32(80, true)
  if (faces <= 0 || faces > 5_000_000) return null
  const expect = 84 + faces * 50
  // Erlaube kleine Abweichungen (Padding)
  if (buffer.byteLength + 64 < expect) return null

  const vertices = new Float32Array(faces * 9)
  const normals = new Float32Array(faces * 9)
  for (let face = 0; face < faces; face++) {
    const start = 84 + face * 50
    if (start + 48 > buffer.byteLength) break
    const nx = reader.getFloat32(start, true)
    const ny = reader.getFloat32(start + 4, true)
    const nz = reader.getFloat32(start + 8, true)
    for (let i = 0; i < 3; i++) {
      const vOff = start + 12 + i * 12
      const dest = face * 9 + i * 3
      vertices[dest] = reader.getFloat32(vOff, true)
      vertices[dest + 1] = reader.getFloat32(vOff + 4, true)
      vertices[dest + 2] = reader.getFloat32(vOff + 8, true)
      normals[dest] = nx
      normals[dest + 1] = ny
      normals[dest + 2] = nz
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  return geometry
}

function findMeshFile(files: File[]): File | undefined {
  return (
    files.find((f) => /\.obj$/i.test(f.name)) ??
    files.find((f) => /\.stl$/i.test(f.name)) ??
    files.find((f) => isStepFileName(f.name))
  )
}

async function finalizeLoadedGroupAsync(
  group: THREE.Group,
  preferredUnit: ObjUnit,
  warnings: string[],
  onProgress?: LoadProgressCallback,
): Promise<ObjImportResult & { blobUrls: string[] }> {
  const nativeDiag = nativeBoundingDiagonal(group)
  const resolved = resolveUnitForMeshSize(preferredUnit, nativeDiag)
  const unit = resolved.unit
  if (resolved.note) warnings.push(resolved.note)

  const scaleToMm = UNIT_TO_MM[unit]
  applyUnitScale(group, scaleToMm)
  centerObject(group)

  reportLoadProgress(onProgress, 'mesh', 0)
  let mesh = await mergeAndWeldFromObjectAsync(group, (subPct) =>
    reportLoadProgress(onProgress, 'mesh', Math.min(70, subPct * 0.7)),
  )
  const originalTriangles = mesh.indices.length / 3

  if (originalTriangles < 1) return { ok: false, error: 'Mesh enthält keine Dreiecke.', blobUrls: [] }
  if (originalTriangles > HARD_MAX_TRIANGLES) {
    return {
      ok: false,
      error: `Mesh zu groß (${originalTriangles.toLocaleString('de-DE')} Dreiecke, max. ${HARD_MAX_TRIANGLES.toLocaleString('de-DE')}).`,
      blobUrls: [],
    }
  }

  if (originalTriangles > TARGET_TRIANGLES) {
    reportLoadProgress(onProgress, 'mesh', 72)
    const reduced = await reduceMeshToTriangleBudget(mesh, TARGET_TRIANGLES, (subPct) =>
      reportLoadProgress(onProgress, 'mesh', 72 + Math.round((subPct / 100) * 26)),
    )
    mesh = reduced
    const reducedTris = mesh.indices.length / 3
    warnings.push(
      `Mesh automatisch vereinfacht: ${originalTriangles.toLocaleString('de-DE')} → ${reducedTris.toLocaleString('de-DE')} Dreiecke (Original-STL unverändert).`,
    )
    // Visual an Arbeitsmesh anpassen (weniger RAM, Raycast = Graph).
    replaceVisualMeshesWithHandle(group, mesh)
  } else if (originalTriangles > 200_000) {
    warnings.push(`Großes Mesh (${originalTriangles.toLocaleString('de-DE')} Dreiecke) — Zeichnen kann langsam sein.`)
  }

  const triangleCount = mesh.indices.length / 3
  reportLoadProgress(onProgress, 'mesh', 100)
  return { ok: true, mesh, visualRoot: group, triangleCount, warnings, blobUrls: [] }
}

function meshBoundingBox(mesh: MeshHandle): {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
  diagonal: number
} {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (let i = 0; i < mesh.vertexCount; i++) {
    const x = mesh.positions[i * 3]
    const y = mesh.positions[i * 3 + 1]
    const z = mesh.positions[i * 3 + 2]
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z
  }
  const dx = maxX - minX
  const dy = maxY - minY
  const dz = maxZ - minZ
  return { minX, minY, minZ, maxX, maxY, maxZ, diagonal: Math.hypot(dx, dy, dz) || 1 }
}

/** Vertex-Clustering: Punkte in einem Gitterzellen zusammenfassen → weniger Dreiecke. */
async function clusterMeshByGrid(
  mesh: MeshHandle,
  cellSize: number,
  onProgress?: (subPct: number) => void,
): Promise<MeshHandle> {
  const { minX, minY, minZ } = meshBoundingBox(mesh)
  const inv = 1 / Math.max(cellSize, 1e-9)
  const keyToIndex = new Map<string, number>()
  const positions: number[] = []

  const mapVertex = (vi: number): number => {
    const x = mesh.positions[vi * 3]
    const y = mesh.positions[vi * 3 + 1]
    const z = mesh.positions[vi * 3 + 2]
    const ix = Math.floor((x - minX) * inv)
    const iy = Math.floor((y - minY) * inv)
    const iz = Math.floor((z - minZ) * inv)
    const key = `${ix},${iy},${iz}`
    const existing = keyToIndex.get(key)
    if (existing !== undefined) return existing
    const newIdx = positions.length / 3
    positions.push(x, y, z)
    keyToIndex.set(key, newIdx)
    return newIdx
  }

  const indices: number[] = []
  const triCount = mesh.indices.length / 3
  for (let t = 0; t < triCount; t++) {
    const i = t * 3
    const a = mapVertex(mesh.indices[i])
    const b = mapVertex(mesh.indices[i + 1])
    const c = mapVertex(mesh.indices[i + 2])
    if (a !== b && b !== c && c !== a) {
      indices.push(a, b, c)
    }
    if (t > 0 && t % WELD_CHUNK === 0) {
      onProgress?.(Math.round((t / triCount) * 100))
      await yieldToMain()
    }
  }
  onProgress?.(100)
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    vertexCount: positions.length / 3,
  }
}

/** Fallback: jedes n-te Dreieck behalten (wenn Clustering nicht reicht). */
function thinTrianglesUniform(mesh: MeshHandle, targetTriangles: number): MeshHandle {
  const triCount = mesh.indices.length / 3
  if (triCount <= targetTriangles) return mesh
  const step = Math.max(1, Math.ceil(triCount / targetTriangles))
  const used = new Map<number, number>()
  const positions: number[] = []
  const indices: number[] = []

  const mapV = (vi: number): number => {
    const existing = used.get(vi)
    if (existing !== undefined) return existing
    const ni = positions.length / 3
    positions.push(mesh.positions[vi * 3], mesh.positions[vi * 3 + 1], mesh.positions[vi * 3 + 2])
    used.set(vi, ni)
    return ni
  }

  for (let t = 0; t < triCount; t += step) {
    const i = t * 3
    const a = mapV(mesh.indices[i])
    const b = mapV(mesh.indices[i + 1])
    const c = mapV(mesh.indices[i + 2])
    if (a !== b && b !== c && c !== a) indices.push(a, b, c)
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    vertexCount: positions.length / 3,
  }
}

/**
 * Reduziert ein Mesh auf höchstens `targetTriangles` (Originaldatei bleibt unverändert).
 * Primär Vertex-Grid-Clustering, sonst gleichmäßiges Ausdünnen.
 */
export async function reduceMeshToTriangleBudget(
  mesh: MeshHandle,
  targetTriangles: number,
  onProgress?: (subPct: number) => void,
): Promise<MeshHandle> {
  const original = mesh.indices.length / 3
  if (original <= targetTriangles) return mesh

  const { diagonal } = meshBoundingBox(mesh)
  // Start: grobe Schätzung, damit ~target Dreiecke übrig bleiben
  let cellSize = diagonal / Math.cbrt(Math.max(8, targetTriangles * 1.5))
  cellSize = Math.max(cellSize, diagonal * 1e-5)

  let best: MeshHandle = mesh
  let bestCount = original

  for (let attempt = 0; attempt < 14; attempt++) {
    const clustered = await clusterMeshByGrid(mesh, cellSize, (sub) => {
      onProgress?.(Math.round(((attempt + sub / 100) / 14) * 90))
    })
    const count = clustered.indices.length / 3
    if (count > 0 && count < bestCount) {
      best = clustered
      bestCount = count
    }
    if (count > 0 && count <= targetTriangles) {
      onProgress?.(100)
      return clustered
    }
    if (count === 0) {
      cellSize *= 0.75
      continue
    }
    const ratio = count / targetTriangles
    cellSize *= Math.max(1.12, Math.min(2.2, Math.cbrt(ratio)))
  }

  onProgress?.(95)
  const thinned = thinTrianglesUniform(bestCount > targetTriangles ? best : mesh, targetTriangles)
  onProgress?.(100)
  return thinned.indices.length >= 3 ? thinned : best
}

function replaceVisualMeshesWithHandle(group: THREE.Group, mesh: MeshHandle): void {
  disposeVisualRoot(group)
  while (group.children.length > 0) {
    group.remove(group.children[0])
  }
  const geometry = meshToBufferGeometry(mesh)
  const visual = new THREE.Mesh(geometry, defaultScanMaterial())
  visual.frustumCulled = false
  group.add(visual)
  group.updateMatrixWorld(true)
}

async function weldPositionsIndicesAsync(
  rawPositions: number[],
  rawIndices: number[],
  onProgress?: (subPct: number) => void,
): Promise<MeshHandle> {
  const keyToIndex = new Map<string, number>()
  const positions: number[] = []
  const indices: number[] = []

  const mapVertex = (srcIdx: number): number => {
    const x = rawPositions[srcIdx * 3]
    const y = rawPositions[srcIdx * 3 + 1]
    const z = rawPositions[srcIdx * 3 + 2]
    const key = quantizeKey(x, y, z, WELD_TOLERANCE)
    const existing = keyToIndex.get(key)
    if (existing !== undefined) return existing
    const newIdx = positions.length / 3
    positions.push(x, y, z)
    keyToIndex.set(key, newIdx)
    return newIdx
  }

  for (let i = 0; i < rawIndices.length; i++) {
    indices.push(mapVertex(rawIndices[i]))
    if (i > 0 && i % WELD_CHUNK === 0) {
      onProgress?.(Math.round((i / rawIndices.length) * 100))
      await yieldToMain()
    }
  }

  onProgress?.(100)
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    vertexCount: positions.length / 3,
  }
}

async function mergeAndWeldFromObjectAsync(
  object: THREE.Object3D,
  onProgress?: (subPct: number) => void,
): Promise<MeshHandle> {
  const rawPositions: number[] = []
  const rawIndices: number[] = []
  let vertexOffset = 0
  const matrix = new THREE.Matrix4()

  object.updateMatrixWorld(true)
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const geom = child.geometry
    if (!(geom instanceof THREE.BufferGeometry)) return
    const posAttr = geom.getAttribute('position')
    if (!posAttr) return

    matrix.copy(child.matrixWorld)
    const startOffset = vertexOffset

    for (let i = 0; i < posAttr.count; i++) {
      const v = new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(matrix)
      rawPositions.push(v.x, v.y, v.z)
      vertexOffset++
    }

    const indexAttr = geom.getIndex()
    if (indexAttr) {
      for (let i = 0; i < indexAttr.count; i++) rawIndices.push(indexAttr.getX(i) + startOffset)
    } else {
      for (let i = 0; i < posAttr.count; i++) rawIndices.push(startOffset + i)
    }
  })

  if (rawIndices.length === 0) throw new Error('Mesh ohne Dreiecke.')
  return weldPositionsIndicesAsync(rawPositions, rawIndices, onProgress)
}

function centerObject(object: THREE.Object3D): void {
  object.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) return
  const center = box.getCenter(new THREE.Vector3())
  object.position.sub(center)
  object.updateMatrixWorld(true)
}

function applyUnitScale(object: THREE.Object3D, scaleToMm: number): void {
  object.scale.multiplyScalar(scaleToMm)
  object.updateMatrixWorld(true)
}

/** Bounding-Diagonalenlänge in Datei-Einheiten (vor mm-Skalierung). */
function nativeBoundingDiagonal(object: THREE.Object3D): number {
  object.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) return 0
  return box.getSize(new THREE.Vector3()).length()
}

/**
 * Viele STL/STEP-Dateien sind in mm, Default war früher „m“ → Modell unsichtbar riesig.
 * Korrigiert offensichtlich falsche Einheiten anhand der Rohgröße.
 */
export function resolveUnitForMeshSize(
  preferred: ObjUnit,
  nativeDiagonal: number,
): { unit: ObjUnit; note: string | null } {
  if (!(nativeDiagonal > 0) || !Number.isFinite(nativeDiagonal)) {
    return { unit: preferred, note: null }
  }
  // Sehr klein in „mm“ gewählt → eher Meter
  if (preferred === 'mm' && nativeDiagonal < 0.5) {
    return { unit: 'm', note: 'Einheit automatisch auf Meter gestellt (sehr kleines Modell).' }
  }
  // „Meter“ gewählt, aber Werte wie typische mm-Koordinaten (z. B. 50–5000)
  if (preferred === 'm' && nativeDiagonal >= 5 && nativeDiagonal <= 50_000) {
    return { unit: 'mm', note: 'Einheit automatisch auf Millimeter gestellt (übliche STL-Größe).' }
  }
  // „cm“ mit klaren mm-Maßen
  if (preferred === 'cm' && nativeDiagonal >= 50 && nativeDiagonal <= 50_000) {
    return { unit: 'mm', note: 'Einheit automatisch auf Millimeter gestellt (übliche STL-Größe).' }
  }
  return { unit: preferred, note: null }
}

export function meshBoundingRadius(mesh: MeshHandle): number {
  let maxR = 0
  for (let i = 0; i < mesh.vertexCount; i++) {
    const x = mesh.positions[i * 3]
    const y = mesh.positions[i * 3 + 1]
    const z = mesh.positions[i * 3 + 2]
    maxR = Math.max(maxR, Math.sqrt(x * x + y * y + z * z))
  }
  return maxR
}

export function disposeVisualRoot(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.geometry?.dispose()
    const disposeMat = (m: THREE.Material) => {
      for (const key of Object.keys(m)) {
        const val = (m as unknown as Record<string, unknown>)[key]
        if (val instanceof THREE.Texture) val.dispose()
      }
      m.dispose()
    }
    if (Array.isArray(child.material)) child.material.forEach(disposeMat)
    else if (child.material) disposeMat(child.material)
  })
}

export function revokeBlobUrls(urls: string[]): void {
  for (const url of urls) URL.revokeObjectURL(url)
}

export async function loadObjAssets(
  files: File[],
  unit: ObjUnit = 'mm',
  onProgress?: LoadProgressCallback,
): Promise<ObjImportResult> {
  const warnings: string[] = []
  const meshFile = findMeshFile(files)
  if (!meshFile) {
    return { ok: false, error: 'Keine OBJ-, STL- oder STEP-Datei gefunden.' }
  }

  const isStep = isStepFileName(meshFile.name)
  const isStl = meshFile.name.toLowerCase().endsWith('.stl')
  const { urls, blobUrls } = buildAssetUrlMap(files)

  try {
    let group: THREE.Group

    reportLoadProgress(onProgress, 'reading', 0)
    await yieldToMain()

    if (isStep) {
      const buffer = await meshFile.arrayBuffer()
      reportLoadProgress(onProgress, 'reading', 100)
      reportLoadProgress(onProgress, 'parsing', 5)
      await yieldToMain()
      const loaded = await loadStepGroup(buffer, unit)
      group = loaded.group
      warnings.push(...loaded.warnings)
      reportLoadProgress(onProgress, 'parsing', 100)
    } else if (isStl) {
      const buffer = await meshFile.arrayBuffer()
      reportLoadProgress(onProgress, 'reading', 100)
      reportLoadProgress(onProgress, 'parsing', 0)
      await yieldToMain()
      group = loadStlGroup(buffer)
      reportLoadProgress(onProgress, 'parsing', 100)
      // Keine Toast-Warnung: fehlende Textur ist bei STL normal.
    } else {
      const textureFile = pickPrimaryTextureFile(meshFile, files, null)
      if (!textureFile && !files.some((f) => f.name.toLowerCase().endsWith('.mtl'))) {
        warnings.push('Tipp (Polycam): OBJ und Textur (.jpg/.png) gemeinsam auswählen.')
      }
      const objText = await meshFile.text()
      reportLoadProgress(onProgress, 'reading', 100)
      reportLoadProgress(onProgress, 'parsing', 0)
      await yieldToMain()
      reportLoadProgress(onProgress, 'textures', 0)
      const loaded = await loadObjGroup(objText, meshFile, files, urls)
      group = loaded.group
      warnings.push(...loaded.warnings)
      reportLoadProgress(onProgress, 'textures', 100)
      reportLoadProgress(onProgress, 'parsing', 100)
    }

    const result = await finalizeLoadedGroupAsync(group, unit, warnings, onProgress)
    if (!result.ok) {
      revokeBlobUrls(blobUrls)
      return { ...result, blobUrls }
    }
    reportLoadProgress(onProgress, 'done', 100)
    return { ...result, blobUrls }
  } catch (err) {
    revokeBlobUrls(blobUrls)
    const msg = err instanceof Error ? err.message : '3D-Datei konnte nicht gelesen werden.'
    return { ok: false, error: msg }
  }
}

export async function parseObjText(text: string, unit: ObjUnit = 'm'): Promise<ObjImportResult> {
  const file = new File([text], 'model.obj', { type: 'text/plain' })
  return loadObjAssets([file], unit)
}

export async function parseStlText(text: string, unit: ObjUnit = 'm'): Promise<ObjImportResult> {
  const file = new File([text], 'model.stl', { type: 'model/stl' })
  return loadObjAssets([file], unit)
}

export async function loadObjFile(file: File, unit: ObjUnit): Promise<ObjImportResult> {
  return loadObjAssets([file], unit)
}

export function meshToBufferGeometry(mesh: MeshHandle): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
  geometry.setIndex(Array.from(mesh.indices))
  geometry.computeVertexNormals()
  return geometry
}

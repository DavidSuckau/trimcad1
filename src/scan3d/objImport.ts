import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import * as THREE from 'three'
import type { MeshHandle, ObjImportResult, ObjUnit } from './types'

const MAX_TRIANGLES = 500_000
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
    color: '#b8c4d0',
    roughness: 0.65,
    metalness: 0.05,
    side: THREE.DoubleSide,
  })
}

function loadStlGroup(buffer: ArrayBuffer): THREE.Group {
  const loader = new STLLoader()
  const geometry = loader.parse(buffer)
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry, defaultScanMaterial())
  const group = new THREE.Group()
  group.add(mesh)
  return group
}

function findMeshFile(files: File[]): File | undefined {
  return files.find((f) => /\.obj$/i.test(f.name)) ?? files.find((f) => /\.stl$/i.test(f.name))
}

function finalizeLoadedGroup(
  group: THREE.Group,
  unit: ObjUnit,
  warnings: string[],
): ObjImportResult & { blobUrls: string[] } {
  const scaleToMm = UNIT_TO_MM[unit]
  applyUnitScale(group, scaleToMm)
  centerObject(group)

  const mesh = mergeAndWeldFromObject(group)
  const triangleCount = mesh.indices.length / 3

  if (triangleCount < 1) return { ok: false, error: 'Mesh enthält keine Dreiecke.', blobUrls: [] }
  if (triangleCount > MAX_TRIANGLES) {
    return { ok: false, error: `Mesh zu groß (${triangleCount} Dreiecke, max. ${MAX_TRIANGLES}).`, blobUrls: [] }
  }
  if (triangleCount > 200_000) {
    warnings.push(`Großes Mesh (${triangleCount} Dreiecke) — Zeichnen kann langsam sein.`)
  }

  return { ok: true, mesh, visualRoot: group, triangleCount, warnings, blobUrls: [] }
}

function weldPositionsIndices(rawPositions: number[], rawIndices: number[]): MeshHandle {
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

  for (const srcIdx of rawIndices) indices.push(mapVertex(srcIdx))

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    vertexCount: positions.length / 3,
  }
}

function mergeAndWeldFromObject(object: THREE.Object3D): MeshHandle {
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
  return weldPositionsIndices(rawPositions, rawIndices)
}

function centerObject(object: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(object)
  const center = box.getCenter(new THREE.Vector3())
  object.position.sub(center)
}

function applyUnitScale(object: THREE.Object3D, scaleToMm: number): void {
  object.scale.multiplyScalar(scaleToMm)
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

export async function loadObjAssets(files: File[], unit: ObjUnit = 'm'): Promise<ObjImportResult> {
  const warnings: string[] = []
  const meshFile = findMeshFile(files)
  if (!meshFile) {
    return { ok: false, error: 'Keine OBJ- oder STL-Datei gefunden.' }
  }

  const isStl = meshFile.name.toLowerCase().endsWith('.stl')
  const { urls, blobUrls } = buildAssetUrlMap(files)

  try {
    let group: THREE.Group

    if (isStl) {
      const buffer = await meshFile.arrayBuffer()
      group = loadStlGroup(buffer)
      warnings.push('STL enthält keine Textur — Modell wird grau dargestellt.')
    } else {
      const textureFile = pickPrimaryTextureFile(meshFile, files, null)
      if (!textureFile && !files.some((f) => f.name.toLowerCase().endsWith('.mtl'))) {
        warnings.push('Tipp (Polycam): OBJ und Textur (.jpg/.png) gemeinsam auswählen.')
      }
      const objText = await meshFile.text()
      const loaded = await loadObjGroup(objText, meshFile, files, urls)
      group = loaded.group
      warnings.push(...loaded.warnings)
    }

    const result = finalizeLoadedGroup(group, unit, warnings)
    if (!result.ok) {
      revokeBlobUrls(blobUrls)
      return { ...result, blobUrls }
    }
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

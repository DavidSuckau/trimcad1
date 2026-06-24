import * as THREE from 'three'
import type { MeshHandle } from './types'

const _viewDir = new THREE.Vector3()
const _normal = new THREE.Vector3()
const _normalMatrix = new THREE.Matrix3()

/** Bevorzugt die zur Kamera gewandte Fläche (verhindert Sprünge auf Rückseiten bei DoubleSide). */
function pickVisibleSurfaceHit(
  camera: THREE.Camera,
  hits: THREE.Intersection[],
): THREE.Intersection | null {
  if (hits.length === 0) return null

  camera.getWorldDirection(_viewDir)

  for (const hit of hits) {
    if (!hit.face) continue
    _normal.copy(hit.face.normal)
    _normalMatrix.getNormalMatrix(hit.object.matrixWorld)
    _normal.applyMatrix3(_normalMatrix).normalize()
    if (_normal.dot(_viewDir) < 0) return hit
  }

  return hits[0]
}

/** Weltpunkt → normalisierte Gerätekoordinaten. */
export function worldToNdc(camera: THREE.Camera, point: THREE.Vector3): THREE.Vector2 {
  const v = point.clone().project(camera)
  return new THREE.Vector2(v.x, v.y)
}

/** Raycast auf dem Modell; null wenn kein Treffer. */
export function raycastSurfaceAtNdc(
  camera: THREE.Camera,
  visualRoot: THREE.Object3D,
  ndc: THREE.Vector2,
): THREE.Vector3 | null {
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(ndc, camera)
  const hits = raycaster.intersectObject(visualRoot, true)
  const hit = pickVisibleSurfaceHit(camera, hits)
  return hit ? hit.point.clone() : null
}

function appendSurfacePoint(flat: number[], x: number, y: number, z: number, minDistMm = 0.5): void {
  if (flat.length >= 3) {
    const lx = flat[flat.length - 3]
    const ly = flat[flat.length - 2]
    const lz = flat[flat.length - 1]
    const dx = x - lx
    const dy = y - ly
    const dz = z - lz
    if (dx * dx + dy * dy + dz * dz < minDistMm * minDistMm) return
  }
  flat.push(x, y, z)
}

/**
 * Linie auf dem Bildschirm abtasten und auf die 3D-Oberfläche projizieren.
 * Erzeugt eine gleichmäßige Naht entlang der sichtbaren Linie (ideal für Gerade-Nähte).
 */
export function sampleSurfaceLineScreen(
  camera: THREE.Camera,
  visualRoot: THREE.Object3D,
  startNdc: THREE.Vector2,
  endNdc: THREE.Vector2,
  sampleCount: number,
): number[] {
  const flat: number[] = []
  const ndc = new THREE.Vector2()
  const steps = Math.max(2, sampleCount)

  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    ndc.set(
      startNdc.x + (endNdc.x - startNdc.x) * t,
      startNdc.y + (endNdc.y - startNdc.y) * t,
    )
    const hit = raycastSurfaceAtNdc(camera, visualRoot, ndc)
    if (!hit) continue
    appendSurfacePoint(flat, hit.x, hit.y, hit.z)
  }
  return flat
}

function samplesForSegment(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const dx = bx - ax
  const dy = by - ay
  const dz = bz - az
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
  return Math.min(32, Math.max(4, Math.ceil(len / 12)))
}

/**
 * Anzeige-Punkte für eine Naht: jedes Segment wird per Bildschirm-Raycast auf der Oberfläche verdichtet.
 * Keine 3D-Kurven-Glättung — die würde bei unebenen Scans durch das Modell schneiden.
 */
export function buildSeamDisplayPoints(
  camera: THREE.Camera,
  visualRoot: THREE.Object3D,
  flat: number[],
): THREE.Vector3[] {
  const out: THREE.Vector3[] = []
  const pointCount = flat.length / 3
  if (pointCount === 0) return out

  const push = (x: number, y: number, z: number) => {
    if (out.length > 0) {
      const p = out[out.length - 1]
      const dx = x - p.x
      const dy = y - p.y
      const dz = z - p.z
      if (dx * dx + dy * dy + dz * dz < 0.25) return
    }
    out.push(new THREE.Vector3(x, y, z))
  }

  push(flat[0], flat[1], flat[2])

  for (let i = 0; i + 1 < pointCount; i++) {
    const ax = flat[i * 3]
    const ay = flat[i * 3 + 1]
    const az = flat[i * 3 + 2]
    const bx = flat[(i + 1) * 3]
    const by = flat[(i + 1) * 3 + 1]
    const bz = flat[(i + 1) * 3 + 2]

    const startNdc = worldToNdc(camera, new THREE.Vector3(ax, ay, az))
    const endNdc = worldToNdc(camera, new THREE.Vector3(bx, by, bz))
    const seg = sampleSurfaceLineScreen(camera, visualRoot, startNdc, endNdc, samplesForSegment(ax, ay, az, bx, by, bz))

    for (let j = 3; j < seg.length; j += 3) {
      push(seg[j], seg[j + 1], seg[j + 2])
    }
  }

  return out
}

export function vertexPathToDisplayPoints(mesh: MeshHandle, vertexPath: number[]): THREE.Vector3[] {
  return vertexPath.map((vi) => {
    const i = vi * 3
    return new THREE.Vector3(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2])
  })
}

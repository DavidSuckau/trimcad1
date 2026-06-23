import * as THREE from 'three'

function collectMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  root.updateMatrixWorld(true)
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) meshes.push(child)
  })
  return meshes
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
  return hits[0] ? hits[0].point.clone() : null
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
    if (flat.length >= 3) {
      const lx = flat[flat.length - 3]
      const ly = flat[flat.length - 2]
      const lz = flat[flat.length - 1]
      const dx = hit.x - lx
      const dy = hit.y - ly
      const dz = hit.z - lz
      if (dx * dx + dy * dy + dz * dz < 0.25) continue
    }
    flat.push(hit.x, hit.y, hit.z)
  }
  return flat
}

/** Glättungskurve wieder auf die Mesh-Oberfläche projizieren (entlang Kamera- und Mittelachse). */
export function projectPointsOntoSurface(
  visualRoot: THREE.Object3D,
  camera: THREE.Camera,
  points: THREE.Vector3[],
): THREE.Vector3[] {
  const meshes = collectMeshes(visualRoot)
  if (meshes.length === 0) return points

  const raycaster = new THREE.Raycaster()
  const camPos = new THREE.Vector3()
  camera.getWorldPosition(camPos)

  return points.map((p) => {
    const toCam = camPos.clone().sub(p)
    if (toCam.lengthSq() < 1e-8) toCam.set(0, 0, 1)
    toCam.normalize()

    const fromCenter = p.clone().negate()
    if (fromCenter.lengthSq() < 1e-8) fromCenter.set(0, 1, 0)
    fromCenter.normalize()

    const dirs = [toCam, toCam.clone().negate(), fromCenter, fromCenter.clone().negate()]
    let best: THREE.Vector3 | null = null
    let bestDist = Infinity

    for (const dir of dirs) {
      const origin = p.clone().add(dir.clone().multiplyScalar(800))
      raycaster.set(origin, dir.clone().negate())
      const hits = raycaster.intersectObjects(meshes, false)
      if (hits[0] && hits[0].distance < bestDist) {
        bestDist = hits[0].distance
        best = hits[0].point.clone()
      }
    }

    return best ?? p.clone()
  })
}

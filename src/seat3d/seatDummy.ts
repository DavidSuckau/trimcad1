import * as THREE from 'three'
import { SEAT_MM } from './bendPiece'

/** Einfacher Autositz-Dummy (Kissen + Lehne), nur Visualisierung. */
export function createSeatDummyGroup(): THREE.Group {
  const g = new THREE.Group()
  g.name = 'seatDummy'

  const foam = new THREE.MeshStandardMaterial({
    color: '#5c6570',
    roughness: 0.85,
    metalness: 0.05,
    side: THREE.DoubleSide,
  })
  const trim = new THREE.MeshStandardMaterial({
    color: '#3d4450',
    roughness: 0.7,
    metalness: 0.1,
  })

  // Sitzkissen (leicht gewölbte Box)
  const cushionGeo = new THREE.BoxGeometry(SEAT_MM.cushionW, 60, SEAT_MM.cushionD, 16, 1, 16)
  const cPos = cushionGeo.attributes.position
  for (let i = 0; i < cPos.count; i++) {
    const x = cPos.getX(i)
    const y = cPos.getY(i)
    const z = cPos.getZ(i)
    if (y > 0) {
      const nx = x / (SEAT_MM.cushionW / 2)
      const nz = z / (SEAT_MM.cushionD / 2)
      cPos.setY(i, y - 10 * (nx * nx * 0.7 + nz * nz))
    }
  }
  cPos.needsUpdate = true
  cushionGeo.computeVertexNormals()
  const cushion = new THREE.Mesh(cushionGeo, foam)
  cushion.position.set(0, SEAT_MM.cushionY - 30, 0)
  cushion.castShadow = true
  cushion.receiveShadow = true
  g.add(cushion)

  // Lehne als gebogenes Segment (Extrude entlang Bogen)
  const backShape = new THREE.Shape()
  const hw = SEAT_MM.backW / 2
  backShape.moveTo(-hw, -20)
  backShape.lineTo(hw, -20)
  backShape.lineTo(hw, 20)
  backShape.lineTo(-hw, 20)
  backShape.closePath()
  const backGeo = new THREE.ExtrudeGeometry(backShape, {
    steps: 24,
    depth: SEAT_MM.backH,
    bevelEnabled: false,
  })
  // Extrude geht in +Z; wir biegen Z→Bogen in YZ
  const bPos = backGeo.attributes.position
  const R = SEAT_MM.backRadius
  for (let i = 0; i < bPos.count; i++) {
    const x = bPos.getX(i)
    const yLocal = bPos.getY(i) // Dicke ±20
    const zArc = bPos.getZ(i) // 0…backH
    const angle = zArc / R
    const py = SEAT_MM.backBaseY + R * Math.sin(angle) + yLocal * Math.cos(angle)
    const pz = SEAT_MM.backBaseZ - R * (1 - Math.cos(angle)) - yLocal * Math.sin(angle)
    bPos.setXYZ(i, x, py, pz)
  }
  bPos.needsUpdate = true
  backGeo.computeVertexNormals()
  const back = new THREE.Mesh(backGeo, foam)
  back.castShadow = true
  back.receiveShadow = true
  g.add(back)

  // Bodenplatte / Fuß
  const base = new THREE.Mesh(new THREE.CylinderGeometry(80, 100, 40, 24), trim)
  base.position.set(0, 40, 40)
  g.add(base)

  return g
}

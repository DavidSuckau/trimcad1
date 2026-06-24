import type { OcctJSModule, OcctJSReadParams, OcctJSResult } from '@tx-code/occt-js'
import * as THREE from 'three'
import type { ObjUnit } from './types'

const STEP_UNIT: Record<ObjUnit, NonNullable<OcctJSReadParams['linearUnit']>> = {
  mm: 'millimeter',
  cm: 'centimeter',
  m: 'meter',
}

let occtModulePromise: Promise<OcctJSModule> | null = null

async function getOcctModule(): Promise<OcctJSModule> {
  if (!occtModulePromise) {
    occtModulePromise = (async () => {
      const [{ default: OcctJS }, { default: wasmUrl }] = await Promise.all([
        import('@tx-code/occt-js'),
        import('@tx-code/occt-js/dist/occt-js.wasm?url'),
      ])
      return OcctJS({
        locateFile: (file) => (file.endsWith('.wasm') ? wasmUrl : file),
      })
    })()
  }
  return occtModulePromise
}

export function isStepFileName(name: string): boolean {
  return /\.(step|stp)$/i.test(name)
}

function geometryMaterial(geo: NonNullable<OcctJSResult['geometries']>[number]): THREE.MeshStandardMaterial {
  const color =
    geo.color != null
      ? new THREE.Color(geo.color.r, geo.color.g, geo.color.b)
      : new THREE.Color('#b8c4d0')
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.65,
    metalness: 0.05,
    side: THREE.DoubleSide,
  })
}

function geometriesToGroup(geometries: NonNullable<OcctJSResult['geometries']>): THREE.Group {
  const group = new THREE.Group()
  for (const geo of geometries) {
    if (geo.positions.length < 9 || geo.indices.length < 3) continue
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(geo.positions, 3))
    if (geo.normals.length === geo.positions.length) {
      geometry.setAttribute('normal', new THREE.BufferAttribute(geo.normals, 3))
    } else {
      geometry.computeVertexNormals()
    }
    geometry.setIndex(new THREE.BufferAttribute(geo.indices, 1))
    const mesh = new THREE.Mesh(geometry, geometryMaterial(geo))
    mesh.name = geo.name || 'step-part'
    group.add(mesh)
  }
  if (group.children.length === 0) {
    throw new Error('STEP-Datei enthält keine triangulierte Geometrie.')
  }
  return group
}

export async function loadStepGroup(buffer: ArrayBuffer, unit: ObjUnit): Promise<{ group: THREE.Group; warnings: string[] }> {
  const warnings: string[] = []
  const occt = await getOcctModule()
  const params: OcctJSReadParams = {
    rootMode: 'one-shape',
    linearUnit: STEP_UNIT[unit],
    linearDeflectionType: 'bounding_box_ratio',
    linearDeflection: 0.08,
    angularDeflection: 0.5,
    readNames: true,
    readColors: true,
  }

  const result = occt.ReadStepFile(new Uint8Array(buffer), params)
  if (!result.success) {
    throw new Error(result.error || 'STEP-Datei konnte nicht gelesen werden.')
  }

  if (result.warnings?.length) {
    warnings.push('STEP-Import mit Hinweisen — Modell wurde trotzdem geladen.')
  }
  if (result.sourceUnit && result.sourceUnit !== STEP_UNIT[unit]) {
    warnings.push(`STEP-Einheit im Modell: ${result.sourceUnit}.`)
  }

  const triangleCount = result.stats?.triangleCount ?? 0
  if (triangleCount > 500_000) {
    throw new Error(`STEP-Modell zu groß (${triangleCount} Dreiecke, max. 500.000).`)
  }
  if (triangleCount > 200_000) {
    warnings.push(`Großes STEP-Modell (${triangleCount} Dreiecke) — Zeichnen kann langsam sein.`)
  }

  warnings.push('STEP enthält keine Textur — Modell wird mit CAD-Farben oder grau dargestellt.')
  return { group: geometriesToGroup(result.geometries ?? []), warnings }
}

/** Alle 3D-Koordinaten in mm. */

import type * as THREE from 'three'

export type ObjUnit = 'mm' | 'cm' | 'm'

export type MeshHandle = {
  positions: Float32Array
  indices: Uint32Array
  vertexCount: number
}

export type Scan3dSeam = {
  id: string
  /** Exakte Oberflächenpunkte des Strichs (mm, xyz interleaved) — Basis für Anzeige */
  surfacePoints: number[]
  /** Topologischer Pfad auf dem Mesh — wird beim Abschließen abgeleitet */
  vertexPath: number[]
  closed: boolean
}

export type Scan3dTool = 'navigate' | 'drawSeam' | 'drawLine'

export type Scan3dSession = {
  fileName: string
  mesh: MeshHandle
  /** Three.js-Objekt mit Materialien/Texturen (skaliert, zentriert) */
  visualRoot: THREE.Object3D
  blobUrls: string[]
  seams: Scan3dSeam[]
  activeSeamId: string | null
  /** Vorschau-Punkte für Gerade-Naht (xyz interleaved) */
  linePreviewPoints: number[]
  showWireframe: boolean
  tool: Scan3dTool
  unit: ObjUnit
}

export type ObjImportResult =
  | { ok: true; mesh: MeshHandle; visualRoot: THREE.Object3D; triangleCount: number; warnings: string[]; blobUrls: string[] }
  | { ok: false; error: string; blobUrls?: string[] }

export type MeshGraph = {
  vertexCount: number
  neighbors: number[][]
  edgeWeights: Map<string, number>
}

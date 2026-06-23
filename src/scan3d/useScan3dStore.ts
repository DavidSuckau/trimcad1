import { create } from 'zustand'
import { buildMeshGraphAsync } from './meshGraph'
import {
  rebuildVertexPathFromSurface,
  simplifySurfacePolyline,
} from './geodesicPath'
import { disposeVisualRoot, loadObjAssets, meshBoundingRadius, revokeBlobUrls } from './objImport'
import * as THREE from 'three'
import type { MeshGraph, MeshHandle, ObjUnit, Scan3dLoadPhase, Scan3dSession, Scan3dTool } from './types'

function snapRadiusMm(mesh: MeshHandle): number {
  return Math.max(15, meshBoundingRadius(mesh) * 0.035)
}

function simplifySurfaceEpsilonMm(mesh: MeshHandle): number {
  return Math.max(8, meshBoundingRadius(mesh) * 0.018)
}

function generateId(): string {
  return `s3d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function appendSurfacePoint(seam: { surfacePoints: number[] }, x: number, y: number, z: number): number[] {
  const pts = [...seam.surfacePoints]
  if (pts.length >= 3) {
    const lx = pts[pts.length - 3]
    const ly = pts[pts.length - 2]
    const lz = pts[pts.length - 1]
    if (lx === x && ly === y && lz === z) return pts
  }
  pts.push(x, y, z)
  return pts
}

type Scan3dState = {
  session: Scan3dSession | null
  meshGraph: MeshGraph | null
  loadError: string | null
  loadWarnings: string[]
  isLoading: boolean
  loadProgress: number
  loadPhase: Scan3dLoadPhase | null
  loadLabel: string
  pendingUnit: ObjUnit
  setPendingUnit: (unit: ObjUnit) => void
  loadObjAssets: (files: File[]) => Promise<void>
  closeSession: () => void
  setTool: (tool: Scan3dTool) => void
  toggleWireframe: () => void
  setLinePreview: (points: number[]) => void
  addSeamFromSurfacePoints: (surfacePoints: number[]) => void
  startSeamAtPoint: (x: number, y: number, z: number) => void
  extendActiveSeamToPoint: (x: number, y: number, z: number) => void
  simplifyActiveSeam: () => void
  finishActiveSeam: () => void
  cancelActiveSeam: () => void
  deleteSeam: (id: string) => void
  undoLastSegment: () => void
  selectSeam: (id: string | null) => void
}

function cleanupSession(session: Scan3dSession | null): void {
  if (!session) return
  disposeVisualRoot(session.visualRoot)
  revokeBlobUrls(session.blobUrls)
}

export const useScan3dStore = create<Scan3dState>((set, get) => ({
  session: null,
  meshGraph: null,
  loadError: null,
  loadWarnings: [],
  isLoading: false,
  loadProgress: 0,
  loadPhase: null,
  loadLabel: '',
  pendingUnit: 'm',

  setPendingUnit: (unit) => set({ pendingUnit: unit }),

  loadObjAssets: async (files) => {
    const unit = get().pendingUnit
    const prev = get().session
    if (prev) cleanupSession(prev)

    set({
      isLoading: true,
      loadProgress: 2,
      loadPhase: 'reading',
      loadLabel: 'Datei wird gelesen…',
      loadError: null,
      loadWarnings: [],
      session: null,
      meshGraph: null,
    })

    const result = await loadObjAssets(files, unit, (progress) => {
      set({
        loadProgress: progress.pct,
        loadPhase: progress.phase,
        loadLabel: progress.label,
      })
    })

    if (!result.ok) {
      if (result.blobUrls) revokeBlobUrls(result.blobUrls)
      set({
        loadError: result.error,
        loadWarnings: [],
        session: null,
        meshGraph: null,
        isLoading: false,
        loadProgress: 0,
        loadPhase: null,
        loadLabel: '',
      })
      return
    }

    set({
      loadProgress: 85,
      loadPhase: 'graph',
      loadLabel: 'Kantengraph wird erstellt…',
    })

    const graph = await buildMeshGraphAsync(result.mesh, (subPct) => {
      const pct = Math.round(82 + (subPct / 100) * 16)
      set({
        loadProgress: pct,
        loadPhase: 'graph',
        loadLabel: 'Kantengraph wird erstellt…',
      })
    })

    const meshFile = files.find((f) => /\.(obj|stl)$/i.test(f.name))
    const session: Scan3dSession = {
      fileName: meshFile?.name ?? 'model',
      mesh: result.mesh,
      visualRoot: result.visualRoot,
      blobUrls: result.blobUrls,
      seams: [],
      activeSeamId: null,
      linePreviewPoints: [],
      showWireframe: false,
      tool: 'navigate',
      unit,
    }
    set({
      session,
      meshGraph: graph,
      loadError: null,
      loadWarnings: result.warnings,
      isLoading: false,
      loadProgress: 100,
      loadPhase: 'done',
      loadLabel: 'Fertig',
    })
  },

  closeSession: () => {
    const prev = get().session
    cleanupSession(prev)
    set({
      session: null,
      meshGraph: null,
      loadError: null,
      loadWarnings: [],
      isLoading: false,
      loadProgress: 0,
      loadPhase: null,
      loadLabel: '',
    })
  },

  setTool: (tool) =>
    set((s) => {
      if (!s.session) return s
      return { session: { ...s.session, tool, linePreviewPoints: [] } }
    }),

  toggleWireframe: () =>
    set((s) => {
      if (!s.session) return s
      const show = !s.session.showWireframe
      s.session.visualRoot.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return
        const mats = Array.isArray(child.material) ? child.material : [child.material]
        for (const m of mats) {
          if (!m) continue
          m.wireframe = show
          m.needsUpdate = true
        }
      })
      return { session: { ...s.session, showWireframe: show } }
    }),

  setLinePreview: (points) =>
    set((s) => {
      if (!s.session) return s
      return { session: { ...s.session, linePreviewPoints: points } }
    }),

  addSeamFromSurfacePoints: (surfacePoints) => {
    const { session, meshGraph } = get()
    if (!session || !meshGraph || surfacePoints.length < 6) return

    const simplified = simplifySurfacePolyline(surfacePoints, simplifySurfaceEpsilonMm(session.mesh))
    const vertexPath = rebuildVertexPathFromSurface(
      session.mesh,
      meshGraph,
      simplified,
      snapRadiusMm(session.mesh),
    )
    const id = generateId()
    const seam = { id, surfacePoints: simplified, vertexPath, closed: false }
    set({
      session: {
        ...session,
        seams: [...session.seams, seam],
        activeSeamId: null,
        linePreviewPoints: [],
      },
    })
  },

  startSeamAtPoint: (x, y, z) => {
    set((s) => {
      if (!s.session) return s
      const id = generateId()
      const seam = { id, surfacePoints: [x, y, z], vertexPath: [], closed: false }
      return {
        session: {
          ...s.session,
          seams: [...s.session.seams, seam],
          activeSeamId: id,
        },
      }
    })
  },

  extendActiveSeamToPoint: (x, y, z) => {
    const { session } = get()
    if (!session || !session.activeSeamId) return

    const seamIdx = session.seams.findIndex((se) => se.id === session.activeSeamId)
    if (seamIdx < 0) return
    const seam = session.seams[seamIdx]
    if (seam.closed) return

    const surfacePoints = appendSurfacePoint(seam, x, y, z)
    const seams = [...session.seams]
    seams[seamIdx] = { ...seam, surfacePoints }

    set({ session: { ...session, seams } })
  },

  simplifyActiveSeam: () => {
    const { session } = get()
    if (!session || !session.activeSeamId) return

    const seamIdx = session.seams.findIndex((se) => se.id === session.activeSeamId)
    if (seamIdx < 0) return
    const seam = session.seams[seamIdx]
    if (seam.surfacePoints.length < 9) return

    const surfacePoints = simplifySurfacePolyline(seam.surfacePoints, simplifySurfaceEpsilonMm(session.mesh))
    const seams = [...session.seams]
    seams[seamIdx] = { ...seam, surfacePoints }
    set({ session: { ...session, seams } })
  },

  finishActiveSeam: () => {
    const { session, meshGraph } = get()
    if (!session || !meshGraph || !session.activeSeamId) return

    get().simplifyActiveSeam()

    const fresh = get().session
    if (!fresh || !fresh.activeSeamId) return

    const activeId = fresh.activeSeamId
    const seams = fresh.seams.map((se) => {
      if (se.id !== activeId) return se
      const surfacePoints =
        se.surfacePoints.length >= 6
          ? simplifySurfacePolyline(se.surfacePoints, simplifySurfaceEpsilonMm(fresh.mesh))
          : se.surfacePoints
      const vertexPath = rebuildVertexPathFromSurface(
        fresh.mesh,
        meshGraph,
        surfacePoints,
        snapRadiusMm(fresh.mesh),
      )
      const closed =
        surfacePoints.length >= 9 &&
        distSurfacePoints(surfacePoints, 0, surfacePoints.length - 3) <
          simplifySurfaceEpsilonMm(fresh.mesh) * 2
      return { ...se, surfacePoints, vertexPath, closed }
    })

    set({ session: { ...fresh, seams, activeSeamId: null, linePreviewPoints: [] } })
  },

  cancelActiveSeam: () =>
    set((s) => {
      if (!s.session || !s.session.activeSeamId) return s
      const activeId = s.session.activeSeamId
      const active = s.session.seams.find((se) => se.id === activeId)
      const seams =
        active && active.surfacePoints.length <= 3
          ? s.session.seams.filter((se) => se.id !== activeId)
          : s.session.seams
      return { session: { ...s.session, seams, activeSeamId: null } }
    }),

  deleteSeam: (id) =>
    set((s) => {
      if (!s.session) return s
      return {
        session: {
          ...s.session,
          seams: s.session.seams.filter((se) => se.id !== id),
          activeSeamId: s.session.activeSeamId === id ? null : s.session.activeSeamId,
        },
      }
    }),

  undoLastSegment: () =>
    set((s) => {
      if (!s.session || !s.session.activeSeamId) return s
      const seamIdx = s.session.seams.findIndex((se) => se.id === s.session!.activeSeamId)
      if (seamIdx < 0) return s
      const seam = s.session.seams[seamIdx]
      if (seam.surfacePoints.length <= 3) {
        const seams = s.session.seams.filter((se) => se.id !== seam.id)
        return { session: { ...s.session, seams, activeSeamId: null } }
      }
      const seams = [...s.session.seams]
      seams[seamIdx] = { ...seam, surfacePoints: seam.surfacePoints.slice(0, -3), vertexPath: [] }
      return { session: { ...s.session, seams } }
    }),

  selectSeam: (id) =>
    set((s) => {
      if (!s.session) return s
      return { session: { ...s.session, activeSeamId: id } }
    }),
}))

function distSurfacePoints(flat: number[], i: number, j: number): number {
  const dx = flat[i] - flat[j]
  const dy = flat[i + 1] - flat[j + 1]
  const dz = flat[i + 2] - flat[j + 2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

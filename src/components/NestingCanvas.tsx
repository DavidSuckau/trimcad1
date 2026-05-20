import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PatternPiece } from '../types/model'
import type { NestingPlan, NestingPartGeometry } from '../nesting/nestingTypes'
import { transformPlacementGrain, transformPlacementPolygon } from '../nesting/nestingGeometry'
import { pieceInteriorFillFromMaterial } from '../theme/materialFillColor'

const VIEW_PAD_MM = 48

type PlanProps = {
  mode: 'plan'
  plan: NestingPlan
  pieces: PatternPiece[]
  geometries: Map<string, NestingPartGeometry>
  materialKey: string
}

type PreviewProps = {
  mode: 'preview'
  rollWidthMm: number
  materialLabel: string
  hint?: string
}

type Props = PlanProps | PreviewProps

function fitZoomToContainer(
  clientWidth: number,
  clientHeight: number,
  rollW: number,
  rollH: number,
): number {
  const pad = VIEW_PAD_MM
  const z = 0.92 * Math.min(
    Math.max(1, clientWidth - pad) / Math.max(rollW, 1),
    Math.max(1, clientHeight - pad) / Math.max(rollH, 1),
  )
  return Math.max(0.02, Math.min(3, z))
}

export function NestingCanvas(props: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(0.35)

  const planProps = props.mode === 'plan' ? props : null
  const rollW = planProps ? planProps.plan.rollWidthMm : props.mode === 'preview' ? props.rollWidthMm : 0
  const rollH = planProps
    ? Math.max(planProps.plan.usedLengthMm, 80)
    : props.mode === 'preview'
      ? Math.max(props.rollWidthMm * 2.5, 1200)
      : 0

  const applyFitZoom = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    setZoom(fitZoomToContainer(el.clientWidth, el.clientHeight, rollW, rollH))
  }, [rollW, rollH])

  const fitKey = planProps ? planProps.plan.placements.length : props.mode === 'preview' ? props.rollWidthMm : 0

  useLayoutEffect(() => {
    applyFitZoom()
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => applyFitZoom())
    ro.observe(el)
    return () => ro.disconnect()
  }, [applyFitZoom, fitKey])

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY > 0 ? 0.92 : 1.08
    setZoom((z) => Math.min(3, Math.max(0.02, z * factor)))
  }, [])

  const vbW = rollW / zoom + VIEW_PAD_MM * 2
  const vbH = rollH / zoom + VIEW_PAD_MM * 2

  const pieceById = useMemo(
    () => new Map((planProps?.pieces ?? []).map((p) => [p.id, p])),
    [planProps?.pieces],
  )

  const fill = useMemo(
    () => (planProps ? (pieceInteriorFillFromMaterial(planProps.materialKey, false) ?? '#f5e6a8') : ''),
    [planProps?.materialKey],
  )

  const placements = useMemo(() => {
    if (!planProps) return null
    const { plan, geometries } = planProps
    return plan.placements.map((pl, idx) => {
      const geom = geometries.get(pl.pieceId)
      const piece = pieceById.get(pl.pieceId)
      if (!geom || !piece) return null
      const pts = transformPlacementPolygon(geom, pl)
      const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z'
      const grain = transformPlacementGrain(geom, pl)
      return (
        <g key={`${pl.pieceId}-${pl.instanceIndex}-${idx}`}>
          <path d={d} fill={fill} fillOpacity={0.85} stroke="#333" strokeWidth={1.2 / zoom} />
          <line
            x1={grain.start.x}
            y1={grain.start.y}
            x2={grain.end.x}
            y2={grain.end.y}
            stroke="#c62828"
            strokeWidth={1.5 / zoom}
            markerEnd="url(#nest-grain-arrow)"
          />
          <text
            x={grain.start.x + 4}
            y={grain.start.y - 4}
            fontSize={10 / zoom}
            fill="#333"
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            {piece.name}
          </text>
        </g>
      )
    })
  }, [planProps, pieceById, fill, zoom])

  const rollRect = (
    <>
      <rect
        x={0}
        y={0}
        width={rollW}
        height={rollH}
        fill="#f4f0e6"
        stroke="#6b5b45"
        strokeWidth={2 / zoom}
      />
      <line x1={0} y1={0} x2={rollW} y2={0} stroke="#c4b89a" strokeWidth={1 / zoom} strokeDasharray={`${12 / zoom} ${8 / zoom}`} />
      <text x={8} y={20 / zoom} fontSize={14 / zoom} fill="#5c4f3a" fontWeight={600}>
        Stoffbahn · {rollW} mm breit
        {planProps ? ` · ${(planProps.plan.usedLengthMm / 1000).toFixed(3)} m Länge` : ''}
      </text>
    </>
  )

  if (props.mode === 'preview') {
    return (
      <div className="nesting-canvas-wrap" ref={wrapRef} onWheel={onWheel} style={{ touchAction: 'none' }}>
        <svg
          className="nesting-canvas-svg"
          viewBox={`${-VIEW_PAD_MM} ${-VIEW_PAD_MM} ${vbW} ${vbH}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Stoffbahn Vorschau"
        >
          {rollRect}
          <text
            x={rollW / 2}
            y={rollH / 2}
            textAnchor="middle"
            fontSize={16 / zoom}
            fill="#888"
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            {props.hint ?? '„Zuschnitt berechnen“ für die Belegung'}
          </text>
          <text
            x={rollW / 2}
            y={rollH / 2 + 22 / zoom}
            textAnchor="middle"
            fontSize={12 / zoom}
            fill="#aaa"
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            {props.materialLabel}
          </text>
        </svg>
        <div className="nesting-canvas-toolbar">
          <button type="button" className="nesting-canvas-tool" onClick={applyFitZoom} title="Gesamtansicht">
            Einpassen
          </button>
          <span className="nesting-canvas-hint">Mausrad: Zoom</span>
        </div>
      </div>
    )
  }

  return (
    <div className="nesting-canvas-wrap" ref={wrapRef} onWheel={onWheel} style={{ touchAction: 'none' }}>
      <svg
        className="nesting-canvas-svg"
        viewBox={`${-VIEW_PAD_MM} ${-VIEW_PAD_MM} ${vbW} ${vbH}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Zuschnittplan auf Stoffbahn"
      >
        <defs>
          <marker id="nest-grain-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#c62828" />
          </marker>
        </defs>
        {rollRect}
        {placements}
      </svg>
      <div className="nesting-canvas-toolbar">
        <button type="button" className="nesting-canvas-tool" onClick={applyFitZoom} title="Gesamtansicht">
          Einpassen
        </button>
        <span className="nesting-canvas-hint">Mausrad: Zoom · Kette nach unten (+Y)</span>
      </div>
    </div>
  )
}

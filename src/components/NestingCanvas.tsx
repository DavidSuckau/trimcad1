import { useCallback, useMemo, useRef, useState } from 'react'
import type { PatternPiece } from '../types/model'
import type { NestingPlan, NestingPartGeometry } from '../nesting/nestingTypes'
import { transformPlacementGrain, transformPlacementPolygon } from '../nesting/nestingGeometry'
import { pieceInteriorFillFromMaterial } from '../theme/materialFillColor'

type Props = {
  plan: NestingPlan
  pieces: PatternPiece[]
  geometries: Map<string, NestingPartGeometry>
  materialKey: string
}

export function NestingCanvas({ plan, pieces, geometries, materialKey }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [zoom, setZoom] = useState(0.35)
  const [pan] = useState({ x: 40, y: 40 })

  const pieceById = useMemo(() => new Map(pieces.map((p) => [p.id, p])), [pieces])
  const fill = pieceInteriorFillFromMaterial(materialKey, false) ?? '#f5e6a8'

  const rollW = plan.rollWidthMm
  const rollH = Math.max(plan.usedLengthMm, 50)

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY > 0 ? 0.92 : 1.08
    setZoom((z) => Math.min(3, Math.max(0.05, z * factor)))
  }, [])

  const placements = plan.placements.map((pl, idx) => {
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

  const vbW = rollW / zoom + 80
  const vbH = rollH / zoom + 80

  return (
    <div className="nesting-canvas-wrap" onWheel={onWheel} style={{ touchAction: 'none' }}>
      <svg
        ref={svgRef}
        className="nesting-canvas-svg"
        viewBox={`${-pan.x} ${-pan.y} ${vbW} ${vbH}`}
        role="img"
        aria-label="Zuschnittplan"
      >
        <defs>
          <marker id="nest-grain-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#c62828" />
          </marker>
        </defs>
        <rect
          x={0}
          y={0}
          width={rollW}
          height={rollH}
          fill="#fafafa"
          stroke="#888"
          strokeWidth={2 / zoom}
          strokeDasharray={`${8 / zoom} ${4 / zoom}`}
        />
        <text x={4} y={12} fontSize={12 / zoom} fill="#666">
          Rollenbreite {rollW} mm · Verbrauch {(plan.usedLengthMm / 1000).toFixed(3)} m
        </text>
        {placements}
      </svg>
      <div className="nesting-canvas-hint">Mausrad: Zoom</div>
    </div>
  )
}

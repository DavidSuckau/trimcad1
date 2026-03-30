import { MATERIAL_PIE_COLORS } from '../bom/materialAreaShare'
import type { MaterialAreaShare } from '../bom/materialAreaShare'

type Props = {
  shares: MaterialAreaShare[]
}

function fmtPct(p: number): string {
  return p.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

function slicePath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const rad = Math.PI / 180
  const t0 = (startDeg - 90) * rad
  const t1 = (endDeg - 90) * rad
  const x0 = cx + r * Math.cos(t0)
  const y0 = cy + r * Math.sin(t0)
  const x1 = cx + r * Math.cos(t1)
  const y1 = cy + r * Math.sin(t1)
  const delta = endDeg - startDeg
  const largeArc = delta > 180 ? 1 : 0
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1} Z`
}

export function StuecklisteMaterialPie({ shares }: Props) {
  if (shares.length === 0) return null

  const size = 168
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 4
  let angle = 0
  const totalArea = shares.reduce((s, x) => s + x.totalAreaM2, 0)

  const single = shares.length === 1

  return (
    <div className="stueckliste-material-pie" aria-label="Flächenanteil je Material">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="stueckliste-material-pie-svg">
        {single ? (
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill={MATERIAL_PIE_COLORS[0]}
            stroke="#fff"
            strokeWidth="1"
          />
        ) : (
          shares.map((row, i) => {
            const sweep = totalArea > 0 ? (row.totalAreaM2 / totalArea) * 360 : 360 / shares.length
            const start = angle
            const end = angle + sweep
            angle = end
            const color = MATERIAL_PIE_COLORS[i % MATERIAL_PIE_COLORS.length]
            return <path key={row.materialKey || `m-${i}`} d={slicePath(cx, cy, r, start, end)} fill={color} stroke="#fff" strokeWidth="1" />
          })
        )}
      </svg>
      <ul className="stueckliste-material-pie-legend">
        {shares.map((row, i) => (
          <li key={row.materialKey || `leg-${i}`}>
            <span className="stueckliste-material-pie-swatch" style={{ background: MATERIAL_PIE_COLORS[i % MATERIAL_PIE_COLORS.length] }} />
            <span className="stueckliste-material-pie-legend-text">
              <span className="stueckliste-material-pie-name">{row.label}</span>
              <span className="stueckliste-material-pie-pct">{fmtPct(row.pct)}&nbsp;%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

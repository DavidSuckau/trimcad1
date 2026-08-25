import { useMemo } from 'react'
import type { FeedbackIssueWithMeta } from './feedbackIssueFilter'
import {
  buildFeedbackTrend,
  buildTrendChartGeometry,
  formatTrendDate,
} from './feedbackTrend'

type Props = {
  issues: FeedbackIssueWithMeta[]
}

export function FeedbackTrendChart({ issues }: Props) {
  const geom = useMemo(() => {
    const trend = buildFeedbackTrend(issues)
    return buildTrendChartGeometry(trend)
  }, [issues])

  if (!geom || geom.points.length < 1) return null

  const first = geom.points[0]!
  const last = geom.points[geom.points.length - 1]!
  const yTicks = [0, Math.ceil(geom.maxY / 2), geom.maxY]

  return (
    <div className="dev-feedback-chart-wrap">
      <div className="dev-feedback-chart-legend">
        <span className="dev-feedback-chart-legend-item dev-feedback-chart-legend-item--open">
          <span className="dev-feedback-chart-swatch" /> Offen
        </span>
        <span className="dev-feedback-chart-legend-item dev-feedback-chart-legend-item--closed">
          <span className="dev-feedback-chart-swatch" /> Abgeschlossen
        </span>
      </div>
      <svg
        className="dev-feedback-chart"
        viewBox={`0 0 ${geom.width} ${geom.height}`}
        role="img"
        aria-label="Verlauf offene und abgeschlossene Feedback-Einträge"
      >
        {yTicks.map((v) => {
          const y =
            geom.padding.top +
            (geom.height - geom.padding.top - geom.padding.bottom) -
            (v / geom.maxY) * (geom.height - geom.padding.top - geom.padding.bottom)
          return (
            <g key={v}>
              <line
                x1={geom.padding.left}
                y1={y}
                x2={geom.width - geom.padding.right}
                y2={y}
                className="dev-feedback-chart-grid"
              />
              <text x={geom.padding.left - 6} y={y + 4} className="dev-feedback-chart-axis" textAnchor="end">
                {v}
              </text>
            </g>
          )
        })}
        <path d={geom.closedPath} className="dev-feedback-chart-line dev-feedback-chart-line--closed" fill="none" />
        <path d={geom.openPath} className="dev-feedback-chart-line dev-feedback-chart-line--open" fill="none" />
        {geom.closedDots.map((d, i) => (
          <circle
            key={`c-${i}`}
            cx={d.x}
            cy={d.y}
            r={geom.points.length <= 20 ? 3 : 2}
            className="dev-feedback-chart-dot dev-feedback-chart-dot--closed"
          />
        ))}
        {geom.openDots.map((d, i) => (
          <circle
            key={`o-${i}`}
            cx={d.x}
            cy={d.y}
            r={geom.points.length <= 20 ? 3 : 2}
            className="dev-feedback-chart-dot dev-feedback-chart-dot--open"
          />
        ))}
        <text x={geom.padding.left} y={geom.height - 8} className="dev-feedback-chart-axis">
          {formatTrendDate(first.date)}
        </text>
        <text
          x={geom.width - geom.padding.right}
          y={geom.height - 8}
          className="dev-feedback-chart-axis"
          textAnchor="end"
        >
          {formatTrendDate(last.date)}
        </text>
      </svg>
    </div>
  )
}

import type { FeedbackIssueWithMeta } from './feedbackIssueFilter'
import type { FeedbackIssueStats } from './feedbackStats'
import { formatOpenDays } from './feedbackStats'
import { FeedbackTrendChart } from './FeedbackTrendChart'

type Props = {
  stats: FeedbackIssueStats
  issues: FeedbackIssueWithMeta[]
  expanded: boolean
  onToggle: () => void
}

export function FeedbackStatsPanel({ stats, issues, expanded, onToggle }: Props) {
  return (
    <section className="dev-feedback-stats" aria-label="Statistik">
      <button type="button" className="dev-feedback-stats-summary" onClick={onToggle}>
        <span className="dev-feedback-stat-chip dev-feedback-stat-chip--open">
          {stats.open} offen
        </span>
        <span className="dev-feedback-stat-chip dev-feedback-stat-chip--progress">
          {stats.inProgress} in Bearbeitung
        </span>
        <span className="dev-feedback-stat-chip dev-feedback-stat-chip--closed">
          {stats.closed} erledigt
        </span>
        {stats.avgOpenDays != null && (
          <span className="dev-feedback-stat-chip dev-feedback-stat-chip--muted">
            Ø {formatOpenDays(Math.round(stats.avgOpenDays))} offen
          </span>
        )}
        <span className="dev-feedback-stats-toggle">{expanded ? '▲' : '▼'} Verlauf</span>
      </button>

      {expanded && issues.length > 0 && (
        <div className="dev-feedback-stats-detail">
          <FeedbackTrendChart issues={issues} />
          <p className="dev-feedback-stats-hint">
            „In Bearbeitung“ = GitHub-Label z. B. <code>in-progress</code> am Issue setzen.
          </p>
        </div>
      )}
    </section>
  )
}

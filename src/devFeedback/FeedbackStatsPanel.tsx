import type { FeedbackIssueWithMeta } from './feedbackIssueFilter'
import type { FeedbackIssueStats } from './feedbackStats'
import { formatOpenDays } from './feedbackStats'

const STATUS_LABEL: Record<string, string> = {
  open: 'Offen',
  in_progress: 'In Bearbeitung',
  closed: 'Erledigt',
}

type Props = {
  stats: FeedbackIssueStats
  issues: FeedbackIssueWithMeta[]
  expanded: boolean
  onToggle: () => void
}

function groupIssues(issues: FeedbackIssueWithMeta[]) {
  return {
    open: issues.filter((i) => i.status === 'open'),
    in_progress: issues.filter((i) => i.status === 'in_progress'),
    closed: issues.filter((i) => i.status === 'closed'),
  }
}

export function FeedbackStatsPanel({ stats, issues, expanded, onToggle }: Props) {
  const groups = groupIssues(issues)

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
        <span className="dev-feedback-stats-toggle">{expanded ? '▲' : '▼'} Details</span>
      </button>

      {expanded && (
        <div className="dev-feedback-stats-detail">
          {(['open', 'in_progress', 'closed'] as const).map((key) => {
            const list = groups[key]
            if (list.length === 0) return null
            return (
              <div key={key} className="dev-feedback-stats-group">
                <h3 className="dev-feedback-stats-group-title">
                  {STATUS_LABEL[key]} ({list.length})
                </h3>
                <ul className="dev-feedback-stats-rows">
                  {list.map((issue) => (
                    <li key={issue.number}>
                      <a href={issue.htmlUrl} target="_blank" rel="noopener noreferrer">
                        #{issue.number} {issue.title}
                      </a>
                      <span className="dev-feedback-stats-age">
                        {issue.status === 'closed'
                          ? `Dauer: ${formatOpenDays(issue.openDays)}`
                          : `seit ${formatOpenDays(issue.openDays)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
          <p className="dev-feedback-stats-hint">
            „In Bearbeitung“ = GitHub-Label z. B. <code>in-progress</code> am Issue setzen.
          </p>
        </div>
      )}
    </section>
  )
}

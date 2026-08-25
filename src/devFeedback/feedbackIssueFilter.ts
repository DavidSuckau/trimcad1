import { GITHUB_FEEDBACK_LABEL } from './featureFlags'
import {
  daysSince,
  resolveFeedbackStatus,
  type FeedbackIssueWithMeta,
  type FeedbackStatus,
} from './feedbackStats'

export type { FeedbackIssueWithMeta, FeedbackStatus }

/** Issues aus dem TrimTex-Feedback (Label oder typischer Issue-Text). */
export function isTrimtexFeedbackIssue(row: {
  labels?: { name?: string }[]
  body?: string | null
  pull_request?: unknown
}): boolean {
  if (row.pull_request) return false
  const labels = row.labels ?? []
  if (labels.some((l) => l.name === GITHUB_FEEDBACK_LABEL)) return true
  const body = row.body ?? ''
  return body.includes('**Gemeldet von:**') || body.includes('**TrimTex:**')
}

function labelNames(row: { labels?: { name?: string }[] }): string[] {
  return (row.labels ?? []).map((l) => l.name).filter((n): n is string => Boolean(n))
}

export function mapGithubIssueRow(row: {
  number: number
  title: string
  state: string
  html_url: string
  created_at: string
  closed_at?: string | null
  body?: string | null
  user?: { login?: string } | null
  labels?: { name?: string }[]
  pull_request?: unknown
}): FeedbackIssueWithMeta | null {
  if (!isTrimtexFeedbackIssue(row)) return null
  const labels = labelNames(row)
  const status = resolveFeedbackStatus(row.state, labels)
  const until =
    status === 'closed' && row.closed_at
      ? new Date(row.closed_at).getTime()
      : Date.now()
  const body = row.body ?? ''
  const trimmed = body.replace(/\r/g, '').trim()
  const preview = trimmed.slice(0, 220)
  return {
    number: row.number,
    title: row.title,
    status,
    htmlUrl: row.html_url,
    createdAt: row.created_at,
    closedAt: row.closed_at ?? null,
    author: row.user?.login ?? 'unknown',
    bodyPreview: preview.length < trimmed.length ? `${preview}…` : preview,
    labels,
    openDays: daysSince(row.created_at, until),
  }
}

import type { FeedbackIssue } from './devFeedbackApi'
import { GITHUB_FEEDBACK_LABEL } from './featureFlags'

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

export function mapGithubIssueRow(row: {
  number: number
  title: string
  state: string
  html_url: string
  created_at: string
  body?: string | null
  user?: { login?: string } | null
  labels?: { name?: string }[]
  pull_request?: unknown
}): FeedbackIssue | null {
  if (!isTrimtexFeedbackIssue(row)) return null
  const body = row.body ?? ''
  const preview = body
    .replace(/\r/g, '')
    .trim()
    .slice(0, 220)
  return {
    number: row.number,
    title: row.title,
    state: row.state,
    htmlUrl: row.html_url,
    createdAt: row.created_at,
    author: row.user?.login ?? 'unknown',
    bodyPreview: preview.length < (body.trim().length) ? `${preview}…` : preview,
  }
}

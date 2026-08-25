import {
  FEEDBACK_API_BASE,
  FEEDBACK_PROXY_ENABLED,
  GITHUB_FEEDBACK_LABEL,
  GITHUB_REPO,
} from './featureFlags'
import type { FeedbackForm } from './validateFeedback'
import { buildIssueBody } from './validateFeedback'

export type FeedbackIssue = {
  number: number
  title: string
  state: string
  htmlUrl: string
  createdAt: string
  author: string
  bodyPreview: string
}

export type CreateFeedbackResult = {
  number: number
  htmlUrl: string
  /** Issue-Formular in neuem Tab — Nutzer klickt dort „Submit“. */
  openedExternally?: boolean
}

type ApiError = { error?: string }

function trimPreview(text: string, max = 220): string {
  const t = text.replace(/\r/g, '').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max)}…`
}

function mapGithubRow(row: {
  number: number
  title: string
  state: string
  html_url: string
  created_at: string
  body?: string | null
  user?: { login?: string } | null
  pull_request?: unknown
}): FeedbackIssue | null {
  if (row.pull_request) return null
  return {
    number: row.number,
    title: row.title,
    state: row.state,
    htmlUrl: row.html_url,
    createdAt: row.created_at,
    author: row.user?.login ?? 'unknown',
    bodyPreview: trimPreview(row.body ?? ''),
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(text.slice(0, 200) || `HTTP ${response.status}`)
  }
}

async function fetchIssuesFromProxy(): Promise<FeedbackIssue[]> {
  const response = await fetch(`${FEEDBACK_API_BASE}/issues?state=open`)
  const data = await parseJson<{ issues?: FeedbackIssue[] } & ApiError>(response)
  if (!response.ok) {
    throw new Error(data.error ?? `Liste fehlgeschlagen (${response.status})`)
  }
  return data.issues ?? []
}

/** Öffentliches Repo: GitHub REST API direkt aus dem Browser (GitHub Pages). */
async function fetchIssuesFromGithubDirect(): Promise<FeedbackIssue[]> {
  const q = new URLSearchParams({
    state: 'open',
    labels: GITHUB_FEEDBACK_LABEL,
    per_page: '50',
    sort: 'updated',
    direction: 'desc',
  })
  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues?${q}`, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!response.ok) {
    throw new Error(`GitHub-Liste (${response.status})`)
  }
  const rows = (await response.json()) as Parameters<typeof mapGithubRow>[0][]
  return rows.map(mapGithubRow).filter((x): x is FeedbackIssue => x != null)
}

export async function fetchFeedbackIssues(): Promise<FeedbackIssue[]> {
  if (FEEDBACK_PROXY_ENABLED) {
    try {
      return await fetchIssuesFromProxy()
    } catch {
      /* Proxy nicht erreichbar → direkt GitHub */
    }
  }
  return fetchIssuesFromGithubDirect()
}

function buildGithubNewIssueUrl(title: string, body: string): string {
  const params = new URLSearchParams()
  params.set('title', title)
  params.set('body', body)
  params.set('labels', GITHUB_FEEDBACK_LABEL)
  return `https://github.com/${GITHUB_REPO}/issues/new?${params.toString()}`
}

async function createIssueViaProxy(
  form: FeedbackForm,
  meta: { appVersion: string; userAgent: string },
): Promise<CreateFeedbackResult> {
  const response = await fetch(`${FEEDBACK_API_BASE}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: form.title.trim(),
      body: buildIssueBody(form, meta),
      authorName: form.authorName.trim(),
    }),
  })
  const data = await parseJson<{ number?: number; htmlUrl?: string } & ApiError>(response)
  if (!response.ok) {
    throw new Error(data.error ?? `Senden fehlgeschlagen (${response.status})`)
  }
  if (data.number == null || !data.htmlUrl) {
    throw new Error('Unerwartete Server-Antwort.')
  }
  return { number: data.number, htmlUrl: data.htmlUrl }
}

export async function createFeedbackIssue(
  form: FeedbackForm,
  meta: { appVersion: string; userAgent: string },
): Promise<CreateFeedbackResult> {
  if (FEEDBACK_PROXY_ENABLED) {
    try {
      return await createIssueViaProxy(form, meta)
    } catch {
      /* Fallback unten */
    }
  }

  const title = form.title.trim()
  const body = buildIssueBody(form, meta)
  const url = buildGithubNewIssueUrl(title, body)
  window.open(url, '_blank', 'noopener,noreferrer')
  return {
    number: 0,
    htmlUrl: url,
    openedExternally: true,
  }
}

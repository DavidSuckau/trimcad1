import {
  FEEDBACK_API_BASE,
  FEEDBACK_PROXY_ENABLED,
  GITHUB_FEEDBACK_LABEL,
  GITHUB_REPO,
} from './featureFlags'
import type { FeedbackForm } from './validateFeedback'
import { buildIssueBody } from './validateFeedback'
import { mapGithubIssueRow } from './feedbackIssueFilter'

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
  openedExternally?: boolean
}

type ApiError = { error?: string }

type GithubIssueRow = Parameters<typeof mapGithubIssueRow>[0]

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (text.trimStart().startsWith('<')) {
    throw new Error('Keine API-Antwort (HTML statt JSON).')
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(text.slice(0, 200) || `HTTP ${response.status}`)
  }
}

function feedbackApiUrl(pathAndQuery: string): string {
  const base = FEEDBACK_API_BASE.startsWith('/')
    ? `${import.meta.env.BASE_URL.replace(/\/?$/, '')}${FEEDBACK_API_BASE}`
    : FEEDBACK_API_BASE
  const normalized = base.replace(/\/$/, '')
  const suffix = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`
  return `${normalized}${suffix}`
}

async function fetchIssuesFromProxy(): Promise<FeedbackIssue[]> {
  const response = await fetch(feedbackApiUrl('/issues?state=open'))
  const data = await parseJson<{ issues?: FeedbackIssue[] } & ApiError>(response)
  if (!response.ok) {
    throw new Error(data.error ?? `Liste fehlgeschlagen (${response.status})`)
  }
  return data.issues ?? []
}

async function githubIssuesRequest(params: URLSearchParams): Promise<GithubIssueRow[]> {
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/issues?${params}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  )
  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`GitHub-Liste (${response.status}): ${errText.slice(0, 120)}`)
  }
  return (await response.json()) as GithubIssueRow[]
}

/** Alle offenen Issues laden und TrimTex-Feedback clientseitig filtern (Label oft beim Senden weg). */
async function fetchIssuesFromGithubDirect(): Promise<FeedbackIssue[]> {
  const params = new URLSearchParams({
    state: 'open',
    per_page: '100',
    sort: 'updated',
    direction: 'desc',
  })
  const rows = await githubIssuesRequest(params)
  const mapped = rows.map(mapGithubIssueRow).filter((x): x is FeedbackIssue => x != null)
  mapped.sort((a, b) => b.number - a.number)
  return mapped
}

export async function fetchFeedbackIssues(): Promise<FeedbackIssue[]> {
  if (FEEDBACK_PROXY_ENABLED) {
    try {
      return await fetchIssuesFromProxy()
    } catch {
      /* Proxy nicht erreichbar */
    }
  }
  return fetchIssuesFromGithubDirect()
}

function buildGithubNewIssueUrl(title: string, body: string): string {
  const params = new URLSearchParams()
  params.set('title', title)
  params.set('body', body)
  params.set('template', 'trimtex-feedback.yml')
  params.set('labels', GITHUB_FEEDBACK_LABEL)
  return `https://github.com/${GITHUB_REPO}/issues/new?${params.toString()}`
}

async function createIssueViaProxy(
  form: FeedbackForm,
  meta: { appVersion: string; userAgent: string },
): Promise<CreateFeedbackResult> {
  const response = await fetch(feedbackApiUrl('/issues'), {
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
      /* Fallback */
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

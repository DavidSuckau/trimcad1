import { FEEDBACK_API_BASE } from './featureFlags'
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

type ApiError = { error?: string }

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(text.slice(0, 200) || `HTTP ${response.status}`)
  }
}

export async function fetchFeedbackIssues(): Promise<FeedbackIssue[]> {
  const response = await fetch(`${FEEDBACK_API_BASE}/issues?state=open`)
  const data = await parseJson<{ issues?: FeedbackIssue[] } & ApiError>(response)
  if (!response.ok) {
    throw new Error(data.error ?? `Liste fehlgeschlagen (${response.status})`)
  }
  return data.issues ?? []
}

export async function createFeedbackIssue(
  form: FeedbackForm,
  meta: { appVersion: string; userAgent: string },
): Promise<{ number: number; htmlUrl: string }> {
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

/** Label = Issue wird aktiv bearbeitet (GitHub). */
export const IN_PROGRESS_LABELS = new Set([
  'in progress',
  'in-progress',
  'doing',
  'wip',
  'bearbeitung',
  'trimtex-in-progress',
])

export type FeedbackStatus = 'open' | 'in_progress' | 'closed'

export type FeedbackIssueStats = {
  open: number
  inProgress: number
  closed: number
  /** Nur offene + in Bearbeitung. */
  avgOpenDays: number | null
  /** Ältestes noch offenes Issue (Tage). */
  oldestOpenDays: number | null
}

export type FeedbackIssueWithMeta = {
  number: number
  title: string
  status: FeedbackStatus
  htmlUrl: string
  createdAt: string
  closedAt: string | null
  author: string
  bodyPreview: string
  labels: string[]
  openDays: number
}

export function daysSince(iso: string, until = Date.now()): number {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.floor((until - t) / (86400 * 1000)))
}

export function resolveFeedbackStatus(
  state: string,
  labels: string[],
): FeedbackStatus {
  if (state === 'closed') return 'closed'
  const lower = labels.map((l) => l.toLowerCase())
  if (lower.some((l) => IN_PROGRESS_LABELS.has(l))) return 'in_progress'
  return 'open'
}

export function computeFeedbackStats(issues: FeedbackIssueWithMeta[]): FeedbackIssueStats {
  let open = 0
  let inProgress = 0
  let closed = 0
  const openDays: number[] = []

  for (const i of issues) {
    if (i.status === 'closed') closed++
    else if (i.status === 'in_progress') {
      inProgress++
      openDays.push(i.openDays)
    } else {
      open++
      openDays.push(i.openDays)
    }
  }

  const avgOpenDays =
    openDays.length > 0 ? Math.round((openDays.reduce((a, b) => a + b, 0) / openDays.length) * 10) / 10 : null
  const oldestOpenDays = openDays.length > 0 ? Math.max(...openDays) : null

  return { open, inProgress, closed, avgOpenDays, oldestOpenDays }
}

export function formatOpenDays(days: number): string {
  if (days <= 0) return 'heute'
  if (days === 1) return '1 Tag'
  if (days < 14) return `${days} Tage`
  const weeks = Math.floor(days / 7)
  return weeks === 1 ? '1 Woche' : `${weeks} Wochen`
}

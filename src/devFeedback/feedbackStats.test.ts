import { describe, expect, it } from 'vitest'
import {
  computeFeedbackStats,
  daysSince,
  formatOpenDays,
  resolveFeedbackStatus,
} from './feedbackStats'

describe('feedbackStats', () => {
  it('resolveFeedbackStatus: in Bearbeitung', () => {
    expect(resolveFeedbackStatus('open', ['trimtex-feedback', 'in-progress'])).toBe('in_progress')
  })

  it('computeFeedbackStats aggregiert', () => {
    const stats = computeFeedbackStats([
      {
        number: 1,
        title: 'a',
        status: 'open',
        htmlUrl: '',
        createdAt: '',
        closedAt: null,
        author: '',
        bodyPreview: '',
        labels: [],
        openDays: 2,
      },
      {
        number: 2,
        title: 'b',
        status: 'in_progress',
        htmlUrl: '',
        createdAt: '',
        closedAt: null,
        author: '',
        bodyPreview: '',
        labels: [],
        openDays: 4,
      },
      {
        number: 3,
        title: 'c',
        status: 'closed',
        htmlUrl: '',
        createdAt: '',
        closedAt: 'x',
        author: '',
        bodyPreview: '',
        labels: [],
        openDays: 0,
      },
    ])
    expect(stats.open).toBe(1)
    expect(stats.inProgress).toBe(1)
    expect(stats.closed).toBe(1)
    expect(stats.avgOpenDays).toBe(3)
    expect(stats.oldestOpenDays).toBe(4)
  })

  it('formatOpenDays', () => {
    expect(formatOpenDays(0)).toBe('heute')
    expect(formatOpenDays(3)).toBe('3 Tage')
  })

  it('daysSince', () => {
    const d = daysSince('2026-01-01T00:00:00Z', new Date('2026-01-04T00:00:00Z').getTime())
    expect(d).toBe(3)
  })
})

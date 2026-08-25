import { describe, expect, it } from 'vitest'
import { buildFeedbackTrend, downsampleTrend } from './feedbackTrend'

describe('buildFeedbackTrend', () => {
  it('zählt offen und abgeschlossen über Zeit', () => {
    const trend = buildFeedbackTrend(
      [
        {
          number: 1,
          title: 'a',
          status: 'closed',
          htmlUrl: '',
          createdAt: '2026-01-01T10:00:00Z',
          closedAt: '2026-01-03T10:00:00Z',
          author: '',
          bodyPreview: '',
          labels: [],
          openDays: 2,
        },
        {
          number: 2,
          title: 'b',
          status: 'open',
          htmlUrl: '',
          createdAt: '2026-01-02T10:00:00Z',
          closedAt: null,
          author: '',
          bodyPreview: '',
          labels: [],
          openDays: 1,
        },
      ],
      new Date('2026-01-04T00:00:00Z').getTime(),
    )
    expect(trend.length).toBeGreaterThan(0)
    const last = trend[trend.length - 1]!
    expect(last.open).toBe(1)
    expect(last.closed).toBe(1)
  })
})

describe('downsampleTrend', () => {
  it('reduziert lange Reihen', () => {
    const pts = Array.from({ length: 200 }, (_, i) => ({
      date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      open: i,
      closed: 0,
    }))
    expect(downsampleTrend(pts, 90).length).toBeLessThanOrEqual(92)
  })
})

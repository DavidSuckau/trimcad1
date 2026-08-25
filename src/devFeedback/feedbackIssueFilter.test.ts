import { describe, expect, it } from 'vitest'
import { isTrimtexFeedbackIssue, mapGithubIssueRow } from './feedbackIssueFilter'

describe('isTrimtexFeedbackIssue', () => {
  it('erkennt Label trimtex-feedback', () => {
    expect(
      isTrimtexFeedbackIssue({ labels: [{ name: 'trimtex-feedback' }], body: 'x' }),
    ).toBe(true)
  })

  it('erkennt TrimTex-Issue-Text ohne Label', () => {
    expect(
      isTrimtexFeedbackIssue({
        labels: [],
        body: '**Gemeldet von:** Max\n**TrimTex:** 1.0',
      }),
    ).toBe(true)
  })

  it('ignoriert fremde Issues', () => {
    expect(isTrimtexFeedbackIssue({ labels: [{ name: 'ideas' }], body: 'random' })).toBe(false)
  })
})

describe('mapGithubIssueRow', () => {
  it('mappt gültiges Issue', () => {
    const row = mapGithubIssueRow({
      number: 2,
      title: 'Test',
      state: 'open',
      html_url: 'https://github.com/x/y/issues/2',
      created_at: '2026-01-01T00:00:00Z',
      body: '**Gemeldet von:** a',
      user: { login: 'u' },
      labels: [{ name: 'trimtex-feedback' }],
    })
    expect(row?.number).toBe(2)
  })
})

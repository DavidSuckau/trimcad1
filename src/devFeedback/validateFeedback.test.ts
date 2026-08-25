import { describe, expect, it } from 'vitest'
import { validateFeedbackForm, buildIssueBody } from './validateFeedback'

describe('validateFeedbackForm', () => {
  it('lehnt zu kurzen Titel ab', () => {
    expect(validateFeedbackForm({ title: 'ab', body: '1234567890', authorName: '' })).toMatch(/Titel/)
  })

  it('akzeptiert gültiges Formular', () => {
    expect(
      validateFeedbackForm({
        title: 'Bug an Ecke',
        body: 'Nach Spiegeln fehlt Fase.',
        authorName: 'Max',
      }),
    ).toBeNull()
  })
})

describe('buildIssueBody', () => {
  it('enthält Autor und Beschreibung', () => {
    const body = buildIssueBody(
      { title: 'x', body: 'Details hier.', authorName: 'Anna' },
      { appVersion: '1.0', userAgent: 'Test' },
    )
    expect(body).toContain('Anna')
    expect(body).toContain('Details hier.')
  })
})

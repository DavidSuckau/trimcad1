export type FeedbackForm = {
  title: string
  body: string
  authorName: string
}

export function validateFeedbackForm(form: FeedbackForm): string | null {
  const title = form.title.trim()
  const body = form.body.trim()
  const authorName = form.authorName.trim()
  if (title.length < 3) return 'Titel: mindestens 3 Zeichen.'
  if (title.length > 120) return 'Titel: maximal 120 Zeichen.'
  if (body.length < 10) return 'Beschreibung: mindestens 10 Zeichen.'
  if (body.length > 8000) return 'Beschreibung: maximal 8000 Zeichen.'
  if (authorName.length > 80) return 'Name: maximal 80 Zeichen.'
  return null
}

export function buildIssueBody(form: FeedbackForm, meta: { appVersion: string; userAgent: string }): string {
  const author = form.authorName.trim() || 'Anonym'
  return [
    `**Gemeldet von:** ${author}`,
    `**TrimTex:** ${meta.appVersion}`,
    `**Browser:** ${meta.userAgent}`,
    '',
    '---',
    '',
    form.body.trim(),
  ].join('\n')
}

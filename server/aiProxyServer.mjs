import 'dotenv/config'
import express from 'express'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'

const app = express()
const port = Number(process.env.AI_PROXY_PORT ?? 8787)
const openAiApiKey = (process.env.OPENAI_API_KEY ?? '').trim()
const modelChat = process.env.OPENAI_MODEL_CHAT ?? 'gpt-4o-mini'
const modelImage = process.env.OPENAI_MODEL_IMAGE ?? 'gpt-image-1'
const maxBodyKb = Number(process.env.AI_PROXY_MAX_BODY_KB ?? 750)

const githubToken = (process.env.GITHUB_TOKEN ?? '').trim()
const githubRepo = (process.env.GITHUB_REPO ?? 'DavidSuckau/trimcad1').trim()
const githubFeedbackLabel = (process.env.GITHUB_FEEDBACK_LABEL ?? 'trimtex-feedback').trim()

function githubConfigured() {
  return Boolean(githubToken && githubRepo.includes('/'))
}

if (!openAiApiKey && !githubConfigured()) {
  console.error('OPENAI_API_KEY oder GITHUB_TOKEN + GITHUB_REPO erforderlich (.env).')
  process.exit(1)
}

app.use(helmet({ contentSecurityPolicy: false }))
app.use(
  express.json({
    limit: `${Math.max(64, Math.floor(maxBodyKb))}kb`,
  }),
)

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.AI_PROXY_RATE_LIMIT_PER_MIN ?? 30),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit erreicht. Bitte kurz warten.' },
})
app.use('/api/ai', aiLimiter)

const feedbackLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.FEEDBACK_RATE_LIMIT_PER_MIN ?? 15),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Feedback-Anfragen. Bitte kurz warten.' },
})
app.use('/api/feedback', feedbackLimiter)

function badRequest(res, message) {
  return res.status(400).json({ error: message })
}

function githubNotConfigured(res) {
  return res.status(503).json({
    error: 'GitHub-Feedback nicht konfiguriert (GITHUB_TOKEN, GITHUB_REPO in .env).',
  })
}

function parseGithubRepo() {
  const parts = githubRepo.split('/').filter(Boolean)
  if (parts.length !== 2) return null
  return { owner: parts[0], repo: parts[1] }
}

async function githubApi(path, options = {}) {
  const parsed = parseGithubRepo()
  if (!parsed) throw new Error('GITHUB_REPO ungültig (Format: owner/repo).')
  const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}${path}`
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${githubToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers ?? {}),
    },
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!response.ok) {
    const msg = data?.message ?? text.slice(0, 300) ?? `HTTP ${response.status}`
    throw new Error(`GitHub (${response.status}): ${msg}`)
  }
  return data
}

function trimPreview(text, max = 220) {
  const t = String(text ?? '')
    .replace(/\r/g, '')
    .trim()
  if (t.length <= max) return t
  return `${t.slice(0, max)}…`
}

app.get('/api/feedback/issues', async (req, res) => {
  if (!githubConfigured()) return githubNotConfigured(res)
  try {
    const state = req.query.state === 'closed' ? 'closed' : 'open'
    const parsed = parseGithubRepo()
    if (!parsed) return badRequest(res, 'GITHUB_REPO ungültig.')
    const q = new URLSearchParams({
      state,
      labels: githubFeedbackLabel,
      per_page: '50',
      sort: 'updated',
      direction: 'desc',
    })
    const rows = await githubApi(`/issues?${q.toString()}`)
    const issues = (Array.isArray(rows) ? rows : [])
      .filter((row) => !row.pull_request)
      .map((row) => ({
        number: row.number,
        title: row.title,
        state: row.state,
        htmlUrl: row.html_url,
        createdAt: row.created_at,
        author: row.user?.login ?? 'unknown',
        bodyPreview: trimPreview(row.body),
      }))
    return res.json({ issues })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GitHub-Liste fehlgeschlagen.'
    return res.status(502).json({ error: message })
  }
})

app.post('/api/feedback/issues', async (req, res) => {
  if (!githubConfigured()) return githubNotConfigured(res)
  try {
    const body = req.body ?? {}
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const issueBody = typeof body.body === 'string' ? body.body.trim() : ''
    if (title.length < 3 || title.length > 120) {
      return badRequest(res, 'Titel: 3–120 Zeichen.')
    }
    if (issueBody.length < 10 || issueBody.length > 12000) {
      return badRequest(res, 'Beschreibung: 10–12000 Zeichen.')
    }
    const created = await githubApi('/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        body: issueBody,
        labels: [githubFeedbackLabel],
      }),
    })
    return res.status(201).json({
      number: created.number,
      htmlUrl: created.html_url,
      title: created.title,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GitHub-Issue konnte nicht erstellt werden.'
    return res.status(502).json({ error: message })
  }
})

async function callOpenAi(payload) {
  if (!openAiApiKey) {
    throw new Error('OPENAI_API_KEY fehlt.')
  }
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openAiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`OpenAI Fehler (${response.status}): ${text.slice(0, 400)}`)
  }
  return JSON.parse(text)
}

app.post('/api/ai/workspace-help', async (req, res) => {
  try {
    const body = req.body ?? {}
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return badRequest(res, 'messages muss ein nicht-leeres Array sein.')
    }
    const payload = {
      model: typeof body.model === 'string' && body.model ? body.model : modelChat,
      temperature: typeof body.temperature === 'number' ? body.temperature : 0.25,
      max_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : 2000,
      messages: body.messages,
    }
    const data = await callOpenAi(payload)
    return res.json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unbekannter AI-Proxy-Fehler.'
    return res.status(502).json({ error: message })
  }
})

app.post('/api/ai/workspace-proposal', async (req, res) => {
  try {
    const body = req.body ?? {}
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return badRequest(res, 'messages muss ein nicht-leeres Array sein.')
    }
    const payload = {
      model: typeof body.model === 'string' && body.model ? body.model : modelChat,
      temperature: typeof body.temperature === 'number' ? body.temperature : 0.1,
      response_format: { type: 'json_object' },
      messages: body.messages,
    }
    const data = await callOpenAi(payload)
    return res.json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unbekannter AI-Proxy-Fehler.'
    return res.status(502).json({ error: message })
  }
})

app.post('/api/ai/configurator-proposal', async (req, res) => {
  try {
    const body = req.body ?? {}
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return badRequest(res, 'messages muss ein nicht-leeres Array sein.')
    }
    const payload = {
      model: typeof body.model === 'string' && body.model ? body.model : modelChat,
      temperature: typeof body.temperature === 'number' ? body.temperature : 0.1,
      response_format: { type: 'json_object' },
      messages: body.messages,
    }
    const data = await callOpenAi(payload)
    return res.json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unbekannter AI-Proxy-Fehler.'
    return res.status(502).json({ error: message })
  }
})

app.post('/api/ai/rock-preview-image', async (req, res) => {
  try {
    const body = req.body ?? {}
    if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
      return badRequest(res, 'prompt ist erforderlich.')
    }
    const payload = {
      model: typeof body.model === 'string' && body.model ? body.model : modelImage,
      prompt: body.prompt,
      size: typeof body.size === 'string' ? body.size : '1024x1024',
    }
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const text = await response.text()
    if (!response.ok) {
      return res.status(502).json({ error: `OpenAI Fehler (${response.status}): ${text.slice(0, 400)}` })
    }
    return res.json(JSON.parse(text))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unbekannter AI-Proxy-Fehler.'
    return res.status(502).json({ error: message })
  }
})

app.listen(port, () => {
  console.log(`App-Proxy läuft auf http://localhost:${port}`)
  if (githubConfigured()) {
    console.log(`GitHub-Feedback: ${githubRepo} (Label: ${githubFeedbackLabel})`)
  }
})

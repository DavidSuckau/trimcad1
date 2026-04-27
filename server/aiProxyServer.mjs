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

if (!openAiApiKey) {
  console.error('OPENAI_API_KEY fehlt. Bitte in .env setzen.')
  process.exit(1)
}

app.use(helmet({ contentSecurityPolicy: false }))
app.use(
  express.json({
    limit: `${Math.max(64, Math.floor(maxBodyKb))}kb`,
  }),
)

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.AI_PROXY_RATE_LIMIT_PER_MIN ?? 30),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit erreicht. Bitte kurz warten.' },
})
app.use('/api/ai', limiter)

function badRequest(res, message) {
  return res.status(400).json({ error: message })
}

async function callOpenAi(payload) {
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
  console.log(`AI proxy läuft auf http://localhost:${port}`)
})

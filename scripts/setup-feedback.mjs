#!/usr/bin/env node
/**
 * Einmal-Setup: GitHub-Label + lokale .env für Feedback-Proxy.
 * Voraussetzung: gh CLI eingeloggt (gh auth login).
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const repo = process.env.GITHUB_REPO ?? 'DavidSuckau/trimcad1'
const label = process.env.GITHUB_FEEDBACK_LABEL ?? 'trimtex-feedback'
const root = process.cwd()
const envPath = join(root, '.env')

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function upsertEnv(lines) {
  let content = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
  for (const [key, value] of lines) {
    const re = new RegExp(`^${key}=.*$`, 'm')
    const line = `${key}=${value}`
    content = re.test(content) ? content.replace(re, line) : `${content}${content.endsWith('\n') || !content ? '' : '\n'}${line}\n`
  }
  writeFileSync(envPath, content, 'utf8')
}

console.log('TrimTex Feedback-Setup\n')

try {
  run('gh auth status')
} catch {
  console.error('gh nicht eingeloggt. Bitte: gh auth login')
  process.exit(1)
}

try {
  run(
    `gh label create "${label}" --repo "${repo}" --color "1d76db" --description "TrimTex Nutzer-Feedback" --force`,
  )
  console.log(`✓ Label „${label}“ in ${repo}`)
} catch (e) {
  console.warn(`Label: ${e instanceof Error ? e.message : e}`)
}

try {
  run(
    `gh label create "in-progress" --repo "${repo}" --color "fbca04" --description "TrimTex: wird bearbeitet" --force`,
  )
  console.log(`✓ Label „in-progress“ in ${repo}`)
} catch (e) {
  console.warn(`Label in-progress: ${e instanceof Error ? e.message : e}`)
}

let token = ''
try {
  token = run('gh auth token')
} catch {
  console.warn('Konnte gh auth token nicht lesen.')
}

const envLines = [
  ['GITHUB_REPO', repo],
  ['GITHUB_FEEDBACK_LABEL', label],
]
if (token) envLines.push(['GITHUB_TOKEN', token])

upsertEnv(envLines)
console.log(`✓ ${envPath} aktualisiert (GITHUB_REPO, GITHUB_FEEDBACK_LABEL${token ? ', GITHUB_TOKEN' : ''})`)
console.log('\nStarten: npm run dev:secure')
console.log('GitHub Pages: Liste + Issue-Formular funktionieren ohne Proxy.')

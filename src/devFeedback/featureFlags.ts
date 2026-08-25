/** Öffentliches GitHub-Repo für Feedback-Issues. */
export const GITHUB_REPO =
  (import.meta.env.VITE_GITHUB_REPO as string | undefined)?.trim() || 'DavidSuckau/trimcad1'

export const GITHUB_FEEDBACK_LABEL =
  (import.meta.env.VITE_GITHUB_FEEDBACK_LABEL as string | undefined)?.trim() || 'trimtex-feedback'

/** Feedback-Modal — `false` zum Deaktivieren. */
export const DEV_FEEDBACK_ENABLED = true

/** API-Basis (Dev/Hetzner mit Proxy). Leer = nur direkte GitHub-API + Issue-Formular. */
export const FEEDBACK_API_BASE = (
  (import.meta.env.VITE_FEEDBACK_API_BASE as string | undefined)?.trim() || '/api/feedback'
).replace(/\/$/, '')

/** Proxy nur in Dev oder wenn explizit VITE_FEEDBACK_PROXY_ENABLED=true. */
export const FEEDBACK_PROXY_ENABLED =
  import.meta.env.DEV ||
  (import.meta.env.VITE_FEEDBACK_PROXY_ENABLED as string | undefined)?.trim() === 'true'

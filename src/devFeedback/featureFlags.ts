/** Feedback-Modal (GitHub Issues) — `false` zum Deaktivieren. */
export const DEV_FEEDBACK_ENABLED = true

/** API-Basis (Dev: Vite-Proxy → server/aiProxyServer.mjs). Produktion: URL des gehosteten Proxys. */
export const FEEDBACK_API_BASE =
  (import.meta.env.VITE_FEEDBACK_API_BASE as string | undefined)?.replace(/\/$/, '') ??
  '/api/feedback'

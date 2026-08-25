# Entwickler-Feedback (GitHub Issues)

Nutzer melden Bugs/Wünsche über **Hilfe → Feedback / Dev-Todo**. Einträge werden als Issues im GitHub-Repo angelegt.

## Server (Pflicht für Senden + Liste)

In `.env`:

```env
GITHUB_TOKEN=ghp_...          # PAT mit repo / Issues (fine-grained: Issues read+write)
GITHUB_REPO=DavidSuckau/trimcad1
GITHUB_FEEDBACK_LABEL=trimtex-feedback   # optional, Default
```

Proxy starten (zusammen mit Vite):

```bash
npm run dev:secure
```

Oder nur Proxy:

```bash
node server/aiProxyServer.mjs
```

Beim ersten Start das Label **`trimtex-feedback`** im GitHub-Repo anlegen (Issues → Labels).

## Produktion (alle Rechner)

Statisches GitHub-Pages-Hosting hat keinen `/api`-Proxy. Den Server separat hosten (Railway, Fly.io, VPS) und in der Build-Umgebung setzen:

```env
VITE_FEEDBACK_API_BASE=https://dein-proxy.example.com/api/feedback
```

## Deaktivieren

`src/devFeedback/featureFlags.ts` → `DEV_FEEDBACK_ENABLED = false`

## Entfernen

Ordner `src/devFeedback/` löschen, Einträge in `App.tsx` + `Toolbar.tsx`, GitHub-Routen in `server/aiProxyServer.mjs`.

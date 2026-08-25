# Entwickler-Feedback (GitHub Issues)

**Hilfe → Feedback / Dev-Todo**

## Was funktioniert wo

| Umgebung | Liste | Senden |
|----------|-------|--------|
| **GitHub Pages** (live) | ✓ direkt von GitHub | GitHub-Tab öffnen → absenden |
| **Lokal** (`npm run dev:secure`) | ✓ | ✓ direkt in der App (Proxy) |

## Einmal-Setup (lokal, optional)

```bash
npm run setup:feedback   # Label + .env mit gh-Token
npm run dev:secure
```

Das Skript legt das Label `trimtex-feedback` an und schreibt `GITHUB_TOKEN` in `.env` (nicht committen).

## GitHub Pages

Beim Build setzt `deploy.yml` automatisch:
- `VITE_FEEDBACK_PROXY_ENABLED=false`
- Repo + Label für direkte GitHub-API

Nutzer brauchen zum **Senden** ein GitHub-Konto (Issue-Formular). Die **Liste** geht für alle ohne Login.

## Deaktivieren / Entfernen

`featureFlags.ts` → `DEV_FEEDBACK_ENABLED = false`  
Ordner `src/devFeedback/` + Toolbar/App + Proxy-Routen löschen.

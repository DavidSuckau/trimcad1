# Hetzner Deploy Checkliste (TrimTex)

Diese Checkliste gilt fuer den Workflow `.github/workflows/deploy-hetzner.yml`.

## 1) Vite Base

- Fuer Hetzner-Deploy wird im Workflow mit `VITE_APP_BASE=/` gebaut.
- Standard lokal/GitHub Pages bleibt ueber `vite.config.ts` mit Fallback `'/trimcad1/'`.

## 2) GitHub Secrets setzen

Im GitHub-Repo unter `Settings -> Secrets and variables -> Actions`:

- `HETZNER_HOST` (z. B. `12.34.56.78`)
- `HETZNER_USER` (z. B. `deploy`)
- `HETZNER_SSH_KEY` (private key, multiline)
- `HETZNER_WEB_ROOT` (z. B. `/var/www/trimtex-web`)
- Optional: `HETZNER_PORT` (Standard `22`)

## 3) Server vorbereiten

Der Deploy-User braucht Schreibrechte auf `HETZNER_WEB_ROOT`:

```bash
sudo mkdir -p /var/www/trimtex-web
sudo chown -R deploy:deploy /var/www/trimtex-web
```

## 4) Nginx (SPA Routing)

`/etc/nginx/sites-available/trimtex`:

```nginx
server {
    listen 80;
    server_name app.deinedomain.de;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name app.deinedomain.de;

    root /var/www/trimtex-web;
    index index.html;

    # Security Header Baseline
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # AI-Proxy (Node) hinter Nginx
    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Aktivieren:

```bash
sudo ln -s /etc/nginx/sites-available/trimtex /etc/nginx/sites-enabled/trimtex
sudo nginx -t
sudo systemctl reload nginx
```

TLS:

```bash
sudo certbot --nginx -d app.deinedomain.de
```

## 5) AI-Proxy (Pflicht fuer Public Launch)

Keine OpenAI-Keys im Browser verwenden. Stattdessen lokal auf dem Server:

```bash
OPENAI_API_KEY=sk-... AI_PROXY_PORT=8787 node server/aiProxyServer.mjs
```

Empfohlen mit systemd als eigener Service inkl. Restart und Logrotation.

## 6) Deploy ausloesen

- Push nach `main`, oder
- Workflow manuell ueber `Actions -> Deploy to Hetzner -> Run workflow`.

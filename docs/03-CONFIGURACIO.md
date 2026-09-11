# 03 · Configuració

## Variables d'entorn (`.env`, copia de `.env.example`)

| Variable | Ús | Notes |
|---|---|---|
| `PUBLIC_URL` | URL pública del servei (enllaços/emails) | S'aplica a settings `meta.appURL`. **Default real: `https://prm.polser.cat`** |
| `PUBLIC_PORT` | Port publicat al HOST (mapeig `PUBLIC_PORT:8090`) | Default `10001` |
| `APP_NAME` | Nom de l'app a la UI/emails | → settings `meta.appName` |
| `SUPERUSER_EMAIL` | Superuser admin de PB (`/_/`) | Es crea/actualitza amb CLI (install.sh pas 5) |
| `SUPERUSER_PASSWORD` | Password del superuser | Força min 6; l'script rebutja `CHANGE_ME_*` |
| `EMAIL_SMTP_HOST` | SMTP per a codis OTP | Ex. `smtp.resend.com` |
| `EMAIL_SMTP_PORT` | Port SMTP | `465`/SSL |
| `EMAIL_SMTP_USER` | Usuari SMTP | `resend` (trig àpia) |
| `EMAIL_SMTP_PASSWORD` | Password/API key SMTP | |
| `EMAIL_SMTP_TLS` | TLS sempre activat | `true` (maps a `settings.smtp.tls`) |
| `EMAIL_FROM` | Remitent `"Nom <addr>"` | Fallback per descompondre sender |
| `SENDER_NAME` / `SENDER_ADDRESS` | Remitent explícit | → `meta.senderName`/`senderAddress` |
| `OTP_DEV_REVEAL` | Dev: mostra el codi OTP als logs | **MAI en producció** |
| `ODOO_URL` | Base URL Odoo | `https://odoo.polser.cat` |
| `ODOO_DB` | DB Odoo | `polser` |
| `ODOO_LOGIN` | Usuari tècnic | `prm@polser.cat` |
| `ODOO_APIKEY` | API key JSON-2 | Enviada com `Authorization: Bearer <key>` |
| `ODOO_STAGE_ID` | Etapa "Nou referit" a Odoo (`crm.lead`) | Default `13` |
| `ODOO_TEAM_ID` | Equip "PRM" | Default `9` (sempre aquest) |
| `VITE_POCKETBASE_URL` | Endpoint API pel build del portal | **BUIT en producció** (mateix origen). Només si l'API és en un altre origen |

> **`VITE_POCKETBASE_URL` buit** = crides relatives al mateix origen (`https://prm.polser.cat/api/…`).
> En dev local (vite dev) sí que cal `http://localhost:8090`.

## ⚠️ Com es configura REALMENT l'app (punt crític)

**PocketBase NO llegeix variables d'entorn per a settings.** N'hi hauria al `docker-compose`
(`PB_APP_URL`, `PB_SMTP_HOST`, `PB_SMTP_PORT`, `PB_SMTP_USER`, `PB_SMTP_PASS`, `PB_SMTP_FROM`)
però **són strings mortes** que PocketBase ignora. La configuració correcta es fa **per API**:

- Autentica com a superuser (`POST /api/collections/_superusers/auth-with-password`).
- `PATCH /api/settings` amb:
  ```json
  {
    "meta": { "appName": "PRM POLSER", "appURL": "https://prm.polser.cat",
              "senderName": "POLSER SEGURETAT", "senderAddress": "no-reply@polser.cat" },
    "smtp": { "enabled": true, "host": "smtp.resend.com", "port": 465,
              "username": "resend", "password": "re_...", "tls": true }
  }
  ```
Això ho fa **automàticament l'`install.sh`** (pas 6). En manual: des de `/_/` → Settings.

> Nota: el comentari dins de `pb_hooks/_settings.pb.js` afirma que PB configura SMTP "de forma
> nativa per variables d'entorn" — **és incorrecte**. El mecanisme real és `PATCH /api/settings` (o la UI).

## `install.sh` pas a pas (desplegament idempotent)

1. Verifica prerequisits (`docker`, `docker compose`, `node`, `npm`).
2. Prepara `.env` des de `.env.example` (si no existeix, forço editar-tota i surt). Rebutja
   arrancar amb `CHANGE_ME_*`.
3. Construeix el portal: `cd portal && npm install && npm run build` → `portal/dist`.
4. Construeix i aixeca el contenidor + espera `GET /api/health` (usa `127.0.0.1:PORT`, força IPv4).
5. `docker compose exec pocketbase pocketbase superuser upsert EMAIL PASS` (idempotent).
6. Autentica superuser i `PATCH /api/settings` (appName, appURL, senderName/Address, SMTP+TLS).
7. Verifica: health, portal `200`, appName i SMTP aplicats.

Requeriment: corre des de l'arrel del repo (`./install.sh`). El portal es serveix pel mateix
binari des de `pb_public` (muntat de `portal/dist`).

## `docker-compose.yml`

- Servei `pocketbase`; build des de `Dockerfile` (PocketBase 0.40.3, Alpine 3.19, amd64).
- Port publicat: `"${PUBLIC_PORT:-10001}:8090"` (el binari escolta a 8090).
- Volums:
  - `pb_data:/pb/pb_data` — **persistent** (SQLite + settings + superusers).
  - `./pb_migrations:/pb/pb_migrations:ro` — migracions (s'apliquen a l'arrencada).
  - `./pb_hooks:/pb/pb_hooks:ro` — hooks (es carreguen a l'arrencada).
  - `./portal/dist:/pb/pb_public:ro` — portal compilat.
- Healthcheck: `wget http://localhost:8090/api/health`.
- Entrada: `pocketbase serve --http=0.0.0.0:8090` (`/pb` com a WORKDIR).

## Auth del portal (OTP)

- Login **sense contrasenya**: `POST /api/collections/partner_users/request-otp` i
  `auth-with-otp` (codi natiu de PocketBase, col·lecció `partner_users`).
- Codi de **6 dígits**, vigència **180 s** (migració 003). `authRule=""` perquè el flux el
  controla l'OTP del portal.
- En dev, `OTP_DEV_REVEAL=true` fa que el codi surti als logs
  (`docker compose logs -f pocketbase`, marca `[otp:dev]`). Requereix SMTP operatiu per enviar-lo.
- El codi OTP s'exposa al hook `onMailerRecordOTPSend` via `e.meta.password` (no a `request-otp`).
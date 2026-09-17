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
| `INVITE_API_KEY` | Clau d'automatització per `POST /api/portal/invitations` | Header `X-API-Key`; interna i acotada, sense token de superuser |
| `CARBONE_API_URL` | Base URL de l'API de Carbone | Cloud: `https://api.carbone.io` |
| `CARBONE_API_KEY` | API key de Carbone | `Authorization: Bearer <key>` |
| `CARBONE_TEMPLATE_ID` | ID de la plantilla del contracte a Carbone | v5 (`versioning=true`) |
| `OTP_DEV_REVEAL` | Dev: mostra el codi OTP als logs | **MAI en producció** |
| `ODOO_URL` | Base URL Odoo | `https://polser.odoo.com` |
| `ODOO_DB` | DB Odoo | `polser` |
| `ODOO_LOGIN` | Usuari tècnic | `prm@polser.cat` |
| `ODOO_APIKEY` | API key JSON-2 | Enviada com `Authorization: Bearer <key>` |
| `ODOO_STAGE_ID` | Etapa "Nou referit" a Odoo (`crm.lead`) | Default `13` |
| `ODOO_TEAM_ID` | Equip "PRM" | Default `9` (sempre aquest) |
| `NTFY_URL` | URL pública del servei ntfy | `https://ntfy.polser.cat`. `NTFY_BASE_URL` del contenidor ntfy |
| `NTFY_INTERNAL_URL` | Adreça interna PB→ntfy | Default `http://ntfy:80` (xarxa Docker) |
| `NTFY_PORT` | Port publicat al HOST de ntfy | Default `10002` |
| `NTFY_TOPIC_PREFIX` | Prefix dels topics per usuari | Default `polser-`; ha de coincidir amb `NTFY_AUTH_ACCESS` |
| `NTFY_VAPID_PUBLIC_KEY` / `NTFY_VAPID_PRIVATE_KEY` | Claus VAPID de Web Push | **Generades per `install.sh`** si estan buides. No canviar amb subscripcions actives |
| `NTFY_VAPID_EMAIL` | Correu de contacte VAPID | Default `no-reply@polser.cat` |
| `NTFY_PUBLISH_TOKEN` | Token opcional de publicació a ntfy | Buit = publicació anònima restringida al prefix |
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
   arrancar amb `CHANGE_ME_*`. **Genera les claus VAPID** de ntfy si falten (pas 2.1).
3. Construeix el portal: `cd portal && npm install && npm run build` → `portal/dist`.
4. Construeix i aixeca els contenidors (`pocketbase` + `ntfy`) + espera `GET /api/health`.
5. `docker compose exec pocketbase pocketbase superuser upsert EMAIL PASS` (idempotent).
6. Autentica superuser i `PATCH /api/settings` (appName, appURL, senderName/Address, SMTP+TLS).
7. Verifica: health, portal `200`, appName, SMTP i health de ntfy.

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
- Servei `ntfy` (`binwiederhier/ntfy:v2.26.0`, pinneat): Web Push per a la PWA.
  - Port publicat: `"${NTFY_PORT:-10002}:80"`; escolta a `:80` dins del contenidor.
  - Volum `ntfy_data:/var/lib/ntfy` — cache, auth i **subscriptions Web Push**.
  - Accés: `NTFY_AUTH_DEFAULT_ACCESS=deny-all` + `NTFY_AUTH_ACCESS='*:polser-*:read-write'`
    (el topic aleatori fa de contrasenya). VAPID via `NTFY_WEB_PUSH_*`.
  - Healthcheck: `wget http://localhost:80/v1/health`.

## Notificacions push (ntfy)

El push a la PWA funciona amb **Web Push sobre ntfy self-hosted**:

- **Topic per usuari** (`partner_users.ntfy_topic`, `polser-<aleatori>`), assignat al hook
  `_push.pb.js` (`onRecordCreate`) i retro-omplert per la migració `013`. Mai s'exposa a l'API
  pública (camp `hidden`; només el retorna `/api/portal/push/config` al propi usuari).
- **Subscripció**: la PWA demana `GET /api/portal/push/config` (VAPID pública + topic) i
  registra el `PushSubscription` via `POST /api/portal/push/subscribe`, que PocketBase
  reenvia a ntfy (`POST /v1/webpush`). El token de publicació **mai** surt del backend.
- **Avís d'activació**: en obrir el portal (després del login), si l'usuari no té
  subscripció activa es mostra un banner amb «Activar» / «Ara no» (es torna a mostrar al
  cap de 7 dies si es descarta). El botó demana el permís del navegador dins del mateix
  gest (necessari a iOS). L'estat també és gestionable a «El meu perfil».
- **Enviament**: el cron `push_processor` (cada minut) publica a ntfy les
  `notification_deliveries` pendents (`pushed_at` buit) amb `notifications.channel` ∈ push/both.
- **Esdeveniments**: canvi d'estat de referit (`_business_rules.pb.js`), comissió acreditada
  (`wallet_ledger`), canvi de payout i campanyes (`notifications`).
- **iOS**: només amb la PWA instal·lada a la pantalla d'inici (iOS 16.4+). Requereix HTTPS.
- **RGPD**: les càrregues push no inclouen mai dades personals de clients.

> ⚠️ L'API `POST/DELETE /v1/webpush` de ntfy és **interna i no documentada**: la imatge està
> pinnejada i, abans d'actualitzar-la, cal validar el registre de subscripcions.

## Auth del portal (OTP)

- Login **sense contrasenya**: `POST /api/collections/partner_users/request-otp` i
  `auth-with-otp` (codi natiu de PocketBase, col·lecció `partner_users`).
- Codi de **6 dígits**, vigència **180 s** (migració 003). `authRule=""` perquè el flux el
  controla l'OTP del portal.
- En dev, `OTP_DEV_REVEAL=true` fa que el codi surti als logs
  (`docker compose logs -f pocketbase`, marca `[otp:dev]`). Requereix SMTP operatiu per enviar-lo.
- El codi OTP s'exposa al hook `onMailerRecordOTPSend` via `e.meta.password` (no a `request-otp`).

## Config del contracte de col·laborador (`settings.sign_config`)

Camp JSON a `settings` amb els paràmetres d'Odoo Sign (migracions `008`/`009`/`010`). Es pot editar
des de `/_/` → `settings` → `sign_config`. Valor funcional actual (Odoo 19 · saas~19.3):

```json
{
  "request_model": "sign.request",
  "template_model": "sign.template",
  "document_model": "sign.document",
  "item_model": "sign.item",
  "document_attachment_field": "attachment_id",
  "document_template_field": "template_id",
  "item_link_field": "document_id",
  "item_role_field": "responsible_id",
  "request_item_field": "request_item_ids",
  "request_document_field": "",
  "role_name": "Signer 1",
  "template_name": "Contracte de col·laboració — {partner_name}",
  "subject": "Contracte de col·laboració — POLSER SEGURETAT",
  "message": "<p>Us fem arribar el contracte per signar.</p>",
  "reference_prefix": "COL-",
  "validity_days": 30,
  "field": {
    "type_id": 1, "name": "Signatura", "page": 3,
    "posX": 0.51, "posY": 0.495, "width": 0.329, "height": 0.096,
    "required": true, "num_options": 0, "alignment": "left"
  }
}
```

### Clau de cada camp
- `*_model`: noms dels models d'Odoo Sign. `role_model` **no es posa**: el model de rols es
  **descobreix automàticament** des de la metadada (`sign.item.responsible_id.relation`).
- `document_attachment_field`: camp on va el PDF dins `sign.document` a Odoo 19 (abans era a
  `sign.template`).
- `item_link_field` / `item_role_field`: com es vincula el `sign.item` al document i al signant
  (`document_id` / `responsible_id`).
- `request_item_field`: camp de firmants al `sign.request`. El signant **requereix `partner_id` i
  `role_id`**.
- `request_document_field`: buit = no s'envia (`template_document_ids` és de només lectura).
- `role_name`: nom del rol/signant (es crea si no existeix).
- `template_name`: suporta `{partner_name}`.
- `validity_days`: s'envia com a **data** (`avui + N dies`).
- `field`: el camp de firma sobre el PDF de Carbone (coordenades relatives 0–1, `page` 1-indexada,
  `type_id: 1` = Signature).

> **Nota:** `document_raw_field` (migració `010`) és **legacy**: el PDF s'adjunta via
> `attachment_id`, no cal.

# PRM POLSER (v2 · PocketBase)

Portal de partners i gestió de referits/comissions de **POLSER SEGURETAT, SL**.
PRM a mida, **extern a Odoo**: Odoo és la font de veritat de la comissió i el PRM
la **reflecteix** (via outbox → Odoo), mai la recalcula pel compte propi.

**Stack (v2):** 1 binari [PocketBase](https://pocketbase.io) 0.40.3 (SQLite embegut,
API + admin UI `/_/`) + **hooks JS** (`pb_hooks/`) + **cron** (crons interns, sense n8n).
El portal React (PWA) se serveix des del mateix binari (`pb_public`).

> Document de referència de producte: `docs/PLAN_MIGRACIONS_POCKETBASE.md` i
> `docs/TASQUES_AGENT_POCKETBASE.md` (auditoria i tasques d'agent).

---

## Arquitectura (una frase)

Un únic procés PocketBase serveix la UI d'admin, l'API del portal (`/api/portal/*`), el portal
React compilat (`pb_public`) i executa els crons de negoci. La sortida cap a **Odoo** passa per la
taula **`outbox`** (emissió per events, processament al cron `sync_odoo` per JSON-RPC). Les
integracions amb Odoo i l'enviament d'emails (OTP) es configuren per `PATCH /api/settings`.

```
Internet ──► PocketBase :8090 (Docker)
               ├── UI admin (/_) + API (/api/*)
               ├── /api/portal/*          → portal React PWA (aïllament per partner, RGPD)
               ├── cron sync_odoo         → llegeix `outbox` pending → Odoo (JSON-RPC)
               ├── cron commission_monthly / payout_processor / notification_processor / cleanup
               └── Odoo (operacions internes + facturació)  ── font de veritat de la comissió
```

---

## Instal·lació / desplegament (via canal oficial)

L'script **`install.sh`** fa tot el desplegament "des del moment 0" (idempotent). Requereix
`docker`, `docker compose`, `node` i `npm` al servidor.

```bash
cp .env.example .env          # EDITA: PUBLIC_URL, APP_NAME, SUPERUSER_EMAIL/PASSWORD, SMTP, ODOO_*
./install.sh
```

`install.sh` executa, en ordre:
1. Verifica prerequisits.
2. Prepara `.env` (rebutja arrancar amb placeholders `CHANGE_ME_*`).
3. Construeix el portal React (`npm install` + `npm run build` → `portal/dist`).
4. Construeix i aixeca el contenidor (`docker compose build` + `up -d`) i espera `health`.
5. Crea/actualitza el **superuser** per CLI: `docker compose exec pocketbase pocketbase superuser upsert SUPERUSER_EMAIL SUPERUSER_PASSWORD`.
6. Aplica **appName, appURL i SMTP** via `PATCH /api/settings` (autenticació com a superuser).
7. Verifica: `health`, portal `200`, i que `appName`/SMTP s'han aplicat.

> ⚠️ **Molt important:** a PocketBase **no hi ha CLI ni flags ni variables d'entorn per a
> settings** (`PB_APP_NAME`, `PB_SMTP_HOST`, etc. que apareguin en un `.env`/compose **NO els
> llegeix PocketBase** — són strings morts). La configuració correcta es fa **per API**:
> autenticar com a superuser i `PATCH /api/settings`. Això ho fa `install.sh` al pas 6.
> Per a la UI: entrar a `/_/` amb el superuser i anar a Settings.

### Quickstart manual (equivalent als passos de `install.sh`)

```bash
# 1) variables d'entorn
cp .env.example .env          # omple: PUBLIC_URL, APP_NAME, SUPERUSER_*, SMTP (OTP), ODOO_*

# 2) construeix el portal (es serveix des del mateix PB a /)
cd portal && npm install && npm run build   # genera portal/dist

# 3) aixeca PocketBase (aplica migracions automàticament i carrega els hooks)
docker compose up -d          # → http://localhost:10001

# 4) superuser (per entrar a /_/)
docker compose exec pocketbase pocketbase superuser upsert admin@polser.cat CONTRASENYA_FORTA

# 5) aplica appName/appURL/SMTP per API (els PB_*_del_compose NO serveixen):
#    autentica com a superuser i PATCH /api/settings — o fes-ho des de /_/ → Settings.
```

### Troubleshooting: no surt el formulari del primer superuser (OPS-1)

PocketBase només mostra el flow de creació del primer superuser quan la col·lecció interna
`_superusers` és **buida**. Si a `/_/` surt directament el login, el volum persistent
`pb_data` ja conté un superuser d'una execució anterior. Solucions:

- **Opció A (no perd dades):** crea/actualitza el superuser per CLI
  ```bash
  docker compose exec pocketbase pocketbase superuser upsert EMAIL PASS_SUPER_SEGUR
  ```
- **Opció B (tornar a zero):** elimina el volum
  ```bash
  docker compose down -v      # -v elimina el volum pb_data
  docker compose up -d        # ara sí que surt el flow a /_/
  ```

### Prova ràpida del login OTP sense SMTP (sols dev)

`OTP_DEV_REVEAL=true` al `.env` → el codi de 6 dígits surt als logs:
```bash
docker compose logs -f pocketbase   # busca "[otp:dev] Codi OTP"
```

---

## Estructura del repo

```
polser-prm/
├── install.sh                 # desplegament idempotent (7 passos)
├── docker-compose.yml         # servei pocketbase (build des de Dockerfile) + volum pb_data
├── Dockerfile                 # PocketBase 0.40.3 (pinneat) sobre Alpine
├── .env.example               # copia → .env (MAI commitegis .env)
├── README.md
├── AGENTS.md                  # guia d'agent — pendent de migrar a l'stack PocketBase
├── docs/
│   └── TASQUES_AGENT_POCKETBASE.md   # auditoria + tasques d'agent (v2)
├── pb_migrations/             # migracions JS (s'apliquen en arrencada)
│   └── 001_create_collections.js     # P1: 16 col·leccions + seed de serveis/settings
├── pb_hooks/                  # hooks JS (càrrega automàtica; cada fitxer és un mòdul)
│   ├── types.d.ts             # stubs de tipus per a l'editor
│   ├── _settings.pb.js        # auxiliar dev OTP (revela el codi si OTP_DEV_REVEAL=true)
│   ├── _outbox.pb.js          # P2: emissor d'events cap a `outbox` (mai crida Odoo)
│   ├── _business_rules.pb.js  # P3: ledger immutable, recurrent única, autònom→afiliat, events, RGPD
│   ├── _crons.pb.js           # P5: crons + ÚNIC processador real d'outbox (sync_odoo → Odoo)
│   └── _portal.pb.js          # P6: API del portal /api/portal/* (aïllament per partner, RGPD)
└── portal/                    # React 19 + TS + Vite → PWA (mobile-first, bottom-nav 3 pestanyes)
```

> ⚠️ **Regla d'enginyeria (important, après a la pràctica):** a PocketBase 0.40.3 el JSVM executa
> els handlers dels hooks en un context aïllat on **cap funció/const/`globalThis` de nivell de
> fitxer és visible** dins dels callbacks. Per això cada `routerAdd`/`cronAdd` ha de ser
> **totalment autocontingut** (lògica inline dins del callback), usant només els globals injectats
> per PB (`$app`, `$os`, `$http`, `$security`, `Record`, `ForbiddenError`, ...). No s'ha de tornar
> a definir helpers a nivell de fitxer i usar-los des de les rutes/crons.

---

## Model de dades (font: `pb_migrations/001_create_collections.js`)

**16 col·leccions:** `services`, `partners`, `partner_users` (auth + OTP),
`partner_members`, `referrals`, `referral_events`, `commission_rules`, `wallet_ledger`,
`payouts`, `interactions`, `documents`, `notifications`, `notification_deliveries`,
`odoo_sync_log`, `settings`, `outbox`. (PB a més crea les seves col·leccions internes:
`_superusers`, `_otps`, `users` — la col·lecció `users` per defecte **no s'usa**.)

- **Diners sempre en cèntims** (enters), mai floats.
- `referrals.odo_opportunity_id` = ancla amb Odoo (`crm.lead`); sync **idempotent**.
- `wallet_ledger` = **APPEND-ONLY**; les correccions són entrades `reversal`.
- RGPD: camps `client_*` de `referrals` ocults a l'API (excepte superusers).

---

## Hooks — mapa de responsabilitats

| Fitxer | Responsabilitat |
|---|---|
| `pb_migrations/001_create_collections.js` | P1 · Esquema + seed |
| `pb_hooks/_settings.pb.js` | Auxiliar dev OTP (revela codi si `OTP_DEV_REVEAL=true`) |
| `pb_hooks/_outbox.pb.js` | P2 · Encuar `create_opportunity` en alta de referit |
| `pb_hooks/_business_rules.pb.js` | P3 · Regles no negociables (vegeu avall) |
| `pb_hooks/_crons.pb.js` | P5 · `sync_odoo`, `commission_monthly`, `payout_processor`, `notification_processor`, `cleanup` + processadors reals Odoo (handlers autocontinguts) |
| `pb_hooks/_portal.pb.js` | P6 · `/api/portal/me`, `/services`, `/referrals`, `/wallet`, `/payouts`, `/documents`, `/notifications` (handlers autocontinguts) |

---

## Regles de negoci NO negociables

1. **La comissió la dicta Odoo.** El PRM l'encua a `outbox` i el cron `sync_odoo` la llegeix de
   Odoo (`crm.lead`, factures de proveïdor). El PRM **no decideix ni recalcula** la comissió.
2. **Regla CEO autònoms (08/09/2026):** un autònom (persona física) és **SEMPRE perfil Afiliat** i
   rep **només 60 € per alta**. **MAI** el 10 % recurrent. 3 capes: esquema (perfils), hook
   (`type=autonomo ⇒ profile=afiliat` a `partners`; `profile=afiliat ⇒ allow_recurring=false` a
   `commission_rules`) i UI (no ofereix la recurrent als autònoms).
3. **Ledger immutable.** Cap UPDATE/DELETE extern sobre `wallet_ledger`; correcció = `reversal`.
4. **Una sola recurrent per període** (`partner+referral+period`, `type=recurring`).
5. **RGPD:** el portal mai exposa dades personals del client referit (només `status` + data).
6. **Referits = oportunitat Odoo.** Tot referit s'ancla a una `crm.lead`; sync idempotent per
   `odo_opportunity_id`.

---

## Operació

| Variable | Ús |
|---|---|
| `PUBLIC_URL` | URL pública del servei (enllaços/emails) — s'aplica a settings (appURL) |
| `APP_NAME` | Nom de l'app (UI + emails) — s'aplica a settings (appName) |
| `SUPERUSER_EMAIL` / `SUPERUSER_PASSWORD` | Superuser admin de PB (creat per `install.sh`) — s'usa per autenticar via API i aplicar settings |
| `EMAIL_SMTP_HOST` / `PORT` / `USER` / `PASSWORD` | SMTP per a l'enviament de codis OTP — s'aplica a settings (smtp) |
| `EMAIL_FROM` | Remitent dels emails (`"Nom <addr>"`) — s'aplica a settings (meta.senderName/Address) |
| `OTP_DEV_REVEAL` | Dev: mostra el codi OTP als logs del contenidor (mai en prod) |
| `ODOO_URL` / `ODOO_DB` / `ODOO_LOGIN` / `ODOO_APIKEY` | Connexió JSON-RPC del cron `sync_odoo` |
| `VITE_POCKETBASE_URL` | Enllaç de la API PB al build del portal. Buit/omès = mateix origen (el portal el serveix el mateix PB); només cal si l'API és en un altre origen |

- Migracions i hooks s'apliquen/carreguen automàticament a l'arrencada (vegeu `Dockerfile`).
- Healthcheck: `GET /api/health` (port exposat `10001 → 8090`).
- **Configuració de l'app (appName, appURL, SMTP):** es fa per `PATCH /api/settings` amb token de
  superuser (no per env vars — PB no les llegeix). `install.sh` ho fa automàticament; en manual,
  des de `/_/` → Settings.

---

## Llicència / nota

Codi propi de POLSER (repo privat). **PocketBase** és **MIT**. La versió està **pinneada** a
`0.40.3` al `Dockerfile` i al `docker-compose.yml`. **Deploy actual:** `prm.polser.cat`.
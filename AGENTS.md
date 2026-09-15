# AGENTS.md — Guia per a l'agent de codi del PRM POLSER (v2 · PocketBase)

Aquest fitxer dona context i **guardrails** a l'agent (o agents) de codi que manté el **PRM de
POLSER SEGURETAT**. Llegeix-lo sencer abans de tocar res. No salteu les regles.

> **Font de veritat del producte:** els documents de `docs/` (índex: [`docs/README.md`](docs/README.md)),
> que descriuen arquitectura, model de dades, configuració, integració amb Odoo i runbook d'operacions.
> La KB externa de preus/comissions/partners viu a `~/.hermes/knowledge/`, no es duplica aquí.
> Si una instrucció d'aquest fitxer contradiu els `docs/`, parla amb la direcció abans — no decideixis tu.

---

## 1. Què és això

PRM (Partner Relationship Management) a mida per a **POLSER SEGURETAT, SL** (seguretat privada a
Catalunya). Gestió de la xarxa de *partners* (inmobiliàries, administradors de finques, operadors
de telecom, autònoms) que refereixen clients: registre de referits, seguiment del cicle de venda,
cartera de comissions i notificacions — accedible des del **mòbil** (PWA).

**Principis no negociables:**
- SELF-HOSTED, sense dependència SaaS ni lock-in.
- **1 backend / 1 BBDD** al PRM (SQLite embegut a PocketBase). La integració amb Odoo és
  **per API/events (outbox)**, mai duplicant/sincronitzant BBDD.
- Mínim de serveis. Coses simples sobre coses complexes. **Sense n8n**: el negoci viu als crons interns.
- La UI del portal és **en català** i **mobile-first**.

---

## 2. Stack i arquitectura

| Capa | Tecnologia | Notes |
|---|---|---|
| Data + API + admin + crons + portal | **PocketBase 0.40.3** (1 binari) | SQLite embegut; UI admin `/_/`; API `/api/*`; `/api/portal/*`; portal a `pb_public` |
| Base de dades | SQLite embegut | fitxer `pb_data.db` al volum `pb_data` (sense Postgres) |
| Portal partner | React 19 + TypeScript + Vite → **PWA** | repositori `portal/`; mobile-first, bottom-nav 3 pestanyes |
| Lògica de negoci | Hooks JS (`pb_hooks/`) + crons (`cronAdd`) | el cor del negoci està als crons interns |
| Integració Odoo | **JSON-2** (`/json/2/<model>/<method>`) via outbox | Odoo = font de veritat de la comissió |
| Infra | Docker Compose + Caddy/CDN extern | `docker-compose.yml` (publica `PUBLIC_PORT:8090`) |

Flux alt nivell:

```
Internet ──► PocketBase :8090 (Docker)
               ├── UI admin (/_) + API (/api/*)
               ├── /api/portal/*          → portal React PWA (aïllament per partner, RGPD)
               ├── cron sync_odoo         → llegeix outbox pending → Odoo (JSON-2)
               ├── cron odoo_two_way_sync → Odoo → PRM (etapa + comissions)
               ├── cron commission_monthly / payout_processor / notification_processor / cleanup
               └── Odoo (operacions internes + facturació)  ── font de veritat de la comissió
```

Deploy actual: **`https://prm.polser.cat`**. Versió pinneada: PocketBase **`0.40.3`**.

---

## 3. Estructura del repo

```
polser-prm-v2/
├── install.sh                 # desplegament idempotent (7 passos)
├── docker-compose.yml         # servei pocketbase (build des de Dockerfile) + volum pb_data
├── Dockerfile                 # PocketBase 0.40.3 (pinneat) sobre Alpine 3.19
├── .env.example               # copia → .env (MAI commitgis .env)
├── README.md                  # quickstart + decisions
├── AGENTS.md                  # aquest fitxer
├── docs/                      # DOCUMENTACIÓ (índex: docs/README.md)
│   ├── 01-ARQUITECTURA.md     # stack, components, flux, mapa de hooks
│   ├── 02-MODEL-DADES.md      # 16 col·leccions + migracions + regles
│   ├── 03-CONFIGURACIO.md     # variables + com es configura l'app realment
│   ├── 04-INTEGRACIO-ODOO.md  # outbox, JSON-2, crons, comissions
│   ├── 05-RUNBOOK-OPERACIONS.md
│   └── (treballs previs: TASQUES_AGENT_POCKETBASE.md, PENDENT_revisio_perdido.md, unif_finances_euros.md)
├── pb_migrations/             # migracions JS (s'apliquen a l'arrencada)
│   └── 001_create_collections.js     # 16 col·leccions + seed de serveis/settings
├── pb_hooks/                  # hooks JS (càrrega automàtica; cada fitxer és un mòdul)
│   ├── types.d.ts             # stubs de tipus per a l'editor
│   ├── _settings.pb.js        # auxiliar dev OTP (revela el codi si OTP_DEV_REVEAL=true)
│   ├── _outbox.pb.js          # P2: encua create_opportunity (MAI crida Odoo al request)
│   ├── _business_rules.pb.js  # P3: ledger immutable, recurrent única, autònom→afiliat, events, RGPD
│   ├── _crons.pb.js           # P5: crons + ÚNIC processador real d'outbox (sync_odoo → Odoo)
│   └── _portal.pb.js          # P6: API /api/portal/* (aïllament per partner, RGPD)
└── portal/                    # React 19 + TS + Vite → PWA (mobile-first, bottom-nav 3 pestanyes)
```

> ⚠️ **Regla d'enginyeria (apresa a la pràctica):** a PocketBase 0.40.3 el JSVM executa els handlers
> dels hooks en un context aïllat on **cap funció/const/`globalThis` de nivell de fitxer és visible**
> dins dels callbacks. Cada `routerAdd`/`cronAdd`/hook ha de ser **totalment autocontingut** (lògica
> inline dins del callback), usant només els globals injectats per PB (`$app`, `$os`, `$http`,
> `$security`, `$apis`, `Record`, `ForbiddenError`, …). No redefinir helpers a nivell de fitxer per
> usar-los des de rutes/crons: donaria `ReferenceError`.

---

## 4. Model de dades — les taules que NO pots trencar

Les taules viuen a `pb_migrations/001_create_collections.js` (detall a `docs/02-MODEL-DADES.md`):

- `services` — catàleg (alta_fee, monthly_fee). **La quota mensual és la base de la comissió recurrent.**
- `partners` + `partner_members` + `partner_users` (auth OTP) — organització, comptes i rols del portal.
- `referrals` — el referit / la venta. **`odo_opportunity_id` = ancla amb Odoo (`crm.lead`).**
  Camp `status` = cicle. `partner_commission_*` = comissió sincronitzada d'Odoo (migració 005).
- `referral_events` — històric de transicions (auditoria, append-only).
- `commission_rules` — regles de comissió. **Espejo de la intenció; el valor final el dicten Odoo.**
- `wallet_ledger` — cartera. **APPEND-ONLY / immutable.** Correccions = entrades `reversal`, MAI UPDATE.
- `payouts` — retirades / factura inversa (mínim 100 €, pagament en 15 dies hàbils; vegeu `settings`).
- `notifications` + `notification_deliveries` — campanyes on-demand (in-app).
- `interactions` — log CPSO. `documents` — materials/push.
- `odoo_sync_log` — auditoria (legacy; la font operativa és `outbox`).
- `settings` — globals (min_payout, payout_days, default_fixed_commission, default_recurring_rate…).
- `outbox` — cua d'events cap a Odoo (P2).

**Moneda canònica: EUROS amb 2 decimals (migració `004`). MAI cèntims ni floats.** No facis `*100`/`/100`.

Canvis de model → editar a `pb_migrations/` com a **migracions** (fitxers numerats o ALTER),
no només per la UI de PocketBase, perquè quedi versionat.

---

## 5. Lògica de negoci NO negociable (ordres de direcció)

1. **La comissió la dicta Odoo.** El PRM encua la intenció a `outbox`, llegeix el resultat d'Odoo i el
   reflecteix a la cartera. El PRM **no decideix ni recalcula** la comissió pel seu compte.
   `commission_rules` és espejo, no criteri.
2. **Regla CEO autònoms (08/09/2026):** un autònom (persona física) és **SEMPRE perfil Afiliat** i rep
   **només 60 € per alta**. **MAI** se li ofereix ni apareix el 10 % recurrent. Aplicar-ho en
   **3 capes**: esquema (perfils), hook (`type=autonomo ⇒ profile=afiliat`; `profile=afiliat ⇒
   allow_recurring=false`) i UI (el portal no ofereix la recurrent als afiliats).
3. **Ledger immutable.** Cap UPDATE/DELETE extern sobre `wallet_ledger`; correcció = entrada `reversal`.
4. **Una sola recurrent per període** (`partner+referral+period`, `type=recurring`), defensada al hook.
5. **RGPD:** el portal del partner **no exposa mai** dades personals dels clients referits
   (només `status` + data); camps `client_*` ocults a l'API.
6. **Referits = oportunitat Odoo (`crm.lead`).** Tot referit s'ancla a una oportunitat del CRM de
   Odoo; pressupost, subscripció i factures pengen d'allà. Sync **idempotent** per `odo_opportunity_id`.

---

## 6. Regles d'enginyeria

- **Català a la UI**, colors de marca POLSER: primary `#042149`, accent `#FF6B00`, fons `#F6F5F4`,
  text `#1F2937`, gris `#6B7280`. Troba-ho a `portal/src/styles.css`.
- **Portal mobile-first:** bottom-nav fixa amb 3 pestanyes (Inici / Referits / Cartera); a ≥768px la
  mateixa estructura en barra superior. No canviïs el model de navegació.
- **TypeScript** estricte, dependències **mínimes**. MAI floats per a diners (euros, 2 decimals).
- `npm run build` ha de passar sempre (portal). Vite `base:'./'`, PWA (manifest + `sw.js`).
- **Mai** commits `.env`, `node_modules/`, `dist/`, `pb_data/`, `*.tsbuildinfo`.
- Revisa la **llicència** de qualsevol dependència nova (preferible MIT/Apache).
  ⚠️ `react-kanban-kit` està descartat (llicència NOASSERTION). PocketBase: **pinneat** a la versió.
- No inventis preus/comissions que no constin a la KB (`/home/ai/.hermes/knowledge/` externa al repo).
  El catàleg està al seed de `pb_migrations/001_create_collections.js`.

---

## 7. Backend i integracions (apunts per a l'agent)

- **Auth partners:** login sense contrasenya **email OTP** natiu de PocketBase sobre la col·lecció
  `partner_users` (`POST /api/collections/partner_users/request-otp` i `auth-with-otp`). Codi de
  **6 dígits / 180 s** (migració 003). Rols interns POLSER: `_superusers` amb contrasenya.
- **Configuració de l'app (appName, appURL, SMTP):** es fa per `PATCH /api/settings` amb token de
  superuser — **NO per variables d'entorn** (les `PB_APP_URL`/`PB_SMTP_*` del compose són strings
  mortes). `install.sh` ho aplica automàticament (pas 6); en manual, `/_/` → Settings.
- **Notificacions on-demand:** col·lecció `notifications`; el cron `notification_processor` passa
  `queued`→`sent` i escriu `notification_deliveries` per audiència (all/afiliats/colaboradors).
  `GET /api/portal/notifications` llista **només les entregues de l'usuari** (permet campanyes dirigides).
- **Alta de partner per invitació** (`pb_hooks/_invitations.pb.js`, migració `006`):
  `POST /api/portal/invitations` (superuser) crea el partner en `pendente` amb perfil **sempre `afiliat`** i
  envia email amb enllaç `/registre?token=...` (7 dies, single-use); `GET/POST /api/portal/invitations/{token}`
  (públics) validen i completen l'alta (activa el partner, crea `partner_users` + `partner_members`, envia
  email de signatura de contracte i notificació in-app dirigida). L'ascens a `colaborador` és manual des de `/_/`.
- **Sync Odoo:** outbox (events) + crons `sync_odoo` (PRM→Odoo) i `odoo_two_way_sync`
  (Odoo→PRM: etapa, comissions, pèrdua, client). Idempotència per `odo_opportunity_id`.
  API **JSON-2** amb `Authorization: Bearer` + header `x-odoo-database`.
- **RBAC:** rols a `partner_users` (`partner`/`POLSER_cpso`/`POLSER_admin`/`POLSER_ceo`).
- El portal fa `fetch` cap a `import.meta.env.VITE_POCKETBASE_URL` (`portal/src/lib/api.ts`);
  **buit en producció** (crides relatives al mateix origen).

---

## 8. Estat actual i què ve ara

**Fet (v2):** infraestructura completa i operativa (deploy: `https://prm.polser.cat`). Portal React
compilat i verificat (`npm run build` exit 0); esquema, hooks i crons implementats (outbox/JSON-2 inclosos).

**Punts de revisió oberts** (vegeu `docs/`):
- `docs/TASQUES_AGENT_POCKETBASE.md` — llistat d'issues de l'auditoria (comprovar quins segueixen oberts).
- `docs/PENDENT_revisio_perdido.md` — revisió de la detecció de leads perdudes.
- Treure la migració morta `002_remove_auth_otps.js` (l'`auth_otps` mai es crea; va en `try/catch`).
- Decidir el tractament de `source='portal'` (forçat al servidor) vs `'onboarding'` (enviat per la UI).
- ⚠️ **Passar el repo a PRIVAT:** ara és públic a GitHub i conté l'snapshot de preus/comissions i el
  model complet.

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
| Portal partner | React 18 + TypeScript + Vite → **PWA** | repositori `portal/`; mobile-first, bottom-nav 3 pestanyes |
| Lògica de negoci | Hooks JS (`pb_hooks/`) + crons (`cronAdd`) | el cor del negoci està als crons interns |
| Integració Odoo | **JSON-2** (`/json/2/<model>/<method>`) via outbox | Odoo = font de veritat de la comissió |
| Push a la PWA | **ntfy self-hosted** (Web Push/VAPID) | servei `ntfy` al compose; el PRM només publica missatges HTTP |
| Infra | Docker Compose + Caddy/CDN extern | `docker-compose.yml` (publica `PUBLIC_PORT:10001` → `8090` i `NTFY_PORT:10002` → `80`) |

Flux alt nivell:

```
Internet ──► PocketBase :8090 (Docker)
               ├── UI admin (/_) + API (/api/*)
               ├── /api/portal/*          → portal React PWA (aïllament per partner, RGPD)
               ├── cron sync_odoo         → llegeix outbox pending → Odoo (JSON-2)
               ├── cron odoo_two_way_sync → Odoo → PRM (etapa + comissions)
               ├── cron commission_monthly / payout_processor (llegat) / notification_processor / cleanup
               ├── cron reengagement_reminder / rule_processor → recordatoris automàtics
               ├── cron push_processor    → ntfy :80 → Web Push a la PWA (per usuari)
               ├── ntfy :80 (Docker)       → servei Web Push/VAPID (topics polser-*)
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
│   ├── 06-PANELL-ADMIN.md     # panell /admin (superusuaris): auth, seccions, endpoints
│   ├── 07-INTEGRACIO-NTFY-PUSH.md # push ntfy self-hosted a la PWA
│   └── (treballs previs: TASQUES_AGENT_POCKETBASE.md, PENDENT_revisio_perdido.md, unif_finances_euros.md)
├── pb_migrations/             # migracions JS (s'apliquen a l'arrencada)
│   ├── 001_create_collections.js     # 16 col·leccions + seed de serveis/settings
│   ├── 002..013_*.js                 # presentació, euros, comissions partner, invitacions,
│   │                                 # contracte, sign_config, admin, dates, push ntfy
│   ├── 014_partner_partial_unique_indexes.js # índexs únics parcials a partners (nif/email)
│   ├── 015_partner_users_token_duration.js   # sessió de 30 dies (authToken.duration)
│   ├── 016_reengagement.js                   # last_seen_at/reminder + reengagement_days
│   └── 017_notification_rules.js             # regles de notificacions automàtiques
├── pb_hooks/                  # hooks JS (càrrega automàtica; cada fitxer és un mòdul)
│   ├── types.d.ts             # stubs de tipus per a l'editor
│   ├── _settings.pb.js        # auxiliar dev OTP (revela el codi si OTP_DEV_REVEAL=true)
│   ├── _outbox.pb.js          # P2: encua create_opportunity (MAI crida Odoo al request)
│   ├── _business_rules.pb.js  # P3: ledger immutable, recurrent única, autònom→afiliat, events, RGPD
│   ├── _crons.pb.js           # P5: crons + ÚNIC processador real d'outbox (sync_odoo → Odoo)
│   ├── _invitations.pb.js     # alta de partner per invitació (token + INVITE_API_KEY)
│   ├── _partner_provisioning.pb.js # partner actiu amb email → crea/assegura partner_users
│   ├── _contracts.pb.js       # partner_sync (res.partner) + PDF contracte via Carbone
│   ├── _admin.pb.js           # P7: API /api/admin/* (panell de superusuaris)
│   ├── _push.pb.js            # P8: push ntfy (topic per usuari, /api/portal/push/*, cron push_processor)
│   └── _portal.pb.js          # P6: API /api/portal/* (aïllament per partner, RGPD)
└── portal/                    # React 18 + TS + Vite → PWA (mobile-first, bottom-nav 3 pestanyes)
```

> ⚠️ **Regla d'enginyeria (apresa a la pràctica):** a PocketBase 0.40.3 el JSVM executa els handlers
> dels hooks en un context aïllat on **cap funció/const/`globalThis` de nivell de fitxer és visible**
> dins dels callbacks. Cada `routerAdd`/`cronAdd`/hook ha de ser **totalment autocontingut** (lògica
> inline dins del callback), usant només els globals injectats per PB (`$app`, `$os`, `$http`,
> `$security`, `$apis`, `Record`, `ForbiddenError`, …). No redefinir helpers a nivell de fitxer per
> usar-los des de rutes/crons: donaria `ReferenceError`.

> ⚠️ **`e.next()` és OBLIGATORI als hooks de records.** El handlers registrats amb
> `onRecordAfterCreateSuccess`/`onRecordAfterUpdateSuccess`/`onRecordCreate`/… formen una **cadena**
> per (event + col·lecció): si un handler **no acaba amb `return e.next()`** (també als `return`
> primerencs) la cadena S'ATURA i els handlers següents **no s'executen mai**. Exemple real: a
> `referrals` hi conviuen l'històric d'events (`_business_rules.pb.js`) i l'encuament a l'outbox
> (`_outbox.pb.js`); sense `e.next()` al primer, l'outbox no es poblava i la sync amb Odoo quedava
> morta silenciosament. Mai treure aquests `e.next()`.

> ⚠️ **API inconsistent de `requestInfo`:** als events de request (`onRecordUpdateRequest`,
> `onRecordDeleteRequest`, rutes `routerAdd`) és un **mètode** → `e.requestInfo().hasSuperuserAuth()`.
> Als events d'`onRecordEnrich` és una **propietat objecte** → `e.requestInfo.hasSuperuserAuth()`.
> No unificar-les. I `$http.send(...).json` **val `null` per a respostes JSON escalars** (p. ex. un
> `create` d'Odoo que retorna un `id` numèric): cal fer `JSON.parse(res.raw)` quan `res.json` és null.

---

## 4. Model de dades — les taules que NO pots trencar

Les taules viuen a `pb_migrations/001_create_collections.js` (detall a `docs/02-MODEL-DADES.md`):

- `services` — catàleg (alta_fee, monthly_fee). **La quota mensual és la base de la comissió recurrent.**
- `partners` + `partner_members` + `partner_users` (auth OTP) — organització, comptes i rols del portal.
  (`partner_users.last_seen_at`/`last_reminder_at` per al re-engagement, migració 016.)
- `referrals` — el referit / la venta. **`odo_opportunity_id` = ancla amb Odoo (`crm.lead`).**
  Camp `status` = cicle. `partner_commission_*` = comissió sincronitzada d'Odoo (migració 005).
- `referral_events` — històric de transicions (auditoria, append-only).
- `commission_rules` — regles de comissió. **Espejo de la intenció; el valor final el dicten Odoo.**
- `wallet_ledger` — cartera. **APPEND-ONLY / immutable.** Correccions = entrades `reversal`, MAI UPDATE.
- `payouts` — retirades. El partner **no** les sol·licita des del portal; l'admin les **registra** quan ha pagat la factura (vegeu §7).
- `notifications` + `notification_deliveries` — notificacions in-app/push (campanyes, events i regles).
  `notifications.rule` apunta a l'origen si ve d'una regla automàtica (migració 017).
- `notification_rules` — **regles de notificacions automàtiques** (migració 017): `periodic`
  (cada `interval_days`) i `wallet_balance` (saldo ≥ `min_balance`); les avalua el cron `rule_processor`.
- `interactions` — log CPSO. `documents` — materials/push.
- `odoo_sync_log` — auditoria (legacy; la font operativa és `outbox`).
- `settings` — globals (min_payout, payout_days, default_fixed_commission, default_recurring_rate,
  reengagement_days…).
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
5. **RGPD:** el partner **propietari** veu les dades del client que **ell mateix ha introduït**
   (`client_*`) a la fitxa del referit; **no** s'exposen mai a altres partners. L'API de col·lecció de
   `referrals` manté `client_*` ocultes per a tots els no-superusers (xarxa de seguretat a
   `_business_rules.pb.js`); només la ruta del portal les retorna al propietari.
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
  **Sessió:** el JWT de `partner_users` dura **30 dies** (`authToken.duration`, migració `015`); el
  portal el **renova silenciosament** (`POST /api/collections/partner_users/auth-refresh`) en obrir
  l'app i al tornar-hi quan és a prop de caducar, i reintenta un cop qualsevol petició que rebi 401.
  Així un usuari actiu no es desconnecta mai; un dispositiu abandonat caduca al cap de 30 dies.
- **Re-engagement** (migració `016`): `partner_users.last_seen_at` s'actualitza en obrir l'app
  (`POST /api/portal/ping`, cridat pel `Layout`). El cron `reengagement_reminder` (diari, 9:00) envia
  un recordatori (notificació push + in-app **i email**) als usuaris amb `last_seen_at` de fa ≥
  `settings.reengagement_days` (def. 30, editable a `/admin/settings`), com a màxim un cop per
  finestra (`last_reminder_at`).
  Els usuaris que mai no han obert l'app no es recorden.
- **Regles de notificacions automàtiques** (migració `017`, col·lecció `notification_rules`): l'admin
  les crea/gestiona a **`/admin/automations`** («Recordatoris»). El cron `rule_processor` (cada 15 min)
  avalua: `periodic` (cada `interval_days`, p. ex. 14) i `wallet_balance` (saldo disponible
  = suma(`wallet_ledger`) − suma(`payouts`) ≥ `min_balance`, com a màxim cada `cooldown_days`).
  Genera una `notifications` (amb `rule`) + `notification_deliveries`; el push el fa `push_processor`.
- **Configuració de l'app (appName, appURL, SMTP):** es fa per `PATCH /api/settings` amb token de
  superuser — **NO per variables d'entorn** (les `PB_APP_URL`/`PB_SMTP_*` del compose són strings
  mortes). `install.sh` ho aplica automàticament (pas 6); en manual, `/_/` → Settings.
- **Notificacions on-demand:** col·lecció `notifications`; el cron `notification_processor` passa
  `queued`→`sent` i escriu `notification_deliveries` per audiència (all/afiliats/colaboradors).
  `GET /api/portal/notifications` llista **només les entregues de l'usuari** (permet campanyes dirigides).
- **Notificacions push a la PWA** (`pb_hooks/_push.pb.js`, migració `013`): ntfy self-hosted
  (Web Push/VAPID) amb un **topic per usuari** (`partner_users.ntfy_topic`, `polser-<aleatori>`,
  camp ocult). La PWA es subscriu via `GET /api/portal/push/config` (VAPID pública) i
  `POST /api/portal/push/subscribe` (PB reenvia a ntfy `POST /v1/webpush`; el token no surt del
  backend). El cron `push_processor` publica les `notification_deliveries` amb `pushed_at` buit i
  `notifications.channel` ∈ push/both. Esdeveniments: estat de referit, comissió, payout i campanyes.
  Mai dades `client_*` als payloads. iOS: només PWA instal·lada (16.4+). API `/v1/webpush` de ntfy
  **no documentada** → imatge pinnejada.
- **Alta de partner per invitació** (`pb_hooks/_invitations.pb.js`, migració `006`):
  `POST /api/portal/invitations` (clau d'entorn `INVITE_API_KEY` al header `X-API-Key`) crea el partner
  en `pendente` amb perfil **sempre `afiliat`** i
  envia email amb enllaç `/registre?token=...` (7 dies, single-use); `GET/POST /api/portal/invitations/{token}`
  (públics) validen i completen l'alta (activa el partner, crea `partner_users` + `partner_members`, envia
  email de signatura de contracte i notificació in-app dirigida). L'ascens a `colaborador` és manual des de `/_/`.
- **Sync Odoo:** outbox (events) + crons `sync_odoo` (PRM→Odoo) i `odoo_two_way_sync`
  (Odoo→PRM: etapa, comissions, pèrdua, client). Idempotència per `odo_opportunity_id`.
  API **JSON-2** amb `Authorization: Bearer` + header `x-odoo-database`.
- **Contracte de col·laborador** (`pb_hooks/_contracts.pb.js`, migracions `007`–`010`): `partner_sync`
  assegura el `res.partner` d'Odoo per NIF (només desa l'id; activa `x_studio_colaborador`; si no
  existeix el crea); `contract_processor` genera el PDF amb **Carbone** (`CARBONE_API_*`) i crea a
  Odoo 19 `ir.attachment` (PDF via `raw`)→`sign.template`→`sign.document` (`attachment_id`)→`sign.item`
  (`document_id` + `responsible_id`)→`sign.request` (signant amb `partner_id` + `role_id`; Odoo Sign
  envia el correu);
  `contract_status_sync` llegeix l'estat (`state='signed'`) i baixa el PDF signat a `contract_file`
  (visible a "El meu perfil"). Paràmetres del contracte a `settings.sign_config` (JSON; el model de
  rols es descobreix sol). El correu de signatura **no** l'envia el PRM (només Odoo Sign).
- **Retirades (cartera)** — flux per factura + registre manual: el partner **no** pot sol·licitar
  retirada des del portal (`POST /api/portal/payouts` està desactivat → **410**). La cartera mostra la
  guia **«Com retirar els fons?»** (factura a `admin@polser.cat`, pagament entre 15 i 30 dies hàbils).
  L'admin registra el pagament a `/admin/payouts` («Registrar pagament» → `POST /api/admin/payouts`):
  crea `payouts` (`pagada`) + entrada `wallet_ledger` `payout_deduction` (−import) → **descompta el
  saldo**; i notifica el partner (push + in-app **i email**). La guia usa `settings.invoice_concept`,
  `settings.min_payout` i les dades fiscals de POLSER via `GET /api/portal/company`.
- **RBAC:** rols a `partner_users` (`partner`/`POLSER_cpso`/`POLSER_admin`/`POLSER_ceo`).
- El portal fa `fetch` cap a `import.meta.env.VITE_POCKETBASE_URL` (`portal/src/lib/api.ts`);
  **buit en producció** (crides relatives al mateix origen).

---

## 8. Estat actual i què ve ara

**Fet (v2):** infraestructura completa i operativa (deploy: `https://prm.polser.cat`). Portal React
compilat i verificat (`npm run build` exit 0); esquema, hooks i crons implementats (outbox/JSON-2 inclosos).

**Correccions aplicades (auditoria + proves en entorn real, 08/10/2026):**
- **Cadena de hooks trencada** (`e.next()` absent a `_business_rules.pb.js`, `_outbox.pb.js`,
  `_partner_provisioning.pb.js`, `_push.pb.js`): el segon handler registrat mai s'executava →
  l'`outbox` no es poblava i la sync amb Odoo era morta. **Arreglat.**
- **`e.requestInfo` mal usat** a `_business_rules.pb.js` (era `e.requestInfo.…` als events de request;
  cal `e.requestInfo().…`): bloquejava updates de ledger com a superuser i petava el hook RGPD.
  **Arreglat** (a `onRecordEnrich` sí que és propietat: `e.requestInfo.…`).
- **`$http.send().json` nul per a JSON escalar** (Odoo `create` → `id`): la sync mai llegia l'ID.
  **Arreglat** amb `JSON.parse(res.raw)` als `odooJson2` de `_crons.pb.js` i `_contracts.pb.js`.
- **`outbox` no reintentava files `error`:** el cron només mirava `pending`, així un error transitori
  quedava estancat. **Arreglat** (processa `pending || error`; `attempts`/`dead` ja existien).
- **Events/notificacions duplicats** en canviar d'etapa: el cron `odoo_two_way_sync` creava un
  `referral_event` extra (el hook ja el crea) i el hook `AfterUpdateSuccess` feia un segon
  `$app.save` (marcar `active_subscription`) que es re-disparava a si mateix. **Arreglat**
  (`active_subscription` es marca a `onRecordUpdate` pre-save; el cron ja no crea l'event).
- **`push_processor` no enviava mai cap push**: ordenava `notification_deliveries` per
  `-created_at`, un camp que **no existeix** en aquesta col·lecció (`id, notification, user,
  delivered_at, read_at, pushed_at`). `findRecordsByFilter` llançava, es capturava i `pending`
  quedava buit → els push d'esdeveniments i campanyes no s'enviaven (només el test `direct`, que
  publica al moment). **Arreglat** (s'ordena per `-delivered_at`). Verificat en local de punta a
  punta: event → `notification`+`delivery` → cron → ntfy → Web Push (aes128gcm + VAPID) desxifrat.
- **Índexs únics `partners.nif` i `partners.email`** xocaven amb strings buits (no es podien crear
  dos partners sense NIF/email). **Arreglat** amb migració `014` (índexs parcials `WHERE … != ''`).
- Migracions mortes eliminades: `002_remove_auth_otps.js` i `1788942106_updated_users.js`
  (aquest últim referenciaba `_pb_users_auth_`, inexistent, i podia trencar l'arrencada).
- `source='onboarding'` tret de la UI (el backend força `'portal'`; l'esquema no admet `onboarding`).
- Deriva de docs corregida (README: JSON-2 en lloc de JSON-RPC; port 10001/10002; `PLAN_MIGRACIONS`
  inexistent).

**Canvis recents (09/10/2026):**
- **Retirades (cartera) — flux per factura + registre manual:** el partner ja **no** sol·licita la
  retirada des del portal (`POST /api/portal/payouts` → **410**); veu una guia **«Com retirar els
  fons?»** (concepte de `settings.invoice_concept`, mínim `settings.min_payout` i dades fiscals de
  POLSER via `GET /api/portal/company`; pagament entre 15 i 30 dies hàbils). L'admin registra el
  pagament a `/admin/payouts` (`POST /api/admin/payouts`): crea `payouts` `pagada` + `wallet_ledger`
  `payout_deduction` (−) + notificació (push + email). `payout_processor` queda **llegat inert**.
- **Notificacions:** estat de «llegida» **al servidor** (`POST /api/portal/notifications/{id}/read`,
  `read-all`), agrupació per data i badge de no llegides; **regles automàtiques** (migració `017`,
  `/admin/automations`, cron `rule_processor`: `periodic` i `wallet_balance`).
- **Sessió:** JWT de `partner_users` a **30 dies** (migració `015`) amb **refresc silenciós**
  (`auth-refresh`) i reintent de 401 al portal.
- **Re-engagement** (migració `016`): `last_seen_at` via `POST /api/portal/ping`; cron
  `reengagement_reminder`; `settings.reengagement_days` **editable a `/admin/settings`**.
- **RGPD (decisió direcció):** el partner **propietari** veu les dades del client que ell mateix ha
  introduït; l'API de col·lecció les oculta a la resta (vegeu §5.5).
- **Detecció de leads perdudes — fix:** Odoo **arxiva** les leads perdudes (`active=false`) i l'ORM
  les **exclou** de `search`/`search_read` (`active_test=true`). El cron `odoo_two_way_sync` ara hi
  passa `context: { active_test: false }` (i `sync_odoo` al `search` d'idempotència). Verificat en
  local amb un mock que emula el filtre i **validat en producció (09/10/2026)**.
- **Robustesa portal:** fora els fallbacks «demo» (mostraven dades **falses** si l'API fallava) →
  estat d'error + reintent a Profile/Onboarding/Materials.
- **Referits (portal):** els `perdido` queden fora de la vista general (xip «Actius»); només surten
  amb el filtre «Perdut». Al detall, el pas **actual** del graf d'estat es pinta verd (fix `>=`).
- **Neteja / coherència:** fora `portal/wrangler.jsonc` + `wrangler` (restes Cloudflare Pages) i codi
  mort (`src/archive/ReferralNew.tsx`, etiqueta `onboarding`); fora les env mortes `PB_APP_URL`/
  `PB_SMTP_*` del compose (PB 0.40.3 les **ignora** → config per `PATCH /api/settings`); docs a
  **React 18**; doc ntfy renombrada `06→07`; `TASQUES_AGENT_POCKETBASE.md` marcat històric.

**Proves locals (entorn aïllat amb Docker, sense tocar producció):**
- El portal es pot compilar sense Node al host:
  `docker run --rm -v "$PWD/portal":/app -w /app node:20-alpine sh -c "npm ci && npm run build"`.
- Config de proves en un `.env` alternatiu (p. ex. `.env.demo`, gitignored) amb `OTP_DEV_REVEAL=true`
  i SMTP cap a un servidor de captura; arrencar amb `docker compose --env-file .env.demo up -d --build`
  (PB a `:10001`, ntfy a `:10002`).
- Superuser: `docker compose --env-file … exec pocketbase pocketbase superuser upsert EMAIL PASS`.
- Odoo es pot simular amb un **mock HTTP de l'API JSON-2** (`POST /json/2/<model>/<method>`), que
  retorni `[]` a `search`, un `id` a `create` i objectes a `search_read` (amb `id` inclòs), per validar
  `outbox → Odoo` i `odoo_two_way_sync` (etapa, comissions, pèrdua) de punta a punta. Per provar la
  **detecció de pèrdua**, el mock ha d'**emular `active_test`**: si la crida no porta
  `context.active_test=false`, ha de filtrar les leads `active=false` (com fa Odoo real).
- Migracions s'apliquen a l'arrencada; els hooks de `pb_hooks/` es recarreguen automàticament en canviar.

**Punts de revisió** (vegeu `docs/`):
- `docs/PENDENT_revisio_perdido.md` — detecció de leads perdudes: **RESOLT i validat en producció**
  (09/10/2026). Causa arrel: Odoo arxiva les leads perdudes i l'ORM les amagava → `active_test:false`.
- **Repo a PRIVAT:** a càrrec de direcció (fora de l'abast del codi).
- `docs/TASQUES_AGENT_POCKETBASE.md` és històric: la majoria d'issues ja estan resolts (vegeu taula
  d'estat). Es pot arxivar.

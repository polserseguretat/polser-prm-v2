# 01 · Arquitectura

## En una frase

Un **únic procés PocketBase 0.40.3** serveix la UI d'admin (`/_/`), l'API REST (`/api/*`),
l'API del portal de partners (`/api/portal/*`), el portal React compilat (`pb_public`) i,
a més, executa els **crons de negoci** interns. La sortida cap a **Odoo** passa per la taula
**`outbox`** (emissió per events, processament al cron `sync_odoo` per **JSON-2**).

## Diagrama d'alt nivell

```
Internet
   │  https://prm.polser.cat
   ▼
┌──────────────────────────── PocketBase :8090 (Docker) ────────────────────────────┐
│  · Admin UI   /_/                 (superuser POLSER)                                │
│  · API REST   /api/collections/*  (PocketBase natiu)                                │
│  · Portal API /api/portal/*       (hooks _portal.pb.js · aïllament per partner)     │
│  · Portal     /                   (React PWA a pb_public, muntat de portal/dist)    │
│  · Crons                          (_crons.pb.js)                                    │
│       sync_odoo          */3  → processa outbox pending → Odoo (JSON-2)             │
│       odoo_two_way_sync  */5  → Odoo → PRM (etapa + comissions)                     │
│       commission_monthly 0 3 1 → recurrent mensual                                  │
│       payout_processor   */10 → factura inversa + pagament                          │
│       notification_processor */5 → campanyes queued→sent                            │
│       cleanup            0 4 *0 → purga outbox antic                                 │
└───────────────┬────────────────────────────────────────────────────────────────────┘
                │  outbox (SQLite: pb_data/pb_data.db)
                ▼
        ┌─────────────── Odoo 19 (operacions internes + facturació) ───────────────┐
        │  Font de veritat de la comissió: el PRM la REFLECTEIX, mai la recalcula.  │
        └───────────────────────────────────────────────────────────────────────────┘
```

## Components

| Component | Tecnologia | On viu | Rol |
|---|---|---|---|
| Backend + API + admin | **PocketBase 0.40.3** (1 binari) | `Dockerfile` + `docker-compose.yml` | Dades (SQLite), auth OTP, API, crons, hooks |
| Base de dades | **SQLite** embegut | volum `pb_data:/pb/pb_data` | Persistència (fitxer `pb_data.db`) |
| Portal partner | **React 19 + TS + Vite → PWA** | `portal/` (serveix de `portal/dist`) | Mobile-first, bottom-nav (Inici / Referits / Cartera) |
| Regles de negoci | Hooks JS (goja JSVM) | `pb_hooks/` | Ledger immutable, recurrent única, regla CEO, RGPD, històric |
| Orquestració | Crons interns (cronAdd) | `pb_hooks/_crons.pb.js` | **Sense n8n**: tot el negoci viu als crons |
| Proxy/TLS | Docker + (exposa port) | compose | Publica `8090` al host (`PUBLIC_PORT`). TLS/DNS al CDN/reverse proxy del servidor |

> **Decisió clau:** el PRM és un monolít PocketBase. No hi ha n8n, ni Postgres, ni Directus,
> ni Cloudflare Pages (aquells eren el pla v1; v2 els elimina). La integració amb Odoo es fa
> **per API/events** (outbox), mai duplicant/sincronitzant BBDD.

## Mapa de responsabilitats dels fitxers

| Fitxer | Responsabilitat |
|---|---|
| `install.sh` | Desplegament idempotent (7 passos) |
| `Dockerfile` | Descàrrega binary PB 0.40.3 pinneat (Alpine 3.19, amd64) + estructura `/pb` |
| `docker-compose.yml` | Servei `pocketbase` + volum `pb_data` + mounts ro de migracions/hooks/portal + healthcheck |
| `pb_migrations/001_create_collections.js` | **P1** · Esquema (16 col·leccions) + seed de serveis/settings |
| `pb_migrations/002…005…1788…` | Migracions evolutives (presentació, OTP, euros, comissions de partner) |
| `pb_hooks/_settings.pb.js` | Auxiliar dev OTP (`OTP_DEV_REVEAL`) |
| `pb_hooks/_outbox.pb.js` | **P2** · Encua `create_opportunity` a l'alta d'un referit (mai crida Odoo) |
| `pb_hooks/_business_rules.pb.js` | **P3** · Ledger immutable, recurrent única, autònom→afiliat, històric d'estats, RGPD |
| `pb_hooks/_crons.pb.js` | **P5** · Crons + ÚNIC processador real d'outbox (Odoo JSON-2) |
| `pb_hooks/_portal.pb.js` | **P6** · API `/api/portal/*` (aïllament per partner, RGPD) |
| `portal/` | React PWA (Vite) |

## Regles d'enginyeria crítiques (apreses a la pràctica)

- **Autocontenció dels handlers (PB 0.40.3 JSVM).** El JSVM executa els callbacks dels hooks en
  un context aïllat on **no són visibles les funcions/consts/`globalThis` de nivell de fitxer**
  (`ReferenceError`). Cada `routerAdd`/`cronAdd`/hook ha de ser **totalment autocontingut**
  (lògica inline), usant només globals injectats (`$app`, `$os`, `$http`, `$security`,
  `$apis`, `Record`, `ForbiddenError`, …).
- **Moneda = EUROS amb 2 decimals** (`round2`), mai cèntims ni floats. La migració `004` ho va
  unificar; no tornar a *100/*100.
- **El `payload` de `outbox` és una string JSON** dins dels hooks (cal `JSON.parse`), no un
  objecte com a l'API REST.
- **`findRecordsByFilter` amb filtres de relació pot rebentar** al JSVM → es cerca sense el
  filtre de relació i es filtra per JS (ex. `recurring_unique`).
- Només el **primer `onRecordAfterUpdateSuccess`** per col·lecció s'executa → events i comissió
  d'alta van al mateix callback.
- Tipus de camp i config: usen les classes globals (`JSONField`, `NumberField`, `unmarshal`),
  no objectes plans (PB 0.40.3 els rebutja).

## Flux d'una alta de referit (extrem a extrem)

1. El partner crea un lead al portal (`POST /api/portal/referrals`, `_portal.pb.js`) →
   es crea el registre `referrals` amb `status=lead` i es genera `REF-XXXXXX`.
2. `onRecordAfterCreateSuccess('referrals')` (hook `_outbox.pb.js`) encua un registre
   `outbox { action: create_opportunity }`.
3. El cron `sync_odoo` (cada 3 min) el recull, busca la lead per `referral_code` i, si no
   existeix, **crea la `crm.lead` a Odoo** amb els camps de comissió i les dades del servei;
   grava `odo_opportunity_id`, `odo_customer_id` i `odoo_sync_status=ok`.
4. El cron `odoo_two_way_sync` (cada 5 min) llegeix l'etapa de la lead a Odoo, la propaga com a
   `referrals.status` (amb event a `referral_events`) i sincronitza les comissions
   (`partner_commission_*`).
5. Quan arriba a `instalado`, el hook ajuda a acreditar la **comissió d'alta** (`type=high`)
   a `wallet_ledger`. La **recurrent** la genera el cron `commission_monthly`.

## Decisions de plataforma (tancades)

- Self-hosted, mínim de serveis, res SaaS.
- 1 backend/1 BBDD; Odoo només per API/events.
- Portal català, mobile-first.
- PocketBase pinneat (BSL/MIT → versioning explícit al `Dockerfile`).
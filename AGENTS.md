# AGENTS.md — Guia per a l'agent de codi del PRM POLSER

Aquest fitxer dona context i **guardrails** a l'agent (o agents) de codi que construeix el
**PRM de POLSER SEGURETAT**. Llegeix-lo sencer abans de tocar res. No salteu les regles.

> **Font de veritat del producte:** [`PLAN_IMPLEMENTACIO_PRM_DIRECTUS.md`](PLAN_IMPLEMENTACIO_PRM_DIRECTUS.md)
> — models (§3), vistes (§5), lògica de comissions + sync Odoo (§6), roadmap (§8).
> Qualsevol implementació ha de respectar aquest document. Si una instrucció d'aquí el contradiu,
> **parla amb la direcció abans**, no decideixis tu.

---

## 1. Què és això

PRM (Partner Relationship Management) a mida per a **POLSER SEGURETAT, SL** (seguretat privada a
Catalunya). Gestió de la xarxa de *partners* (inmobiliàries, administradors de finques, operadors
de telecom, autònoms) que refereixen clients: registre de referits, seguiment del cicle de venda,
cartera de comissions i notificacions — accedible des del **mòbil** (PWA).

**Principis no negociables:**
- SELF-HOSTED, sense dependència SaaS ni lock-in.
- **1 backend / 1 BBDD** al PRM (PostgreSQL). La integració amb Odoo és **per API/events**, mai duplicant/sincronitzant BBDD.
- Mínim de serveis. Coses simples sobre coses complexes.
- La UI del portal és **en català** i **mobile-first**.

---

## 2. Stack i arquitectura

| Capa | Tecnologia | Notes |
|---|---|---|
| Data + API + admin | **Directus** 12.3.1 (BSL 1.1) sobre **PostgreSQL 16** | Les col·leccions = taules reals a Postgres. Panel admin (Directus Studio) per al backoffice POLSER. |
| Base de dades | PostgreSQL 16 (contenidor `db`) | BBDD del PRM dedicada. `schema/` = DDL canònic. |
| Portal partner | React 19 + TypeScript + Vite → **PWA** | Repositori `portal/`. Mobile-first, bottom-nav 3 pestanyes. |
| Lògica de negoci | Flows + extensions Directus (JS/TS) + **n8n** (orquestració) | n8n i Odoo són externs (fora d'aquest repo) i s'integren per API. |
| Infra | Docker Compose + **Cloudflare Tunnel** (API) + **Cloudflare Pages** (portal) | `docker-compose.yml`. TLS i DNS a Cloudflare; Directus a l'arrel d'`api.partners.polser.cat`. |

Flux alt nivell:
```
Internet ─ Cloudflare ─┬─ partners.polser.cat ─► Cloudflare Pages ─► portal React PWA ─► (fetch cross-origin) ─► Directus (API) ─► PostgreSQL
                       └─ api.partners.polser.cat ─► Cloudflare Tunnel ─► Directus
                       └─ n8n (integracions) ──► Odoo 19 (ops internes + facturació)
```

---

## 3. Estructura del repo

```
polser-prm/
├── AGENTS.md                       # aquest fitxer
├── README.md                       # quickstart + decisions
├── PLAN_IMPLEMENTACIO_PRM_DIRECTUS.md   # EL producte. Sempre obert.
├── docker-compose.yml              # db + directus + cloudflared (túnel)
├── .env.example                    # copia → .env (MAI commitgis .env)
├── schema/
│   ├── 01__schema.sql              # DDL del model (15 taules + enums + índexs)
│   └── 02__seed.sql                # catàleg de serveis (KB) + settings
└── portal/                         # React PWA (Vite + TS)
```

---

## 4. Model de dades — les taules que NO pots trencar

Les taules viuen a `schema/01__schema.sql`. Són la font de veritat del model; Directus les
descobreix com a col·leccions. Resum crític:

- `services` — catàleg (alta_fee, monthly_fee). La **cuota mensual és la base** de la comissió recurrent.
- `partners` + `partner_members` — el partner/organització i les seves comptes d'usuari del portal.
  Els rols del portal depenen de `partner_members.partner`.
- `referrals` — el referit / la venta. **`odo_opportunity_id` = ancla amb Odoo (crm.lead).** Camp `status` = cicle.
- `referral_events` — històric de transicions (auditoria). Sempre s'escriu en canviar d'estat.
- `commission_rules` — regles de comissió. **Espejo de la intenció; el valor final el dicten Odoo.**
- `wallet_ledger` — cartera. **APPEND-ONLY / immutable.** Les correccions = entrades `reversal`, MAI UPDATE.
- `payouts` — retirades / factura inversa (mínim 100 €, pagament en 15 dies hàbils).
- `notifications` + `notification_deliveries` — campanyes on-demand (in-app + push PWA).
- `odoo_sync_log` — auditoria de sincronització amb Odoo.
- `settings` — globals (min_payout, default commission, invoice_concept, etc.).
- `auth_otps` — codis OTP del login sense contrasenya (guardem el HASH).

Canvis de model → editar `schema/` com a **migracions** (afegir fitxers numerats o ALTER),
no només a l'UI de Directus, perquè quedi versionat.

---

## 5. Lògica de negoci NO negociable (ordres de direcció)

1. **La comissió la dicta Odoo.** En Odoo hi ha un camp que defineix quina comissió es cobra per
   cada venda/oportunitat. El PRM la **llegeix de Odoo** (via n8n) per reflectir-la a la cartera.
   El PRM **no decideix ni recalcula** la comissió pel seu compte. `commission_rules` és espejo, no criteri.
2. **Regla CEO autònoms (08/09/2026):** un autònom (persona física) és **SEMPRE perfil Afiliat** i rep
   **només 60 € per alta**. **MAI** se li ofereix ni apareix el 10 % recurrent. Aplicar-ho en
   **3 capes**: `allow_recurring=false` a la regla, validació a l'API/hook, i la UI no mostra l'opció.
   Afegeix un test que ho garanteixi.
3. **Ledger immutable.** Cap UPDATE sobre `wallet_ledger`. Correcció = entrada `reversal` autoritzada.
4. **Escril la recurrent un sol cop per període** (UNIQUE `partner+referral+period` a `type=recurring`).
5. **RGPD:** el portal del partner **no exposa mai** dades personals dels clients referits
   (només `status` + data). La minimització és obligatòria.
6. **Referits = oportunitat Odoo (`crm.lead`).** Tot referit s'ancla a una oportunitat del CRM de
   Odoo; presupost, subscripció i factures pengen d'allà. Sync **idempotent** per `odo_opportunity_id`.

---

## 6. Regles d'enginyeria

- **Català a la UI**, colors de marca POLSER: primary `#042149`, accent `#FF6B00`, fons `#F6F5F4`,
  text `#1F2937`, gris `#6B7280`. Troba-ho a `portal/src/styles.css`.
- **Portal mobile-first:** bottom-nav fixa amb 3 pestanyes (Inici / Els meus referits / Cartera);
  a ≥768px la mateixa estructura en sidebar/barra superior. No canviïs el model de navegació.
- **TypeScript** estricte, dependències **mínimes**. MAI floats per a diners (usa `numeric`/centaus).
- `npm run build` ha de passar sempre (portal). Vite `base:'./'`, PWA (manifest + `sw.js`).
- **Mai** commits `.env`, `node_modules/`, `dist/`, `pgdata/`, `.tsbuildinfo`.
- Revisa la **llicència** de qualsevol dependència nova (preferible MIT/Apache). 
  ⚠️ `react-kanban-kit` està descartat (llicència NOASSERTION). Directus: **pinnear la versió** (BSL/change date).
- No inventis preus/comissions que no constin a la KB (`/home/ai/.hermes/knowledge/` externa al repo).
  El catàleg està al `schema/02__seed.sql`.

---

## 7. Backend i integracions (apunts per a l'agent)

- **Auth partners:** login sense contrasenya **email OTP** (§6.6 del plan). Endpoints
  `POST /auth-otp/request-otp` i `POST /auth-otp/verify-otp` (extensió `extensions/auth-otp`;
  Directus prefixa els endpoints pel nom de l'extensió). Codi únic amb TTL curt, guardat com a HASH a
  `auth_otps`; s'emet un JWT de Directus. Rols POLSER interns: contrasenya + 2FA.
- **RBAC (§4):** seed idempotent a `extensions/rbac` (rols `partner`/`POLSER_cpso`/`POLSER_admin`/`POLSER_ceo`
  + policies + permisos a l'arrencada). ⚠️ Directus 12 lliure té les **custom permission rules**
  (filtres/camps/presets) gated per llicència → només es creen permisos senzills. Per això l'aïllament
  per partner i l'ocultació de dades personals viuen a l'extensió **`/portal/*`** (`extensions/portal`),
  que escopeix per `directus_users.partner` (migració 04 + hook `extensions/partners`).
- **Notificacions on-demand (§6.4.1):** col·lecció `notifications`; in-app via Directus Realtime +
  push PWA via Web Push (VAPID), l'enviament el fa n8n.
- **Sync Odoo (§6.3):** intercanvi de dades per events, orquestrat amb n8n; idempotència per `odo_opportunity_id`;
  registre a `odoo_sync_log` i re-emissió d'operacions fallides.
- **Motor d'automatitzacions (decisió 09/09/2026):** la lògica de negoci s'orquestra amb **n8n**, no amb
  Directus Flows (llicència free limitada). El disparador d'events el gestiona el mateix n8n: el nodo
  **Postgres Trigger** (mode *Table Row Change Events*) crea el seu propi trigger sobre `referrals`
  (AFTER INSERT → `pg_notify`) en activar el workflow i l'elimina en desactivar-lo (migració 07 només
  prepara la BD: enum `create_opportunity` + `CREATE` al schema per a l'usuari `polserprm` — el mateix
  que Directus, que ja té `TRIGGER`/`SELECT` per la migració 05). El payload del NOTIFY és la fila
  completa (`row_to_json`), assumit via canal intern de Postgres. Les **ESCRIPTURES** de negoci es fan
  sempre per la API de Directus amb el token tècnic (rol `POLSER_admin`); n8n només escriu a la BD per
  gestionar el seu trigger.
- **RBAC (§4):** rols Directus `partner` / `POLSER_cpso` / `POLSER_admin` / `POLSER_ceo`.
  `POLSER_ceo` és l'ÚNIC que pot escriure `commission_rules` / comissions especials.
- El portal fa `fetch` cap a `import.meta.env.VITE_DIRECTUS_URL` (`portal/src/lib/api.ts`).

---

## 8. Estat actual i què ve ara

**Fet (F1–F4):**
- Infra base (compose: postgres + Directus 12.3.1 + Cloudflare Tunnel), `.env.example`.
- Publicació: portal React PWA a **Cloudflare** (static assets worker `polser-prm`,
  `portal/dist`; SPA fallback via `not_found_handling: single-page-application` a `wrangler.jsonc`)
  i API Directus a l'arrel d'`api.partners.polser.cat` per **Cloudflare Tunnel** (`cloudflared`).
- Esquema SQL complet (§3) + seed de serveis. Migracions: `03` (auth_otps.created_at), `04`
  (directus_users.partner).
- **F2 — RBAC:** hook `extensions/rbac` (rols/policies/permisos idempotent a l'arrencada).
- **F3 — Auth OTP:** extensió `extensions/auth-otp` + guard de sessió al router del portal.
- **F4 — Portal lligat a l'API real** (`/portal/*`): extensió `extensions/portal` amb aïllament
  per partner server-side (`directus_users.partner` via hook `extensions/partners` + migració 04).
  Portal React compilat i verificat.

**Pendents (per ordre del plan §8):**
- F5: motor de comissions (Flows/extensió) + sync Odoo amb n8n.
- F6: KPIs, 2FA/robustesa, push PWA.
- Pendents d'operació: aplicar `schema/03__…` i `schema/04__…`, crear un partner de prova
  (partners actiu + usuari `partner` + `partner_members`) i `OTP_DEV_REVEAL=true` per provar sense SMTP.

**Primera tasca natural per a l'agent de codi:** arrencar `docker compose up`, aplicar `schema/`
i re-escriure `portal/src/lib/api.ts` per apuntar a Directus real, i enganxar el guard d'auth al router.
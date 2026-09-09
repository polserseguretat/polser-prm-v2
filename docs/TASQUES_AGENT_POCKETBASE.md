# Tasques per a l'agent de codi — PRM POLSER v2 (PocketBase)

> **Data:** 15/09/2026 · **Autor:** Pol (CoS) · **Repo:** `polser-prm-v2`
> Llegeix aquest document sencer abans de tocar res. És la llista d'issues detectats en
> l'auditoria de la migració Directus → PocketBase, prioritzats, amb acció concreta i
> criteri de verificació per a cada un.
>
> Fonts de referència: `PLAN_MIGRACIONS_POCKETBASE.md` (al directori de plans de Pol) i
> aquest mateix repo (esquema a `pb_migrations/`, hooks a `pb_hooks/`).

---

## Context: què és això

PRM (Partner Relationship Management) de **POLSER SEGURETAT, SL**. Portal de partners i gestió
de referits/comissions, **extern a Odoo** (Odoo és la font de veritat de la comissió; el PRM la
reflecteix). **Objectiu d'arquitectura:** 1 binari PocketBase + hooks JS + cron, **sense n8n**,
sense Postgres, sense Cloudflare Pages. Esquema a `pb_migrations/001_create_collections.js`
(16 col·leccions), hooks a `pb_hooks/`.

**Principis NO negociables (decisions de direcció):**
- La comissió la **dicta Odoo**; el PRM la llegeix via outbox→Odoo, mai la recalcula pel compte propi.
- **CEO (08/09/2026):** un autònom (persona física) és **SEMPRE perfil Afiliat** → només **60 €/alta**,
  **MAI el 10 % recurrent**. 3 capes (esquema/hook/UI).
- Diners **sempre en centims** (enters), mai flots.
- UI del portal en **català**, mobile-first, bottom-nav 3 pestanyes (Inici / Els meus referits / Cartera).

---

## ORDRE D'EXECUCIÓ (seguir aquesta seqüència)

1. 🔴 CRÍTIC-1 — Sync Odoo no operativa (el cor del valor)
2. 🟠 ALT-1 — Regla CEO autònom→afiliat INCOMPLETA (ordre de direcció, no negociable)
3. 🟠 ALT-2 — `ODOO_APIKEY` truncada al compose
4. 🟡 MIG-1 — `stage_date` mismatch de tipus
5. 🟡 MIG-2 — `$app.findAllRecords` pot no existir a PB 0.40.3
6. 🟡 MIG-3 — Helpers outbox duplicats entre fitxers
7. 🟡 MIG-4 — README i estructura arrosseguen el v1 Directus
8. 🟡 OPS-1 — Superuser d'inici que no mostra el flow de creació

---

## 🔴 CRÍTIC-1 — La sync amb Odoo és NO operativa (stub al cron)

**Fitxers:** `pb_hooks/_outbox.pb.js` i `pb_hooks/_crons.pb.js`

**Problema:** hi ha **dues funcions `processOutboxPending`** (cada `.pb.js` té scope propi):
- `_outbox.pb.js` conté la **lògica real** (`odooRpc`, `processCreateOpportunity`, `processPayout`),
  però **no registra cap `cronAdd('sync_odoo', ...)`**.
- `_crons.pb.js` registra el cron `sync_odoo`, però crida la **seva pròpia `processOutboxPending`
  stub** que fa:
  ```js
  // TODO: processar cada acció segons el type
  // Per ara marca ok per evitar reintents infinits
  rec.set('status', 'ok')
  ```
  → marca `ok` **sense cridar mai Odoo**.

**Acció:**
1. Fusionar la lògica real de `_outbox.pb.js` en la `processOutboxPending` que executa el cron
   (o registrar el `cronAdd('sync_odoo')` dins de `_outbox.pb.js`).
2. **Esborrar el stub** de `_crons.pb.js`.
3. El cron ha de cridar `processCreateOpportunity` / `processPayout` de debò.

**Criteri de verificació (exit-criterion #4):** 1 referit creat al portal genera 1 fila outbox
pending; el cron la resol contra l'stub d'Odoo i la deixa en `ok` **després de fer la crida real**
(stub/mock d'Odoo en staging). Verificar log `[outbox] ok` amb `action=create_opportunity`.

---

## 🟠 ALT-1 — Regla CEO autònom→afiliat INCOMPLETA (forat a `partners`)

**Fitxer:** `pb_hooks/_business_rules.pb.js` (`forceAfiliatNoRecurring`) + `001_create_collections.js`

**Problema:** el hook força `allow_recurring=false` quan una **commission_rule** té
`profile=afiliat`. Però **no garanteix que un partner `type=autonomo` neixi amb `profile=afiliat`**
a la col·lecció `partners`. Sense això, un autònom pot quedar com `colaborador` i cobrar el 10 %
recurrent — **viola l'ordre directa de direcció**.

**Acció:**
1. Afegir hook `onRecordBeforeCreateRequest`/`onRecordBeforeUpdateRequest` a `partners`:
   si `type === 'autonomo'` → forçar `profile = 'afiliat'`.
2. Garantir les 3 capes: esquema (default), hook (força), UI (no mostra recurrent a autònoms).

**Criteri:** crear/actualitzar un partner `type=autonomo` amb body `profile=colaborador` → queda
forçat a `afiliat`. Test unit via API.

---

## 🟠 ALT-2 — `ODOO_APIKEY` truncada al docker-compose

**Fitxer:** `docker-compose.yml` (línia ~31)

**Problema:**
```yaml
ODOO_APIKEY: "${ODO...:-}"
```
Variable **tallada a mig camí** (`ODO...`), no resol res a runtime. L'autenticació JSON-RPC a
`_outbox.pb.js` (`$os.getenv('ODOO_APIKEY')`) rebria buit.

**Acció:** corregir a `ODOO_APIKEY: "${ODOO_APIKEY:-}"` i afegir-la a `.env.example` (ja hi és,
verificar que el nom coincideixi).

**Criteri:** `docker compose config` resol `ODOO_APIKEY` sense truncar; `$os.getenv('ODOO_APIKEY')`
retorna el valor d'entorn.

---

## 🟡 MIG-1 — `stage_date` mismatch de tipus

**Fitxers:** `001_create_collections.js` (camp `stage_date` tipus `date`) i `_portal.pb.js`
(`rec.set('stage_date', new Date().toISOString())`)

**Problema:** el camp és `date` (PB espera `YYYY-MM-DD`), però el portal assigna
`toISOString()` (amb hora `T...Z`). Pot llançar error o guardar format inconsistent.

**Acció:** a `_portal.pb.js`, assignar `new Date().toISOString().slice(0, 10)`.

**Criteri:** crear referit via `POST /api/portal/referrals` → `stage_date` guardat com `YYYY-MM-DD`.

---

## 🟡 MIG-2 — `$app.findAllRecords` pot no existir a PB 0.40.3

**Fitxer:** `pb_hooks/_crons.pb.js` (`runNotificationProcessor`)

**Problema:** usa `$app.findAllRecords('partner_users')`. Confirmar que el mètode existeix a la
versió pinneada (0.40.3). En moltes versions de PB no hi ha `findAllRecords`; el patró robust és
`$app.findRecordsByFilter('partner_users', 'id != ""', '-created', limit, 0)` (a
`commission_monthly` ja s'usa el patró correcte; a `notification_processor` no).

**Acció:** substituir per `findRecordsByFilter` si cal; confirmar contra els tipus de `types.d.ts`.

**Criteri:** el cron `notification_processor` no llança error en arrencada/execució.

---

## 🟡 MIG-3 — Helpers outbox duplicats entre `_crons.pb.js` i `_outbox.pb.js`

**Problema:** cada fitxer redefineix `enqueueOutbox`, `processOutboxPending`, etc. (inlined per
scope propi). Això **només és acceptable si no divergeixen**. Ara divergeixen (CRÍTIC-1). Mantenir
**un sol origen de la lògica d'outbox**.

**Acció:** després de resoldre CRÍTIC-1, decidir quin fitxer és el propietari de la lògica outbox i
deixar-hi tot; esborrar les còpies mortes.

**Criteri:** un únic `processOutboxPending` amb la lògica real a tot el repo.

---

## 🟡 MIG-4 — README i estructura arrosseguen tot el v1 Directus

**Fitxers:** `README.md`, `schema/*.sql` (01..07), `extensions/*` (auth-otp, partners, portal, rbac)

**Problema:** el README encara documenta Directus/Postgres/Cloudflare Pages/n8n, i el repo encara
conté artefactes del v1. Confús per a l'agent següent i per al hard cut ("zero Directus").

**Acció:** actualitzar `README.md` a l'stack PocketBase (1 binari, hooks, cron, cap n8n). Decidir
**esborrar** `schema/*.sql` i `extensions/*` del repo (ja viuen a l'historial de v1) per netejar el
tret i evitar tornar a Directus per error.

**Criteri:** `README.md` reflecteix l'arquitectura actual; el repo no conté artefactes Directus.

---

## 🟡 OPS-1 — Superuser d'inici: salta el flow de creació i va directe a login

**Símptoma:** en arrencar, a `/_/` surt directament el login en lloc del formulari de creació del
primer superuser.

**Diagnòstic (verificat):** **cap codi, migració ni script del repo crea cap superuser.** Ni
`.env.example` té `PB_SUPERUSER_*`. El grep sencer només troba mencions de superuser en docs antics
de Directus i el `hasSuperuserAuth()` al hook (que només *llegeix*, no crea).

El problema és **estat del volum `pb_data`**: PocketBase només mostra el flow de creació del primer
superuser quan la col·lecció interna `_superusers` és **buida**. Si salta al login, el volum
`pb_data:/pb/pb_data` (volum nombrat i persistent al compose) **ja conté com a mínim un superuser**
d'una execució anterior — i el setup ja no tornarà a sortir.

**Acció (triar 1):**
- **Opció A (no perd dades, recomanada):** crear el superuser via CLI:
  ```bash
  docker compose exec pocketbase pocketbase superuser upsert EMAIL PASS_SUPER_SEGUR
  ```
- **Opció B (tornar a zero):**
  ```bash
  docker compose down -v     # -v elimina el volum pb_data
  docker compose up -d       # ara sí que surt el flow a /_/
  ```

**Nota extra detectada:** la migració `002_remove_auth_otps.js` intenta esborrar `auth_otps`, que
`001` no crea (l'OTP el gestiona el tipus `auth` de `partner_users`). És una migració morta (va en
`try/catch`, no trenca) amb un caràcter estrany al comentari (`primer起fresh`). Es pot eliminar.

---

## Entorn de treball de l'agent de codi (OpenCode)

- **Instal·lació:** `npm i -g opencode-ai@latest` (o `brew install anomalyco/tap/opencode`).
- **Auth:** `opencode auth login` o variables de provider (`OPENROUTER_API_KEY`, etc.).
  Verificar amb `opencode auth list`.
- **Stat de la màquina (15/09/2026):** OpenCode **NO està instal·lat** al host de Pol
  (`opencode: command not found`). Primer pas del teu setup: instal·lar-lo.
- Repo de treball: `polser-prm-v2`, branca `main`, identitat git ja configurada
  (`253367905+polserseguretat@`). Clon: a `/tmp/polser-prm-v2` (per a l'agent; re-clonar en un
  directori de treball net si es vol isolació).
- **Regla:** no s'executen preus/comissions que no constin a la KB. Diners en cèntims. UI català.

---
*Generat: 15/09/2026 · Pol (CoS) · Document de treball per a l'agent de codi del PRM POLSER v2.*
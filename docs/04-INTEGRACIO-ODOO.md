# 04 · Integració amb Odoo

El PRM és **extern a Odoo**: Odoo és la **font de veritat** de la comissió i el PRM la
**reflecteix**. El PRM només encua intencions (outbox) i llegeix resultats; mai calcula la
comissió "pel seu compte" com a verdader — excepte fallbacks explícits (quota × rate) quan Odoo
encara no ha retornat un valor.

## API utilitzada: JSON-2 (Odoo 19+)

- Endpoint: `POST {ODOO_URL}/json/2/{model}/{method}` (ex. `crm.lead/create`).
- Auth: `Authorization: Bearer {ODOO_APIKEY}` + header `x-odoo-database: {ODOO_DB}`.
- Arguments **nomenats** (no posicionals): `{ vals_list: [...] }`, `{ domain: [...], fields: [...] }`.
- NO usen el JSON-RPC deprecat (`authenticate`/`execute_kw`).
- El motivació del fitxer: els valors numèrics (team/stage/recurring) s'han de passar com a
  **enters** (`Number($os.getenv(...))`), no strings.

## Outbox: cua d'events (patró d'emissió)

- **Emissor** (`_outbox.pb.js`): `onRecordAfterCreateSuccess('referrals')` encua
  `{ entity: 'referral', action: 'create_opportunity', payload: { referral_id } }` a `outbox`.
  **Mai crida Odoo dins del request.**
- **Processador** (`_crons.pb.js`, cron `sync_odoo`): l'únic propietari de la lògica outbox.
- Estats outbox: `pending` → `ok` / `error` → `dead` (als 5 intents). `attempts` incrementa.
- El `payload` dins del hook és una **string JSON**: cal `JSON.parse` explícit.
- El camp `entity_id` és la font fiable de l'ID del referit (fallback a `payload.referral_id`).

## Crons (mapa complet)

| Cron | Expressió | Descripció |
|---|---|---|
| `sync_odoo` | `*/3 * * * *` | Processa outbox `pending` (màx 50, 30 s timeout per crida) → Odoo. `create_opportunity` i `create_vendor_bill`. MAX_ATTEMPTS=5 |
| `odoo_two_way_sync` | `*/5 * * * *` | Odoo → PRM: etapa (stage_id→status) + comissions (`x_studio_*`→`partner_commission_*`) + pèrdua + client. Una sola `search_read` |
| `commission_monthly` | `0 3 1 * *` | Genera la comissió recurrent del mes (període YYYY-MM) per a referits `instalado` no afiliats |
| `payout_processor` | `*/10 * * * *` | `solicitada`+factura rebuda → `en_proces` + encua `create_vendor_bill`; `en_proces`+termini (`payout_days`=15) → `pagada` |
| `notification_processor` | `*/5 * * * *` | Campanyes `queued` → `sent` (in-app), crea `notification_deliveries` per audiència (`all`/`afiliats`/`colaboradors`) |
| `cleanup` | `0 4 * * 0` | Elimina outbox no-pending amb >30 dies |

## `create_opportunity` (referit → `crm.lead`)

1. Cerca la lead per `referral_code` (`name =like "REF-XXXXXX%"`); si existeix → utilitza-la
   (idempotent per `odo_opportunity_id`).
2. Si no: crea amb `vals_list`:
   - `name`: `${referral_code} · ${client_name}`
   - `email_from` / `phone` / `contact_name`: dades del client (pròpies del partner)
   - `referred`: nom del partner que ha referit
   - `expected_revenue`: alta del servei (euros)
   - `recurring_plan`: `1` (mensualment), `recurring_revenue`: quota mensual del servei
   - `stage_id`: `ODOO_STAGE_ID` (13 · "Nou referit"), `team_id`: `ODOO_TEAM_ID` (9 · "PRM")
   - **Comissions del partner** (camps `x_studio_*` de `crm.lead`):
     - `x_studio_colab_comision_de_alta`: comissió fixa d'alta, **60 €** (tots els perfils)
     - `x_studio_colab_comision_recurrente`: ~10 % de la quota, **SOLS perfil Col·laborador**;
       **0 per afiliat** (regla CEO 08/09/2026)
   - `description`: details del servei (category, sector, alta, quota, IVA) + notes
3. Grava `odo_opportunity_id` (enter validat), llegeix `partner_id` → `odo_customer_id`,
   `odoo_sync_status=ok`.

## `odoo_two_way_sync` (Odoo → PRM)

- Selecta referits `odo_opportunity_id != 0 && status != 'instalado'`, agrupa els IDs i fa una
  **única** `search_read` (`fields: stage_id, partner_id, x_studio_*, won_status, lost_reason_id`).
- Mapeig `stage_id` → `referrals.status`:

| stage_id (Odoo) | Etapa | status (PRM) |
|---|---|---|
| 13 | Nou referit | `lead` |
| 9 | Contactat | `contactado` |
| 10 | Pressupost | `presupuesto` |
| 11 | Acceptat | `aceptado` |
| 12 | Instal·lat/Actiu | `instalado` |

- **Pèrdua mana sobre l'etapa:** si `won_status='lost'` o hi ha `lost_reason_id` → status
  `perdido` i registra el motiu a `notes` ("Perdut (Odoo): …").
- Sincronitza **comissions** (`x_studio_*` → `partner_commission_alta/recurrente`) **independentment**
  del canvi d'estat. Si el perfil del partner és `afiliat` ⇒ recurrent forçada a `0,00` (regla CEO),
  vingui el que vingui d'Odoo. Robust: si els camps no existeixen (migració 005 pendent), s'omet i
  **mai aborta el cron**.
- Actualitza `odo_customer_id` si la lead té client i el referit no (els clients es creen durant el funnel).
- Cada canvi d'estat genera un `referral_event` (from→to).

## `commission_monthly` (recurrent)

- Activa només si `settings.recurring_enabled`.
- Període = mes actual (`YYYY-MM`). Processa **TOTS** els referits `status=instalado` (pagina amb
  lots de 500).
- **Exclou** afiliats (regla CEO). Si la regla té `allow_recurring=false` → exclou.
- Import: la comissió recurrent **assignada per referit** (`partner_commission_recurrente` de
  Odoo = font de veritat); si no hi ha, fallback `monthly_fee × rate`. **Mai usa `estimated_value`**
  (és l'alta, no la mensual). Si no hi ha import fiable → no inventa.
- Escriu a `wallet_ledger` `type=recurring` (l'hook `recurring_unique` bloca duplicats
  partner+referral+period).

## Comissions (model)

- **Alta (high):** 60 € per instal·lació, per a TOTS els perfils. S'acredita quan un referit passa
  a `instalado` (idempotent, dins el mateix hook d'update de `referrals`).
- **Recurrent:** ~10 % de la quota mensual (`default_recurring_rate`), **només per Col·laboradors**
  (PIME/empreses). Els **Afiliats/autònoms mai** (ordre CEO 08/09/2026, 3 capes: esquema, hook, UI).

## Idempotència i errors

- `odo_opportunity_id` és l'ancora de la sync (idempotent).
- Si Odoo falla (`res.statusCode >= 300`), es marquen `attempts++`, `last_error`, i amb ≥5
  intents → `dead` (dead-letter; revisar logs per re-emetre).
- `payout_processor` encua `create_vendor_bill` → `account.move` (`in_invoice`) amb
  `price_unit = payouts.amount` (euros) i `invoice_date = avui`.
- Els crons van embolicats en `try/catch` i registren a `$app.logger()` (marcs `[cron:*]`, `[outbox]`).
# 02 · Model de dades

Mètrica canònica dels diners: **EUROS amb 2 decimals** (unificació a la migració `004`).
Cap camp es guarda en cèntims. Els enums s'implementen com a `select`.

## Col·leccions de negoci (16)

| Col·lecció | Tipus | Descripció | Camps clau / índexs |
|---|---|---|---|
| `services` | base | Catàleg de serveis | `code`(UNIQUE), `name`, `category`(alarma/videovigilancia/manteniment), `sector`(residencial/negocio/comunidades/industria), `alta_fee`, `monthly_fee`, `iva_included`, `details`(json), `presentation`(json), `active` |
| `partners` | base | Organitzacions/partners | `name`, `profile`(afiliat/colaborador), `type`(inmobiliaria/administrador_fincas/operador_telecom/autonomo/otro), `nif`(UNIQUE), `email`(UNIQUE), `phone`, `address`, `status`(pendente/actiu/inactiu/bloquejat), `activation_date`, `contract_file`, `notes` |
| `partner_users` | **auth** | Comptes del portal (login OTP) | `role`(partner/POLSER_cpso/POLSER_admin/POLSER_ceo), `partner`(rel), `name`. `passwordAuth=off`, `otp{enabled,length:6,duration:180}`, `authRule=""` |
| `partner_members` | base | Vincle partner↔user | `partner`, `user`, `role_in_partner`(owner/editor/viewer); UNIQUE(partner,user) |
| `referrals` | base | La venta / el referit | `partner`, `referral_code`, `client_*`(**hidden** RGPD), `service`, `service_type`, `status`, `stage_date`, `estimated_value`, `final_value`, `active_subscription`, `odo_opportunity_id`, `odo_customer_id`, `odo_sale_id`, `odoo_sync_status`, `source`, `self_referral`, `notes`, `partner_commission_alta`, `partner_commission_recurrente`; list/view/create escopejats al partner propietari |
| `referral_events` | base | Històric d'estats (append-only) | `referral`, `from_status`, `to_status`, `reason`, `lost_reason` |
| `commission_rules` | base | Regles (espejo, no criteri) | `name`, `profile`(afiliat/colaborador/all), `kind`(high/recurring/adjustment/reversal), `service`, `fixed_amount`, `rate`, `base`, `allow_recurring`, `partner_override`, `active`, `valid_from`, `valid_to` |
| `wallet_ledger` | base | Cartera (**immutable**) | `partner`, `referral`, `type`(high/recurring/adjustment/payout_deduction/reversal), `amount`(signat, EUR), `period`(YYYY-MM), `status`(accrued/poised/paid/reversed/void), `description` |
| `payouts` | base | Retirades / factura inversa | `partner`, `amount`, `invoice_reference`, `invoice_received_at`, `status`(solicitada/factura_rebuda/en_proces/pagada), `paid_at`, `odo_vendor_bill_id` |
| `interactions` | base | Log CPSO | `partner`, `referral`, `channel`, `direction`(inbound/outbound), `type`, `summary`, `outcome` |
| `documents` | base | Materials/push | `title`, `type`, `category`, `file`, `version`, `published` |
| `notifications` | base | Campanyes on-demand | `title`, `body`, `image`, `audience`(all/afiliats/colaboradors), `channel`(inapp/push/both), `scheduled_at`, `sent_at`, `status`(draft/queued/sent/failed) |
| `notification_deliveries` | base | Entregues | `notification`, `user`, `delivered_at`, `read_at`; UNIQUE(notification,user) |
| `odoo_sync_log` | base | Auditòria (legacy) | `entity`, `entity_id`, `action`, `odoo_operation`, `status`, `error`, `attempts`. **Operativa real = taula `outbox`** |
| `settings` | base | Globals (fila única) | `min_payout`(100), `payout_days`(15), `default_fixed_commission`(60), `default_recurring_rate`(0.10), `recurring_enabled`, `invoice_concept`, `sla_days_no_contact`(7) |
| `outbox` | base | Cua d'events → Odoo | `entity`, `entity_id`, `action`(create_opportunity/create_vendor_bill/…), `payload`(json), `status`(pending/ok/error/dead), `attempts`, `last_error` |

> **Col·leccions internes de PocketBase:** `_superusers` (admin), `_otps` (codis OTP),
> `users` (col·lecció auth per defecte — **no s'usa**; la migració `1788942106` li activa només
> OTP 6 dígits de manera inofensiva, però res del PRM la toca).

## Estats de negoci

- `referrals.status`: `lead` → `contactado` → `presupuesto` → `aceptado` → `instalado`, o `perdido`.
- `wallet_ledger.type`: `high` (comissió d'alta), `recurring`, `adjustment`, `payout_deduction`, `reversal`.
- `wallet_ledger.status`: `accrued`, `poised`, `paid`, `reversed`, `void`.
- `payouts.status`: `solicitada` → (`factura_rebuda`) → `en_proces` → `pagada`.

## Diners de referència (seed, en euros)

| Servei | Alta | Quota/mes | IVA | Sector |
|---|---|---|---|---|
| `pis` Per pisos | 599,00 | 27,99 | inclòs | residencial |
| `casa` Per cases | 749,00 | 29,99 | inclòs | residencial |
| `oficina` Per oficines | 549,00 | 27,99 | no | negocio |
| `botiga` Per botigues | 699,00 | 34,99 | no | negocio |
| `amida` A mida (residencial) | pressupost | pressupost | — | residencial |
| `amida-neg` A mida (negoci) | pressupost | pressupost | — | negocio |

> Semàntica d'import al portal: `0` = gratuït, `-1` = pressupost a mida, `>0` = preu fix, `null` = pressupost.
> Font de veritat dels preus: KB compartida `~/.hermes/knowledge/` (el seed només és l'snapshot de desplegament).

## Regles d'integritat (hooks)

- **`wallet_ledger` immutable:** cap UPDATE/DELETE extern (hook llança `ForbiddenError`); només
  `onRecordEnrich`/superusers. Correcció = entrada `reversal`.
- **Recurrent única:** UNIQUE lògic (partner+referral+period en `type=recurring`), defensat al hook
  (`onRecordCreate`) contra duplicats.
- **Autònom→afiliat (regla CEO):** `partners.type=autonomo` ⇒ `profile=afiliat` (hook);
  `commission_rules.profile=afiliat` ⇒ `allow_recurring=false` (hook); el portal no ofereix recurrent als afiliats.
- **RGPD:** camps `client_*` marcats `hidden` a l'esquema **i** l'`onRecordEnrich` els oculta
  per a tothom que no sigui superuser.

## Migracions

| Fitxer | Contingut |
|---|---|
| `001_create_collections.js` | 16 col·leccions + seed serveis/settings. Diners en CÈNTIMS (en aquest punt) |
| `002_add_service_presentation.js` | Camp JSON `presentation` + seed de descripcions |
| `002_remove_auth_otps.js` | Elimina `auth_otps` (mai creada) → **migració morta** (try/catch); es pot treure |
| `003__partner_users_otp_length.js` | OTP 6 dígits / 180 s (default PB = 8) |
| `004_money_euros.js` | **Converteix tots els diners de cèntims → euros** (2 dec); `payouts.amount` només normalitza |
| `005_add_partner_commission_fields.js` | `referrals.partner_commission_alta/recurrente` (euros) |
| `1788942106_updated_users.js` | Col·lecció default `users`: habilita OTP 6 dígits (no s'usa) |

> Ordre d'aplicació: per nom (PocketBase). `002_add…` abans de `002_remove…`.

## Convencions d'esquema

- DINERS: enters en € a 2 decimals (post-004). **No fer `*100`/`/100` enlloc.**
- `autodate` per `created/updated`; `date` (YYYY-MM-DD) per dates de negoci.
- Relacions amb `cascadeDelete` control·lat per col·lecció.
- Canvis de model = **migracions** numerades al repo (versionables), no només a la UI.
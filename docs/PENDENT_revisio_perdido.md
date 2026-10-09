# PENDENT — Revisió sync de leads perdudes (perdido) al PRM

**Creat:** 11/09/2026 · **Estat:** ✅ RESOLT (causa arrel corregida, 09/10/2026) · **Responsable:** Pol (CoS)

> **✅ RESOLT (09/10/2026) — causa arrel.** Odoo **arxiva** les leads quan es marquen com a perdudes
> (`active=false`, `date_closed` informat) i, per defecte, l'ORM les **exclou** de
> `search`/`search_read` (`active_test=true`). El cron `odoo_two_way_sync` consultava `crm.lead`
> sense el context `active_test: false`, així que, en el moment de la pèrdua, la lead
> **desapareixia** de la consulta i mai es detectava. (La prova local anterior amb el mock no ho va
> veure perquè el mock no emulava aquest filtre.)
>
> **Correcció:** `pb_hooks/_crons.pb.js` → `context: { active_test: false }` al `search_read` de
> `odoo_two_way_sync` i al `search` d'idempotència de `sync_odoo`.
>
> **Verificat en local (09/10/2026):** mock d'Odoo que emula `active_test` amb una lead real
> (`id 136`, `won_status='lost'`, `lost_reason_id=[9,'Fora de termini']`, `active=false`,
> `stage_id=13`) → el referit passa a `perdido`, notes "Perdut (Odoo): Fora de termini",
> `odo_customer_id` i comissions sincronitzats, i event `lead → perdido`.
>
> **Pendent:** re-validar contra l'Odoo real de producció.

## Verificació local (08/10/2026)

S'ha muntat un entorn Docker complet (PocketBase 0.40.3 + ntfy + SMTP de proves + **mock
d'Odoo JSON-2**) i s'ha comprovat el flux sencer:

- Referit creat al portal → fila `outbox` (`create_opportunity`) → `cron sync_odoo` → `crm.lead`
  creat a Odoo amb `odo_opportunity_id` gravat i `odoo_sync_status='ok'`.
- `cron odoo_two_way_sync` amb la lead a `won_status='lost'` + `lost_reason_id=[1,"Molt car"]`
  → referral `status='perdido'`, notes amb `Perdut (Odoo): Molt car`, i **un sol** `referral_event`
  `lead → perdido`.
- Etapa `stage_id=12` → `status='instalado'`, `partner_commission_alta=60`, `partner_commission_recurrente=2,8`,
  comissió d'alta al `wallet_ledger` i notificació (una sola) al partner.

> Mentre es feia aquesta prova es van detectar i corregir **dos bugs que feien la sync inoperant**:
> (1) la cadena de hooks `onRecordAfterCreateSuccess` estava trencada per falta de `e.next()`, de
> manera que l'`outbox` **no es poblava mai**; (2) `$http.send().json` és `null` per a respostes JSON
> escalars (l'`id` de `create` d'Odoo), de manera que mai es llegia l'ID de l'oportunitat. Vegeu
> `AGENTS.md` §8.

Queda pendent **només la validació contra l'Odoo real de producció** (credencials/instància).

## Context
Es va demanar que `odoo_two_way_sync` (abans `stage_monitor`) registri al PRM
quan una lead es perd a Odoo (`won_status='lost'` / `lost_reason_id` present) →
referral `status='perdido'` + event amb el motiu. El codi està fet i pujat
(commits `0139e17`, `848f225`, `61e3e86`, `45b4f11`), però a producció
**no s'observa** que es canvii a `perdido`.

## Què s'ha comprovat (11/09/2026) a `prm.polser.cat`
- ✅ Instància viva (health 200). Migració d'euros aplicada (`services` en euros:
  `pis 599/27,99`, `botiga 699/34,99`). Migració 005 aplicada (`referrals` té
  `partner_commission_alta` i `partner_commission_recurrente`, 25 camps).
- ⚠️ **`referrals` = 0 registres** a `prm.polser.cat` (per a l'accés provat).
- ⚠️ Autenticació `_superusers/auth-with-password` amb `admin@polser.cat` retorna
  un token vàlid (record `admin@polser.cat`, id `0jat9vwk32gju36`), però aquest
  token **NO és acceptat com a superuser** als endpoints d'admin:
  - `GET /api/collections` → **401** «requires valid record authorization token»
  - `GET /api/collections/referrals/records` → returns 0 (filtre per partner)
  - `GET /api/collections/partners|settings|outbox` → **403** «Only superusers»
  → O bé `prm.polser.cat` **no és la instància de producció** amb les dades, o el
    token que retorna no es reconeix com a superuser en aquell host. **Pendent de
    localitzar la instància correcta / credencials vàlides.**

## Per què `perdido` no s'actualitza (hipòtesis obertes)
1. El cron només processa referits que **existeixen al PRM** i tenen
   `odo_opportunity_id`. Si les leads es proven **directament a Odoo** sense crear
   el referit al PRM, el sync no té res a actualitzar.
2. Producció pot no haver **reiniciar PocketBase** després del `git pull` (els
   hook canvis només es carreguen en reiniciar).
3. El valor real de `won_status`/`lost_reason_id` que retorna Odoo pot no encaixar
   amb la comprovació (log `[odoo_two_way_sync] canvi d'etapa ... lost true/false`).

## Accions per reprendre
- Confirmar la **URL/adreça real** de la instància de producció del PRM (és
  `prm.polser.cat`? o n'hi ha una altra / Cloudflare tunnel `api.partners.polser.cat`?).
- Fer login **admin `_/_`** (o CLI `pocketbase superuser upsert`) i revisar si els
  0 referits són correctes o si es mira al lloc equivocat.
- Si hi ha referits: verificar que un d'ells té `odo_opportunity_id` i que el cron
  llegeix la lead (mira el log del procés: `[odoo_two_way_sync] leads sincronitzades`).
- Confirmar que Odoo marca `won_status='lost'` (i `lost_reason_id=[id,"motiu"]`) a
  la lead, i que el reinici s'ha fet.

## Fitxers tocats (ja pujats a GitHub `main`)
- `pb_hooks/_crons.pb.js` — rescriu `odoo_two_way_sync` amb pèrdua integrada a la
  resolució d'estat + comissions aïllades.
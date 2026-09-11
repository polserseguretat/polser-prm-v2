# PRM POLSER — Unificació monetària: EUROS (2 decimals)

**Data:** 10/09/2026 · **Autor:** Pol (CoS) · **Abast:** PRM (PocketBase + portal)

---

## Per què

El PRM emmagatzemava els diners en **cèntims** (enters: `2799` = 27,99 €), però
alguns camins ja guardaven **euros** (els payouts via `_portal.pb.js` feien
`Math.round(amount)` de l'import en euros del portal) i Odoo/el portal treballen en
**euros**. Resultat: barreja de sistemes → el portal mostava `2799 €` en lloc de
`27,99 €`, i els payouts de 60 € s'enviaven a Odoo com a **0,60 €**.

**Mètrica canònica a partir d'ara: EUROS, DECIMALS, 2 decimals.** Cap camp monetari
emmagatzema cèntims i CAP codi ha de fer `*100` ni `/100`.

---

## Canvis realitzats (repo `polser-prm-v2`)

| Fitxer | Canvi |
|---|---|
| `pb_migrations/004_money_euros.js` | **NOVA migració** de conversió de dades: cèntims → euros (/100) per a `services.alta_fee/monthly_fee`, `referrals.estimated_value/final_value`, `commission_rules.fixed_amount`, `wallet_ledger.amount`, `settings.min_payout/default_fixed_commission`. **Cas especial:** `payouts.amount` ja era en EUROS → no es divideix (només 2 decimals). DOWN reverteix (*100). |
| `pb_hooks/_portal.pb.js` (POST /payouts) | Guarda `amount` **en euros**, `round2` → 2 decimals. (Abans: `Math.round` enter amb comentari "cèntims" pero el valor era euros.) |
| `pb_hooks/_crons.pb.js` | Eliminats els `/100` i `*100` de tota la lògica: `create_opportunity` (expected_revenue, recurring_revenue, descripció Alta/Quota) i `create_vendor_bill` (price_unit). `commission_monthly` calcula la recurrent en euros amb `round2(base*rate)` (abans `Math.round` truncava: 27,99×0,10→3 en lloc de 2,80). |
| `portal/src/pages/Onboarding.tsx` | `fmtEuro` passa de `maximumFractionDigits:0` a **2** (els preus de servei surten `27,99 €`, no `28 €`). Els altres (`Dashboard`, `Wallet`, `ReferralDetail`) ja eren a 2 decimals. |

> El `001_create_collections.js` **NO s'ha modificat** (és històric, già aplicat en
> producció: queda en cèntims; la conversió la fa el `004`). Això garanteix que una
> instal·lació nova appli `001`(cèntims)→`004`(euros) = correcte, i que la producció
> (que ja té `001`) només rebi el `004`.

---

## Aplicació a producció (fer a l'host del PocketBase)

1. Copiar al desplegament de producció:
   - `pb_migrations/004_money_euros.js` → `pb_migrations/`
   - `pb_hooks/_portal.pb.js` i `pb_hooks/_crons.pb.js` → `pb_hooks/`
   - `portal/src/pages/Onboarding.tsx` → portal (i rebuild del portal si aplica).
2. **Reiniciar** el servei PocketBase perquè apli l'`004` i recarregui hooks.
   ```
   # exemple si és servei systemd
   systemctl restart pocketbase   # o el procés/servei equivalent
   ```
   En arrencar, PB aplica la migració 004 sobre les dades existents (÷100 a camps en
   cèntims; payouts queden com estan, 2 dec).
3. **Verificar** (services és públic per listRule `''`):
   ```
   curl -s 'https://<PB>/api/collections/services/records?perPage=6'
   # espera: alta_fee pis=599, monthly_fee pis=27.99 (no 59900/2799)
   ```

---

## Què cal comprovar a mà (ambigüitats)

- **`referrals.estimated_value` / `final_value`:** per convenció eren cèntims. El
  `004` els divideix per 100. **Spot-check:** comparar `expected_revenue` de la lead
  a Odoo amb el valor al PRM després de la migració. Si alguna fila s'havia creat en
  euros, caldrà corregir-la manualment (entrada ajust).
- **`payouts.amount`:** el `004` NO el divideix (ja era euros). Confirmar que les
  retirades pendents/facturades surten a la xifra correcta a Odoo (abans sortien ÷100).
- **`wallet_ledger` immutabilitat:** els `onRecordUpdateRequest/DeleteRequest` no
  bloquegen els saves programàtics de la migració (no passen per *Request hooks),
  de manera que el `004` pot reescriure `amount` sense que el hook el bloquegi. Correcte.

---

## Rollback

Amb PB: eliminar `pb_migrations/004_money_euros.js`? **No** — el rollback correcte és
revertir el codi (`git checkout -- pb_hooks/_portal.pb.js pb_hooks/_crons.pb.js
portal/src/pages/Onboarding.tsx`) i, si cal tornar els valors a cèntims, executar el
`down` del `004` (la funció `(app)=>` del fitxer) una sola vegada amb PB en mode
migrate; després eliminar el fitxer `004`. Fer-ho amb còpia de seguretat de `pb_data`.

---

*Fi del document.*
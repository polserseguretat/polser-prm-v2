/// <reference path="../pb_hooks/types.d.ts" />
// =====================================================================
// PRM POLSER — Migració 005: camps de comissió del partner al referit
// ---------------------------------------------------------------
// Afegeix a `referrals` els imports que POLSER pagarà al partner per
// aquest referit, alimentats pel cron bidireccional `odoo_two_way_sync`
// (Odoo -> PRM). Font de veritat del pagament: Odoo (els poden ajustar).
//
//   - partner_commission_alta       € (2 dec) — comissió fixa d'alta
//   - partner_commission_recurrente € (2 dec) — recurrent mensual;
//      per perfil 'afiliat' SEMPRE 0,00 (regla CEO 08/09/2026).
//
// Moneda: EUROS amb 2 decimals (mètrica canònica del PRM).
//
// NOTA (JSVM PB 0.40.3): `collection.fields.add({...})` amb un objecte pla
// llança "could not convert [object Object] to core.Field". Cal passar
// INSTÀNCIES de camp: `new NumberField({...})` (les classes Field/
// NumberField/etc. són globals del JSVM).
// =====================================================================

migrate((app) => {
  const col = app.findCollectionByNameOrId('referrals')
  let changed = false

  if (!col.fields.getByName('partner_commission_alta')) {
    col.fields.add(new NumberField({ name: 'partner_commission_alta', min: null, max: null })) // euros (2 dec)
    changed = true
  }
  if (!col.fields.getByName('partner_commission_recurrente')) {
    col.fields.add(new NumberField({ name: 'partner_commission_recurrente', min: null, max: null })) // euros (2 dec)
    changed = true
  }

  if (changed) app.save(col)
}, (app) => {
  // DOWN: eliminar camps si existeixen (sense esborrar res més)
  const col = app.findCollectionByNameOrId('referrals')
  let changed = false
  if (col.fields.getByName('partner_commission_alta')) { col.fields.removeByName('partner_commission_alta'); changed = true }
  if (col.fields.getByName('partner_commission_recurrente')) { col.fields.removeByName('partner_commission_recurrente'); changed = true }
  if (changed) app.save(col)
})
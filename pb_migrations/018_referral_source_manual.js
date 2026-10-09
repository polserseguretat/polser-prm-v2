/// <reference path="../pb_hooks/types.d.ts" />
// =====================================================================
// PRM POLSER — Migració 018: valor 'manual' a referrals.source
// ---------------------------------------------------------------
// Els referits importats manualment des del panell /admin (backfill
// històric, POST /api/admin/referrals/backfill) es marquen amb
// source='manual' per:
//   - distingir-los dels del portal, i
//   - NO encuar cap create_opportunity a Odoo (són PRM-only; vegeu
//     _outbox.pb.js) ni mostrar la secció de sync al portal.
// =====================================================================

migrate((app) => {
  const col = app.findCollectionByNameOrId('referrals')
  const field = col.fields.getByName('source')
  if (field) {
    const values = (field.values || []).slice()
    if (values.indexOf('manual') === -1) {
      values.push('manual')
      field.values = values
      app.save(col)
    }
  }
}, (app) => {
  const col = app.findCollectionByNameOrId('referrals')
  const field = col.fields.getByName('source')
  if (field) {
    field.values = (field.values || []).filter((v) => v !== 'manual')
    app.save(col)
  }
})

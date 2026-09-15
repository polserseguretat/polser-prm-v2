/// <reference path="../pb_hooks/types.d.ts" />
// =====================================================================
// PRM POLSER — Migració 008: configuració de la signatura (Odoo Sign)
// ---------------------------------------------------------------
// Afegeix el camp JSON `sign_config` a `settings` i l'inicialitza amb els
// paràmetres concrets del contracte de col·laborador:
//
//   - request_model / template_model / item_model / role_model
//   - request_item_field (camp de firmants al sign.request)
//   - role_name ("Customer")
//   - template_name / subject / message / reference_prefix / validity_days
//   - field: el camp de firma (type_id, page, posX, posY, width, height,
//            required, num_options, alignment)
//
// NOTA (JSVM PB 0.40.3): JSONField és una classe global; cal instància.
// =====================================================================

migrate((app) => {
  const col = app.findCollectionByNameOrId('settings')
  let changed = false
  if (!col.fields.getByName('sign_config')) {
    col.fields.add(new JSONField({ name: 'sign_config', maxSize: 0 }))
    changed = true
  }
  if (changed) app.save(col)

  // SEED (només si està buit)
  let s = null
  try { s = app.findFirstRecordByFilter('settings', 'id != ""') } catch (_) { s = null }
  if (s) {
    let raw = null
    try { raw = s.get('sign_config') } catch (_) { raw = null }
    const empty = !raw ||
      (typeof raw === 'string' && raw.trim() === '') ||
      (typeof raw === 'object' && Object.keys(raw).length === 0)
    if (empty) {
      const cfg = {
        request_model: 'sign.request',
        template_model: 'sign.template',
        item_model: 'sign.item',
        request_item_field: 'request_item_ids',
        role_name: 'Signer 1',
        template_name: 'Contracte de col·laboració — {partner_name}',
        subject: 'Contracte de col·laboració — POLSER SEGURETAT',
        message: '<p>Hola,</p><p>Us fem arribar el contracte de col·laboració per signar-lo electrònicament.</p>',
        reference_prefix: 'COL-',
        validity_days: 30,
        field: {
          type_id: 1,
          name: 'Signatura',
          page: 3,
          posX: 0.51,
          posY: 0.495,
          width: 0.329,
          height: 0.096,
          required: true,
          num_options: 0,
          alignment: 'left',
        },
      }
      s.set('sign_config', JSON.parse(JSON.stringify(cfg)))
      app.save(s)
    }
  }
}, (app) => {
  const col = app.findCollectionByNameOrId('settings')
  if (col.fields.getByName('sign_config')) {
    col.fields.removeByName('sign_config')
    app.save(col)
  }
})
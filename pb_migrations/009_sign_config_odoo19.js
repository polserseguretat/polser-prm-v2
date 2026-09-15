/// <reference path="../pb_hooks/types.d.ts" />
// =====================================================================
// PRM POLSER — Migració 009: sign_config per a Odoo 19 (Sign refactoritzat)
// ---------------------------------------------------------------
// A Odoo 19 el PDF de Sign ja NO viu a `sign.template`: ara `sign.document`
// té `attachment_id`. Aquesta migració afegeix a `settings.sign_config`
// els noms de model/camp nous (sense sobreescriure els existents), de manera
// que el flux es pugui adaptar sense tocar codi.
// =====================================================================

migrate((app) => {
  let s = null
  try { s = app.findFirstRecordByFilter('settings', 'id != ""') } catch (_) { s = null }
  if (!s) return

  let cfg = {}
  try {
    const raw = s.get('sign_config')
    cfg = (typeof raw === 'string') ? JSON.parse(raw) : (raw || {})
  } catch (_) { cfg = {} }
  if (typeof cfg !== 'object' || cfg === null) cfg = {}

  const defaults = {
    document_model: 'sign.document',
    document_attachment_field: 'attachment_id',
    document_template_field: 'template_id',
    item_link_field: 'document_id',
    item_role_field: 'responsible_id',
    request_document_field: '',
  }
  let changed = false
  for (const k of Object.keys(defaults)) {
    if (cfg[k] === undefined) { cfg[k] = defaults[k]; changed = true }
  }
  if (changed) {
    s.set('sign_config', JSON.parse(JSON.stringify(cfg)))
    app.save(s)
  }
}, (app) => {
  // DOWN: sense canvis destructius
})
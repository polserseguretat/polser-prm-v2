/// <reference path="../pb_hooks/types.d.ts" />
// =====================================================================
// PRM POLSER — Migració 010: sign_config.document_raw_field = "raw"
// ---------------------------------------------------------------
// A Odoo 19 el PDF de `sign.document` s'envia pel camp binari `raw`
// (base64). La migració 009 el va deixar buit; aquí l'activem per als
// desplegaments que ja l'havien aplicat.
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

  if (!cfg.document_raw_field) {
    cfg.document_raw_field = 'raw'
    s.set('sign_config', JSON.parse(JSON.stringify(cfg)))
    app.save(s)
  }
}, (app) => {
  // DOWN: sense canvis destructius
})
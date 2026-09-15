/// <reference path="../pb_hooks/types.d.ts" />
// =====================================================================
// PRM POLSER — Migració 006: invitacions d'alta de partner
// ---------------------------------------------------------------
// Afegeix a `partners` els camps per gestionar l'alta per invitació:
//
//   - invite_token            text (ocult) — token únic de l'enllaç
//   - invite_expires_at       date        — caducitat (7 dies)
//   - invited_at              date        — moment de la invitació
//   - onboarding_completed_at date        — moment en què el partner
//                                            completa l'alta
//
// El token és d'un sol ús: al completar l'alta s'esborra ('').
// `hidden:true` perquè mai surti a `publicExport()` ni a l'API del portal.
//
// NOTA (JSVM PB 0.40.3): calen INSTÀNCIES de camp (TextField/DateField),
// no objectes plans (vegeu comentari a la migració 005).
// =====================================================================

migrate((app) => {
  const col = app.findCollectionByNameOrId('partners')
  let changed = false

  if (!col.fields.getByName('invite_token')) {
    col.fields.add(new TextField({ name: 'invite_token', max: 64, hidden: true }))
    changed = true
  }
  if (!col.fields.getByName('invite_expires_at')) {
    col.fields.add(new DateField({ name: 'invite_expires_at' }))
    changed = true
  }
  if (!col.fields.getByName('invited_at')) {
    col.fields.add(new DateField({ name: 'invited_at' }))
    changed = true
  }
  if (!col.fields.getByName('onboarding_completed_at')) {
    col.fields.add(new DateField({ name: 'onboarding_completed_at' }))
    changed = true
  }

  if (changed) app.save(col)
}, (app) => {
  // DOWN: eliminar camps si existeixen
  const col = app.findCollectionByNameOrId('partners')
  let changed = false
  if (col.fields.getByName('invite_token')) { col.fields.removeByName('invite_token'); changed = true }
  if (col.fields.getByName('invite_expires_at')) { col.fields.removeByName('invite_expires_at'); changed = true }
  if (col.fields.getByName('invited_at')) { col.fields.removeByName('invited_at'); changed = true }
  if (col.fields.getByName('onboarding_completed_at')) { col.fields.removeByName('onboarding_completed_at'); changed = true }
  if (changed) app.save(col)
})
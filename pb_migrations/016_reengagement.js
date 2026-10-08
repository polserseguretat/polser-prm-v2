/// <reference path="../pb_hooks/types.d.ts" />
// =====================================================================
// PRM POLSER — Migració 016: recordatori de re-engagement (inactivitat)
// ---------------------------------------------------------------
// Quan un usuari del portal porta N dies (per defecte 30) sense obrir
// l'app, el cron `reengagement_reminder` li envia un recordatori
// (notificació push + in-app + email) perquè torni i segueixi oferint
// solucions als seus clients.
//
// Camps nous:
//   partner_users.last_seen_at    — darrera obertura de l'app (POST /api/portal/ping)
//   partner_users.last_reminder_at — darrer recordatori enviat (anti-spam)
//   settings.reengagement_days    — dies d'inactivitat per disparar el recordatori (30)
//
// NOTA (JSVM PB 0.40.3): per afegir camps calen INSTÀNCIES de camp
// (new DateField/NumberField), no objectes plans.
// =====================================================================

migrate((app) => {
  // 1. partner_users — seguiment d'activitat
  const users = app.findCollectionByNameOrId('partner_users')
  let usersChanged = false
  if (!users.fields.getByName('last_seen_at')) {
    users.fields.add(new DateField({ name: 'last_seen_at', hidden: true }))
    usersChanged = true
  }
  if (!users.fields.getByName('last_reminder_at')) {
    users.fields.add(new DateField({ name: 'last_reminder_at', hidden: true }))
    usersChanged = true
  }
  if (usersChanged) app.save(users)

  // 2. settings — dies d'inactivitat (configurable)
  const settings = app.findCollectionByNameOrId('settings')
  if (!settings.fields.getByName('reengagement_days')) {
    settings.fields.add(new NumberField({ name: 'reengagement_days' }))
    app.save(settings)
  }

  // 3. seed del valor per defecte (30 dies) si encara no hi és
  try {
    const s = app.findFirstRecordByFilter('settings', 'id != ""')
    if (s && !(Number(s.get('reengagement_days')) > 0)) {
      s.set('reengagement_days', 30)
      app.save(s)
    }
  } catch (_) { /* sense settings no passa res */ }
}, (app) => {
  const users = app.findCollectionByNameOrId('partner_users')
  users.fields.removeByName('last_seen_at')
  users.fields.removeByName('last_reminder_at')
  app.save(users)

  const settings = app.findCollectionByNameOrId('settings')
  settings.fields.removeByName('reengagement_days')
  app.save(settings)
})

/// <reference path="../pb_hooks/types.d.ts" />
// =====================================================================
// PRM POLSER — Migració 013: notificacions push (ntfy) a la PWA
// ---------------------------------------------------------------
// 1. `partner_users`:
//      - ntfy_topic          text (ocult) — topic ntfy privat de l'usuari
//                             (prefix `polser-` + aleatori). Fa de contrasenya.
//      - push_enabled        bool — l'usuari té una subscripció Web Push activa.
//      - push_subscribed_at  date — darrera subscripció (renovacions).
//
// 2. `notifications.link` text — deep-link opcional que s'obre en clicar el
//    push (p. ex. `/referrals/<id>`, `/wallet`). Buit -> `/notifications`.
//
// 3. `notification_deliveries.pushed_at` date — marca quan s'ha enviat el
//    push de l'entrega (idempotència del cron `push_processor`). Les entregues
//    prèvies es marquen amb la seva `delivered_at` per NO reenviar historial.
//
// NOTA (JSVM PB 0.40.3): per afegir camps calen INSTÀNCIES de camp
// (new TextField/BoolField/DateField), no objectes plans (migració 005).
// =====================================================================

migrate((app) => {
  // Generador de topic: $security.randomString si és accessible; si no,
  // fallback local. Es garanteix la unicitat comprovant l'existent.
  const rand = (n) => {
    try { return $security.randomString(n) } catch (_) {
      const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
      let s = ''
      for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)]
      return s
    }
  }
  const prefix = 'polser-'
  const topicInUse = (topic, exceptId) => {
    try {
      const found = app.findFirstRecordByFilter('partner_users', 'ntfy_topic = {:t}', { t: topic })
      return !!(found && found.id !== exceptId)
    } catch (_) { return false }
  }

  // ---------------------------------------------------------------
  // 1. partner_users — camps de push
  // ---------------------------------------------------------------
  const users = app.findCollectionByNameOrId('partner_users')
  let usersChanged = false
  if (!users.fields.getByName('ntfy_topic')) {
    users.fields.add(new TextField({ name: 'ntfy_topic', max: 64, hidden: true }))
    usersChanged = true
  }
  if (!users.fields.getByName('push_enabled')) {
    users.fields.add(new BoolField({ name: 'push_enabled' }))
    usersChanged = true
  }
  if (!users.fields.getByName('push_subscribed_at')) {
    users.fields.add(new DateField({ name: 'push_subscribed_at' }))
    usersChanged = true
  }
  if (usersChanged) app.save(users)

  // Backfill de ntfy_topic per als usuaris existents.
  const BATCH = 500
  let offset = 0
  for (;;) {
    let rows = []
    try {
      rows = app.findRecordsByFilter('partner_users', 'id != ""', '', BATCH, offset)
    } catch (_) { break }
    if (!rows || !rows.length) break
    for (const u of rows) {
      if (u.get('ntfy_topic')) continue
      let topic = ''
      for (let i = 0; i < 5; i++) {
        const candidate = prefix + rand(24)
        if (!topicInUse(candidate, u.id)) { topic = candidate; break }
      }
      if (!topic) topic = prefix + rand(16) + '-' + u.id.slice(0, 8)
      u.set('ntfy_topic', topic)
      app.save(u)
    }
    if (rows.length < BATCH) break
    offset += rows.length
  }

  // Índex únic (després del backfill).
  if (!users.indexes || !users.indexes.some((i) => String(i).indexOf('idx_partner_users_ntfy_topic') !== -1)) {
    users.indexes = (users.indexes || []).concat(['CREATE UNIQUE INDEX idx_partner_users_ntfy_topic ON partner_users (ntfy_topic)'])
    app.save(users)
  }

  // ---------------------------------------------------------------
  // 2. notifications.link
  // ---------------------------------------------------------------
  const notif = app.findCollectionByNameOrId('notifications')
  if (!notif.fields.getByName('link')) {
    notif.fields.add(new TextField({ name: 'link', max: 300 }))
    app.save(notif)
  }

  // ---------------------------------------------------------------
  // 3. notification_deliveries.pushed_at
  // ---------------------------------------------------------------
  const dels = app.findCollectionByNameOrId('notification_deliveries')
  if (!dels.fields.getByName('pushed_at')) {
    dels.fields.add(new DateField({ name: 'pushed_at' }))
    app.save(dels)
  }

  // Backfill: marquem les entregues existents com a ja "pushed" perquè el
  // cron no reenviï tot l'historial de notificacions en activar la funció.
  offset = 0
  for (;;) {
    let rows = []
    try {
      rows = app.findRecordsByFilter('notification_deliveries', 'id != ""', '', BATCH, offset)
    } catch (_) { break }
    if (!rows || !rows.length) break
    for (const d of rows) {
      if (d.get('pushed_at')) continue
      const deliveredAt = d.get('delivered_at')
      if (deliveredAt) d.set('pushed_at', deliveredAt)
      app.save(d)
    }
    if (rows.length < BATCH) break
    offset += rows.length
  }
}, (app) => {
  // DOWN: elimina els camps afegits (no toca dades de negoci).
  const users = app.findCollectionByNameOrId('partner_users')
  let changed = false
  for (const n of ['ntfy_topic', 'push_enabled', 'push_subscribed_at']) {
    if (users.fields.getByName(n)) { users.fields.removeByName(n); changed = true }
  }
  if (changed) app.save(users)

  const notif = app.findCollectionByNameOrId('notifications')
  if (notif.fields.getByName('link')) { notif.fields.removeByName('link'); app.save(notif) }

  const dels = app.findCollectionByNameOrId('notification_deliveries')
  if (dels.fields.getByName('pushed_at')) { dels.fields.removeByName('pushed_at'); app.save(dels) }
})

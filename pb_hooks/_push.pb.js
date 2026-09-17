/// <reference path="./types.d.ts" />
// =====================================================================
// PRM POLSER — Notificacions push (ntfy) a la PWA
// ---------------------------------------------------------------
// Aquest fitxer és el propietari de tot el que fa referència a ntfy:
//
//   - topic ntfy per usuari (onRecordCreate de `partner_users`)
//   - GET  /api/portal/push/config        VAPID pública + topic + estat
//   - POST /api/portal/push/subscribe     registra la subscripció a ntfy
//   - DELETE /api/portal/push/subscribe   elimina la subscripció
//   - cron push_processor                 publica les entregues pendents
//   - onRecordAfterCreateSuccess(comissions) -> encua notificació push
//   - onRecordAfterUpdateSuccess(payouts)    -> encua notificació push
//
// El canal de push es governa amb el camp `notifications.channel`
// (inapp|push|both). Les campanyes (`notification_processor`) i els events
// transaccionals només han de crear `notifications` + `notification_deliveries`;
// aquest cron s'encarrega d'enviar-les (idempotent per `pushed_at`).
//
// SEGURETAT (PB 0.40.3 JSVM): cada handler és TOTALMENT AUTOCONTINGUT
// (lògica inline dins del callback). No s'usen funcions/const top-level,
// perquè no són visibles dins dels callbacks. Només globals injectats.
// =====================================================================

// ------------------------------------------------------------------
// Topic ntfy per usuari (el topic fa de contrasenya: prefix + aleatori)
// ------------------------------------------------------------------
onRecordCreate((e) => {
  try {
    if (!e.record.get('ntfy_topic')) {
      const prefix = $os.getenv('NTFY_TOPIC_PREFIX') || 'polser-'
      e.record.set('ntfy_topic', prefix + $security.randomString(24))
    }
  } catch (_) { /* no bloqueja mai l'alta de l'usuari */ }
  return e.next()
}, 'partner_users')

// ------------------------------------------------------------------
// GET /api/portal/push/config
//   Retorna la VAPID pública, el topic de l'usuari i si el servei està
//   operatiu. Si l'usuari encara no té topic, se n'hi genera un.
// ------------------------------------------------------------------
routerAdd('GET', '/api/portal/push/config', (e) => {
  const auth = e.auth
  if (!auth) throw new ForbiddenError('Autenticació requerida.')

  const NTFY_URL = ($os.getenv('NTFY_URL') || '').replace(/\/+$/, '')
  const prefix = $os.getenv('NTFY_TOPIC_PREFIX') || 'polser-'

  let topic = auth.get('ntfy_topic')
  if (!topic) {
    topic = prefix + $security.randomString(24)
    try { auth.set('ntfy_topic', topic); $app.save(auth) } catch (_) { }
  }

  // La VAPID pública pot venir d'entorn (més ràpid) o de ntfy /v1/config.
  let publicKey = $os.getenv('NTFY_VAPID_PUBLIC_KEY') || ''
  let enabled = !!(NTFY_URL && publicKey)
  if (NTFY_URL && !publicKey) {
    try {
      const res = $http.send({ url: NTFY_URL + '/v1/config', method: 'GET', timeout: 10 })
      if (res.statusCode === 200 && res.json) {
        publicKey = res.json.web_push_public_key || res.json.WebPushPublicKey || res.json.webpush_public_key || ''
        const webPushFlag = (res.json.enable_web_push !== false && res.json.EnableWebPush !== false)
        enabled = !!publicKey && webPushFlag
      }
    } catch (_) { /* ntfy no accessible: enabled=false */ }
  }

  return e.json(200, {
    data: {
      enabled: enabled,
      topic: topic,
      vapid_public_key: publicKey,
      subscribed: !!auth.get('push_enabled'),
    },
  })
}, $apis.requireAuth('partner_users'))

// ------------------------------------------------------------------
// POST /api/portal/push/subscribe
//   Body: { endpoint, keys: { p256dh, auth } }
//   Registra la subscripció del navegador al servidor ntfy per al topic
//   de l'usuari. El token de publicació mai surt del backend.
// ------------------------------------------------------------------
routerAdd('POST', '/api/portal/push/subscribe', (e) => {
  const auth = e.auth
  if (!auth) throw new ForbiddenError('Autenticació requerida.')

  const NTFY_URL = ($os.getenv('NTFY_URL') || '').replace(/\/+$/, '')
  if (!NTFY_URL) throw new BadRequestError('El servei de notificacions no està configurat.')

  const body = e.requestInfo().body || {}
  const endpoint = String(body.endpoint || '').trim()
  const keys = body.keys || {}
  const p256dh = String(keys.p256dh || '').trim()
  const authKey = String(keys.auth || '').trim()
  if (!endpoint || !p256dh || !authKey) throw new BadRequestError('Subscripció push no vàlida.')

  let topic = auth.get('ntfy_topic')
  if (!topic) {
    topic = ($os.getenv('NTFY_TOPIC_PREFIX') || 'polser-') + $security.randomString(24)
    auth.set('ntfy_topic', topic)
  }

  const headers = { 'content-type': 'application/json' }
  const token = $os.getenv('NTFY_PUBLISH_TOKEN') || ''
  if (token) headers['authorization'] = 'Bearer ' + token

  const res = $http.send({
    url: NTFY_URL + '/v1/webpush',
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ endpoint: endpoint, p256dh: p256dh, auth: authKey, topics: [topic] }),
    timeout: 15,
  })
  if (res.statusCode < 200 || res.statusCode >= 300) {
    $app.logger().warn('[push] subscripció rebutjada per ntfy', 'status', res.statusCode, 'user', auth.id)
    throw new BadRequestError('No s\'ha pogut activar les notificacions push (ntfy ' + res.statusCode + ').')
  }

  auth.set('push_enabled', true)
  auth.set('push_subscribed_at', new Date().toISOString())
  $app.save(auth)
  $app.logger().info('[push] subscripció registrada', 'user', auth.id)
  return e.json(200, { data: { enabled: true, topic: topic } })
}, $apis.requireAuth('partner_users'))

// ------------------------------------------------------------------
// DELETE /api/portal/push/subscribe
//   Body: { endpoint }  (opcional: si no arriba, només marca estat local)
// ------------------------------------------------------------------
routerAdd('DELETE', '/api/portal/push/subscribe', (e) => {
  const auth = e.auth
  if (!auth) throw new ForbiddenError('Autenticació requerida.')

  const body = e.requestInfo().body || {}
  const endpoint = String(body.endpoint || '').trim()
  const NTFY_URL = ($os.getenv('NTFY_URL') || '').replace(/\/+$/, '')

  if (NTFY_URL && endpoint) {
    const headers = { 'content-type': 'application/json' }
    const token = $os.getenv('NTFY_PUBLISH_TOKEN') || ''
    if (token) headers['authorization'] = 'Bearer ' + token
    try {
      $http.send({
        url: NTFY_URL + '/v1/webpush',
        method: 'DELETE',
        headers: headers,
        body: JSON.stringify({ endpoint: endpoint }),
        timeout: 15,
      })
    } catch (_) { /* best-effort */ }
  }

  auth.set('push_enabled', false)
  $app.save(auth)
  return e.json(200, { data: { enabled: false } })
}, $apis.requireAuth('partner_users'))

// ------------------------------------------------------------------
// cron push_processor (* * * * *)
//   Publica via ntfy les entregues pendents (`notification_deliveries`
//   amb `pushed_at` buit) el canal de les quals sigui push/both.
// ------------------------------------------------------------------
cronAdd('push_processor', '* * * * *', () => {
  try {
    const NTFY_URL = ($os.getenv('NTFY_URL') || '').replace(/\/+$/, '')
    if (!NTFY_URL) return
    const TOKEN = $os.getenv('NTFY_PUBLISH_TOKEN') || ''
    const nowIso = new Date().toISOString()

    // Entregues pendents. Es prova el filtre de data buida i, si falla,
    // es fa el filtratge en JS (robustesa entre versions de PB).
    let pending = []
    try {
      pending = $app.findRecordsByFilter('notification_deliveries', 'pushed_at = ""', '-created_at', 200, 0)
    } catch (_) { pending = [] }
    if (!pending.length) {
      try {
        const rows = $app.findRecordsByFilter('notification_deliveries', 'id != ""', '-created_at', 200, 0)
        pending = rows.filter((d) => !d.get('pushed_at'))
      } catch (_) { pending = [] }
    }
    if (!pending.length) return

    let sent = 0
    for (const d of pending) {
      let notif = null
      let user = null
      try { notif = d.get('notification') ? $app.findRecordById('notifications', d.get('notification')) : null } catch (_) { notif = null }
      try { user = d.get('user') ? $app.findRecordById('partner_users', d.get('user')) : null } catch (_) { user = null }

      const channel = notif ? (notif.get('channel') || 'inapp') : 'inapp'
      const topic = user ? (user.get('ntfy_topic') || '') : ''
      const shouldPush = !!notif && !!user && (channel === 'push' || channel === 'both') &&
        !!topic && !user.get('disabled') && !!user.get('push_enabled')

      if (shouldPush) {
        try {
          const payload = {
            topic: topic,
            title: notif.get('title') || 'POLSER SEGURETAT',
            message: notif.get('body') || notif.get('title') || '',
            click: notif.get('link') || '/notifications',
            priority: 3,
            tags: ['bell'],
          }
          const headers = { 'content-type': 'application/json' }
          if (TOKEN) headers['authorization'] = 'Bearer ' + TOKEN
          const res = $http.send({
            url: NTFY_URL + '/',
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload),
            timeout: 15,
          })
          if (res.statusCode < 200 || res.statusCode >= 300) {
            throw new Error('ntfy HTTP ' + res.statusCode)
          }
          sent++
        } catch (err) {
          $app.logger().warn('[push_processor] enviament fallit (es reintentarà)', 'delivery', d.id, 'error', String((err && err.message) || err))
          continue // NO marquem pushed_at: es reintenta al proper cicle
        }
      }
      d.set('pushed_at', nowIso)
      try { $app.save(d) } catch (_) { }
    }
    if (sent) $app.logger().info('[push_processor] pushes enviats', 'count', sent)
  } catch (err) {
    $app.logger().error('[cron:push_processor]', 'error', err.message)
  }
})

// ------------------------------------------------------------------
// Comissions acreditades -> push al partner (wallet_ledger)
//   Cobreix alta ('high') i recurrent ('recurring'). La recurrent única i
//   la regla CEO (afiliat sense recurrent) ja es defensen al seu hook.
// ------------------------------------------------------------------
onRecordAfterCreateSuccess((e) => {
  try {
    const r = e.record
    const type = r.get('type')
    if (type !== 'high' && type !== 'recurring') return
    const amount = Number(r.get('amount') || 0)
    if (!(amount > 0)) return
    const partnerId = r.get('partner')
    if (!partnerId) return

    // Destinataris: usuaris del portal del partner (rol partner, no desactivats).
    let users = []
    try {
      users = $app.findRecordsByFilter('partner_users', 'partner = {:p}', '', 200, 0, { p: partnerId })
    } catch (_) { users = [] }
    users = users.filter((u) => u.get('role') === 'partner' && !u.get('disabled'))
    if (!users.length) return

    const amountTxt = amount.toFixed(2).replace('.', ',') + ' €'
    const title = type === 'high' ? "Comissió d'alta acreditada" : 'Comissió recurrent acreditada'
    const body = (r.get('description') || ('Comissió ' + amountTxt)) + ' · +' + amountTxt

    const notifCol = $app.findCollectionByNameOrId('notifications')
    const n = new Record(notifCol)
    n.set('title', title)
    n.set('body', body)
    n.set('audience', 'all') // l'entrega real és dirigida (notification_deliveries)
    n.set('channel', 'both')
    n.set('status', 'sent')
    n.set('sent_at', new Date().toISOString())
    n.set('link', '/wallet')
    $app.save(n)

    const delCol = $app.findCollectionByNameOrId('notification_deliveries')
    const today = new Date().toISOString().slice(0, 10)
    for (const u of users) {
      const d = new Record(delCol)
      d.set('notification', n.id)
      d.set('user', u.id)
      d.set('delivered_at', today)
      try { $app.save(d) } catch (_) { /* duplicat */ }
    }
  } catch (err) {
    $app.logger().warn('[push] comissió: notificació no creada', 'error', String((err && err.message) || err))
  }
}, 'wallet_ledger')

// ------------------------------------------------------------------
// Canvis d'estat de payout -> push al partner
// ------------------------------------------------------------------
onRecordAfterUpdateSuccess((e) => {
  try {
    const rec = e.record
    const newStatus = rec.get('status')
    const oldStatus = rec.original() ? rec.original().get('status') : null
    if (!newStatus || !oldStatus || newStatus === oldStatus) return

    const label = {
      solicitada: 'sol·licitada',
      factura_rebuda: 'factura rebuda',
      en_proces: 'en procés',
      pagada: 'pagada',
    }[newStatus] || newStatus
    const amount = Number(rec.get('amount') || 0)
    const amountTxt = amount > 0 ? (amount.toFixed(2).replace('.', ',') + ' €') : ''

    const partnerId = rec.get('partner')
    if (!partnerId) return
    let users = []
    try {
      users = $app.findRecordsByFilter('partner_users', 'partner = {:p}', '', 200, 0, { p: partnerId })
    } catch (_) { users = [] }
    users = users.filter((u) => u.get('role') === 'partner' && !u.get('disabled'))
    if (!users.length) return

    const notifCol = $app.findCollectionByNameOrId('notifications')
    const n = new Record(notifCol)
    n.set('title', 'Retirada ' + label)
    n.set('body', 'La teva retirada' + (amountTxt ? ' de ' + amountTxt : '') + ' ha passat a l\'estat: ' + label + '.')
    n.set('audience', 'all')
    n.set('channel', 'both')
    n.set('status', 'sent')
    n.set('sent_at', new Date().toISOString())
    n.set('link', '/wallet')
    $app.save(n)

    const delCol = $app.findCollectionByNameOrId('notification_deliveries')
    const today = new Date().toISOString().slice(0, 10)
    for (const u of users) {
      const d = new Record(delCol)
      d.set('notification', n.id)
      d.set('user', u.id)
      d.set('delivered_at', today)
      try { $app.save(d) } catch (_) { /* duplicat */ }
    }
  } catch (err) {
    $app.logger().warn('[push] payout: notificació no creada', 'error', String((err && err.message) || err))
  }
}, 'payouts')

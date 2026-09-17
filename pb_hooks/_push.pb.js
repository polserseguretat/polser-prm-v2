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

  const prefix = $os.getenv('NTFY_TOPIC_PREFIX') || 'polser-'

  let topic = auth.get('ntfy_topic')
  if (!topic) {
    topic = prefix + $security.randomString(24)
    try { auth.set('ntfy_topic', topic); $app.save(auth) } catch (_) { }
  }

  // Candidats d'URL de ntfy. Primer la xarxa Docker interna (nom de servei i
  // nom de contenidor), després l'URL d'entorn. Així no depèn d'una variable
  // mal configurada (p. ex. apuntant al domini públic IPv6/Cloudflare).
  const candidates = []
  const envInternal = ($os.getenv('NTFY_INTERNAL_URL') || '').replace(/\/+$/, '')
  const envUrl = ($os.getenv('NTFY_URL') || '').replace(/\/+$/, '')
  if (envInternal) candidates.push(envInternal)
  candidates.push('http://ntfy:80')
  candidates.push('http://polser-prm-ntfy:80')
  if (envUrl && candidates.indexOf(envUrl) === -1) candidates.push(envUrl)

  // Font de veritat: el propi ntfy (`/v1/config`). Si cap candidat respon o el
  // Web Push no hi està configurat, `enabled=false` i NO intentem subscriure.
  let publicKey = ''
  let enabled = false
  let httpReason = ''
  let connected = false
  const probeErrors = []
  for (const base of candidates) {
    try {
      const res = $http.send({ url: base + '/v1/config', method: 'GET', timeout: 4 })
      connected = true
      if (res.statusCode === 200 && res.json) {
        const key = res.json.web_push_public_key || res.json.WebPushPublicKey || res.json.webpush_public_key || ''
        const webPushFlag = (res.json.enable_web_push !== false && res.json.EnableWebPush !== false)
        if (key && webPushFlag) { publicKey = key; enabled = true; break }
        httpReason = 'webpush_desactivat'
      } else {
        httpReason = 'ntfy_http_' + (res ? res.statusCode : 0)
      }
    } catch (err) {
      probeErrors.push(base + ' -> ' + String((err && err.message) || err))
    }
  }
  const reason = enabled ? '' : (connected ? (httpReason || 'webpush_desactivat') : 'ntfy_inabastable')
  if (!enabled) {
    $app.logger().warn('[push] ntfy no disponible', 'reason', reason, 'intents', probeErrors.join(' | '))
  }

  return e.json(200, {
    data: {
      enabled: enabled,
      topic: topic,
      vapid_public_key: publicKey,
      subscribed: !!auth.get('push_enabled'),
      reason: reason,
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

  // Mateixos candidats que a /config (xarxa interna primer).
  const candidates = []
  const envInternal = ($os.getenv('NTFY_INTERNAL_URL') || '').replace(/\/+$/, '')
  const envUrl = ($os.getenv('NTFY_URL') || '').replace(/\/+$/, '')
  if (envInternal) candidates.push(envInternal)
  candidates.push('http://ntfy:80')
  candidates.push('http://polser-prm-ntfy:80')
  if (envUrl && candidates.indexOf(envUrl) === -1) candidates.push(envUrl)

  let res = null
  const errors = []
  for (const base of candidates) {
    try {
      const r = $http.send({
        url: base + '/v1/webpush',
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ endpoint: endpoint, p256dh: p256dh, auth: authKey, topics: [topic] }),
        timeout: 15,
      })
      if (r && r.statusCode) { res = r; break }
    } catch (err) {
      errors.push(base + ' -> ' + String((err && err.message) || err))
    }
  }
  if (!res) {
    $app.logger().error('[push] ntfy inabastable al subscriure', 'intents', errors.join(' | '))
    throw new BadRequestError('No s\'ha pogut contactar amb el servei de notificacions.')
  }

  if (res.statusCode < 200 || res.statusCode >= 300) {
    let detail = String(res.statusCode)
    try {
      if (res.json) detail = res.json.error || res.json.message || detail
      else if (res.raw) detail = String(res.raw).slice(0, 200)
    } catch (_) { /* ignore */ }
    $app.logger().warn('[push] subscripció rebutjada per ntfy', 'status', res.statusCode, 'detail', detail, 'user', auth.id, 'topic', topic)
    throw new BadRequestError('No s\'ha pogut activar les notificacions push: ' + detail)
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

  if (endpoint) {
    const headers = { 'content-type': 'application/json' }
    const token = $os.getenv('NTFY_PUBLISH_TOKEN') || ''
    if (token) headers['authorization'] = 'Bearer ' + token
    const candidates = []
    const envInternal = ($os.getenv('NTFY_INTERNAL_URL') || '').replace(/\/+$/, '')
    const envUrl = ($os.getenv('NTFY_URL') || '').replace(/\/+$/, '')
    if (envInternal) candidates.push(envInternal)
    candidates.push('http://ntfy:80')
    candidates.push('http://polser-prm-ntfy:80')
    if (envUrl && candidates.indexOf(envUrl) === -1) candidates.push(envUrl)
    for (const base of candidates) {
      try {
        const r = $http.send({
          url: base + '/v1/webpush',
          method: 'DELETE',
          headers: headers,
          body: JSON.stringify({ endpoint: endpoint }),
          timeout: 15,
        })
        if (r && r.statusCode) break
      } catch (_) { /* prova el següent candidat */ }
    }
  }

  auth.set('push_enabled', false)
  $app.save(auth)
  return e.json(200, { data: { enabled: false } })
}, $apis.requireAuth('partner_users'))

// ------------------------------------------------------------------
// POST /api/portal/push/test
//   Envia un push de prova a l'usuari actual i retorna el resultat
//   (diagnòstic: si ntfy accepta la publicació). Crea també el registre
//   in-app perquè es vegi a la llista de notificacions.
// ------------------------------------------------------------------
routerAdd('POST', '/api/portal/push/test', (e) => {
  const auth = e.auth
  if (!auth) throw new ForbiddenError('Autenticació requerida.')

  const prefix = $os.getenv('NTFY_TOPIC_PREFIX') || 'polser-'
  let topic = auth.get('ntfy_topic')
  if (!topic) {
    topic = prefix + $security.randomString(24)
    auth.set('ntfy_topic', topic)
    try { $app.save(auth) } catch (_) { }
  }

  // Registre in-app (channel 'inapp' perquè el cron no el republiqui; aquesta
  // ruta publica directament i en retorna el resultat).
  try {
    const notifCol = $app.findCollectionByNameOrId('notifications')
    const n = new Record(notifCol)
    n.set('title', 'Prova de notificació')
    n.set('body', 'Notificació de prova de POLSER SEGURETAT.')
    n.set('audience', 'all')
    n.set('channel', 'inapp')
    n.set('status', 'sent')
    n.set('sent_at', new Date().toISOString())
    n.set('link', '/notifications')
    $app.save(n)
    const delCol = $app.findCollectionByNameOrId('notification_deliveries')
    const d = new Record(delCol)
    d.set('notification', n.id)
    d.set('user', auth.id)
    d.set('delivered_at', new Date().toISOString())
    d.set('pushed_at', new Date().toISOString())
    try { $app.save(d) } catch (_) { }
  } catch (_) { /* l'in-app no és crític per a la prova */ }

  const candidates = []
  const envInternal = ($os.getenv('NTFY_INTERNAL_URL') || '').replace(/\/+$/, '')
  const envUrl = ($os.getenv('NTFY_URL') || '').replace(/\/+$/, '')
  if (envInternal) candidates.push(envInternal)
  candidates.push('http://ntfy:80')
  candidates.push('http://polser-prm-ntfy:80')
  if (envUrl && candidates.indexOf(envUrl) === -1) candidates.push(envUrl)

  const token = $os.getenv('NTFY_PUBLISH_TOKEN') || ''
  const headers = { 'content-type': 'application/json' }
  if (token) headers['authorization'] = 'Bearer ' + token
  const payload = {
    topic: topic,
    title: 'Prova de notificació',
    message: 'Notificació de prova de POLSER SEGURETAT.',
    click: '/notifications',
    priority: 3,
    tags: ['bell'],
  }

  let published = false
  let status = 0
  let detail = ''
  const errs = []
  for (const base of candidates) {
    try {
      const r = $http.send({ url: base + '/', method: 'POST', headers: headers, body: JSON.stringify(payload), timeout: 15 })
      status = r ? r.statusCode : 0
      if (status >= 200 && status < 300) { published = true; break }
      try { detail = (r && r.json && (r.json.error || r.json.message)) || String(status) } catch (_) { detail = String(status) }
    } catch (err) {
      errs.push(base + ' -> ' + String((err && err.message) || err))
    }
  }
  if (!published && !detail) detail = errs.join(' | ') || 'ntfy inabastable'

  $app.logger().info('[push] prova enviada', 'user', auth.id, 'topic', topic, 'published', published, 'status', status, 'detail', detail)
  return e.json(200, { data: { published: published, status: status, detail: detail, topic: topic, subscribed: !!auth.get('push_enabled') } })
}, $apis.requireAuth('partner_users'))

// ------------------------------------------------------------------
// cron push_processor (* * * * *)
//   Publica via ntfy les entregues pendents (`notification_deliveries`
//   amb `pushed_at` buit) el canal de les quals sigui push/both.
// ------------------------------------------------------------------
cronAdd('push_processor', '* * * * *', () => {
  try {
    const TOKEN = $os.getenv('NTFY_PUBLISH_TOKEN') || ''
    const candidates = []
    const envInternal = ($os.getenv('NTFY_INTERNAL_URL') || '').replace(/\/+$/, '')
    const envUrl = ($os.getenv('NTFY_URL') || '').replace(/\/+$/, '')
    if (envInternal) candidates.push(envInternal)
    candidates.push('http://ntfy:80')
    candidates.push('http://polser-prm-ntfy:80')
    if (envUrl && candidates.indexOf(envUrl) === -1) candidates.push(envUrl)
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
      // NO es filtra per `push_enabled` (és un estat per usuari, no per
      // dispositiu): ntfy entrega només als endpoints subscrits a aquest topic.
      // Així, amb diversos dispositius, desactivar-ne un no atura els altres.
      const shouldPush = !!notif && !!user && (channel === 'push' || channel === 'both') &&
        !!topic && !user.get('disabled')

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
          let ok = false
          let lastErr = ''
          for (const base of candidates) {
            try {
              const res = $http.send({
                url: base + '/',
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload),
                timeout: 15,
              })
              if (res.statusCode >= 200 && res.statusCode < 300) { ok = true; break }
              lastErr = 'ntfy HTTP ' + res.statusCode
            } catch (err) {
              lastErr = String((err && err.message) || err)
            }
          }
          if (!ok) throw new Error(lastErr || 'ntfy inabastable')
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

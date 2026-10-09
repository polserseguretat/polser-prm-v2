/// <reference path="./types.d.ts" />
// =====================================================================
// PRM POLSER — Panell d'administració (/admin)
// ---------------------------------------------------------------
// API per al panell de superusuaris. Totes les rutes requereixen un
// SUPERUSUARI autenticat de PocketBase (Bearer token de `_superusers`).
// El CRUD de col·leccions el fa el frontend directament contra l'API
// nativa de PocketBase (/api/collections/<col>/records), que el
// superusuari pot usar sense restriccions de regles. Aquest fitxer
// només aporta:
//
//   - GET  /api/admin/stats                 KPIs i sèries temporals
//   - GET  /api/admin/outbox-health         salut de la cua cap a Odoo
//   - POST /api/admin/outbox/{id}/retry     reintentar un event
//   - POST /api/admin/notifications/{id}/send  entrega immediata
//   - POST /api/admin/users                 alta d'usuari del portal
//   - POST /api/admin/partners/invite       alta de partner per invitació
//                                           (injecta l'email i el token al
//                                            servidor; no exposa cap clau)
//   - POST /api/admin/audit                 registre d'auditoria
//
// SEGURETAT (PB 0.40.3 JSVM): cada handler és TOTALMENT AUTOCONTINGUT
// (lògica inline dins del callback). No s'usen funcions/const top-level,
// perquè no són visibles dins dels callbacks. Només globals injectats.
// =====================================================================

// ------------------------------------------------------------------
// GET /api/admin/stats
// ------------------------------------------------------------------
routerAdd('GET', '/api/admin/stats', (e) => {
  if (!e.requestInfo().hasSuperuserAuth()) {
    throw new ForbiddenError('Cal autenticació de superusuari.')
  }

  // Paginació completa d'una col·lecció (evita el límit per defecte de 500).
  const fetchAll = (col, filter, sort) => {
    const out = []
    const BATCH = 500
    let offset = 0
    for (;;) {
      let rows
      try {
        rows = $app.findRecordsByFilter(col, filter || 'id != ""', sort || '', BATCH, offset)
      } catch (_) {
        break
      }
      if (!rows || !rows.length) break
      for (let i = 0; i < rows.length; i++) out.push(rows[i])
      if (rows.length < BATCH) break
      offset += rows.length
    }
    return out
  }
  const round2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100
  const inc = (obj, key) => { const k = key || '—'; obj[k] = (obj[k] || 0) + 1 }
  const addMoney = (obj, key, v) => { const k = key || '—'; obj[k] = round2((obj[k] || 0) + Number(v || 0)) }

  // Últims 12 períodes YYYY-MM (de més antic a més recent)
  const months = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'))
  }
  const monthSet = {}
  for (const m of months) monthSet[m] = true
  const monthOf = (iso) => {
    if (!iso) return ''
    const s = String(iso)
    return s.slice(0, 7)
  }

  // ---- Partners ----
  const partners = fetchAll('partners', '', '-created_at')
  const partnersByStatus = {}
  const partnersByProfile = {}
  const partnersByType = {}
  const partnersByMonth = {}
  for (const p of partners) {
    inc(partnersByStatus, p.get('status'))
    inc(partnersByProfile, p.get('profile'))
    inc(partnersByType, p.get('type'))
    const m = monthOf(p.get('created'))
    if (monthSet[m]) partnersByMonth[m] = (partnersByMonth[m] || 0) + 1
  }

  // ---- Referrals ----
  const referrals = fetchAll('referrals', '', '-created_at')
  const referralsByStatus = {}
  const referralsByMonth = {}
  let installed = 0
  let lost = 0
  for (const r of referrals) {
    inc(referralsByStatus, r.get('status'))
    if (r.get('status') === 'instalado') installed++
    if (r.get('status') === 'perdido') lost++
    const m = monthOf(r.get('created'))
    if (monthSet[m]) referralsByMonth[m] = (referralsByMonth[m] || 0) + 1
  }
  const referralsTotal = referrals.length
  const conversionRate = referralsTotal > 0 ? Math.round((installed / referralsTotal) * 1000) / 10 : 0

  // ---- Wallet (comissions) ----
  const wallet = fetchAll('wallet_ledger', '', '-created_at')
  const walletByType = {}
  const walletByStatus = {}
  const walletByPeriod = {}
  let walletTotal = 0
  for (const w of wallet) {
    const amount = Number(w.get('amount') || 0)
    walletTotal = round2(walletTotal + amount)
    addMoney(walletByType, w.get('type'), amount)
    addMoney(walletByStatus, w.get('status'), amount)
    const period = w.get('period')
    if (period && monthSet[period]) addMoney(walletByPeriod, period, amount)
  }

  // ---- Payouts ----
  const payouts = fetchAll('payouts', '', '-created_at')
  const payoutsByStatus = {}
  let payoutsAmount = 0
  for (const p of payouts) {
    inc(payoutsByStatus, p.get('status'))
    payoutsAmount = round2(payoutsAmount + Number(p.get('amount') || 0))
  }
  const payoutsPending = (payoutsByStatus['solicitada'] || 0) + (payoutsByStatus['factura_rebuda'] || 0) + (payoutsByStatus['en_proces'] || 0)

  // ---- Outbox ----
  const outbox = fetchAll('outbox', '', '-created_at')
  const outboxByStatus = {}
  let outboxErrors = 0
  for (const o of outbox) {
    inc(outboxByStatus, o.get('status'))
    if (o.get('status') === 'error' || o.get('status') === 'dead') outboxErrors++
  }

  // ---- Notifications ----
  const notifications = fetchAll('notifications', '', '-created_at')
  const notificationsByStatus = {}
  for (const n of notifications) inc(notificationsByStatus, n.get('status'))

  // ---- Alertes ----
  const contractsPending = partners.filter((p) => p.get('contract_status') === 'pending_signature').length
  let expiredInvitations = 0
  const nowMs = Date.now()
  for (const p of partners) {
    if (p.get('status') !== 'pendente') continue
    const exp = p.get('invite_expires_at')
    if (exp && new Date(exp).getTime() < nowMs) expiredInvitations++
  }

  const series = months.map((m) => ({
    month: m,
    referrals: referralsByMonth[m] || 0,
    partners: partnersByMonth[m] || 0,
    commissions: walletByPeriod[m] || 0,
  }))

  return e.json(200, {
    data: {
      partners: {
        total: partners.length,
        active: partnersByStatus['actiu'] || 0,
        pending: partnersByStatus['pendente'] || 0,
        byStatus: partnersByStatus,
        byProfile: partnersByProfile,
        byType: partnersByType,
      },
      referrals: {
        total: referralsTotal,
        installed,
        lost,
        conversionRate,
        byStatus: referralsByStatus,
      },
      wallet: {
        total: walletTotal,
        byType: walletByType,
        byStatus: walletByStatus,
      },
      payouts: {
        total: payouts.length,
        pending: payoutsPending,
        paid: payoutsByStatus['pagada'] || 0,
        amount: payoutsAmount,
        byStatus: payoutsByStatus,
      },
      outbox: {
        total: outbox.length,
        byStatus: outboxByStatus,
      },
      notifications: {
        total: notifications.length,
        byStatus: notificationsByStatus,
      },
      alerts: {
        outboxErrors,
        pendingPayouts: payoutsPending,
        contractsPendingSignature: contractsPending,
        expiredInvitations,
      },
      series,
      generatedAt: new Date().toISOString(),
    },
  })
})

// ------------------------------------------------------------------
// GET /api/admin/outbox-health
// ------------------------------------------------------------------
routerAdd('GET', '/api/admin/outbox-health', (e) => {
  if (!e.requestInfo().hasSuperuserAuth()) {
    throw new ForbiddenError('Cal autenticació de superusuari.')
  }
  const rows = $app.findRecordsByFilter('outbox', 'id != ""', '-created_at', 500, 0)
  const byStatus = {}
  const errors = []
  for (const r of rows) {
    const st = r.get('status') || '—'
    byStatus[st] = (byStatus[st] || 0) + 1
    if ((st === 'error' || st === 'dead') && errors.length < 50) {
      errors.push({
        id: r.id,
        entity: r.get('entity'),
        entity_id: r.get('entity_id'),
        action: r.get('action'),
        status: st,
        attempts: r.get('attempts') || 0,
        last_error: r.get('last_error') || '',
        updated_at: r.get('updated_at') || r.get('created'),
      })
    }
  }
  return e.json(200, { data: { total: rows.length, byStatus, errors } })
})

// ------------------------------------------------------------------
// POST /api/admin/outbox/{id}/retry
// ------------------------------------------------------------------
routerAdd('POST', '/api/admin/outbox/{id}/retry', (e) => {
  if (!e.requestInfo().hasSuperuserAuth()) {
    throw new ForbiddenError('Cal autenticació de superusuari.')
  }
  const id = e.request.pathValue('id')
  let row = null
  try { row = $app.findRecordById('outbox', id) } catch (_) { row = null }
  if (!row) throw new BadRequestError('Event no trobat.')
  row.set('status', 'pending')
  row.set('attempts', 0)
  row.set('last_error', '')
  $app.save(row)
  return e.json(200, { data: { id: row.id, status: 'pending' } })
})

// ------------------------------------------------------------------
// POST /api/admin/notifications/{id}/send  (entrega immediata)
// ------------------------------------------------------------------
routerAdd('POST', '/api/admin/notifications/{id}/send', (e) => {
  if (!e.requestInfo().hasSuperuserAuth()) {
    throw new ForbiddenError('Cal autenticació de superusuari.')
  }
  const id = e.request.pathValue('id')
  let n = null
  try { n = $app.findRecordById('notifications', id) } catch (_) { n = null }
  if (!n) throw new BadRequestError('Notificació no trobada.')

  const audience = n.get('audience') || 'all'
  const today = new Date().toISOString().slice(0, 10)
  const users = $app.findRecordsByFilter('partner_users', 'id != ""', '-created_at', 1000, 0)
  const deliveredCol = $app.findCollectionByNameOrId('notification_deliveries')
  let delivered = 0

  for (const u of users) {
    if (u.get('disabled')) continue
    if (u.get('role') !== 'partner') continue
    if (audience !== 'all') {
      let profile = null
      const partnerId = u.get('partner')
      if (partnerId) { try { profile = $app.findRecordById('partners', partnerId).get('profile') } catch (_) { profile = null } }
      if (audience === 'afiliats' && profile !== 'afiliat') continue
      if (audience === 'colaboradors' && profile !== 'colaborador') continue
    }
    const d = new Record(deliveredCol)
    d.set('notification', n.id)
    d.set('user', u.id)
    d.set('delivered_at', today)
    try {
      $app.save(d)
      delivered++
    } catch (_) { /* duplicat (unique notification+user) */ }
  }

  n.set('sent_at', today)
  n.set('status', 'sent')
  $app.save(n)
  $app.logger().info('[admin] notificació enviada', 'id', n.id, 'delivered', delivered)
  return e.json(200, { data: { id: n.id, delivered, status: 'sent' } })
})

// ------------------------------------------------------------------
// POST /api/admin/notification-rules/{id}/run  (força l'execució propera)
//   Per a regles PERIÒDIQUES: fixa next_run_at=ara perquè el cron la
//   processi al proper cicle. Les regles de SALDO s'avaluen soles.
// ------------------------------------------------------------------
routerAdd('POST', '/api/admin/notification-rules/{id}/run', (e) => {
  if (!e.requestInfo().hasSuperuserAuth()) {
    throw new ForbiddenError('Cal autenticació de superusuari.')
  }
  const id = e.request.pathValue('id')
  let rule = null
  try { rule = $app.findRecordById('notification_rules', id) } catch (_) { rule = null }
  if (!rule) throw new BadRequestError('Regla no trobada.')

  if (rule.get('trigger_type') === 'periodic') {
    rule.set('next_run_at', new Date().toISOString())
    $app.save(rule)
    $app.logger().info('[admin] regla programada per ara', 'id', rule.id)
    return e.json(200, { data: { queued: true, message: "S'executarà al proper cicle (≤15 min)." } })
  }
  return e.json(200, { data: { queued: false, message: "Aquesta regla s'avalua automàticament segons el saldo." } })
})

// ------------------------------------------------------------------
// POST /api/admin/payouts  (registra un pagament fet i el descompta)
//   Cos: { partner, amount, invoice_reference? }
//   Crea: payouts (status=pagada) + wallet_ledger (payout_deduction, -import)
//   i notifica el partner (in-app/push + email).
// ------------------------------------------------------------------
routerAdd('POST', '/api/admin/payouts', (e) => {
  if (!e.requestInfo().hasSuperuserAuth()) {
    throw new ForbiddenError('Cal autenticació de superusuari.')
  }
  const body = e.requestInfo().body || {}
  const partnerId = String(body.partner || '').trim()
  const amount = Number(body.amount)
  if (!partnerId) throw new BadRequestError('Cal indicar el partner.')
  if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestError('Import no vàlid.')

  let partner = null
  try { partner = $app.findRecordById('partners', partnerId) } catch (_) { partner = null }
  if (!partner) throw new BadRequestError('Partner no trobat.')

  const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100
  const amt = round2(amount)
  const nowIso = new Date().toISOString()
  const today = nowIso.slice(0, 10)
  const invoiceRef = String(body.invoice_reference || '').trim().slice(0, 100)

  // 1) Historial de la retirada (pagada)
  const payCol = $app.findCollectionByNameOrId('payouts')
  const p = new Record(payCol)
  p.set('partner', partnerId)
  p.set('amount', amt)
  if (invoiceRef) p.set('invoice_reference', invoiceRef)
  p.set('invoice_received_at', today)
  p.set('paid_at', today)
  p.set('status', 'pagada')
  $app.save(p)

  // 2) Descompte real a la cartera (ledger append-only, import negatiu)
  const ledCol = $app.findCollectionByNameOrId('wallet_ledger')
  const entry = new Record(ledCol)
  entry.set('partner', partnerId)
  entry.set('type', 'payout_deduction')
  entry.set('amount', -amt)
  entry.set('period', nowIso.slice(0, 7))
  entry.set('status', 'paid')
  entry.set('description', 'Retirada pagada' + (invoiceRef ? ' (factura ' + invoiceRef + ')' : ''))
  $app.save(entry)

  // 3) Notificació in-app + push al(s) usuari(s) del partner
  const amtTxt = amt.toFixed(2).replace('.', ',') + ' €'
  let users = []
  try { users = $app.findRecordsByFilter('partner_users', 'partner = {:p}', '', 200, 0, { p: partnerId }) } catch (_) { users = [] }
  users = users.filter((u) => u.get('role') === 'partner' && !u.get('disabled'))

  if (users.length) {
    try {
      const notifCol = $app.findCollectionByNameOrId('notifications')
      const n = new Record(notifCol)
      n.set('title', 'Pagament registrat')
      n.set('body', "S'ha registrat el pagament de " + amtTxt + ' a la vostra cartera.' + (invoiceRef ? ' (factura ' + invoiceRef + ')' : ''))
      n.set('audience', 'all')
      n.set('channel', 'both')
      n.set('status', 'sent')
      n.set('sent_at', nowIso)
      n.set('link', '/wallet')
      $app.save(n)
      const delCol = $app.findCollectionByNameOrId('notification_deliveries')
      for (const u of users) {
        const d = new Record(delCol)
        d.set('notification', n.id)
        d.set('user', u.id)
        d.set('delivered_at', today)
        try { $app.save(d) } catch (_) { }
      }
    } catch (err) {
      $app.logger().warn('[admin] notificacio payout no creada', 'error', String((err && err.message) || err))
    }

    // 4) Email (canal fiable encara que el push caduqui)
    try {
      const meta = ($app.settings() && $app.settings().meta) || {}
      const appURL = meta.appURL || 'https://prm.polser.cat'
      const senderName = meta.senderName || 'POLSER SEGURETAT'
      const senderAddress = meta.senderAddress || 'no-reply@polser.cat'
      for (const u of users) {
        const email = String(u.get('email') || '').trim()
        if (!email) continue
        try {
          const msg = new MailerMessage({
            from: { name: senderName, address: senderAddress },
            to: [{ address: email }],
            subject: 'Pagament registrat al Portal de Partners',
            html: '<p>Hola,</p>' +
              "<p>S'ha registrat el pagament de <strong>" + amtTxt + '</strong> a la vostra cartera del Portal de Partners.' + (invoiceRef ? ' (factura ' + invoiceRef + ')' : '') + '</p>' +
              '<p>Podeu consultar els moviments a <a href="' + appURL + '/wallet">' + appURL + '/wallet</a>.</p>',
          })
          $app.newMailClient().send(msg)
        } catch (err) {
          $app.logger().warn('[admin] email payout no enviat', 'user', u.id, 'error', String((err && err.message) || err))
        }
      }
    } catch (err) {
      $app.logger().warn('[admin] email payout', 'error', String((err && err.message) || err))
    }
  }

  $app.logger().info('[admin] payout registrat', 'partner', partnerId, 'amount', amt)
  return e.json(200, { data: { payout_id: p.id, ledger_id: entry.id, amount: amt } })
})

// ------------------------------------------------------------------
// POST /api/admin/users  (alta d'usuari del portal)
// ------------------------------------------------------------------
routerAdd('POST', '/api/admin/users', (e) => {
  if (!e.requestInfo().hasSuperuserAuth()) {
    throw new ForbiddenError('Cal autenticació de superusuari.')
  }
  const body = e.requestInfo().body || {}
  const email = String(body.email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestError('Correu electrònic no vàlid.')
  const allowedRoles = ['partner', 'POLSER_cpso', 'POLSER_admin', 'POLSER_ceo']
  const role = String(body.role || 'partner')
  if (allowedRoles.indexOf(role) === -1) throw new BadRequestError('Rol no vàlid.')

  let existing = null
  try { existing = $app.findFirstRecordByFilter('partner_users', 'email = {:email}', { email }) } catch (_) { }
  if (existing) throw new BadRequestError('Ja existeix un usuari amb aquest correu.')

  const col = $app.findCollectionByNameOrId('partner_users')
  const nu = new Record(col)
  nu.set('email', email)
  nu.set('verified', true)
  nu.set('role', role)
  nu.set('name', String(body.name || ''))
  nu.set('disabled', false)
  const partnerId = String(body.partner || '').trim()
  if (partnerId) nu.set('partner', partnerId)
  // La col·lecció auth exigeix `password` encara que passwordAuth estigui
  // desactivat (login per OTP): s'assigna una contrasenya aleatòria.
  nu.setRandomPassword()
  $app.save(nu)

  if (partnerId && role === 'partner') {
    try {
      const memCol = $app.findCollectionByNameOrId('partner_members')
      const mem = new Record(memCol)
      mem.set('partner', partnerId)
      mem.set('user', nu.id)
      mem.set('role_in_partner', 'owner')
      $app.save(mem)
    } catch (_) { /* vincle opcional */ }
  }

  return e.json(200, { data: { id: nu.id, email, role } })
})

// ------------------------------------------------------------------
// POST /api/admin/partners/invite  (alta/invitació de partner)
//   Replica la lògica de _invitations.pb.js però guardada per superusuari,
//   de manera que la INVITE_API_KEY no surt mai cap al navegador.
// ------------------------------------------------------------------
routerAdd('POST', '/api/admin/partners/invite', (e) => {
  if (!e.requestInfo().hasSuperuserAuth()) {
    throw new ForbiddenError('Cal autenticació de superusuari.')
  }
  const body = e.requestInfo().body || {}
  const name = String(body.name || '').trim()
  const email = String(body.email || '').trim().toLowerCase()
  if (!name) throw new BadRequestError('El nom és obligatori.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestError('Correu electrònic no vàlid.')

  let existingUser = null
  try { existingUser = $app.findFirstRecordByFilter('partner_users', 'email = {:email}', { email }) } catch (_) { }
  if (existingUser) throw new BadRequestError('Ja existeix un usuari del portal amb aquest correu.')

  let partner = null
  try { partner = $app.findFirstRecordByFilter('partners', 'email = {:email}', { email }) } catch (_) { }

  const token = $security.randomString(48)
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000)

  if (partner) {
    const status = partner.get('status')
    if (status === 'actiu') throw new BadRequestError('Aquest partner ja és actiu al portal.')
    if (status !== 'pendente') throw new BadRequestError('Estat del partner no permès per a invitació (' + status + ').')
    partner.set('invite_token', token)
    partner.set('invite_expires_at', expiresAt.toISOString())
    partner.set('invited_at', new Date().toISOString())
    $app.save(partner)
  } else {
    const col = $app.findCollectionByNameOrId('partners')
    const rec = new Record(col)
    rec.set('name', name)
    rec.set('email', email)
    rec.set('profile', 'afiliat')
    rec.set('type', 'otro')
    rec.set('status', 'pendente')
    rec.set('invite_token', token)
    rec.set('invite_expires_at', expiresAt.toISOString())
    rec.set('invited_at', new Date().toISOString())
    $app.save(rec)
    partner = rec
  }

  const settings = $app.settings()
  const meta = settings.meta || {}
  const appURL = meta.appURL || 'https://prm.polser.cat'
  const inviteUrl = appURL + '/registre?token=' + token

  let mailSent = false
  try {
    const senderName = meta.senderName || 'POLSER SEGURETAT'
    const senderAddress = meta.senderAddress || 'no-reply@polser.cat'
    const msg = new MailerMessage({
      from: { name: senderName, address: senderAddress },
      to: [{ address: email }],
      subject: 'Alta al Portal de Partners de POLSER SEGURETAT',
      html: '<p>Hola ' + name + ',</p>' +
        '<p>Has estat convidat a formar part de la xarxa de partners de POLSER SEGURETAT.</p>' +
        '<p>Per crear la teva fitxa i accedir al portal, obre aquest enllaç (caducitat 7 dies):</p>' +
        '<p><a href="' + inviteUrl + '">' + inviteUrl + '</a></p>' +
        '<p><strong>Afiliat: 60 € per alta.</strong></p>',
    })
    $app.newMailClient().send(msg)
    mailSent = true
  } catch (err) {
    $app.logger().warn('[admin] invitació: mail no enviat', 'error', String((err && err.message) || err))
  }

  $app.logger().info('[admin] partner convidat', 'id', partner.id, 'email', email)
  return e.json(200, {
    data: {
      partner_id: partner.id,
      email,
      invite_url: inviteUrl,
      expires_at: expiresAt.toISOString(),
      mail_sent: mailSent,
    },
  })
})

// ------------------------------------------------------------------
// POST /api/admin/audit  (registre d'auditoria del panell)
// ------------------------------------------------------------------
routerAdd('POST', '/api/admin/audit', (e) => {
  if (!e.requestInfo().hasSuperuserAuth()) {
    throw new ForbiddenError('Cal autenticació de superusuari.')
  }
  const body = e.requestInfo().body || {}
  const allowedActions = ['create', 'update', 'delete', 'invite', 'send', 'login', 'view_pii', 'other']
  const action = allowedActions.indexOf(String(body.action)) !== -1 ? String(body.action) : 'other'
  const col = $app.findCollectionByNameOrId('admin_audit')
  const rec = new Record(col)
  let actor = String(body.actor || '')
  try {
    if (!actor && e.auth && e.auth.email) actor = String(e.auth.email())
  } catch (_) { }
  rec.set('actor', actor.slice(0, 200))
  rec.set('action', action)
  rec.set('entity', String(body.entity || '').slice(0, 100))
  rec.set('entity_id', String(body.entity_id || '').slice(0, 100))
  if (body.payload && typeof body.payload === 'object') rec.set('payload', body.payload)
  try {
    const ip = e.request && e.request.remoteAddr ? String(e.request.remoteAddr) : ''
    if (ip) rec.set('ip', ip.slice(0, 64))
  } catch (_) { }
  $app.save(rec)
  return e.json(200, { data: { id: rec.id } })
})

// ------------------------------------------------------------------
// SEGURETAT: bloqueja l'accés dels comptes desactivats (OTP)
//   `disabled=true` impedeix demanar i validar codis OTP. Es comprova als
//   hooks d'OTP perquè la col·lecció `partner_users` no té passwordAuth.
// ------------------------------------------------------------------
onRecordRequestOTPRequest((e) => {
  const rec = e.record
  if (rec && rec.get('disabled')) {
    throw new ForbiddenError('Aquest compte està desactivat.')
  }
  return e.next()
}, 'partner_users')

onRecordAuthWithOTPRequest((e) => {
  const rec = e.record
  if (rec && rec.get('disabled')) {
    throw new ForbiddenError('Aquest compte està desactivat.')
  }
  return e.next()
}, 'partner_users')

/// <reference path="./types.d.ts" />
// =====================================================================
// P5 — Cron jobs (tots registrats amb cronAdd) + processador d'outbox
//   sync_odoo            */3 * * * *  processa l'outbox cap a Odoo
//   commission_monthly   0 3 1 * *    genera la recurrent del mes
//   payout_processor     */10 * * * * processa payout + factura inversa
//   notification_processor */5 * * * * campanyes queued -> sent (in-app)
//   cleanup              0 4 * * 0    neteja outbox antics
//
//  Aquest fitxer és l'ÚNIC propietari de la lògica d'outbox (CRÍTIC-1 /
//  MIG-3 de l'auditoria): helpers d'emissió, processadors reals cap a
//  Odoo i el cron sync_odoo que els executa. _outbox.pb.js (P2) només
//  encua events via hook; mai crida Odoo dins del request.
// =====================================================================

const MS_PER_DAY = 24 * 60 * 60 * 1000

// ------------------------------------------------------------------
// Helpers Odoo (JSON-RPC)
// ------------------------------------------------------------------
function odooRpc(service, method, args) {
  const url = $os.getenv('ODOO_URL')
  const res = $http.send({
    url: url + '/jsonrpc',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args } }),
    timeout: 30,
  })
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`Odoo HTTP ${res.statusCode}`)
  }
  if (res.json.error) {
    throw new Error(`Odoo RPC error: ${JSON.stringify(res.json.error)}`)
  }
  return res.json.result
}

function odooAuth() {
  const db = $os.getenv('ODOO_DB')
  const login = $os.getenv('ODOO_LOGIN')
  const apiKey = $os.getenv('ODOO_APIKEY')
  return odooRpc('common', 'authenticate', [db, login, apiKey])
}

function odooExecKw(uid, model, method, args, kwargs) {
  const db = $os.getenv('ODOO_DB')
  const apiKey = $os.getenv('ODOO_APIKEY')
  return odooRpc('object', 'execute_kw', [db, uid, apiKey, model, method, args, kwargs || {}])
}

// ------------------------------------------------------------------
// Helpers outbox
// ------------------------------------------------------------------
function enqueueOutbox(entity, entityId, action, payload) {
  const col = $app.findCollectionByNameOrId('outbox')
  const row = new Record(col)
  row.set('entity', entity)
  row.set('entity_id', entityId)
  row.set('action', action)
  row.set('payload', payload || {})
  row.set('status', 'pending')
  row.set('attempts', 0)
  $app.save(row)
}

function setOutbox(outboxId, fields) {
  const rec = $app.findRecordById('outbox', outboxId)
  for (const [k, v] of Object.entries(fields)) rec.set(k, v)
  $app.save(rec)
}

// ------------------------------------------------------------------
// Processament idempotent d'una fila outbox
// ------------------------------------------------------------------
function processCreateOpportunity(row, payload) {
  // crea/vincula la crm.lead a Odoo per odo_opportunity_id (idempotent)
  const uid = odooAuth()
  const referralId = payload.referral_id
  const referral = referralId ? $app.findRecordById('referrals', referralId) : null
  if (!referral) throw new Error('Referit no trobat')

  const referralCode = referral.get('referral_code')

  // si ja té oportunitat, res a fer
  if (referral.get('odo_opportunity_id')) {
    return { leadId: referral.get('odo_opportunity_id'), created: false }
  }

  // cerca el lead per prefix del codi (evita duplicats en reintents)
  const found = odooExecKw(uid, 'crm.lead', 'search', [['name', '=like', referralCode + '%']], { limit: 1 })
  let leadId = found && found.length ? found[0] : null

  if (!leadId) {
    const altaFee = referral.get('final_value') || referral.get('estimated_value') || 0
    const clientName = referral.get('client_name') || ''
    leadId = odooExecKw(uid, 'crm.lead', 'create', [{
      name: `${referralCode} · ${clientName}`,
      phone: referral.get('client_phone') || '',
      email_from: referral.get('client_email') || '',
      description: referral.get('notes') || '',
      expected_revenue: altaFee ? altaFee / 100 : 0, // cèntims -> euros
    }])
  }

  // write-back al referit
  referral.set('odo_opportunity_id', leadId)
  referral.set('odoo_sync_status', 'ok')
  $app.save(referral)

  // auditoria (compat)
  const logCol = $app.findCollectionByNameOrId('odoo_sync_log')
  const log = new Record(logCol)
  log.set('entity', 'referral')
  log.set('entity_id', referralId)
  log.set('action', 'create_opportunity')
  log.set('odoo_operation', 'crm.lead.create')
  log.set('status', 'ok')
  log.set('attempts', row.get('attempts'))
  $app.save(log)

  return { leadId, created: true }
}

function processPayout(row, payload) {
  // factura de proveïdor (create_vendor_bill) — opcional per fase
  const uid = odooAuth()
  const payoutId = payload.payout_id
  const payout = payoutId ? $app.findRecordById('payouts', payoutId) : null
  if (!payout) throw new Error('Payout no trobat')
  if (payout.get('odo_vendor_bill_id')) return { ok: true }

  const amount = payout.get('amount') / 100 // cèntims -> euros
  const billId = odooExecKw(uid, 'account.move', 'create', [{
    move_type: 'in_invoice',
    invoice_date: new Date().toISOString().slice(0, 10),
    line_ids: [[0, 0, { name: 'Retirada partner', quantity: 1, price_unit: amount }]],
  }])
  payout.set('odo_vendor_bill_id', billId)
  payout.set('status', 'en_proces')
  $app.save(payout)
  return { ok: true }
}

const PROCESSORS = {
  create_opportunity: processCreateOpportunity,
  create_vendor_bill: processPayout,
}

// ------------------------------------------------------------------
// Loop principal del cron: processa totes les outbox pending (REAL)
// ------------------------------------------------------------------
function processOutboxPending(limit = 50) {
  const pending = $app.findRecordsByFilter('outbox', "status = 'pending'", '-created', limit, 0)
  for (const row of pending) {
    const payload = (() => { try { return row.get('payload') } catch (_) { return {} } })() || {}
    try {
      const handler = PROCESSORS[row.get('action')]
      if (!handler) throw new Error(`Acció sense handler: ${row.get('action')}`)
      handler(row, payload)
      setOutbox(row.id, { status: 'ok', last_error: '' })
      $app.logger().info('[outbox] ok', 'id', row.id, 'action', row.get('action'))
    } catch (err) {
      const attempts = (row.get('attempts') || 0) + 1
      const maxAttempts = 5
      const dead = attempts >= maxAttempts
      $app.logger().error('[outbox] error', 'id', row.id, 'error', err.message)
      setOutbox(row.id, {
        status: dead ? 'dead' : 'error',
        attempts,
        last_error: String(err.message || err),
      })
    }
  }
  return pending.length
}

function monthKey(date) {
  return date.toISOString().slice(0, 7) // YYYY-MM
}

function settingsRecord() {
  return $app.findFirstRecordByFilter('settings', 'id != ""')
}

// ------------------------------------------------------------------
// commission_monthly — comissió recurrent del mes (base = Odoo)
// ------------------------------------------------------------------
function runCommissionMonthly() {
  const s = settingsRecord()
  if (!s.get('recurring_enabled')) return

  const period = monthKey(new Date())
  // referits amb subscripció activa (font Odoo) que poden generar recurrent
  const activeReferrals = $app.findRecordsByFilter('referrals', "active_subscription = true && status = 'instalado'", '-created', 1000, 0)

  for (const ref of activeReferrals) {
    const partnerId = ref.get('partner')
    if (!partnerId) continue
    let partner = null
    try { partner = $app.findRecordById('partners', partnerId) } catch (_) { continue }
    // perfil afiliat: MAI recurrent (regla CEO)
    if (partner.get('profile') === 'afiliat') continue

    // cerca la regla recurrent aplicable (espejo; el valor el dicta Odoo)
    const rule = findRecurringRule(partner.get('profile'), ref.get('service'))
    if (!rule || !rule.get('allow_recurring')) continue

    // base = quota mensual del servei (cèntims); fallback a estimat
    let base = 0
    if (ref.get('service')) {
      try {
        const svc = $app.findRecordById('services', ref.get('service'))
        base = svc.get('monthly_fee') || 0
      } catch (_) { /* sense servei */ }
    }
    if (!base) base = ref.get('estimated_value') || 0

    const rate = rule.get('rate') || s.get('default_recurring_rate') || 0
    const amount = Math.round(base * rate) // cèntims * rate

    // el hook recurring_unique evita duplicats del mateix període
    const col = $app.findCollectionByNameOrId('wallet_ledger')
    const entry = new Record(col)
    entry.set('partner', partnerId)
    entry.set('referral', ref.id)
    entry.set('type', 'recurring')
    entry.set('amount', amount)
    entry.set('period', period)
    entry.set('status', 'accrued')
    entry.set('description', `Comissió recurrent ${period} (ref. ${ref.get('referral_code') || ''})`)
    try {
      $app.save(entry)
    } catch (err) {
      // duplicat o error: es registra i es continua
      $app.logger().warn('[commission_monthly] entrada no creada', 'error', err.message)
    }
  }
}

function findRecurringRule(profile, serviceId) {
  const rules = $app.findRecordsByFilter('commission_rules', "kind = 'recurring' && active = true && (profile = {:p} || profile = 'all')", '-created', 50, 0, { p: profile })
  // prioritat: regla específica de servei, si no qualsevol (service null)
  if (serviceId) {
    const specific = rules.find((r) => r.get('service') && r.get('service') === serviceId)
    if (specific) return specific
  }
  return rules.find((r) => !r.get('service')) || rules[0] || null
}

// ------------------------------------------------------------------
// payout_processor — factura inversa i estats
// ------------------------------------------------------------------
function runPayoutProcessor() {
  const s = settingsRecord()
  const payoutDays = s.get('payout_days') || 15
  const now = new Date()

  // solicitada amb factura rebuda -> en_proces + enqueue factura proveïdor
  const toProcess = $app.findRecordsByFilter('payouts', "status = 'solicitada' && invoice_received_at != null", '-created', 200, 0)
  for (const p of toProcess) {
    p.set('status', 'en_proces')
    $app.save(p)
    enqueueOutbox('payout', p.id, 'create_vendor_bill', { payout_id: p.id })
  }

  // en_proces superat el termini -> pagada
  const toPay = $app.findRecordsByFilter('payouts', "status = 'en_proces' && invoice_received_at != null", '-created', 200, 0)
  for (const p of toPay) {
    const invDate = new Date(p.get('invoice_received_at')).getTime()
    if (now.getTime() - invDate >= payoutDays * MS_PER_DAY) {
      p.set('status', 'pagada')
      p.set('paid_at', now.toISOString().slice(0, 10)) // camp date (YYYY-MM-DD)
      $app.save(p)
    }
  }
}

// ------------------------------------------------------------------
// notification_processor — campanyes queued -> sent (in-app)
// ------------------------------------------------------------------
function runNotificationProcessor() {
  const nowIso = new Date().toISOString()
  const today = nowIso.slice(0, 10) // camps date (YYYY-MM-DD)
  const queued = $app.findRecordsByFilter('notifications', "status = 'queued' && (scheduled_at = null || scheduled_at <= {:now})", '-created', 50, 0, { now: nowIso })

  const users = $app.findRecordsByFilter('partner_users', 'id != ""', '-created', 500, 0)

  for (const n of queued) {
    const audience = n.get('audience') || 'all'
    const deliveredCol = $app.findCollectionByNameOrId('notification_deliveries')
    for (const u of users) {
      if (u.get('role') !== 'partner') continue
      // filtre per perfil
      if (audience !== 'all') {
        let profile = null
        if (u.get('partner')) {
          try { profile = $app.findRecordById('partners', u.get('partner')).get('profile') } catch (_) { }
        }
        if (audience === 'afiliats' && profile !== 'afiliat') continue
        if (audience === 'colaboradors' && profile !== 'colaborador') continue
      }
      const d = new Record(deliveredCol)
      d.set('notification', n.id)
      d.set('user', u.id)
      d.set('delivered_at', today)
      try { $app.save(d) } catch (_) { /* duplicat (unique) */ }
    }
    n.set('sent_at', today)
    n.set('status', 'sent')
    $app.save(n)
  }
}

// ------------------------------------------------------------------
// cleanup — neteja outbox antics
// ------------------------------------------------------------------
function runCleanup() {
  // outbox antics (ok/error/dead) >30 dies
  const oldOutbox = $app.findRecordsByFilter('outbox', "status != 'pending' && updated < {:cutoff}", '-created', 500, 0, {
    cutoff: new Date(Date.now() - 30 * MS_PER_DAY).toISOString(),
  })
  for (const r of oldOutbox) { try { $app.delete(r) } catch (_) { } }
}

// ------------------------------------------------------------------
// Registre dels crons
// ------------------------------------------------------------------
cronAdd('sync_odoo', '*/3 * * * *', () => {
  try { processOutboxPending() } catch (err) { $app.logger().error('[cron:sync_odoo]', 'error', err.message) }
})

cronAdd('commission_monthly', '0 3 1 * *', () => {
  try { runCommissionMonthly() } catch (err) { $app.logger().error('[cron:commission_monthly]', 'error', err.message) }
})

cronAdd('payout_processor', '*/10 * * * *', () => {
  try { runPayoutProcessor() } catch (err) { $app.logger().error('[cron:payout_processor]', 'error', err.message) }
})

cronAdd('notification_processor', '*/5 * * * *', () => {
  try { runNotificationProcessor() } catch (err) { $app.logger().error('[cron:notification_processor]', 'error', err.message) }
})

cronAdd('cleanup', '0 4 * * 0', () => {
  try { runCleanup() } catch (err) { $app.logger().error('[cron:cleanup]', 'error', err.message) }
})

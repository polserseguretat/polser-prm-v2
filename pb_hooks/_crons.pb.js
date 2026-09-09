/// <reference path="./types.d.ts" />
// =====================================================================
// P5 — Cron jobs (tots registrats amb cronAdd)
//   sync_odoo            */3 * * * *  processa l'outbox cap a Odoo
//   commission_monthly   0 3 1 * *    genera la recurrent del mes
//   payout_processor     */10 * * * * processa payout + factura inversa
//   notification_processor */5 * * * * campanyes queued -> sent (in-app)
//   cleanup              0 4 * * 0    neteja outbox antics
// =====================================================================

const MS_PER_DAY = 24 * 60 * 60 * 1000

// ------------------------------------------------------------------
// Helpers outbox (inlined — cada fitxer .pb.js té scope propi)
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

function processOutboxPending(limit) {
  limit = limit || 50
  const pending = $app.findRecordsByFilter('outbox', "status = 'pending'", '-created', limit, 0)
  for (const row of pending) {
    const payload = (() => { try { return row.get('payload') } catch (_) { return {} } })() || {}
    try {
      // TODO: processar cada acció segons el type
      // Per ara marca ok per evitar reintents infinits
      const rec = $app.findRecordById('outbox', row.id)
      rec.set('status', 'ok')
      rec.set('last_error', '')
      $app.save(rec)
      $app.logger().info('[outbox] ok', 'id', row.id, 'action', row.get('action'))
    } catch (err) {
      const attempts = (row.get('attempts') || 0) + 1
      const maxAttempts = 5
      const dead = attempts >= maxAttempts
      $app.logger().error('[outbox] error', 'id', row.id, 'error', err.message)
      const rec = $app.findRecordById('outbox', row.id)
      rec.set('status', dead ? 'dead' : 'error')
      rec.set('attempts', attempts)
      rec.set('last_error', String(err.message || err))
      $app.save(rec)
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
      p.set('paid_at', now.toISOString())
      $app.save(p)
    }
  }
}

// ------------------------------------------------------------------
// notification_processor — campanyes queued -> sent (in-app)
// ------------------------------------------------------------------
function runNotificationProcessor() {
  const now = new Date().toISOString()
  const queued = $app.findRecordsByFilter('notifications', "status = 'queued' && (scheduled_at = null || scheduled_at <= {:now})", '-created', 50, 0, { now })

  const users = $app.findAllRecords('partner_users') // actius
  const userCol = $app.findCollectionByNameOrId('partner_users')

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
      d.set('delivered_at', now)
      try { $app.save(d) } catch (_) { /* duplicat (unique) */ }
    }
    n.set('sent_at', now)
    n.set('status', 'sent')
    $app.save(n)
  }
}

// ------------------------------------------------------------------
// cleanup — neteja auth_otps i outbox antics
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

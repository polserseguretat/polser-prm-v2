/// <reference path="./types.d.ts" />
// =====================================================================
// P2 — Outbox i expedidor de sync amb Odoo (substitueix n8n)
//   - outbox_emit: hook que escriu una fila a `outbox` (mai crida Odoo
//     dins del request del portal).
//   - processOutboxPending: funció que crida a Odoo (idempotent per
//     odo_opportunity_id) i marca la fila ok / error / dead. La crida
//     el cron sync_odoo (P5) cada 3 minuts.
// =====================================================================

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
// Processament idempotent d'una fila outbox
// ------------------------------------------------------------------
function setOutbox(outboxId, fields) {
  const rec = $app.findRecordById('outbox', outboxId)
  for (const [k, v] of Object.entries(fields)) rec.set(k, v)
  $app.save(rec)
}

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
// Loop principal del cron: processa totes les outbox pending
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

// ------------------------------------------------------------------
// outbox_emit — hook d'alta de referit (append a la cua, res de HTTP)
// ------------------------------------------------------------------
onRecordAfterCreateSuccess((e) => {
  const col = $app.findCollectionByNameOrId('outbox')
  const row = new Record(col)
  row.set('entity', 'referral')
  row.set('entity_id', e.record.id)
  row.set('action', 'create_opportunity')
  row.set('payload', { referral_id: e.record.id })
  row.set('status', 'pending')
  row.set('attempts', 0)
  $app.save(row)
}, 'referrals')

// exposa les funcions compartides a la resta de fitxers de hooks (crons)
globalThis.processOutboxPending = processOutboxPending
globalThis.enqueueOutbox = (entity, entityId, action, payload) => {
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

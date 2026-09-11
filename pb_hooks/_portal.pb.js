// =====================================================================
// P6 — API del Portal de Partners (/api/portal/*)
// Totes les rutes requereixen autenticació d'un usuari `partner_users`
// amb `partner` assignat. RGPD: mai s'exposen camps client_*.
//
// FIX (2026-09-10): a PB 0.40.3 els handlers dels hooks s'executen en un
// context aïllat on NO són visibles funcions/const top-level del fitxer
// (ni globalThis ni propietats en objectes injectats). Per això cada ruta
// és TOTALMENT AUTOCONTINGUDA: la validació del partner i la serialització
// segura es fan inline dins del callback. Només es fan servir globals
// injectats per PB ($app, $os, $security, Record, ForbiddenError...).
// =====================================================================

// ------------------------------------------------------------------
// GET /api/portal/me
// ------------------------------------------------------------------
routerAdd('GET', '/api/portal/me', (e) => {
  const auth = e.auth
  if (!auth) throw new ForbiddenError('Autenticació requerida.')
  const partner = auth.get('partner')
  if (!partner) throw new ForbiddenError("L'usuari no té cap partner assignat.")
  let partnerRec = null
  try { partnerRec = $app.findRecordById('partners', partner) } catch (_) { }
  return e.json(200, {
    data: {
      user: { id: auth.id, email: auth.email(), role: auth.get('role') },
      partner: partnerRec ? partnerRec.publicExport() : null,
    },
  })
}, $apis.requireAuth('partner_users'))

// ------------------------------------------------------------------
// GET /api/portal/services
// ------------------------------------------------------------------
routerAdd('GET', '/api/portal/services', (e) => {
  const rows = $app.findRecordsByFilter('services', 'active = true', 'name', 200, 0)
  return e.json(200, { data: rows.map((r) => r.publicExport()) })
}, $apis.requireAuth('partner_users'))

// ------------------------------------------------------------------
// GET /api/portal/referrals  (sols del partner, sense dades personals)
// ------------------------------------------------------------------
routerAdd('GET', '/api/portal/referrals', (e) => {
  const auth = e.auth
  if (!auth) throw new ForbiddenError('Autenticació requerida.')
  const partner = auth.get('partner')
  if (!partner) throw new ForbiddenError("L'usuari no té cap partner assignat.")
  const rows = $app.findRecordsByFilter('referrals', 'partner = {:partner}', ' -created_at', 500, 0, { partner })
  return e.json(200, {
    data: rows.map((r) => ({
      id: r.id, partner: r.get('partner'), referral_code: r.get('referral_code'),
      service: r.get('service'), service_type: r.get('service_type'), status: r.get('status'),
      stage_date: r.get('stage_date'), estimated_value: r.get('estimated_value'), source: r.get('source'),
      created_at: r.get('created'), updated_at: r.get('updated_at'),
    })),
  })
}, $apis.requireAuth('partner_users'))

// ------------------------------------------------------------------
// GET /api/portal/referrals/{id}
//   Només el partner propietari (validat). El partner veu les dades del
//   client que ELL mateix ha introduït (legítim), el servei triat i
//   l'estat de sincronització amb Odoo. RGPD: client_* only per propietari.
// ------------------------------------------------------------------
routerAdd('GET', '/api/portal/referrals/{id}', (e) => {
  const auth = e.auth
  if (!auth) throw new ForbiddenError('Autenticació requerida.')
  const partner = auth.get('partner')
  if (!partner) throw new ForbiddenError("L'usuari no té cap partner assignat.")
  const id = e.request.pathValue('id')
  let rec = null
  try { rec = $app.findRecordById('referrals', id) } catch (_) { }
  if (!rec || rec.get('partner') !== partner) throw new ForbiddenError('Referit no trobat.')

  // Servei triat, expandit (nom, categoria, sector, imports, IVA)
  let service = null
  const serviceId = rec.get('service')
  if (serviceId) {
    try {
      const s = $app.findRecordById('services', serviceId)
      service = { id: s.id, code: s.get('code'), name: s.get('name'), category: s.get('category'),
        sector: s.get('sector'), alta_fee: s.get('alta_fee'), monthly_fee: s.get('monthly_fee'),
        iva_included: s.get('iva_included') }
    } catch (_) { }
  }

  return e.json(200, {
    data: {
      id: rec.id, partner: rec.get('partner'), referral_code: rec.get('referral_code'),
      service, service_type: rec.get('service_type'), status: rec.get('status'),
      stage_date: rec.get('stage_date'), estimated_value: rec.get('estimated_value'),
      final_value: rec.get('final_value'), source: rec.get('source'),
      // Client (propi) + notes
      client_name: rec.get('client_name'), client_phone: rec.get('client_phone'),
      client_email: rec.get('client_email'), client_address: rec.get('client_address'),
      notes: rec.get('notes'),
      // Sincronització amb Odoo
      odo_opportunity_id: rec.get('odo_opportunity_id'), odo_customer_id: rec.get('odo_customer_id'),
      odo_sale_id: rec.get('odo_sale_id'), odoo_sync_status: rec.get('odoo_sync_status'),
      created_at: rec.get('created'), updated_at: rec.get('updated_at'),
    },
  })
}, $apis.requireAuth('partner_users'))

// ------------------------------------------------------------------
// GET /api/portal/referrals/{id}/events
// ------------------------------------------------------------------
routerAdd('GET', '/api/portal/referrals/{id}/events', (e) => {
  const auth = e.auth
  if (!auth) throw new ForbiddenError('Autenticació requerida.')
  const partner = auth.get('partner')
  if (!partner) throw new ForbiddenError("L'usuari no té cap partner assignat.")
  const id = e.request.pathValue('id')
  let rec = null
  try { rec = $app.findRecordById('referrals', id) } catch (_) { }
  if (!rec || rec.get('partner') !== partner) throw new ForbiddenError('Referit no trobat.')
  const events = $app.findRecordsByFilter('referral_events', 'referral = {:id}', 'created_at', 500, 0, { id })
  return e.json(200, {
    data: events.map((ev) => ({
      id: ev.id, from_status: ev.get('from_status'), to_status: ev.get('to_status'),
      reason: ev.get('reason'), lost_reason: ev.get('lost_reason'), created_at: ev.get('created'),
    })),
  })
}, $apis.requireAuth('partner_users'))

// ------------------------------------------------------------------
// POST /api/portal/referrals  (crea lead; l'hook outbox_emit l'encua)
// ------------------------------------------------------------------
routerAdd('POST', '/api/portal/referrals', (e) => {
  const auth = e.auth
  if (!auth) throw new ForbiddenError('Autenticació requerida.')
  const partner = auth.get('partner')
  if (!partner) throw new ForbiddenError("L'usuari no té cap partner assignat.")
  const body = e.requestInfo().body || {}
  const clientName = String(body.client_name || '').trim()
  const service = String(body.service || '').trim()
  if (!clientName || !service) throw new BadRequestError('client_name i service són obligatoris.')

  const referralCode = 'REF-' + $security.randomString(6).toUpperCase()

  const col = $app.findCollectionByNameOrId('referrals')
  const rec = new Record(col)
  rec.set('partner', partner)
  rec.set('referral_code', referralCode)
  rec.set('client_name', clientName)
  rec.set('client_phone', body.client_phone ? String(body.client_phone) : '')
  rec.set('client_email', body.client_email ? String(body.client_email) : '')
  rec.set('client_address', body.client_address ? String(body.client_address) : '')
  rec.set('service', service)
  rec.set('service_type', body.service_type ? String(body.service_type) : '')
  rec.set('notes', body.notes ? String(body.notes) : '')
  rec.set('source', 'portal')
  rec.set('status', 'lead')
  rec.set('stage_date', new Date().toISOString().slice(0, 10)) // camp date (YYYY-MM-DD)
  rec.set('odoo_sync_status', 'pendiente')
  rec.set('active_subscription', false)
  rec.set('self_referral', false)
  $app.save(rec)

  $app.logger().info('[portal] referit creat', 'code', referralCode, 'partner', partner)
  return e.json(200, {
    data: {
      id: rec.id, partner: rec.get('partner'), referral_code: rec.get('referral_code'),
      service: rec.get('service'), service_type: rec.get('service_type'), status: rec.get('status'),
      stage_date: rec.get('stage_date'), estimated_value: rec.get('estimated_value'), source: rec.get('source'),
      created_at: rec.get('created'), updated_at: rec.get('updated_at'),
    },
  })
}, $apis.requireAuth('partner_users'))

// ------------------------------------------------------------------
// GET /api/portal/wallet
// ------------------------------------------------------------------
routerAdd('GET', '/api/portal/wallet', (e) => {
  const auth = e.auth
  if (!auth) throw new ForbiddenError('Autenticació requerida.')
  const partner = auth.get('partner')
  if (!partner) throw new ForbiddenError("L'usuari no té cap partner assignat.")
  const rows = $app.findRecordsByFilter('wallet_ledger', 'partner = {:partner}', ' -created_at', 1000, 0, { partner })
  return e.json(200, {
    data: rows.map((r) => ({
      id: r.id, type: r.get('type'), amount: r.get('amount'), period: r.get('period'),
      status: r.get('status'), description: r.get('description'), created_at: r.get('created'),
    })),
  })
}, $apis.requireAuth('partner_users'))

// ------------------------------------------------------------------
// POST /api/portal/payouts
// ------------------------------------------------------------------
routerAdd('POST', '/api/portal/payouts', (e) => {
  const auth = e.auth
  if (!auth) throw new ForbiddenError('Autenticació requerida.')
  const partner = auth.get('partner')
  if (!partner) throw new ForbiddenError("L'usuari no té cap partner assignat.")
  const body = e.requestInfo().body || {}
  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestError('Quantitat no vàlida.')

  const col = $app.findCollectionByNameOrId('payouts')
  const p = new Record(col)
  p.set('partner', partner)
  p.set('amount', Math.round(amount)) // cèntims
  p.set('status', 'solicitada')
  $app.save(p)
  return e.json(200, { data: { id: p.id, amount: p.get('amount'), status: p.get('status'), created_at: p.get('created') } })
}, $apis.requireAuth('partner_users'))

// ------------------------------------------------------------------
// GET /api/portal/documents  (publicats)
// ------------------------------------------------------------------
routerAdd('GET', '/api/portal/documents', (e) => {
  const rows = $app.findRecordsByFilter('documents', 'published = true', ' -updated_at', 200, 0)
  return e.json(200, {
    data: rows.map((r) => {
      const filename = r.get('file') || ''
      return {
        id: r.id, title: r.get('title'), type: r.get('type'), category: r.get('category'),
        file: filename ? `/api/files/documents/${r.id}/${filename}` : null,
        version: r.get('version'), updated_at: r.get('updated_at'),
      }
    }),
  })
}, $apis.requireAuth('partner_users'))

// ------------------------------------------------------------------
// GET /api/portal/notifications  (enviades)
// ------------------------------------------------------------------
routerAdd('GET', '/api/portal/notifications', (e) => {
  const rows = $app.findRecordsByFilter('notifications', "status = 'sent'", ' -created_at', 200, 0)
  return e.json(200, {
    data: rows.map((r) => ({ id: r.id, title: r.get('title'), body: r.get('body'), image: r.get('image'), created_at: r.get('created') })),
  })
}, $apis.requireAuth('partner_users'))
// =====================================================================
// P5 — Cron jobs (tots registrats amb cronAdd) + processador d'outbox
//   sync_odoo            */3 * * * *  processa l'outbox cap a Odoo
//   commission_monthly   0 3 1 * *    genera la recurrent del mes
//   payout_processor     */10 * * * * processa payout + factura inversa
//   notification_processor */5 * * * * campanyes queued -> sent (in-app)
//   odoo_two_way_sync    */5 * * * *  Odoo->PRM: etapa + comissions de partner
//   cleanup              0 4 * * 0    neteja outbox antics
//
//  FIX (2026-09-10): a PB 0.40.3 els handlers dels hooks s'executen en un
//  context aïllat on NO són visibles les funcions top-level del fitxer.
//  Per això cada cron és TOTALMENT AUTOCONTINGUT (lògica inline dins del
//  callback cronAdd). Només es fan servir globals injectats per PB.
//
//  Aquest fitxer és l'ÚNIC propietari de la lògica d'outbox cap a Odoo.
//  _outbox.pb.js (P2) només encua events; mai crida Odoo dins del request.
// =====================================================================

// ------------------------------------------------------------------
// sync_odoo — processa outbox pending cap a Odoo (JSON-2 a /json/2,
//             idempotent per odo_opportunity_id)
// ------------------------------------------------------------------
cronAdd('sync_odoo', '*/3 * * * *', () => {
  try {
    const MAX_ATTEMPTS = 5
    // arrodoniment monetari a 2 decimals (euros) — PRM treballa en euros
    const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

    // External JSON-2 API (Odoo 19+). Autentica amb Authorization: Bearer
    // <API key> a cada request (NO hi ha authenticate/uid/execute_kw com al
    // JSON-RPC deprecated. Els args són nomenats, no posicionals.
    function odooJson2(model, method, payload) {
      const res = $http.send({
        url: $os.getenv('ODOO_URL') + '/json/2/' + model + '/' + method,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + $os.getenv('ODOO_APIKEY'),
          'x-odoo-database': $os.getenv('ODOO_DB'),
          'user-agent': 'polser-prm',
        },
        body: JSON.stringify(payload),
        timeout: 30,
      })
      if (res.statusCode < 200 || res.statusCode >= 300) {
        let odooErr = ''
        try { odooErr = (res.json && res.json.message) || JSON.stringify(res.json || {}).slice(0, 500) } catch (_) { odooErr = JSON.stringify(res.json || {}).slice(0, 500) }
        throw new Error(`Odoo HTTP ${res.statusCode}: ${odooErr}`)
      }
      return res.json
    }
    const setOutbox = (id, fields) => { const rec = $app.findRecordById('outbox', id); for (const [k, v] of Object.entries(fields)) rec.set(k, v); $app.save(rec) }

    const pending = $app.findRecordsByFilter('outbox', "status = 'pending'", ' -created_at', 50, 0)
    for (const row of pending) {
      const action = row.get('action')
      // IMPORTANT (PocketBase JSVM): al hook, record.get('payload') retorna la
      // STRING JSON crua (NO l'objecte deserialitzat com fa l'API REST). Cal
      // JSON.parse explícit. Sense això, payload.referral_id es undefined i es
      // llançava "Referit no trobat" malgrat que el referit existeix.
      let payload = {}
      try {
        const raw = row.get('payload')
        payload = (typeof raw === 'string') ? JSON.parse(raw) : (raw || {})
      } catch (_) { payload = {} }
      try {
        if (action === 'create_opportunity') {
          // Font de veritat de l'ID del referit: entity_id del registre outbox
          // (camp text, sempre fiable). payload.referral_id com a fallback.
          const referralId = row.get('entity_id') || payload.referral_id
          let referral = null
          try { referral = referralId ? $app.findRecordById('referrals', referralId) : null } catch (refErr) { referral = null }
          if (!referral) throw new Error('Referit no trobat')
          const referralCode = referral.get('referral_code')
          if (!referral.get('odo_opportunity_id')) {
            const found = odooJson2('crm.lead', 'search', { domain: [['name', '=like', referralCode + '%']], limit: 1 })
            let leadId = Array.isArray(found) && found.length ? found[0] : null
            if (!leadId) {
              // Dades del servei seleccionat (expected_revenue / recurring_revenue)
              let altaFee = referral.get('final_value') || referral.get('estimated_value') || 0
              let monthlyFee = 0
              const serviceId = referral.get('service')
              let service = null
              try { service = serviceId ? $app.findRecordById('services', serviceId) : null } catch (_) { }
              if (service) {
                altaFee = service.get('alta_fee') || altaFee
                monthlyFee = service.get('monthly_fee') || 0
              }
              // 'referred' = nom del partner que ha referit (col·laborador/afiliat)
              let referredName = ''
              let referredProfile = ''   // afiliat | colaborador (regla CEO: afiliat mai recurrent)
              const partnerId = referral.get('partner')
              try {
                const partner = partnerId ? $app.findRecordById('partners', partnerId) : null
                referredName = partner ? (partner.get('name') || '') : ''
                referredProfile = partner ? (partner.get('profile') || '') : ''
              } catch (_) { }
              // Descripció = detalls del servei plantejat al portal + notes.
              // El servei dóna: code, name, category, sector, alta_fee,
              // monthly_fee (en euros) i iva_included.
              const serCode = service ? (service.get('code') || '') : ''
              const serName = service ? (service.get('name') || '') : ''
              const serCat = service ? (service.get('category') || '') : ''
              const serSector = service ? (service.get('sector') || '') : ''
              const serAlta = service ? (service.get('alta_fee') || 0) : (altaFee || 0) // euros
              const serIva = service ? (service.get('iva_included') ? 'IVA inclòs' : 'sense IVA inclòs') : ''
              let descriptionTxt = `Servei: ${serName || serCode || '—'}`
              if (serCode) descriptionTxt += ` (${serCode})`
              if (serCat) descriptionTxt += `\nCategoria: ${serCat}`
              if (serSector) descriptionTxt += `\nSector: ${serSector}`
              if (serAlta) descriptionTxt += `\nAlta: ${serAlta.toFixed(2)} €`
              if (monthlyFee) descriptionTxt += `\nQuota mensual: ${(monthlyFee || 0).toFixed(2)} €`
              if (serIva) descriptionTxt += `\nIVA: ${serIva}`
              const rawNotes = referral.get('notes') || ''
              if (rawNotes) descriptionTxt += `\n\nNotes: ${rawNotes}`

              // ------------------------------------------------------
              // Comissions del partner -> camps x_studio del crm.lead
              //  - x_studio_colab_comision_de_alta: comissió fixa d'alta
              //    (60 € IVA inclòs), mateixa per a tots dos perfils.
              //  - x_studio_colab_comision_recurrente: ~10% de la quota,
              //    SOLS per perfil Col·laborador (PIME). REGLA CEO
              //    (08/09/2026): un afiliat MAI té commissió recurrent => 0.
              // ------------------------------------------------------
              const wSettings = (() => { try { return $app.findFirstRecordByFilter('settings', 'id != ""') } catch (_) { return null } })()
              const defaultFixed = (wSettings && wSettings.get('default_fixed_commission')) || 60 // euros
              const defaultRate = (wSettings && wSettings.get('default_recurring_rate')) || 0.10
              const comisionAlta = defaultFixed // euros, per a tots els perfils
              let comisionRecurrente = 0
              if (referredProfile !== 'afiliat' && monthlyFee > 0) {
                let rate = defaultRate
                try {
                  const rules = $app.findRecordsByFilter('commission_rules', "kind = 'recurring' && active = true && (profile = {:p} || profile = 'all')", ' -created_at', 50, 0, { p: referredProfile })
                  const nf = rules.find((r) => !r.get('service')) || rules[0]
                  if (serviceId) { const sp = rules.find((r) => r.get('service') && r.get('service') === serviceId); if (sp && sp.get('rate') != null) rate = sp.get('rate') }
                  else if (nf && nf.get('rate') != null) rate = nf.get('rate')
                } catch (_) { /* queda defaultRate */ }
                comisionRecurrente = round2(monthlyFee * rate)
              }

              // IMPORTANT: els IDs de BD d'Odoo (team/stage/recurring) i els
              // imports deuen ser ENTERS (no strings). $os.getenv sempre torna
              // strings, així que fem Number() explícit.
              const ODOO_TEAM_ID = Number($os.getenv('ODOO_TEAM_ID')) || 9
              const ODOO_STAGE_ID = Number($os.getenv('ODOO_STAGE_ID')) || 13
              leadId = odooJson2('crm.lead', 'create', { vals_list: [{
                name: `${referralCode} · ${referral.get('client_name') || ''}`,
                email_from: referral.get('client_email') || '',
                phone: referral.get('client_phone') || '',
                contact_name: referral.get('client_name') || '',
                referred: referredName,
                expected_revenue: altaFee ? altaFee : 0,   // EUR (el PRM emmagatzema euros, 2 dec)
                recurring_plan: 1,        // "Mensualment" — ID numèric de la BD Odoo
                recurring_revenue: monthlyFee ? monthlyFee : 0, // EUR, segons servei
                x_studio_colab_comision_de_alta: comisionAlta,       // € — comissió fixa per alta
                x_studio_colab_comision_recurrente: comisionRecurrente, // € — 10% quota (0 si afiliat)
                stage_id: ODOO_STAGE_ID,      // "Nou referit"
                team_id: ODOO_TEAM_ID,        // "PRM" — sempre aquest
                description: descriptionTxt,
              }] })
            }
            // Normalitzem l'ID retornat a enter positiu. Si no és vàlid (0,
            // undefined, objecte), llancem en lloc de gravar un fals 'ok'.
            let leadIdNum = parseInt(Array.isArray(leadId) ? leadId[0] : leadId, 10)
            if (!leadIdNum || isNaN(leadIdNum)) throw new Error('Odoo no ha retornat un ID d\'oportunitat vàlid: ' + JSON.stringify(leadId))
            referral.set('odo_opportunity_id', leadIdNum)
            // Llegim el client (partner_id) associat a la lead a Odoo. Si la
            // lead no té cap client associat (partner_id buit), no toca res.
            try {
              const custRead = odooJson2('crm.lead', 'search_read', { domain: [['id', '=', leadIdNum]], fields: ['partner_id'] })
              const custList = Array.isArray(custRead) ? custRead : (custRead && custRead.items) || []
              const rm = custList && custList[0]
              let custId = rm ? rm.partner_id : null
              if (Array.isArray(custId)) custId = custId[0]
              custId = parseInt(custId, 10)
              if (custId && !isNaN(custId)) referral.set('odo_customer_id', custId)
            } catch (_) { /* si no es pot llegir, seguim sense client */ }
            referral.set('odoo_sync_status', 'ok')
            $app.save(referral)
          }
        } else if (action === 'create_vendor_bill') {
          const payoutId = payload.payout_id
          const payout = payoutId ? $app.findRecordById('payouts', payoutId) : null
          if (!payout) throw new Error('Payout no trobat')
          if (!payout.get('odo_vendor_bill_id')) {
            const amount = payout.get('amount') // euros (2 dec) — Odoo espera price_unit en euros
            const billId = odooJson2('account.move', 'create', { vals_list: [{
              move_type: 'in_invoice',
              invoice_date: new Date().toISOString().slice(0, 10),
              line_ids: [[0, 0, { name: 'Retirada partner', quantity: 1, price_unit: amount }]],
            }] })
            payout.set('odo_vendor_bill_id', billId)
            payout.set('status', 'en_proces')
            $app.save(payout)
          }
        } else {
          throw new Error(`Acció sense handler: ${action}`)
        }
        setOutbox(row.id, { status: 'ok', last_error: '' })
        $app.logger().info('[outbox] ok', 'id', row.id, 'action', action)
      } catch (err) {
        const attempts = (row.get('attempts') || 0) + 1
        const dead = attempts >= MAX_ATTEMPTS
        $app.logger().error('[outbox] error', 'id', row.id, 'action', action, 'error', err.message)
        setOutbox(row.id, { status: dead ? 'dead' : 'error', attempts, last_error: String(err.message || err) })
      }
    }
  } catch (err) {
    $app.logger().error('[cron:sync_odoo]', 'error', err.message)
  }
})

// ------------------------------------------------------------------
// commission_monthly — comissió recurrent del mes (base = Odoo)
// ------------------------------------------------------------------
cronAdd('commission_monthly', '0 3 1 * *', () => {
  try {
    const s = (() => { try { return $app.findFirstRecordByFilter('settings', 'id != ""') } catch (_) { return null } })()
    if (!s || !s.get('recurring_enabled')) return
    const period = new Date().toISOString().slice(0, 7)
    const activeReferrals = $app.findRecordsByFilter('referrals', "active_subscription = true && status = 'instalado'", ' -created_at', 1000, 0)

    function findRecurringRule(profile, serviceId) {
      const rules = $app.findRecordsByFilter('commission_rules', "kind = 'recurring' && active = true && (profile = {:p} || profile = 'all')", ' -created_at', 50, 0, { p: profile })
      if (serviceId) { const sp = rules.find((r) => r.get('service') && r.get('service') === serviceId); if (sp) return sp }
      return rules.find((r) => !r.get('service')) || rules[0] || null
    }

    const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

    for (const ref of activeReferrals) {
      const partnerId = ref.get('partner')
      if (!partnerId) continue
      let partner = null
      try { partner = $app.findRecordById('partners', partnerId) } catch (_) { continue }
      if (partner.get('profile') === 'afiliat') continue // regla CEO: autònoms/afiliats mai recurrent

      const rule = findRecurringRule(partner.get('profile'), ref.get('service'))
      if (!rule || !rule.get('allow_recurring')) continue

      let base = 0
      if (ref.get('service')) { try { base = $app.findRecordById('services', ref.get('service')).get('monthly_fee') || 0 } catch (_) { } }
      if (!base) base = ref.get('estimated_value') || 0
      const rate = rule.get('rate') || s.get('default_recurring_rate') || 0
      const amount = round2(base * rate) // euros (2 dec)

      const col = $app.findCollectionByNameOrId('wallet_ledger')
      const entry = new Record(col)
      entry.set('partner', partnerId)
      entry.set('referral', ref.id)
      entry.set('type', 'recurring')
      entry.set('amount', amount)
      entry.set('period', period)
      entry.set('status', 'accrued')
      entry.set('description', `Comissió recurrent ${period} (ref. ${ref.get('referral_code') || ''})`)
      try { $app.save(entry) } catch (err) { $app.logger().warn('[commission_monthly] entrada no creada', 'error', err.message) }
    }
  } catch (err) {
    $app.logger().error('[cron:commission_monthly]', 'error', err.message)
  }
})

// ------------------------------------------------------------------
// payout_processor — factura inversa i estats
// ------------------------------------------------------------------
cronAdd('payout_processor', '*/10 * * * *', () => {
  try {
    const MS_PER_DAY = 24 * 60 * 60 * 1000
    const s = (() => { try { return $app.findFirstRecordByFilter('settings', 'id != ""') } catch (_) { return null } })()
    const payoutDays = (s && s.get('payout_days')) || 15
    const now = new Date()

    // enqueue factura proveïdor per aquelles amb factura rebuda
    const toProcess = $app.findRecordsByFilter('payouts', "status = 'solicitada' && invoice_received_at != null", ' -created_at', 200, 0)
    for (const p of toProcess) {
      p.set('status', 'en_proces')
      $app.save(p)
      const col = $app.findCollectionByNameOrId('outbox')
      const row = new Record(col)
      row.set('entity', 'payout')
      row.set('entity_id', p.id)
      row.set('action', 'create_vendor_bill')
      row.set('payload', { payout_id: p.id })
      row.set('status', 'pending')
      row.set('attempts', 0)
      $app.save(row)
    }

    // pagar els que superen el termini
    const toPay = $app.findRecordsByFilter('payouts', "status = 'en_proces' && invoice_received_at != null", ' -created_at', 200, 0)
    for (const p of toPay) {
      const invDate = new Date(p.get('invoice_received_at')).getTime()
      if (now.getTime() - invDate >= payoutDays * MS_PER_DAY) {
        p.set('status', 'pagada')
        p.set('paid_at', now.toISOString().slice(0, 10))
        $app.save(p)
      }
    }
  } catch (err) {
    $app.logger().error('[cron:payout_processor]', 'error', err.message)
  }
})

// ------------------------------------------------------------------
// odoo_two_way_sync — sincronitza etapa (stage_id) i COMISSIONS de les
//                  leads a Odoo amb el referit al PRM.
//   Etapa (Odoo -> status de referrals) + comissions de partner
//   (x_studio_* a Odoo -> partner_commission_* a referrals).
//   Mapeig stage_id (Odoo) -> status (referrals):
//     13 "Nou referit"       -> lead
//     9  "Contactat"         -> contactado
//     10 "Pressupost"        -> presupuesto
//     11 "Acceptat"          -> aceptado
//     12 "Instal·lat/Actiu"  -> instalado
//   Quan l'etapa canvia, actualitza referral.status i enregistra un
//   referral_event (from_status -> to_status) per històric.
//   Eficient: una sola crida search_read amb id in [leads] (no N crides).
// ------------------------------------------------------------------
cronAdd('odoo_two_way_sync', '*/5 * * * *', () => {
  try {
    // arrodoniment monetari a 2 decimals (euros)
    const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
    // odooJson2 AUTOCONTINGUT: el JSVM de PB 0.40.3 aïlla els handlers, així
    // que cal definir-la aqui (la del sync_odoo no es visible des d'aquest).
    function odooJson2(model, method, payload) {
      const res = $http.send({
        url: $os.getenv('ODOO_URL') + '/json/2/' + model + '/' + method,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + $os.getenv('ODOO_APIKEY'),
          'x-odoo-database': $os.getenv('ODOO_DB'),
          'user-agent': 'polser-prm',
        },
        body: JSON.stringify(payload),
        timeout: 30,
      })
      if (res.statusCode < 200 || res.statusCode >= 300) {
        let odooErr = ''
        try { odooErr = (res.json && res.json.message) || JSON.stringify(res.json || {}).slice(0, 500) } catch (_) { odooErr = JSON.stringify(res.json || {}).slice(0, 500) }
        throw new Error(`Odoo HTTP ${res.statusCode}: ${odooErr}`)
      }
      return res.json
    }
    const STAGE_TO_STATUS = {
      13: 'lead',
      9: 'contactado',
      10: 'presupuesto',
      11: 'aceptado',
      12: 'instalado',
    }

    // 1. Referits sincronitzats amb Odoo (tenen odo_opportunity_id != 0)
    //    i que ENCARA no han arribat a 'instalado' (final del pipeline, ja
    //    no cal tornar a consultar l'etapa a Odoo).
    const synced = $app.findRecordsByFilter('referrals', "odo_opportunity_id != 0 && odo_opportunity_id != '' && status != 'instalado'", ' -created_at', 500, 0)
    const leadIds = []
    for (const r of synced) {
      const lid = parseInt(r.get('odo_opportunity_id'), 10)
      if (lid && leadIds.indexOf(lid) === -1) leadIds.push(lid)
    }
    if (!leadIds.length) return
    $app.logger().info('[odoo_two_way_sync] leads sincronitzades', 'count', leadIds.length)

    // 2. Llegeix stage_id i partner_id (client associat) de totes les leads
    //    en una sola crida JSON/2. El partner_id pot crear-se durant el funnel.
    const rows = odooJson2('crm.lead', 'search_read', { domain: [['id', 'in', leadIds]], fields: ['stage_id', 'partner_id', 'x_studio_colab_comision_de_alta', 'x_studio_colab_comision_recurrente', 'won_status', 'lost_reason_id'] })

    // rows pot ser array directe o estar embolcallat.
    const list = Array.isArray(rows) ? rows : (rows && rows.items) || []
    const stageByLead = {}
    const custByLead = {}
    const commByLead = {}
    const lostByLead = {}
    const lostReasonByLead = {}
    for (const e of list) {
      // stage_id pot venir com [id, nom] (tupla) o directament l'id (int)
      const sid = e.id
      let stage = e.stage_id
      if (Array.isArray(stage)) stage = stage[0]
      if (sid != null) stageByLead[sid] = parseInt(stage, 10)
      // partner_id: [id, nom] o directament l'id
      let cust = e.partner_id
      if (Array.isArray(cust)) cust = cust[0]
      cust = parseInt(cust, 10)
      if (sid != null) custByLead[sid] = (cust && !isNaN(cust)) ? cust : null
      // Comissions del partner (camps x_studio a Odoo): nul·les si buides
      if (sid != null) {
        const a = e.x_studio_colab_comision_de_alta
        const r = e.x_studio_colab_comision_recurrente
        commByLead[sid] = {
          alta: (a == null || a === '') ? null : Number(a),
          rec: (r == null || r === '') ? null : Number(r),
        }
        // Lead perduda a Odoo: `won_status` = 'lost' i motiu a `lost_reason_id`
        // (many2one -> [id, nom]). Ex.: won_status='lost', lost_reason_id=[1,"Molt car"].
        // Fallback: si hi ha un lost_reason_id assignat, considerem la lead perduda
        // (cobreix casos on won_status no arriba de forma fiable).
        const hasLostReason = e.lost_reason_id != null &&
          String(e.lost_reason_id) !== '' && String(e.lost_reason_id) !== 'false'
        lostByLead[sid] = String(e.won_status || '') === 'lost' || hasLostReason
        let lr = ''
        if (Array.isArray(e.lost_reason_id)) lr = String(e.lost_reason_id[1] != null ? e.lost_reason_id[1] : e.lost_reason_id[0])
        else if (e.lost_reason_id) lr = String(e.lost_reason_id)
        lostReasonByLead[sid] = lr
      }
    }

    // 3. Aplica canvis d'etapa als referits
    const evCol = $app.findCollectionByNameOrId('referral_events')
    const refCol = $app.findCollectionByNameOrId('referrals')
    const hasCommAlta = !!refCol.fields.getByName('partner_commission_alta')
    const hasCommRec = !!refCol.fields.getByName('partner_commission_recurrente')
    let changed = 0
    for (const r of synced) {
      const lid = parseInt(r.get('odo_opportunity_id'), 10)

      // 3a. Client associat (partner_id): es pot crear DURANT el funnel, així
      //     que es comprova independent del canvi d'etapa. Si la lead te un
      //     client i el referit no el te gravat (o ha canviat), s'actualitza.
      const custId = custByLead[lid]
      if (custId) {
        const currentCust = parseInt(r.get('odo_customer_id'), 10)
        if (!currentCust || currentCust !== custId) {
          r.set('odo_customer_id', custId)
          $app.save(r)
          $app.logger().info('[odoo_two_way_sync] client associat actualitzat', 'referral', r.id, 'customer', custId)
        }
      }

      // 3c. Comissions del partner (Odoo -> PRM). Odoo és la font de
      // veritat del pagament (des d'Odoo es poden ajustar els imports).
      // Per un perfil 'afiliat' la comissió recurrent va SEMPRE a 0,00
      // (regla CEO 08/09/2026), vingui el que vingui d'Odoo.
      // Es comprova AQUÍ (abans del continue de l'etapa) perquè és un
      // camp INDEPENDENT: s'ha de sincronitzar encara que l'etapa no canviï.
      // NOTA robustesa: si els camps de comissió no existeixen encara a
      // l'esquema (migració 005 pendent), es salta i MAI s'aborta el cron
      // (així la detecció de pèrdua de 3d continua executant-se).
      try {
        if (commByLead[lid]) {
          let partnerProfile = ''
          try { const prp = $app.findRecordById('partners', r.get('partner')); partnerProfile = prp ? (prp.get('profile') || '') : '' } catch (_) { }
          const comm = commByLead[lid]
          let commChanged = false
          if (hasCommAlta && comm.alta != null && r.get('partner_commission_alta') !== comm.alta) {
            r.set('partner_commission_alta', round2(comm.alta))
            commChanged = true
          }
          const currentRec = hasCommRec ? r.get('partner_commission_recurrente') : 0
          const wantRec = partnerProfile === 'afiliat' ? 0 : (comm.rec != null ? round2(comm.rec) : currentRec)
          if (hasCommRec && currentRec !== wantRec) {
            r.set('partner_commission_recurrente', wantRec)
            commChanged = true
          }
          if (commChanged) {
            $app.save(r)
            $app.logger().info('[odoo_two_way_sync] comissions actualitzades', 'referral', r.id, 'alta', r.get('partner_commission_alta'), 'recurrente', r.get('partner_commission_recurrente'))
          }
        }
      } catch (err) {
        $app.logger().error('[odoo_two_way_sync] comissions', 'referral', r.id, 'error', err.message)
      }

      // 3b. Resolució d'estat: etapa (Odoo) JUNT amb la PÈRDUA.
      // La pèrdua (won_status='lost' o lost_reason_id present) mana sobre
      // l'etapa: si la lead està perduda, l'estat objectiu és 'perdido' i
      // s'enregistra el motiu a les notes. Tot en un sol càlcul.
      const targetStage = stageByLead[lid]
      let targetStatus = targetStage != null ? STAGE_TO_STATUS[targetStage] : null
      if (lostByLead[lid]) {
        targetStatus = 'perdido'
        const lostReason = lostReasonByLead[lid] || ''
        if (lostReason && String(r.get('notes') || '').indexOf('Perdut (Odoo)') === -1) {
          r.set('notes', (r.get('notes') || '') + `\nPerdut (Odoo): ${lostReason}`)
        }
      }
      if (targetStatus == null) continue // ni etapa mapejada ni perduda: res a fer
      const current = r.get('status')
      if (current === targetStatus) continue // ja alineat
      const from = current
      r.set('status', targetStatus)
      $app.save(r) // el hook referral_events registra from -> targetStatus (amb el motiu a notes)
      // Històric append-only
      const ev = new Record(evCol)
      ev.set('referral', r.id)
      ev.set('from_status', from)
      ev.set('to_status', targetStatus)
      try { $app.save(ev) } catch (_) { }
      changed++
      $app.logger().info('[odoo_two_way_sync] canvi d\'etapa', 'referral', r.id, 'from', from, 'to', targetStatus, 'lost', !!lostByLead[lid])
    }
    if (changed) $app.logger().info('[odoo_two_way_sync] etapes actualitzades', 'count', changed)
  } catch (err) {
    $app.logger().error('[cron:odoo_two_way_sync]', 'error', err.message)
  }
})

// ------------------------------------------------------------------
// notification_processor — campanyes queued -> sent (in-app)
// ------------------------------------------------------------------
cronAdd('notification_processor', '*/5 * * * *', () => {
  try {
    const nowIso = new Date().toISOString()
    const today = nowIso.slice(0, 10)
    const queued = $app.findRecordsByFilter('notifications', "status = 'queued' && (scheduled_at = null || scheduled_at <= {:now})", ' -created_at', 50, 0, { now: nowIso })
    const users = $app.findRecordsByFilter('partner_users', 'id != ""', '', 500, 0)
    const deliveredCol = $app.findCollectionByNameOrId('notification_deliveries')

    for (const n of queued) {
      const audience = n.get('audience') || 'all'
      for (const u of users) {
        if (u.get('role') !== 'partner') continue
        if (audience !== 'all') {
          const profile = u.get('partner') ? (() => { try { return $app.findRecordById('partners', u.get('partner')).get('profile') } catch (_) { return null } })() : null
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
  } catch (err) {
    $app.logger().error('[cron:notification_processor]', 'error', err.message)
  }
})

// ------------------------------------------------------------------
// cleanup — neteja outbox antics (>30 dies)
// ------------------------------------------------------------------
cronAdd('cleanup', '0 4 * * 0', () => {
  try {
    const MS_PER_DAY = 24 * 60 * 60 * 1000
    const oldOutbox = $app.findRecordsByFilter('outbox', "status != 'pending' && updated_at < {:cutoff}", ' -created_at', 500, 0, {
      cutoff: new Date(Date.now() - 30 * MS_PER_DAY).toISOString(),
    })
    for (const r of oldOutbox) { try { $app.delete(r) } catch (_) { } }
  } catch (err) {
    $app.logger().error('[cron:cleanup]', 'error', err.message)
  }
})
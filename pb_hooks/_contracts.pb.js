/// <reference path="./types.d.ts" />
// =====================================================================
// Contracte de col·laborador — sincronització amb Odoo i generació (Carbone)
// ---------------------------------------------------------------
//  partner_sync      */5 * * * *  assegura el res.partner d'Odoo per NIF
//  contract_processor */5 * * * * genera el PDF del contracte amb Carbone
//
// Perquè aquest fitxer sigui inert fins que estigui configurat, cada cron
// surt immediatament si falten les variables d'entorn necessàries.
//
// FIX (PB 0.40.3): cada cron és TOTALMENT AUTOCONTINGUT (lògica inline),
// només amb globals injectats ($app, $http, $os, Record...). La funció
// odooJson2 es reimplementa dins del callback on cal.
//
// PENDENT: la creació del `sign.document` d'Odoo (Odoo Sign) i el polling
// d'estat; s'afegiran quan la doc d'Odoo estigui disponible.
// =====================================================================

// ------------------------------------------------------------------
// partner_sync — assegura el `res.partner` d'Odoo per al partner
//   · només partners 'actiu' amb NIF
//   · cerca oberta per `vat` (amb/sense prefix ES)
//   · si existeix -> desar odo_partner_id (i activar x_studio_colaborador)
//   · si no existeix -> crear res.partner amb x_studio_colaborador=true
// ------------------------------------------------------------------
cronAdd('partner_sync', '*/5 * * * *', () => {
  try {
    const ODOO_URL = $os.getenv('ODOO_URL')
    const ODOO_APIKEY = $os.getenv('ODOO_APIKEY')
    const ODOO_DB = $os.getenv('ODOO_DB')
    if (!ODOO_URL || !ODOO_APIKEY) return

    function odooJson2(model, method, payload) {
      const res = $http.send({
        url: ODOO_URL + '/json/2/' + model + '/' + method,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + ODOO_APIKEY,
          'x-odoo-database': ODOO_DB,
          'user-agent': 'polser-prm',
        },
        body: JSON.stringify(payload),
        timeout: 30,
      })
      if (res.statusCode < 200 || res.statusCode >= 300) {
        let odooErr = ''
        try { odooErr = (res.json && res.json.message) || String(res.raw || '').slice(0, 500) } catch (_) { odooErr = String(res.raw || '').slice(0, 500) }
        throw new Error('Odoo HTTP ' + res.statusCode + ': ' + odooErr)
      }
      return res.json
    }

    // (sense filtre de relació; filtrem per JS per robustesa al JSVM)
    let rows = []
    try { rows = $app.findRecordsByFilter('partners', "status = 'actiu' && nif != ''", 'created_at', 500, 0) } catch (_) { rows = [] }

    for (const p of rows) {
      if (p.get('odo_partner_id')) continue
      const nif = String(p.get('nif') || '').trim()
      if (!nif) continue
      try {
        // Cerca oberta per vat: primer el NIF tal qual, després amb prefix ES.
        let ids = []
        try {
          const f1 = odooJson2('res.partner', 'search', { domain: [['vat', '=', nif]], limit: 1 })
          ids = Array.isArray(f1) ? f1 : (f1 && f1.items) || []
        } catch (_) { ids = [] }
        if (!ids.length) {
          const nifEs = 'ES' + nif.replace(/^ES/i, '')
          try {
            const f2 = odooJson2('res.partner', 'search', { domain: [['vat', '=', nifEs]], limit: 1 })
            ids = Array.isArray(f2) ? f2 : (f2 && f2.items) || []
          } catch (_) { ids = [] }
        }

        if (ids.length) {
          const pid = parseInt(ids[0], 10)
          if (pid && !isNaN(pid)) {
            p.set('odo_partner_id', pid)
            // ÚNICA escriptura permesa a un res.partner existent: activar el flag.
            try {
              const rd = odooJson2('res.partner', 'search_read', { domain: [['id', '=', pid]], fields: ['x_studio_colaborador'] })
              const list = Array.isArray(rd) ? rd : (rd && rd.items) || []
              const cur = list[0]
              if (cur && cur.x_studio_colaborador !== true) {
                odooJson2('res.partner', 'write', { ids: [pid], vals: { x_studio_colaborador: true } })
              }
            } catch (e) {
              $app.logger().warn('[partner_sync] x_studio_colaborador no actualitzat', 'partner', p.id, 'error', String(e && e.message || e))
            }
          }
        } else {
          const createRes = odooJson2('res.partner', 'create', { vals_list: [{
            name: p.get('name') || '',
            vat: nif,
            is_company: p.get('is_company') === true,
            email: p.get('email') || false,
            phone: p.get('phone') || false,
            street: p.get('address') || false,
            x_studio_colaborador: true,
          }] })
          const npid = parseInt(Array.isArray(createRes) ? createRes[0] : createRes, 10)
          if (npid && !isNaN(npid)) p.set('odo_partner_id', npid)
        }

        $app.save(p)
        $app.logger().info('[partner_sync] ok', 'partner', p.id, 'odo_partner_id', p.get('odo_partner_id'))
      } catch (err) {
        $app.logger().warn('[partner_sync] error', 'partner', p.id, 'error', String(err && err.message || err))
      }
    }
  } catch (err) {
    $app.logger().error('[cron:partner_sync]', 'error', String(err && err.message || err))
  }
})

// ------------------------------------------------------------------
// contract_processor — genera el PDF del contracte amb Carbone
//   Requereix CARBONE_API_URL / CARBONE_API_KEY / CARBONE_TEMPLATE_ID.
//   Només per a partners 'actiu', amb NIF i amb odo_partner_id (ja sincronitzat).
// ------------------------------------------------------------------
cronAdd('contract_processor', '*/5 * * * *', () => {
  try {
    const CARBONE_API_URL = $os.getenv('CARBONE_API_URL')
    const CARBONE_API_KEY = $os.getenv('CARBONE_API_KEY')
    const CARBONE_TEMPLATE_ID = $os.getenv('CARBONE_TEMPLATE_ID')
    if (!CARBONE_API_URL || !CARBONE_API_KEY || !CARBONE_TEMPLATE_ID) return

    let rows = []
    try { rows = $app.findRecordsByFilter('partners', "status = 'actiu' && nif != ''", 'created_at', 200, 0) } catch (_) { rows = [] }

    for (const p of rows) {
      const status = p.get('contract_status') || 'no'
      if (status !== 'no' && status !== 'error') continue
      if (p.get('contract_draft_file')) continue  // ja generat
      if (!p.get('odo_partner_id')) continue       // primer cal el res.partner
      try {
        const isCompany = p.get('is_company') === true
        const nif = String(p.get('nif') || '')
        const repName = String(p.get('legal_rep_name') || '')
        const repNif = String(p.get('legal_rep_nif') || '')

        const d = new Date()
        const pad = (n) => String(n).padStart(2, '0')
        const dateStr = pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear()

        const typeLabels = {
          inmobiliaria: 'Inmobiliària',
          administrador_fincas: 'Administrador de finques',
          operador_telecom: 'Operador de telecomunicacions',
          autonomo: 'Autònom',
          otro: 'Altres',
        }
        const activity = typeLabels[p.get('type')] || String(p.get('type') || '')
        const isAfiliat = p.get('profile') === 'afiliat'
        const commission = isAfiliat
          ? '60€ IVA inclòs per venda realitzada.'
          : '60€ IVA inclòs per venda realitzada i 10% de la quota de servei recurrent.'

        const data = {
          date: dateStr,
          partner_rep_name: repName,
          partner_rep_nif: repNif,
          partner_name: p.get('name') || '',
          partner_nif: nif,
          partner_address: p.get('address') || '',
          activity: activity,
          commission: commission,
        }

        const res = $http.send({
          url: CARBONE_API_URL + '/render/' + CARBONE_TEMPLATE_ID + '?download=true',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer ' + CARBONE_API_KEY,
            'carbone-version': '5',
          },
          body: JSON.stringify({ data: data, convertTo: 'pdf' }),
          timeout: 60,
        })
        if (res.statusCode < 200 || res.statusCode >= 300) {
          throw new Error('Carbone HTTP ' + res.statusCode + ': ' + String(res.raw || '').slice(0, 300))
        }
        const bytes = res.body
        if (!bytes || !bytes.length) throw new Error('Carbone no ha retornat cap PDF')

        const file = $filesystem.fileFromBytes(bytes, 'contracte-' + p.id + '.pdf')
        p.set('contract_draft_file', file)
        p.set('contract_generated_at', new Date().toISOString())
        p.set('contract_status', 'generating')
        $app.save(p)
        $app.logger().info('[contract_processor] PDF generat', 'partner', p.id, 'is_company', isCompany)

        // TODO(sign): crear el `sign.document` d'Odoo amb aquest PDF i, si
        // va bé, set contract_status='pending_signature', contract_sent_at i
        // odo_sign_document_id.
      } catch (err) {
        $app.logger().error('[contract_processor] error', 'partner', p.id, 'error', String(err && err.message || err))
        try { p.set('contract_status', 'error'); $app.save(p) } catch (_) {}
      }
    }
  } catch (err) {
    $app.logger().error('[cron:contract_processor]', 'error', String(err && err.message || err))
  }
})
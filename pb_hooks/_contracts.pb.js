/// <reference path="./types.d.ts" />
// =====================================================================
// Contracte de col·laborador — Odoo (res.partner + Sign) i Carbone
// ---------------------------------------------------------------
//  partner_sync          */5 * * * *  assegura el res.partner d'Odoo per NIF
//  contract_processor    */5 * * * *  Carbone (PDF) -> Odoo Sign (sign.request)
//  contract_status_sync  */10 * * * * Odoo -> PRM (estat + PDF signat)
//
// Cada cron surt immediatament si falten les variables d'entorn necessàries,
// així que el fitxer és inert fins que estigui configurat.
//
// FIX (PB 0.40.3): cada cron és TOTALMENT AUTOCONTINGUT (lògica inline),
// només amb globals injectats ($app, $http, $os, $filesystem, Record...).
// La funció odooJson2 es reimplementa dins de cada callback.
//
// Configuració (paràmetres del contracte): `settings.sign_config` (JSON),
// vegeu la migració 008.
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
        throw new Error('Odoo ' + model + '.' + method + ' HTTP ' + res.statusCode + ': ' + odooErr)
      }
      return res.json
    }

    let rows = []
    try { rows = $app.findRecordsByFilter('partners', "status = 'actiu' && nif != ''", 'created_at', 500, 0) } catch (_) { rows = [] }

    for (const p of rows) {
      if (p.get('odo_partner_id')) continue
      const nif = String(p.get('nif') || '').trim()
      if (!nif) continue
      try {
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
// contract_processor — Carbone (PDF) + Odoo Sign (Odoo 19)
//   1. Carbone -> PDF (bytes) -> base64
//   2. ir.attachment/create (datas = base64)
//   3. sign.template/create (només name)
//   3b. sign.document/create (attachment_id) -> el PDF viu aquí a Odoo 19
//   4. resoldre rol per nom (sign.role)
//   5. sign.item/create (camp de firma de sign_config)
//   6. sign.request/create -> Odoo envia el correu de signatura
//   7. desar odo_sign_document_id + contract_status=pending_signature
//
// NOTA: els noms de model i de camp són configurables a settings.sign_config
// (Odoo 19 va refactoritzar Sign: el PDF ja no és a sign.template).
// ------------------------------------------------------------------
cronAdd('contract_processor', '*/5 * * * *', () => {
  try {
    const ODOO_URL = $os.getenv('ODOO_URL')
    const ODOO_APIKEY = $os.getenv('ODOO_APIKEY')
    const ODOO_DB = $os.getenv('ODOO_DB')
    const CARBONE_API_URL = $os.getenv('CARBONE_API_URL')
    const CARBONE_API_KEY = $os.getenv('CARBONE_API_KEY')
    const CARBONE_TEMPLATE_ID = $os.getenv('CARBONE_TEMPLATE_ID')
    if (!ODOO_URL || !ODOO_APIKEY) return
    if (!CARBONE_API_URL || !CARBONE_API_KEY || !CARBONE_TEMPLATE_ID) return

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
        timeout: 60,
      })
      if (res.statusCode < 200 || res.statusCode >= 300) {
        let odooErr = ''
        try { odooErr = (res.json && res.json.message) || String(res.raw || '').slice(0, 500) } catch (_) { odooErr = String(res.raw || '').slice(0, 500) }
        throw new Error('Odoo ' + model + '.' + method + ' HTTP ' + res.statusCode + ': ' + odooErr)
      }
      return res.json
    }
    const num = (v, d) => (v === null || v === undefined || v === '' ? d : Number(v))

    // Configuració de la signatura
    let cfg = null
    try {
      const s = $app.findFirstRecordByFilter('settings', 'id != ""')
      const raw = s.get('sign_config')
      cfg = (typeof raw === 'string') ? JSON.parse(raw) : (raw || null)
    } catch (_) { cfg = null }
    if (!cfg) { $app.logger().warn('[contract_processor] sign_config absent'); return }

    const requestModel = cfg.request_model || 'sign.request'
    const templateModel = cfg.template_model || 'sign.template'
    const itemModel = cfg.item_model || 'sign.item'
    const roleModel = cfg.role_model || 'sign.role'
    const requestItemField = cfg.request_item_field || 'request_item_ids'
    const field = cfg.field || {}

    let rows = []
    try { rows = $app.findRecordsByFilter('partners', "status = 'actiu' && nif != ''", 'created_at', 200, 0) } catch (_) { rows = [] }

    for (const p of rows) {
      const status = p.get('contract_status') || 'no'
      if (status !== 'no' && status !== 'error') continue
      const odooPartnerId = parseInt(p.get('odo_partner_id'), 10)
      if (!odooPartnerId || isNaN(odooPartnerId)) continue
      const reference = (cfg.reference_prefix || 'COL-') + p.id

      try {
        // Idempotència: si ja existeix un sign.request amb aquesta referència,
        // no en creem un altre (reintents).
        let existingReqId = null
        try {
          const er = odooJson2(requestModel, 'search', { domain: [['reference', '=', reference]], limit: 1 })
          const erIds = Array.isArray(er) ? er : (er && er.items) || []
          if (erIds.length) existingReqId = parseInt(erIds[0], 10)
        } catch (_) { }
        if (existingReqId && !isNaN(existingReqId)) {
          p.set('odo_sign_document_id', existingReqId)
          p.set('contract_status', 'pending_signature')
          if (!p.get('contract_sent_at')) p.set('contract_sent_at', new Date().toISOString())
          $app.save(p)
          continue
        }

        // 1. Carbone -> PDF
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
          partner_rep_name: String(p.get('legal_rep_name') || ''),
          partner_rep_nif: String(p.get('legal_rep_nif') || ''),
          partner_name: p.get('name') || '',
          partner_nif: String(p.get('nif') || ''),
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

        // Desar l'esborrany (auditoria) i marcar que s'està generant
        const draft = $filesystem.fileFromBytes(bytes, 'contracte-' + p.id + '.pdf')
        p.set('contract_draft_file', draft)
        p.set('contract_generated_at', new Date().toISOString())
        p.set('contract_status', 'generating')
        $app.save(p)

        // 2. ir.attachment
        const base64 = Buffer.from(bytes).toString('base64')
        const attRes = odooJson2('ir.attachment', 'create', { vals_list: [{
          type: 'binary',
          name: 'contracte-' + p.id + '.pdf',
          mimetype: 'application/pdf',
          datas: base64,
        }] })
        const attId = parseInt(Array.isArray(attRes) ? attRes[0] : attRes, 10)
        if (!attId || isNaN(attId)) throw new Error("Odoo no ha retornat id d'ir.attachment")

        // 3. sign.template (contenidor) — Odoo 19: el PDF ja NO va aquí
        const tplName = String(cfg.template_name || 'Contracte de col·laboració').replace('{partner_name}', p.get('name') || '')
        const tplRes = odooJson2(templateModel, 'create', { vals_list: [{ name: tplName }] })
        const tplId = parseInt(Array.isArray(tplRes) ? tplRes[0] : tplRes, 10)
        if (!tplId || isNaN(tplId)) throw new Error('Odoo no ha retornat id de ' + templateModel)

        // 3b. sign.document (Odoo 19): el PDF va aquí (attachment_id)
        const docModel = cfg.document_model || 'sign.document'
        const docVals = { name: tplName }
        docVals[cfg.document_attachment_field || 'attachment_id'] = attId
        docVals[cfg.document_template_field || 'template_id'] = tplId
        if (cfg.document_num_pages != null && cfg.document_num_pages !== '') docVals.num_pages = num(cfg.document_num_pages, null)
        const docRes = odooJson2(docModel, 'create', { vals_list: [docVals] })
        const docId = parseInt(Array.isArray(docRes) ? docRes[0] : docRes, 10)
        if (!docId || isNaN(docId)) throw new Error('Odoo no ha retornat id de ' + docModel)

        // 4. rol del signant (per nom)
        const roleName = cfg.role_name || 'Customer'
        const roleRes = odooJson2(roleModel, 'search_read', { domain: [['name', '=', roleName]], fields: ['id', 'name'], limit: 1 })
        const roleList = Array.isArray(roleRes) ? roleRes : (roleRes && roleRes.items) || []
        const roleId = roleList[0] ? parseInt(roleList[0].id, 10) : null
        if (!roleId || isNaN(roleId)) throw new Error('Rol de signatura no trobat: ' + roleName)

        // 5. sign.item (camp de firma), vinculat al document
        const itemVals = {}
        itemVals[cfg.item_link_field || 'template_id'] = docId
        itemVals.responsible_id = roleId
        itemVals.type_id = num(field.type_id, 1)
        itemVals.required = field.required !== false
        itemVals.name = field.name || 'Signatura'
        itemVals.page = num(field.page, 1)
        itemVals.posX = num(field.posX, 0.5)
        itemVals.posY = num(field.posY, 0.5)
        itemVals.width = num(field.width, 0.3)
        itemVals.height = num(field.height, 0.08)
        if (field.num_options != null) itemVals.num_options = num(field.num_options, 0)
        if (field.alignment) itemVals.alignment = field.alignment
        odooJson2(itemModel, 'create', { vals_list: [itemVals] })

        // 6. sign.request (envia el correu automàticament)
        const vd = num(cfg.validity_days, 30)
        const validUntil = new Date(Date.now() + vd * 24 * 3600 * 1000).toISOString().slice(0, 10)
        const reqVals = {
          template_id: tplId,
          subject: cfg.subject || 'Contracte de col·laboració — POLSER SEGURETAT',
          message: cfg.message || '<p>Us fem arribar el contracte per signar.</p>',
          reference: reference,
          validity: validUntil,
        }
        reqVals[requestItemField] = [[0, 0, { partner_id: odooPartnerId }]]
        if (cfg.request_document_field) {
          reqVals[cfg.request_document_field] = [[6, 0, [docId]]]
        }
        const reqRes = odooJson2(requestModel, 'create', { vals_list: [reqVals] })
        const reqId = parseInt(Array.isArray(reqRes) ? reqRes[0] : reqRes, 10)
        if (!reqId || isNaN(reqId)) throw new Error('Odoo no ha retornat id de ' + requestModel)

        p.set('odo_sign_document_id', reqId)
        p.set('contract_status', 'pending_signature')
        p.set('contract_sent_at', new Date().toISOString())
        $app.save(p)
        $app.logger().info('[contract_processor] sign.request creat', 'partner', p.id, 'request', reqId)
      } catch (err) {
        $app.logger().error('[contract_processor] error', 'partner', p.id, 'error', String(err && err.message || err))
        try { p.set('contract_status', 'error'); $app.save(p) } catch (_) { }
      }
    }
  } catch (err) {
    $app.logger().error('[cron:contract_processor]', 'error', String(err && err.message || err))
  }
})

// ------------------------------------------------------------------
// contract_status_sync — Odoo -> PRM
//   · sign.request.state = 'sent'    -> pending_signature (es manté)
//   · sign.request.state = 'signed'  -> signed + descàrrega del PDF signat
//   · 'cancelled'/'canceled'         -> canceled
//   · 'expired'                      -> error
// ------------------------------------------------------------------
cronAdd('contract_status_sync', '*/10 * * * *', () => {
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
        timeout: 60,
      })
      if (res.statusCode < 200 || res.statusCode >= 300) {
        let odooErr = ''
        try { odooErr = (res.json && res.json.message) || String(res.raw || '').slice(0, 500) } catch (_) { odooErr = String(res.raw || '').slice(0, 500) }
        throw new Error('Odoo ' + model + '.' + method + ' HTTP ' + res.statusCode + ': ' + odooErr)
      }
      return res.json
    }

    let requestModel = 'sign.request'
    try {
      const s = $app.findFirstRecordByFilter('settings', 'id != ""')
      const raw = s.get('sign_config')
      const cfg = (typeof raw === 'string') ? JSON.parse(raw) : (raw || null)
      if (cfg && cfg.request_model) requestModel = cfg.request_model
    } catch (_) { }

    let rows = []
    try { rows = $app.findRecordsByFilter('partners', "status = 'actiu'", 'created_at', 500, 0) } catch (_) { rows = [] }

    for (const p of rows) {
      const reqId = parseInt(p.get('odo_sign_document_id'), 10)
      if (!reqId || isNaN(reqId)) continue
      if ((p.get('contract_status') || '') !== 'pending_signature') continue
      try {
        const rr = odooJson2(requestModel, 'search_read', { domain: [['id', '=', reqId]], fields: ['state'], limit: 1 })
        const list = Array.isArray(rr) ? rr : (rr && rr.items) || []
        const st = list[0] ? list[0].state : null
        if (!st) continue

        if (st === 'signed') {
          p.set('contract_status', 'signed')
          p.set('contract_signed_at', new Date().toISOString())

          // Descarregar el PDF signat
          try {
            let signedAttId = null
            // (a) Odoo 19: completed_document_attachment_ids del sign.request
            try {
              const rd0 = odooJson2(requestModel, 'read', { ids: [reqId], fields: ['completed_document_attachment_ids'] })
              const l0 = Array.isArray(rd0) ? rd0 : (rd0 && rd0.items) || []
              const ids0 = l0[0] ? l0[0].completed_document_attachment_ids : null
              if (Array.isArray(ids0) && ids0.length) signedAttId = parseInt(ids0[0], 10)
            } catch (_) { }
            // (b) fallback: ir.attachment de res_model=sign.request
            if (!signedAttId) {
              const atts = odooJson2('ir.attachment', 'search_read', {
                domain: [['res_model', '=', requestModel], ['res_id', '=', reqId]],
                fields: ['id', 'name', 'mimetype', 'file_size'],
              })
              const arr = Array.isArray(atts) ? atts : (atts && atts.items) || []
              const pdfs = arr.filter((a) =>
                String(a.mimetype || '') === 'application/pdf' &&
                !/certificat|certificate/i.test(String(a.name || '')),
              )
              pdfs.sort((a, b) => (Number(b.file_size) || 0) - (Number(a.file_size) || 0))
              if (pdfs.length) signedAttId = parseInt(pdfs[0].id, 10)
            }
            if (signedAttId && !isNaN(signedAttId)) {
              const rd = odooJson2('ir.attachment', 'read', { ids: [signedAttId], fields: ['datas', 'name'] })
              const rdList = Array.isArray(rd) ? rd : (rd && rd.items) || []
              const b64 = rdList[0] ? rdList[0].datas : null
              if (b64) {
                const bytes = Buffer.from(String(b64), 'base64')
                const file = $filesystem.fileFromBytes(bytes, 'contracte-signat-' + p.id + '.pdf')
                p.set('contract_file', file)
              }
            }
          } catch (e) {
            $app.logger().warn('[contract_status_sync] PDF signat no descarregat', 'partner', p.id, 'error', String(e && e.message || e))
          }

          $app.save(p)
          $app.logger().info('[contract_status_sync] contracte signat', 'partner', p.id, 'request', reqId)
        } else if (st === 'cancelled' || st === 'canceled') {
          p.set('contract_status', 'canceled')
          $app.save(p)
        } else if (st === 'expired') {
          p.set('contract_status', 'error')
          $app.save(p)
        }
        // 'sent' -> es manté pending_signature
      } catch (err) {
        $app.logger().warn('[contract_status_sync] error', 'partner', p.id, 'error', String(err && err.message || err))
      }
    }
  } catch (err) {
    $app.logger().error('[cron:contract_status_sync]', 'error', String(err && err.message || err))
  }
})
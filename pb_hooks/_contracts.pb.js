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
    // Codificador base64 en JS pur (no depèn de Buffer del JSVM).
    const b64FromBytes = (bytes) => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
      let out = ''
      const n = bytes.length
      for (let i = 0; i < n; i += 3) {
        const b1 = bytes[i] & 0xff
        const b2 = (i + 1 < n) ? (bytes[i + 1] & 0xff) : 0
        const b3 = (i + 2 < n) ? (bytes[i + 2] & 0xff) : 0
        out += chars.charAt(b1 >> 2)
        out += chars.charAt(((b1 & 3) << 4) | (b2 >> 4))
        out += (i + 1 < n) ? chars.charAt(((b2 & 15) << 2) | (b3 >> 6)) : '='
        out += (i + 2 < n) ? chars.charAt(b3 & 63) : '='
      }
      return out
    }

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
    // A Odoo 19 `sign.role` ja no existeix (rols = signants del document).
    const roleModel = (cfg.role_model && cfg.role_model !== 'sign.role') ? cfg.role_model : ''
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

        let bytes = res.body
        const ctRaw = res.headers ? (res.headers['content-type'] || res.headers['Content-Type']) : ''
        const ct = Array.isArray(ctRaw) ? ctRaw.join(',') : String(ctRaw || '')
        let isJson = ct.toLowerCase().indexOf('json') >= 0
        if (!isJson && Array.isArray(bytes) && bytes.length && bytes[0] === 123 /* '{' */) isJson = true
        // Algunes respostes de Carbone retornen { success, data: { renderId } } en lloc del PDF.
        if (isJson) {
          const renderId = (res.json && res.json.data && res.json.data.renderId) ? res.json.data.renderId : null
          if (!renderId) throw new Error('Carbone ha retornat JSON sense renderId: ' + String(res.raw || '').slice(0, 200))
          const res2 = $http.send({
            url: CARBONE_API_URL + '/render/' + renderId,
            method: 'GET',
            headers: { authorization: 'Bearer ' + CARBONE_API_KEY, 'carbone-version': '5' },
            timeout: 60,
          })
          if (res2.statusCode < 200 || res2.statusCode >= 300) throw new Error('Carbone GET HTTP ' + res2.statusCode)
          bytes = res2.body
        }
        if (!bytes || !bytes.length) throw new Error('Carbone no ha retornat cap PDF')
        try {
          const b0 = Array.isArray(bytes) ? bytes.slice(0, 5).join(',') : ('typeof=' + typeof bytes + ':' + String(bytes).slice(0, 20))
          $app.logger().info('[contract_processor] carbone', 'ct', ct, 'isArray', Array.isArray(bytes), 'len', bytes.length, 'head', b0)
        } catch (_) { }

        // Desar l'esborrany (auditoria) i marcar que s'està generant
        const draft = $filesystem.fileFromBytes(bytes, 'contracte-' + p.id + '.pdf')
        p.set('contract_draft_file', draft)
        p.set('contract_generated_at', new Date().toISOString())
        p.set('contract_status', 'generating')
        $app.save(p)

        // 2. PDF -> base64 + ir.attachment (sign.document.attachment_id és obligatori)
        const base64 = b64FromBytes(bytes)
        try { $app.logger().info('[contract_processor] base64', 'len', base64.length, 'head', base64.slice(0, 12)) } catch (_) { }
        // Diagnòstic: el PDF de Carbone porta /Encrypt? (Odoo rebutja PDFs xifrats)
        try {
          let s = ''
          const step = 8192
          for (let i = 0; i < bytes.length; i += step) {
            s += String.fromCharCode.apply(null, bytes.slice(i, i + step))
          }
          $app.logger().info('[contract_processor] pdf check', 'encrypt', s.indexOf('/Encrypt') >= 0, 'eof', s.indexOf('%%EOF') >= 0, 'len', bytes.length)
        } catch (_) { }

        const attName = 'contracte-' + p.id + '.pdf'
        const readSize = (id) => {
          try {
            const chk = odooJson2('ir.attachment', 'read', { ids: [id], fields: ['file_size'] })
            const c = (Array.isArray(chk) ? chk : (chk && chk.items) || [])[0] || {}
            return Number(c.file_size || 0)
          } catch (_) { return 0 }
        }
        let attId = 0
        let attSize = 0
        const attAttempts = [
          { type: 'binary', name: attName, mimetype: 'application/pdf', raw: base64 },
          { type: 'binary', name: attName, mimetype: 'application/pdf', datas: base64 },
        ]
        for (const vals of attAttempts) {
          try {
            const attRes = odooJson2('ir.attachment', 'create', { vals_list: [vals] })
            const id = parseInt(Array.isArray(attRes) ? attRes[0] : attRes, 10)
            if (!id || isNaN(id)) continue
            let sz = readSize(id)
            if (!sz) {
              // prova d'omplir amb l'altre camp
              try { odooJson2('ir.attachment', 'write', { ids: [id], vals: (vals.raw ? { datas: base64 } : { raw: base64 }) }) } catch (_) { }
              sz = readSize(id)
            }
            if (sz > 0) { attId = id; attSize = sz; break }
          } catch (_) { }
        }
        try { $app.logger().info('[contract_processor] attachment', 'id', attId, 'size', attSize) } catch (_) { }
        if (!attId || !attSize) throw new Error("No s'ha pogut crear l'ir.attachment amb contingut (datas/raw)")

        // 3. sign.template (contenidor) — Odoo 19: el PDF ja NO va aquí
        const tplName = String(cfg.template_name || 'Contracte de col·laboració').replace('{partner_name}', p.get('name') || '')
        const tplRes = odooJson2(templateModel, 'create', { vals_list: [{ name: tplName }] })
        const tplId = parseInt(Array.isArray(tplRes) ? tplRes[0] : tplRes, 10)
        if (!tplId || isNaN(tplId)) throw new Error('Odoo no ha retornat id de ' + templateModel)

        // 3b. sign.document (Odoo 19): attachment_id obligatori
        const docModel = cfg.document_model || 'sign.document'
        const docVals = { name: tplName }
        docVals[cfg.document_attachment_field || 'attachment_id'] = attId
        docVals[cfg.document_template_field || 'template_id'] = tplId
        if (cfg.document_num_pages != null && cfg.document_num_pages !== '') docVals.num_pages = num(cfg.document_num_pages, null)
        try { $app.logger().info('[contract_processor] sign.document vals', 'keys', Object.keys(docVals).join(',')) } catch (_) { }
        const docRes = odooJson2(docModel, 'create', { vals_list: [docVals] })
        const docId = parseInt(Array.isArray(docRes) ? docRes[0] : docRes, 10)
        if (!docId || isNaN(docId)) throw new Error('Odoo no ha retornat id de ' + docModel)

        // 4+5. sign.item: el camp de firma necessita un rol/signant
        //      (`responsible_id`). A Odoo 19 el model de rol es descobreix
        //      dinàmicament des de la metadada (`fields_get`).
        const itemLink = cfg.item_link_field || 'document_id'
        const fieldVals = {
          type_id: num(field.type_id, 1),
          required: field.required !== false,
          name: field.name || 'Signatura',
          page: num(field.page, 1),
          posX: num(field.posX, 0.5),
          posY: num(field.posY, 0.5),
          width: num(field.width, 0.3),
          height: num(field.height, 0.08),
        }
        if (field.num_options != null) fieldVals.num_options = num(field.num_options, 0)
        if (field.alignment) fieldVals.alignment = field.alignment

        // 1) Descobreix el model de rol (relation de sign.item.responsible_id)
        let roleModelName = (cfg.role_model && cfg.role_model !== 'sign.role') ? cfg.role_model : ''
        if (!roleModelName) {
          try {
            const fg = odooJson2(itemModel, 'fields_get', { allfields: false })
            roleModelName = (fg && fg.responsible_id && fg.responsible_id.relation) || ''
          } catch (_) { }
        }
        try { $app.logger().info('[contract_processor] role model', 'model', roleModelName) } catch (_) { }

        // 2) Obté el rol: camp del document, o el primer existent, o en crea un
        let roleId = cfg.role_id ? Number(cfg.role_id) : null
        if (!roleId && roleModelName) {
          // 2a) camp de sign.document que apunta al model de rol
          try {
            const docFg = odooJson2(docModel, 'fields_get', { allfields: false })
            let roleField = ''
            for (const k in docFg) {
              if (docFg[k] && docFg[k].relation === roleModelName) { roleField = k; break }
            }
            if (roleField) {
              const dr = odooJson2(docModel, 'read', { ids: [docId], fields: [roleField] })
              const d0 = (Array.isArray(dr) ? dr : (dr && dr.items) || [])[0] || {}
              const rid = Array.isArray(d0[roleField]) ? d0[roleField][0] : d0[roleField]
              if (rid) roleId = parseInt(rid, 10)
            }
          } catch (_) { }
          // 2b) si no, en crea un vinculat al template/document
          if (!roleId) {
            try {
              const roleFg = odooJson2(roleModelName, 'fields_get', { allfields: false })
              const rv = { name: cfg.role_name || 'Signer 1' }
              if (roleFg.template_id) rv.template_id = tplId
              if (roleFg.document_id) rv.document_id = docId
              const rr = odooJson2(roleModelName, 'create', { vals_list: [rv] })
              roleId = parseInt(Array.isArray(rr) ? rr[0] : rr, 10)
            } catch (e) {
              $app.logger().warn('[contract_processor] role create', 'error', String(e && e.message || e))
            }
          }
        }
        try { $app.logger().info('[contract_processor] role id', 'id', roleId) } catch (_) { }

        // 3) Crea el sign.item (amb el rol) vinculat al document
        const itemVals = Object.assign({}, fieldVals)
        itemVals[itemLink] = docId
        if (roleId && !isNaN(roleId)) itemVals[cfg.item_role_field || 'responsible_id'] = roleId
        const itemRes = odooJson2(itemModel, 'create', { vals_list: [itemVals] })
        try { $app.logger().info('[contract_processor] sign.item creat', 'item', JSON.stringify(itemRes)) } catch (_) { }

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
        const signerVals = { partner_id: odooPartnerId }
        if (roleId && !isNaN(roleId)) signerVals.role_id = roleId
        reqVals[requestItemField] = [[0, 0, signerVals]]
        const reqDocField = (cfg.request_document_field && cfg.request_document_field !== 'off') ? cfg.request_document_field : ''
        if (reqDocField) reqVals[reqDocField] = [[6, 0, [docId]]]
        try { $app.logger().info('[contract_processor] sign.request vals', 'keys', Object.keys(reqVals).join(','), 'role_id', roleId) } catch (_) { }
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
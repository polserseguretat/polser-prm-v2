/// <reference path="./types.d.ts" />
// =====================================================================
// PRM POLSER — Alta de partner per invitació
// ---------------------------------------------------------------
// Flux:
//   1. POST   /api/portal/invitations            (API key INVITE_API_KEY)
//              -> crea `partners` en 'pendente' (perfil SEMPRE 'afiliat'),
//                 genera token únic i envia email amb enllaç de registre.
//   2. GET    /api/portal/invitations/{token}    (públic)
//              -> valida el token i retorna prefill (name, email, type).
//   3. POST   /api/portal/invitations/{token}    (públic)
//              -> completa la fitxa (type, nif, phone, address), activa el
//                 partner, crea l'usuari del portal (auth OTP) + vincle
//                 partner_members (owner), envia email de signatura i crea
//                 una notificació in-app dirigida a aquest usuari.
//
// Regla de negoci (direcció 08/09/2026): tots els partners nous que entrin
// per invitació són PERFIL AFILIAT (60 € per alta, sense recurrent).
// L'ascens a 'colaborador' el fa internament POLSER des de /_/.
//
// FIX (PB 0.40.3): cada callback és TOTALMENT AUTOCONTINGUT (lògica inline),
// només amb globals injectats ($app, $security, Record, ForbiddenError,
// BadRequestError, MailerMessage...). No s'usen funcions/const top-level.
// =====================================================================

// ------------------------------------------------------------------
// POST /api/portal/invitations  (API key a la variable INVITE_API_KEY)
// ------------------------------------------------------------------
routerAdd('POST', '/api/portal/invitations', (e) => {
  // Auth: clau dedicada d'automatització al header X-API-Key. Comparació
  // en temps constant ($security.equal). No cal token de superuser.
  const expected = $os.getenv('INVITE_API_KEY') || ''
  const provided = String((e.request.header.get('X-API-Key') || '')).trim()
  if (!expected || !provided || !$security.equal(expected, provided)) {
    throw new UnauthorizedError('API key no vàlida.')
  }

  const body = e.requestInfo().body || {}
  const name = String(body.name || '').trim()
  const email = String(body.email || '').trim().toLowerCase()
  if (!name) throw new BadRequestError('El nom és obligatori.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestError('Correu electrònic no vàlid.')

  // Ja existeix un usuari del portal amb aquest correu?
  let existingUser = null
  try { existingUser = $app.findFirstRecordByFilter('partner_users', 'email = {:email}', { email }) } catch (_) {}
  if (existingUser) throw new BadRequestError('Ja existeix un usuari del portal amb aquest correu.')

  // Ja existeix el partner (per reenviament)?
  let partner = null
  try { partner = $app.findFirstRecordByFilter('partners', 'email = {:email}', { email }) } catch (_) {}

  const token = $security.randomString(48)
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000) // 7 dies

  if (partner) {
    const status = partner.get('status')
    if (status === 'actiu') throw new BadRequestError('Aquest partner ja és actiu al portal.')
    if (status !== 'pendente') throw new BadRequestError('Estat del partner no permès per a invitació (' + status + ').')
    // Reenviament: regenera token i envia un altre cop
    partner.set('invite_token', token)
    partner.set('invite_expires_at', expiresAt.toISOString())
    partner.set('invited_at', new Date().toISOString())
    $app.save(partner)
  } else {
    const col = $app.findCollectionByNameOrId('partners')
    const rec = new Record(col)
    rec.set('name', name)
    rec.set('email', email)
    rec.set('profile', 'afiliat') // per defecte tots els nous partners són afiliats
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
    $app.logger().warn('[invitacio] mail no enviat', 'error', String(err && err.message || err))
  }

  $app.logger().info('[invitacio] partner convidat', 'id', partner.id, 'email', email)
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
// GET /api/portal/invitations/{token}  (públic)
// ------------------------------------------------------------------
routerAdd('GET', '/api/portal/invitations/{token}', (e) => {
  const token = String(e.request.pathValue('token') || '').trim()
  if (!token) throw new BadRequestError('Token no vàlid.')
  let partner = null
  try { partner = $app.findFirstRecordByFilter('partners', 'invite_token = {:token}', { token }) } catch (_) {}
  if (!partner) throw new ForbiddenError('Enllaç no vàlid o ja utilitzat.')

  const exp = partner.get('invite_expires_at')
  if (exp && new Date(exp).getTime() < Date.now()) throw new ForbiddenError('Aquest enllaç ha caducat.')
  if (partner.get('status') !== 'pendente') throw new ForbiddenError("Aquesta invitació ja s'ha processat.")

  return e.json(200, {
    data: {
      name: partner.get('name'),
      email: partner.get('email'),
      type: partner.get('type'),
    },
  })
})

// ------------------------------------------------------------------
// POST /api/portal/invitations/{token}  (públic) — completa l'alta
// ------------------------------------------------------------------
routerAdd('POST', '/api/portal/invitations/{token}', (e) => {
  const token = String(e.request.pathValue('token') || '').trim()
  if (!token) throw new BadRequestError('Token no vàlid.')
  let partner = null
  try { partner = $app.findFirstRecordByFilter('partners', 'invite_token = {:token}', { token }) } catch (_) {}
  if (!partner) throw new ForbiddenError('Enllaç no vàlid o ja utilitzat.')

  const exp = partner.get('invite_expires_at')
  if (exp && new Date(exp).getTime() < Date.now()) throw new ForbiddenError('Aquest enllaç ha caducat.')
  if (partner.get('status') !== 'pendente') throw new ForbiddenError("Aquesta invitació ja s'ha processat.")

  const body = e.requestInfo().body || {}
  const allowedTypes = ['inmobiliaria', 'administrador_fincas', 'operador_telecom', 'autonomo', 'otro']
  const type = String(body.type || '').trim()
  if (!allowedTypes.includes(type)) throw new BadRequestError('Tipus de partner no vàlid.')

  const name = String(body.name || partner.get('name') || '').trim()
  if (!name) throw new BadRequestError('El nom és obligatori.')

  partner.set('name', name)
  partner.set('type', type)
  partner.set('nif', String(body.nif || '').trim().slice(0, 20))
  partner.set('phone', String(body.phone || '').trim().slice(0, 50))
  partner.set('address', String(body.address || '').trim().slice(0, 300))
  partner.set('profile', 'afiliat') // forçat: tots els nous partners són afiliats
  partner.set('status', 'actiu')
  partner.set('activation_date', new Date().toISOString().slice(0, 10))
  partner.set('invite_token', '') // single-use
  partner.set('onboarding_completed_at', new Date().toISOString())
  $app.save(partner)

  const email = String(partner.get('email') || '').trim().toLowerCase()
  if (!email) throw new BadRequestError('El partner no té correu electrònic.')

  // Crea l'usuari del portal (auth OTP) si no existeix
  let user = null
  try { user = $app.findFirstRecordByFilter('partner_users', 'email = {:email}', { email }) } catch (_) {}
  if (!user) {
    const userCol = $app.findCollectionByNameOrId('partner_users')
    const nu = new Record(userCol)
    nu.set('email', email)
    nu.set('verified', true)
    nu.set('role', 'partner')
    nu.set('partner', partner.id)
    nu.set('name', name)
    $app.save(nu)
    user = nu

    // Vincle partner ↔ user (owner)
    try {
      const memCol = $app.findCollectionByNameOrId('partner_members')
      const mem = new Record(memCol)
      mem.set('partner', partner.id)
      mem.set('user', user.id)
      mem.set('role_in_partner', 'owner')
      $app.save(mem)
    } catch (_) {}
  }

  // Notificació in-app dirigida (signatura del contracte)
  try {
    const notifCol = $app.findCollectionByNameOrId('notifications')
    const notif = new Record(notifCol)
    notif.set('title', 'Benvingut al Portal de Partners')
    notif.set('body', 'Us donem la benvinguda. Per activar el contracte de col·laboració, cal que signeu la documentació que us enviarà l\'equip de POLSER SEGURETAT.')
    notif.set('audience', 'all') // camp obligatori; l'entrega és dirigida per notification_deliveries
    notif.set('channel', 'inapp')
    notif.set('status', 'sent')
    notif.set('sent_at', new Date().toISOString())
    $app.save(notif)
    const delCol = $app.findCollectionByNameOrId('notification_deliveries')
    const del = new Record(delCol)
    del.set('notification', notif.id)
    del.set('user', user.id)
    del.set('delivered_at', new Date().toISOString())
    $app.save(del)
  } catch (_) {}

  // Email de signatura del contracte
  try {
    const settings = $app.settings()
    const meta = settings.meta || {}
    const appURL = meta.appURL || 'https://prm.polser.cat'
    const senderName = meta.senderName || 'POLSER SEGURETAT'
    const senderAddress = meta.senderAddress || 'no-reply@polser.cat'
    const msg = new MailerMessage({
      from: { name: senderName, address: senderAddress },
      to: [{ address: email }],
      subject: 'Signatura del contracte · POLSER SEGURETAT',
      html: '<p>Hola ' + name + ',</p>' +
        "<p>La teva fitxa de partner s'ha creat correctament i ja tens accés al portal.</p>" +
        '<p>Per completar l\'alta, cal que signeu el contracte de col·laboració. L\'equip de POLSER SEGURETAT us contactarà amb els detalls.</p>' +
        '<p>Accedeix al portal: <a href="' + appURL + '">' + appURL + '</a></p>' +
        '<p><strong>Afiliat: 60 € per alta.</strong></p>',
    })
    $app.newMailClient().send(msg)
  } catch (err) {
    $app.logger().warn('[invitacio] mail contracte no enviat', 'error', String(err && err.message || err))
  }

  $app.logger().info('[invitacio] alta completada', 'partner', partner.id, 'user', user.id)
  return e.json(200, { data: { partner_id: partner.id, user_id: user.id, status: 'actiu' } })
})
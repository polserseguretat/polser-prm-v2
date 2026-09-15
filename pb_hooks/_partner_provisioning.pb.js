/// <reference path="./types.d.ts" />
// =====================================================================
// Provisió automàtica d'accés al portal per als partners
// ---------------------------------------------------------------
// Quan un `partners` queda en estat `actiu` i té correu, s'assegura que
// existeixi un `partner_users` (auth OTP) vinculat perquè pugui accedir
// al portal. Cobreix:
//   - partners creats/activats manualment des de /_/
//   - partners activats pel flux d'invitació (status 'actiu')
//
// Idempotent: si ja existeix l'usuari amb aquell email, no fa res.
// No bloqueja mai el desat del partner (tot dins try/catch).
//
// NOTA (PB 0.40.3 JSVM): cada callback és autocontingut (lògica inline),
// només amb globals injectats. No s'usen funcions top-level.
// =====================================================================

onRecordAfterCreateSuccess((e) => {
  const rec = e.record
  const email = String(rec.get('email') || '').trim().toLowerCase()
  if (!email || rec.get('status') !== 'actiu') return

  let existing = null
  try { existing = $app.findFirstRecordByFilter('partner_users', 'email = {:email}', { email }) } catch (_) {}
  if (existing) return

  try {
    const userCol = $app.findCollectionByNameOrId('partner_users')
    const nu = new Record(userCol)
    nu.set('email', email)
    nu.set('verified', true)
    nu.set('role', 'partner')
    nu.set('partner', rec.id)
    nu.set('name', rec.get('name') || '')
    // La col·lecció auth exigeix `password` encara que passwordAuth estigui
    // desactivat (login per OTP). S'assigna una contrasenya aleatòria.
    nu.setRandomPassword()
    $app.save(nu)

    try {
      const memCol = $app.findCollectionByNameOrId('partner_members')
      const mem = new Record(memCol)
      mem.set('partner', rec.id)
      mem.set('user', nu.id)
      mem.set('role_in_partner', 'owner')
      $app.save(mem)
    } catch (_) { }

    $app.logger().info('[partner_provisioning] usuari creat', 'partner', rec.id, 'email', email)
  } catch (err) {
    $app.logger().warn('[partner_provisioning] usuari no creat', 'partner', rec.id, 'error', String(err && err.message || err))
  }
}, 'partners')

onRecordAfterUpdateSuccess((e) => {
  const rec = e.record
  const email = String(rec.get('email') || '').trim().toLowerCase()
  if (!email || rec.get('status') !== 'actiu') return

  let existing = null
  try { existing = $app.findFirstRecordByFilter('partner_users', 'email = {:email}', { email }) } catch (_) {}
  if (existing) return

  try {
    const userCol = $app.findCollectionByNameOrId('partner_users')
    const nu = new Record(userCol)
    nu.set('email', email)
    nu.set('verified', true)
    nu.set('role', 'partner')
    nu.set('partner', rec.id)
    nu.set('name', rec.get('name') || '')
    // La col·lecció auth exigeix `password` encara que passwordAuth estigui
    // desactivat (login per OTP). S'assigna una contrasenya aleatòria.
    nu.setRandomPassword()
    $app.save(nu)

    try {
      const memCol = $app.findCollectionByNameOrId('partner_members')
      const mem = new Record(memCol)
      mem.set('partner', rec.id)
      mem.set('user', nu.id)
      mem.set('role_in_partner', 'owner')
      $app.save(mem)
    } catch (_) { }

    $app.logger().info('[partner_provisioning] usuari creat', 'partner', rec.id, 'email', email)
  } catch (err) {
    $app.logger().warn('[partner_provisioning] usuari no creat', 'partner', rec.id, 'error', String(err && err.message || err))
  }
}, 'partners')
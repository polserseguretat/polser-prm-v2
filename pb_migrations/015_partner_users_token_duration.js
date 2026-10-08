/// <reference path="../pb_hooks/types.d.ts" />
// =====================================================================
// PRM POLSER — Migració 015: durada de la sessió de partner_users
// ---------------------------------------------------------------
// La sessió del portal és el JWT de `partner_users`. En aquesta versió de
// PocketBase la durada es configura PER COL·LECCIÓ (`authToken.duration`).
// El valor per defecte és 432000 s (5 dies), massa just per a un portal que
// es consulta esporàdicament.
//
// S'estableix a 2592000 s (30 dies). El portal fa un REFRESC SILENCIÓS
// (`POST /api/collections/partner_users/auth-refresh`) en obrir l'app i al
// tornar-hi quan el token és a prop de caducar, de manera que un usuari actiu
// no es desconnecta mai; un dispositiu abandonat caduca al cap de 30 dies.
//
// NOTA: els tokens ja emesos conserven la seva data de caducitat; la durada
// nova s'aplica al següent login/refresc.
// =====================================================================

migrate((app) => {
  const col = app.findCollectionByNameOrId('partner_users')
  unmarshal({ authToken: { duration: 2592000 } }, col) // 30 dies
  return app.save(col)
}, (app) => {
  const col = app.findCollectionByNameOrId('partner_users')
  unmarshal({ authToken: { duration: 432000 } }, col) // revert a 5 dies
  return app.save(col)
})

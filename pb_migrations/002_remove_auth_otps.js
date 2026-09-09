/// <reference path="../pb_hooks/types.d.ts" />
// =====================================================================
// PRM POLSER — Migració 002: eliminar auth_otps (redundant)
// PocketBase gestiona OTP internament; la nostra taula auth_otps
// no és necessària.
// =====================================================================
migrate((app) => {
  try {
    const col = app.findCollectionByNameOrId('auth_otps')
    app.delete(col)
    console.log('auth_otps eliminat')
  } catch (e) {
    // potser no existeix (primer起fresh)
  }
}, (app) => {
  // no cal down — és una cleanup
})

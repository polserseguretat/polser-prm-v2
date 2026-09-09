/// <reference path="../pb_hooks/types.d.ts" />
// =====================================================================
// PRM POLSER — Migració 003: OTP de partner_users amb codis de 6 dígits
// El portal valida codis de 6 dígits (placeholder "123456"); el default
// de PocketBase és de 8 dígits.
// =====================================================================
migrate((app) => {
  const collection = app.findCollectionByNameOrId("partner_users")

  unmarshal({
    otp: {
      enabled: true,
      length: 6,
      duration: 180, // 3 minuts
    },
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("partner_users")

  unmarshal({
    otp: {
      enabled: true,
      length: 8,
    },
  }, collection)

  return app.save(collection)
})

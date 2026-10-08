/// <reference path="../pb_hooks/types.d.ts" />
// =====================================================================
// PRM POLSER — Migració 014: índexs únics PARCIALS a `partners`
// ---------------------------------------------------------------
// PROBLEMA: 001 creava
//     CREATE UNIQUE INDEX idx_partners_nif   ON partners (nif)
//     CREATE UNIQUE INDEX idx_partners_email ON partners (email)
// Els camps `nif` i `email` són OPCIONALS, però a PocketBase els valors
// buits s'emmagatzemen com a string buit ('', no NULL). Per tant el segon
// partner sense NIF (o sense email) xocava amb "nif: validation_not_unique"
// i no es podia crear. Bloquejava l'alta de partners de prova i qualsevol
// partner sense NIF/email.
//
// SOLUCIÓ: recrear els dos índexs com a PARCIALS (WHERE ... != ''), de
// manera que només siguin únics els valors informats. SQLite suporta
// índexs parcials des de 3.8.
// =====================================================================

migrate((app) => {
  const ok = (i) => {
    const s = String(i)
    return s.indexOf('idx_partners_nif') !== -1 || s.indexOf('idx_partners_email') !== -1
  }
  const col = app.findCollectionByNameOrId('partners')
  const kept = (col.indexes || []).filter((i) => !ok(i))
  kept.push("CREATE UNIQUE INDEX idx_partners_nif ON partners (nif) WHERE nif IS NOT NULL AND nif != ''")
  kept.push("CREATE UNIQUE INDEX idx_partners_email ON partners (email) WHERE email IS NOT NULL AND email != ''")
  col.indexes = kept
  app.save(col)
}, (app) => {
  // DOWN: tornar als índexs únics sense filtre.
  const ok = (i) => {
    const s = String(i)
    return s.indexOf('idx_partners_nif') !== -1 || s.indexOf('idx_partners_email') !== -1
  }
  const col = app.findCollectionByNameOrId('partners')
  const kept = (col.indexes || []).filter((i) => !ok(i))
  kept.push('CREATE UNIQUE INDEX idx_partners_nif ON partners (nif)')
  kept.push('CREATE UNIQUE INDEX idx_partners_email ON partners (email)')
  col.indexes = kept
  app.save(col)
})

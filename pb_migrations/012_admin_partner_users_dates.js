/// <reference path="../pb_hooks/types.d.ts" />
// =====================================================================
// PRM POLSER — Migració 012: camps de data a `partner_users`
// ---------------------------------------------------------------
// PB 0.40.3 retorna 400 en ordenar per els camps interns `created`/
// `updated` (bug/limitació de la versió). Totes les col·leccions de
// negoci tenen el camp `created_at` (autodate) per ordenar, però
// `partner_users` (auth) no en tenia. S'afegeixen aquí perquè el panell
// `/admin` pugui llistar els usuaris per data de creació.
//
// NOTA (JSVM PB 0.40.3): calen INSTÀNCIES de camp (AutodateField).
// =====================================================================

migrate((app) => {
  const col = app.findCollectionByNameOrId('partner_users')
  let changed = false

  if (!col.fields.getByName('created_at')) {
    col.fields.add(new AutodateField({ name: 'created_at', onCreate: true, onUpdate: false }))
    changed = true
  }
  if (!col.fields.getByName('updated_at')) {
    col.fields.add(new AutodateField({ name: 'updated_at', onCreate: true, onUpdate: true }))
    changed = true
  }

  if (changed) app.save(col)
}, (app) => {
  const col = app.findCollectionByNameOrId('partner_users')
  let changed = false
  if (col.fields.getByName('created_at')) { col.fields.removeByName('created_at'); changed = true }
  if (col.fields.getByName('updated_at')) { col.fields.removeByName('updated_at'); changed = true }
  if (changed) app.save(col)
})

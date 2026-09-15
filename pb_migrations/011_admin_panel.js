/// <reference path="../pb_hooks/types.d.ts" />
// =====================================================================
// PRM POLSER — Migració 011: suport del panell d'administració
// ---------------------------------------------------------------
// El panell /admin s'autentica amb un SUPERUSUARI de PocketBase, de
// manera que NO calen canvis de regles a les col·leccions de negoci
// (el superusuari les ignora). Aquesta migració només afegeix:
//
//   1. `partner_users.disabled` (bool) — per desactivar comptes del
//      portal sense esborrar-los. S'usa `disabled` (default false) i no
//      `active` perquè un bool existent queda a false en afegir el camp:
//      així els comptes preexistents NO es desactiven per accident.
//
//   2. Col·lecció `admin_audit` (base, només superusuari) — traçabilitat
//      de les accions del panell (RGPD: qui ha vist/modificat què).
//
// NOTA (JSVM PB 0.40.3): per afegir camps a una col·lecció existent calen
// INSTÀNCIES de camp (new BoolField), no objectes plans (migració 005).
// =====================================================================

migrate((app) => {
  // ---------------------------------------------------------------
  // 1. partner_users.disabled
  // ---------------------------------------------------------------
  const users = app.findCollectionByNameOrId('partner_users')
  if (!users.fields.getByName('disabled')) {
    users.fields.add(new BoolField({ name: 'disabled' }))
    app.save(users)
  }

  // ---------------------------------------------------------------
  // 2. admin_audit — registre d'accions del panell
  // ---------------------------------------------------------------
  let existing = null
  try {
    existing = app.findCollectionByNameOrId('admin_audit')
  } catch (_) {
    existing = null
  }
  if (!existing) {
    const audit = new Collection({
      name: 'admin_audit',
      type: 'base',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: 'text', name: 'actor', max: 200 },
        { type: 'select', name: 'action', required: true, values: ['create', 'update', 'delete', 'invite', 'send', 'login', 'view_pii', 'other'] },
        { type: 'text', name: 'entity', max: 100 },
        { type: 'text', name: 'entity_id', max: 100 },
        { type: 'json', name: 'payload' },
        { type: 'text', name: 'ip', max: 64 },
        { type: 'autodate', name: 'created_at', onCreate: true, onUpdate: false },
      ],
      indexes: ['CREATE INDEX idx_admin_audit_created ON admin_audit (created_at)'],
    })
    app.save(audit)
  }
}, (app) => {
  // DOWN
  try {
    const audit = app.findCollectionByNameOrId('admin_audit')
    app.delete(audit)
  } catch (_) { /* no existia */ }

  const users = app.findCollectionByNameOrId('partner_users')
  if (users.fields.getByName('disabled')) {
    users.fields.removeByName('disabled')
    app.save(users)
  }
})

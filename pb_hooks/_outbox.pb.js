/// <reference path="./types.d.ts" />
// =====================================================================
// P2 — Outbox: cua d'events cap a Odoo (substitueix n8n)
//   Aquest fitxer NOMÉS emet (encua) events: mai crida Odoo dins del
//   request del portal.
//   El processament real cap a Odoo i el cron sync_odoo viuen a
//   _crons.pb.js (P5), únic propietari de la lògica d'outbox
//   (vegeu CRÍTIC-1 / MIG-3 de l'auditoria).
// =====================================================================

// ------------------------------------------------------------------
// outbox_emit — hook d'alta de referit (append a la cua, res de HTTP)
// ------------------------------------------------------------------
onRecordAfterCreateSuccess((e) => {
  const col = $app.findCollectionByNameOrId('outbox')
  const row = new Record(col)
  row.set('entity', 'referral')
  row.set('entity_id', e.record.id)
  row.set('action', 'create_opportunity')
  row.set('payload', { referral_id: e.record.id })
  row.set('status', 'pending')
  row.set('attempts', 0)
  $app.save(row)
}, 'referrals')

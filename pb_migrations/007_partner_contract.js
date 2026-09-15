/// <reference path="../pb_hooks/types.d.ts" />
// =====================================================================
// PRM POLSER — Migració 007: entitat legal + contracte de col·laborador
// ---------------------------------------------------------------
// Afegeix a `partners`:
//
//  Entitat legal:
//   - is_company       bool   — persona jurídica (true) / física (false)
//   - legal_rep_name   text   — representant/administrador
//   - legal_rep_nif    text   — NIF del representant
//
//  Contracte (Carbone -> Odoo Sign):
//   - contract_status       select  no|generating|pending_signature|signed|canceled|error
//   - odo_partner_id        number  — id de res.partner a Odoo
//   - odo_sign_document_id  number  — id del sign.document a Odoo
//   - contract_generated_at date
//   - contract_sent_at      date
//   - contract_signed_at    date
//   - contract_draft_file   file    — PDF generat per Carbone (esborrany)
//     (`contract_file`, ja existent, es reserva per al PDF SIGNAT)
//
// NOTA (JSVM PB 0.40.3): calen INSTÀNCIES de camp (BoolField/SelectField...).
// =====================================================================

migrate((app) => {
  const col = app.findCollectionByNameOrId('partners')
  let changed = false

  if (!col.fields.getByName('is_company')) {
    col.fields.add(new BoolField({ name: 'is_company' }))
    changed = true
  }
  if (!col.fields.getByName('legal_rep_name')) {
    col.fields.add(new TextField({ name: 'legal_rep_name', max: 200 }))
    changed = true
  }
  if (!col.fields.getByName('legal_rep_nif')) {
    col.fields.add(new TextField({ name: 'legal_rep_nif', max: 20 }))
    changed = true
  }
  if (!col.fields.getByName('contract_status')) {
    col.fields.add(new SelectField({
      name: 'contract_status',
      maxSelect: 1,
      values: ['no', 'generating', 'pending_signature', 'signed', 'canceled', 'error'],
    }))
    changed = true
  }
  if (!col.fields.getByName('odo_partner_id')) {
    col.fields.add(new NumberField({ name: 'odo_partner_id', min: null, max: null }))
    changed = true
  }
  if (!col.fields.getByName('odo_sign_document_id')) {
    col.fields.add(new NumberField({ name: 'odo_sign_document_id', min: null, max: null }))
    changed = true
  }
  if (!col.fields.getByName('contract_generated_at')) {
    col.fields.add(new DateField({ name: 'contract_generated_at' }))
    changed = true
  }
  if (!col.fields.getByName('contract_sent_at')) {
    col.fields.add(new DateField({ name: 'contract_sent_at' }))
    changed = true
  }
  if (!col.fields.getByName('contract_signed_at')) {
    col.fields.add(new DateField({ name: 'contract_signed_at' }))
    changed = true
  }
  if (!col.fields.getByName('contract_draft_file')) {
    col.fields.add(new FileField({ name: 'contract_draft_file', maxSelect: 1 }))
    changed = true
  }

  if (changed) app.save(col)
}, (app) => {
  // DOWN: eliminar camps si existeixen
  const col = app.findCollectionByNameOrId('partners')
  let changed = false
  const names = [
    'is_company', 'legal_rep_name', 'legal_rep_nif', 'contract_status',
    'odo_partner_id', 'odo_sign_document_id', 'contract_generated_at',
    'contract_sent_at', 'contract_signed_at', 'contract_draft_file',
  ]
  for (const n of names) {
    if (col.fields.getByName(n)) { col.fields.removeByName(n); changed = true }
  }
  if (changed) app.save(col)
})
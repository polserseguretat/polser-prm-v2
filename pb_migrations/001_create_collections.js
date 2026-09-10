/// <reference path="../pb_hooks/types.d.ts" />
// =====================================================================
// PRM POLSER — Migració 001: creació de col·leccions (P1)
// Port de schema/01__schema.sql + 02__seed.sql (Directus/PostgreSQL) a
// PocketBase. Tipus: diners en CÈNTIMS (enters), select per enums,
// autodate per created/updated, date per dates de negoci.
// =====================================================================

// helper per crear una col·lecció i retornar el seu id
function createCollection(app, def) {
  const c = new Collection(def)
  app.save(c)
  return c.id
}

function idOf(app, name) {
  return app.findCollectionByNameOrId(name).id
}

migrate((app) => {
  // ---------------------------------------------------------------
  // 1. services — catàleg (alta_fee / monthly_fee en cèntims)
  // ---------------------------------------------------------------
  const servicesId = createCollection(app, {
    name: 'services',
    type: 'base',
    listRule: '',
    viewRule: '',
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: 'text', name: 'code', required: true, max: 50 },
      { type: 'text', name: 'name', required: true, max: 200 },
      { type: 'select', name: 'category', required: true, values: ['alarma', 'videovigilancia', 'manteniment'] },
      { type: 'select', name: 'sector', required: true, values: ['residencial', 'negocio', 'comunidades', 'industria'] },
      { type: 'number', name: 'alta_fee', min: null, max: null },            // cèntims
      { type: 'number', name: 'monthly_fee', min: null, max: null },         // cèntims
      { type: 'bool', name: 'iva_included' },
      { type: 'json', name: 'details' },
      { type: 'bool', name: 'active' },
      { type: 'autodate', name: 'created_at', onCreate: true, onUpdate: false },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_services_code ON services (code)'],
  })

  // ---------------------------------------------------------------
  // 2. partners — organitzacions
  // ---------------------------------------------------------------
  const partnersId = createCollection(app, {
    name: 'partners',
    type: 'base',
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: 'text', name: 'name', required: true, max: 200 },
      { type: 'select', name: 'profile', required: true, values: ['afiliat', 'colaborador'] },
      { type: 'select', name: 'type', required: true, values: ['inmobiliaria', 'administrador_fincas', 'operador_telecom', 'autonomo', 'otro'] },
      { type: 'text', name: 'nif', max: 20 },
      { type: 'email', name: 'email' },
      { type: 'text', name: 'phone', max: 50 },
      { type: 'text', name: 'address', max: 300 },
      { type: 'select', name: 'status', required: true, values: ['pendente', 'actiu', 'inactiu', 'bloquejat'] },
      { type: 'date', name: 'activation_date' },
      { type: 'file', name: 'contract_file', maxSelect: 1 },
      { type: 'text', name: 'notes', max: 2000 },
      { type: 'autodate', name: 'created_at', onCreate: true, onUpdate: false },
      { type: 'autodate', name: 'updated_at', onCreate: true, onUpdate: true },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_partners_nif ON partners (nif)', 'CREATE UNIQUE INDEX idx_partners_email ON partners (email)'],
  })

  // ---------------------------------------------------------------
  // 3. partner_users — auth (portal accounts, email + OTP)
  //    Neix actiu i verificat (P4); password no obligatori.
  // ---------------------------------------------------------------
  const partnerUsersId = createCollection(app, {
    name: 'partner_users',
    type: 'auth',
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: 'select', name: 'role', required: true, values: ['partner', 'POLSER_cpso', 'POLSER_admin', 'POLSER_ceo'] },
      { type: 'relation', name: 'partner', collectionId: partnersId, maxSelect: 1, cascadeDelete: false, minSelect: 0 },
      { type: 'text', name: 'name', max: 200 },
    ],
    passwordAuth: { enabled: false },
    otp: { enabled: true },
    // authRule="" (no null): a PB, null vol dir que NINGU actua com a usuari
    // autenticat d'aquesta col·lecció -> el login OTP retornava 403
    // "doesn't satisfy the collection requirements to authenticate".
    // Amb "" qualsevol pot autenticar-se (el flux el controla l'OTP del portal).
    authRule: '',
    indexes: ['CREATE INDEX idx_partner_users_partner ON partner_users (partner)'],
  })

  // ---------------------------------------------------------------
  // 4. partner_members — vincle partner ↔ user auth
  // ---------------------------------------------------------------
  const partnerMembersId = createCollection(app, {
    name: 'partner_members',
    type: 'base',
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: 'relation', name: 'partner', collectionId: partnersId, maxSelect: 1, cascadeDelete: true, minSelect: 1, required: true },
      { type: 'relation', name: 'user', collectionId: partnerUsersId, maxSelect: 1, cascadeDelete: true, minSelect: 1, required: true },
      { type: 'select', name: 'role_in_partner', required: true, values: ['owner', 'editor', 'viewer'] },
      { type: 'autodate', name: 'created_at', onCreate: true, onUpdate: false },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_partner_members_unique ON partner_members (partner, user)'],
  })

  // ---------------------------------------------------------------
  // 5. referrals — la venta (RGPD: camps client_* ocults a l'API)
  // ---------------------------------------------------------------
  const referralsId = createCollection(app, {
    name: 'referrals',
    type: 'base',
    listRule: '@request.auth.id != "" && partner = @request.auth.partner',
    viewRule: '@request.auth.id != "" && partner = @request.auth.partner',
    createRule: '@request.auth.id != "" && partner = @request.auth.partner',
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: 'relation', name: 'partner', collectionId: partnersId, maxSelect: 1, cascadeDelete: false, minSelect: 0 },
      { type: 'text', name: 'referral_code', max: 50 },
      { type: 'text', name: 'client_name', max: 200, hidden: true },        // RGPD
      { type: 'text', name: 'client_phone', max: 50, hidden: true },        // RGPD
      { type: 'email', name: 'client_email', hidden: true },                // RGPD
      { type: 'text', name: 'client_address', max: 300, hidden: true },     // RGPD
      { type: 'relation', name: 'service', collectionId: servicesId, maxSelect: 1, cascadeDelete: false, minSelect: 0 },
      { type: 'select', name: 'service_type', values: ['alarma', 'videovigilancia', 'manteniment'] },
      { type: 'select', name: 'status', required: true, values: ['lead', 'contactado', 'presupuesto', 'aceptado', 'instalado', 'perdido'] },
      { type: 'date', name: 'stage_date', required: true },
      { type: 'number', name: 'estimated_value', min: null, max: null },     // cèntims
      { type: 'number', name: 'final_value', min: null, max: null },         // cèntims
      { type: 'bool', name: 'active_subscription' },
      { type: 'number', name: 'odo_opportunity_id', min: null, max: null },
      { type: 'number', name: 'odo_customer_id', min: null, max: null },
      { type: 'number', name: 'odo_sale_id', min: null, max: null },
      { type: 'select', name: 'odoo_sync_status', required: true, values: ['pendiente', 'ok', 'error'] },
      { type: 'select', name: 'source', required: true, values: ['portal', 'whatsapp', 'email', 'telefono', 'web'] },
      { type: 'bool', name: 'self_referral' },
      { type: 'text', name: 'notes', max: 2000 },
      { type: 'autodate', name: 'created_at', onCreate: true, onUpdate: false },
      { type: 'autodate', name: 'updated_at', onCreate: true, onUpdate: true },
    ],
    indexes: [
      'CREATE INDEX idx_referrals_partner ON referrals (partner)',
      'CREATE INDEX idx_referrals_status ON referrals (status)',
      'CREATE INDEX idx_referrals_odo_opp ON referrals (odo_opportunity_id)',
    ],
  })

  // ---------------------------------------------------------------
  // 6. referral_events — històric (append-only hook)
  // ---------------------------------------------------------------
  const referralEventsId = createCollection(app, {
    name: 'referral_events',
    type: 'base',
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: 'relation', name: 'referral', collectionId: referralsId, maxSelect: 1, cascadeDelete: true, minSelect: 1, required: true },
      { type: 'select', name: 'from_status', values: ['lead', 'contactado', 'presupuesto', 'aceptado', 'instalado', 'perdido'] },
      { type: 'select', name: 'to_status', required: true, values: ['lead', 'contactado', 'presupuesto', 'aceptado', 'instalado', 'perdido'] },
      { type: 'text', name: 'reason', max: 2000 },
      { type: 'text', name: 'lost_reason', max: 2000 },
      { type: 'autodate', name: 'created_at', onCreate: true, onUpdate: false },
    ],
    indexes: ['CREATE INDEX idx_events_referral ON referral_events (referral)'],
  })

  // ---------------------------------------------------------------
  // 7. commission_rules — espejo; el valor final el dicta Odoo
  // ---------------------------------------------------------------
  const commissionRulesId = createCollection(app, {
    name: 'commission_rules',
    type: 'base',
    listRule: '',
    viewRule: '',
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: 'text', name: 'name', required: true, max: 200 },
      { type: 'select', name: 'profile', required: true, values: ['afiliat', 'colaborador', 'all'] },
      { type: 'select', name: 'kind', required: true, values: ['high', 'recurring', 'adjustment', 'reversal'] },
      { type: 'relation', name: 'service', collectionId: servicesId, maxSelect: 1, cascadeDelete: true, minSelect: 0 },
      { type: 'number', name: 'fixed_amount', min: null, max: null },        // cèntims
      { type: 'number', name: 'rate', min: null, max: null },                // 0.10
      { type: 'text', name: 'base', max: 50 },                               // 'monthly_fee' | 'amount_invoiced'
      { type: 'bool', name: 'allow_recurring' },
      { type: 'relation', name: 'partner_override', collectionId: partnersId, maxSelect: 1, cascadeDelete: true, minSelect: 0 },
      { type: 'bool', name: 'active' },
      { type: 'date', name: 'valid_from' },
      { type: 'date', name: 'valid_to' },
      { type: 'autodate', name: 'created_at', onCreate: true, onUpdate: false },
    ],
  })

  // ---------------------------------------------------------------
  // 8. wallet_ledger — IMMUTABLE, enters signats (cèntims), UNIQUE recurrent
  // ---------------------------------------------------------------
  const walletLedgerId = createCollection(app, {
    name: 'wallet_ledger',
    type: 'base',
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: 'relation', name: 'partner', collectionId: partnersId, maxSelect: 1, cascadeDelete: true, minSelect: 1, required: true },
      { type: 'relation', name: 'referral', collectionId: referralsId, maxSelect: 1, cascadeDelete: false, minSelect: 0 },
      { type: 'select', name: 'type', required: true, values: ['high', 'recurring', 'adjustment', 'payout_deduction', 'reversal'] },
      { type: 'number', name: 'amount', required: true, min: null, max: null }, // cèntims signats
      { type: 'text', name: 'period', max: 7 },                                // YYYY-MM
      { type: 'select', name: 'status', required: true, values: ['accrued', 'poised', 'paid', 'reversed', 'void'] },
      { type: 'text', name: 'description', max: 500 },
      { type: 'autodate', name: 'created_at', onCreate: true, onUpdate: false },
    ],
    indexes: ['CREATE INDEX idx_ledger_partner ON wallet_ledger (partner)'],
  })

  // ---------------------------------------------------------------
  // 9. payouts — retirades (mínim 100 € = 10000 cèntims)
  // ---------------------------------------------------------------
  const payoutsId = createCollection(app, {
    name: 'payouts',
    type: 'base',
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: 'relation', name: 'partner', collectionId: partnersId, maxSelect: 1, cascadeDelete: true, minSelect: 1, required: true },
      { type: 'number', name: 'amount', required: true, min: null, max: null }, // cèntims
      { type: 'text', name: 'invoice_reference', max: 100 },
      { type: 'date', name: 'invoice_received_at' },
      { type: 'select', name: 'status', required: true, values: ['solicitada', 'factura_rebuda', 'en_proces', 'pagada'] },
      { type: 'date', name: 'paid_at' },
      { type: 'number', name: 'odo_vendor_bill_id', min: null, max: null },
      { type: 'autodate', name: 'created_at', onCreate: true, onUpdate: false },
    ],
    indexes: ['CREATE INDEX idx_payouts_partner ON payouts (partner)'],
  })

  // ---------------------------------------------------------------
  // 10. interactions — log CPSO
  // ---------------------------------------------------------------
  const interactionsId = createCollection(app, {
    name: 'interactions',
    type: 'base',
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: 'relation', name: 'partner', collectionId: partnersId, maxSelect: 1, cascadeDelete: true, minSelect: 0 },
      { type: 'relation', name: 'referral', collectionId: referralsId, maxSelect: 1, cascadeDelete: false, minSelect: 0 },
      { type: 'select', name: 'channel', required: true, values: ['whatsapp', 'email', 'telegram', 'telefono', 'portal'] },
      { type: 'select', name: 'direction', required: true, values: ['inbound', 'outbound'] },
      { type: 'select', name: 'type', required: true, values: ['onboarding', 'followup', 'reactivation', 'info', 'complaint'] },
      { type: 'text', name: 'summary', max: 2000 },
      { type: 'select', name: 'outcome', required: true, values: ['positive', 'neutral', 'negative', 'pending'] },
      { type: 'autodate', name: 'created_at', onCreate: true, onUpdate: false },
    ],
    indexes: ['CREATE INDEX idx_interactions_partner ON interactions (partner)'],
  })

  // ---------------------------------------------------------------
  // 11. documents — materials/push
  // ---------------------------------------------------------------
  const documentsId = createCollection(app, {
    name: 'documents',
    type: 'base',
    listRule: '',
    viewRule: '',
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: 'text', name: 'title', required: true, max: 200 },
      { type: 'text', name: 'type', max: 50 },
      { type: 'text', name: 'category', max: 100 },
      { type: 'file', name: 'file', maxSelect: 1 },
      { type: 'text', name: 'version', max: 20 },
      { type: 'bool', name: 'published' },
      { type: 'autodate', name: 'updated_at', onCreate: true, onUpdate: true },
    ],
  })

  // ---------------------------------------------------------------
  // 12. notifications — campanyes on-demand
  // ---------------------------------------------------------------
  const notificationsId = createCollection(app, {
    name: 'notifications',
    type: 'base',
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: 'text', name: 'title', required: true, max: 200 },
      { type: 'text', name: 'body', max: 5000 },
      { type: 'file', name: 'image', maxSelect: 1 },
      { type: 'select', name: 'audience', required: true, values: ['all', 'afiliats', 'colaboradors'] },
      { type: 'select', name: 'channel', required: true, values: ['inapp', 'push', 'both'] },
      { type: 'date', name: 'scheduled_at' },
      { type: 'date', name: 'sent_at' },
      { type: 'select', name: 'status', required: true, values: ['draft', 'queued', 'sent', 'failed'] },
      { type: 'autodate', name: 'created_at', onCreate: true, onUpdate: false },
      { type: 'autodate', name: 'updated_at', onCreate: true, onUpdate: true },
    ],
  })

  // ---------------------------------------------------------------
  // 13. notification_deliveries — UNIQUE(notification, user)
  // ---------------------------------------------------------------
  const notificationDeliveriesId = createCollection(app, {
    name: 'notification_deliveries',
    type: 'base',
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: 'relation', name: 'notification', collectionId: notificationsId, maxSelect: 1, cascadeDelete: true, minSelect: 1, required: true },
      { type: 'relation', name: 'user', collectionId: partnerUsersId, maxSelect: 1, cascadeDelete: true, minSelect: 1, required: true },
      { type: 'date', name: 'delivered_at' },
      { type: 'date', name: 'read_at' },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_deliveries_unique ON notification_deliveries (notification, user)'],
  })

  // ---------------------------------------------------------------
  // 14. odoo_sync_log — auditoria (es manté per compatibilitat; la
  //     font operativa és la taula `outbox` de P2)
  // ---------------------------------------------------------------
  const odooSyncLogId = createCollection(app, {
    name: 'odoo_sync_log',
    type: 'base',
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: 'select', name: 'entity', required: true, values: ['referral', 'partner', 'payout'] },
      { type: 'text', name: 'entity_id', max: 50 },
      { type: 'select', name: 'action', required: true, values: ['create_customer', 'create_sale', 'update_sale_status', 'read_subscription', 'create_vendor_bill', 'create_opportunity'] },
      { type: 'text', name: 'odoo_operation', max: 200 },
      { type: 'select', name: 'status', required: true, values: ['pendiente', 'ok', 'error'] },
      { type: 'text', name: 'error', max: 2000 },
      { type: 'number', name: 'attempts', min: 0, max: null },
      { type: 'autodate', name: 'created_at', onCreate: true, onUpdate: false },
      { type: 'autodate', name: 'updated_at', onCreate: true, onUpdate: true },
    ],
  })

  // ---------------------------------------------------------------
  // 15. settings — globals single-row
  // ---------------------------------------------------------------
  const settingsId = createCollection(app, {
    name: 'settings',
    type: 'base',
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: 'number', name: 'min_payout', required: true, min: 0, max: null },          // cèntims (10000 = 100 €)
      { type: 'number', name: 'payout_days', required: true, min: 0, max: null },
      { type: 'number', name: 'default_fixed_commission', required: true, min: 0, max: null }, // cèntims (6000 = 60 €)
      { type: 'number', name: 'default_recurring_rate', required: true, min: 0, max: 1 },  // 0.10
      { type: 'bool', name: 'recurring_enabled' },
      { type: 'text', name: 'invoice_concept', required: true, max: 500 },
      { type: 'number', name: 'sla_days_no_contact', required: true, min: 0, max: null },
    ],
  })

  // ---------------------------------------------------------------
  // 16. outbox — cua de sync amb Odoo (P2)
  // ---------------------------------------------------------------
  const outboxId = createCollection(app, {
    name: 'outbox',
    type: 'base',
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: 'select', name: 'entity', required: true, values: ['referral', 'partner', 'payout'] },
      { type: 'text', name: 'entity_id', max: 50 },
      { type: 'select', name: 'action', required: true, values: ['create_customer', 'create_sale', 'update_sale_status', 'read_subscription', 'create_vendor_bill', 'create_opportunity'] },
      { type: 'json', name: 'payload' },
      { type: 'select', name: 'status', required: true, values: ['pending', 'ok', 'error', 'dead'] },
      { type: 'number', name: 'attempts', min: 0, max: null },
      { type: 'text', name: 'last_error', max: 2000 },
      { type: 'autodate', name: 'created_at', onCreate: true, onUpdate: false },
      { type: 'autodate', name: 'updated_at', onCreate: true, onUpdate: true },
    ],
    indexes: ['CREATE INDEX idx_outbox_status ON outbox (status)', 'CREATE INDEX idx_outbox_entity ON outbox (entity, entity_id)'],
  })

  // ---------------------------------------------------------------
  // SEED: services + settings (02__seed.sql)
  // Diners en CÈNTIMS: 599,00 € = 59900 ; 27,99 € = 2799 ; etc.
  // ---------------------------------------------------------------
  const servicesCol = app.findCollectionByNameOrId('services')
  const seedServices = [
    ['pis', 'Per pisos', 'alarma', 'residencial', 59900, 2799, true, '{"detectors":3,"aviso_policia":true,"app":true}'],
    ['casa', 'Per cases', 'alarma', 'residencial', 74900, 2999, true, '{"detectors":5,"aviso_policia":true,"app":true}'],
    ['oficina', 'Per oficines', 'alarma', 'negocio', 54900, 2799, false, '{"detectors":3,"gestio_usuaris":true}'],
    ['botiga', 'Per botigues', 'alarma', 'negocio', 69900, 3499, false, '{"detectors":3,"sirena":true,"panic":true,"videovigilancia":true,"cameras":2}'],
    ['amida', 'A mida (residencial)', 'alarma', 'residencial', null, null, true, '{"pressupost":true}'],
    ['amida-neg', 'A mida (negoci)', 'alarma', 'negocio', null, null, false, '{"pressupost":true,"analitica_video":true}'],
  ]
  for (const [code, name, category, sector, alta_fee, monthly_fee, iva, details] of seedServices) {
    const rec = new Record(servicesCol)
    rec.set('code', code)
    rec.set('name', name)
    rec.set('category', category)
    rec.set('sector', sector)
    if (alta_fee !== null) rec.set('alta_fee', alta_fee)
    if (monthly_fee !== null) rec.set('monthly_fee', monthly_fee)
    rec.set('iva_included', iva)
    rec.set('details', JSON.parse(details))
    rec.set('active', true)
    app.save(rec)
  }

  const settingsCol = app.findCollectionByNameOrId('settings')
  const s = new Record(settingsCol)
  s.set('min_payout', 10000)
  s.set('payout_days', 15)
  s.set('default_fixed_commission', 6000)
  s.set('default_recurring_rate', 0.10)
  s.set('recurring_enabled', true)
  s.set('invoice_concept', 'Assistència comercial a POLSER SEGURETAT, SL')
  s.set('sla_days_no_contact', 7)
  app.save(s)
}, (app) => {
  // down: elimina les col·leccions (ordre invers de dependències)
  const names = ['outbox', 'settings', 'odoo_sync_log', 'notification_deliveries', 'notifications', 'documents', 'interactions', 'payouts', 'wallet_ledger', 'commission_rules', 'referral_events', 'referrals', 'partner_members', 'partner_users', 'partners', 'services']
  for (const n of names) {
    try { app.delete(app.findCollectionByNameOrId(n)) } catch (_) { /* ja no existeix */ }
  }
})

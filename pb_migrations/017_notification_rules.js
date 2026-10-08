/// <reference path="../pb_hooks/types.d.ts" />
// =====================================================================
// PRM POLSER — Migració 017: regles de notificacions automàtiques
// ---------------------------------------------------------------
// Permet a l'admin crear "recordatoris predeterminats" que el cron
// `rule_processor` avalua periòdicament:
//   - periodic       : s'envia cada interval_days (p. ex. cada 14 dies).
//   - wallet_balance : s'envia als partners amb saldo disponible >= min_balance
//                      (com a màxim un cop cada cooldown_days).
//
// Cada regla genera una `notifications` (amb `rule` = id de la regla) i les
// corresponents `notification_deliveries` per als destinataris; el cron
// `push_processor` s'encarrega del push (ntfy) si channel és push/both.
//
// Camps de la col·lecció:
//   name, active, trigger_type, audience, title, body, link, channel,
//   interval_days, min_balance, cooldown_days, next_run_at, last_run_at
// =====================================================================

migrate((app) => {
  // 1. Col·lecció de regles (només superusuaris: regles d'accés null)
  const rules = new Collection({
    name: 'notification_rules',
    type: 'base',
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: 'text', name: 'name', required: true, max: 200 },
      { type: 'bool', name: 'active' },
      { type: 'select', name: 'trigger_type', required: true, values: ['periodic', 'wallet_balance'] },
      { type: 'select', name: 'audience', required: true, values: ['all', 'afiliats', 'colaboradors'] },
      { type: 'text', name: 'title', required: true, max: 200 },
      { type: 'text', name: 'body', max: 2000 },
      { type: 'text', name: 'link', max: 300 },
      { type: 'select', name: 'channel', required: true, values: ['inapp', 'push', 'both'] },
      { type: 'number', name: 'interval_days', min: 1, max: null },
      { type: 'number', name: 'min_balance', min: 0, max: null },
      { type: 'number', name: 'cooldown_days', min: 1, max: null },
      { type: 'date', name: 'next_run_at' },
      { type: 'date', name: 'last_run_at' },
      { type: 'autodate', name: 'created_at', onCreate: true, onUpdate: false },
      { type: 'autodate', name: 'updated_at', onCreate: true, onUpdate: true },
    ],
    indexes: ['CREATE INDEX idx_notification_rules_active ON notification_rules (active)'],
  })
  app.save(rules)

  // 2. notifications.rule — atribució (i deduplicació per usuari)
  const notifications = app.findCollectionByNameOrId('notifications')
  if (!notifications.fields.getByName('rule')) {
    notifications.fields.add(new RelationField({
      name: 'rule',
      collectionId: rules.id,
      maxSelect: 1,
      cascadeDelete: false,
      minSelect: 0,
    }))
    app.save(notifications)
  }
}, (app) => {
  const notifications = app.findCollectionByNameOrId('notifications')
  if (notifications.fields.getByName('rule')) {
    notifications.fields.removeByName('rule')
    app.save(notifications)
  }
  try {
    const rules = app.findCollectionByNameOrId('notification_rules')
    app.delete(rules)
  } catch (_) { /* no existeix */ }
})

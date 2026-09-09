/**
 * RBAC seed (F2) — rols, policies i permisos de Directus (plan §4).
 *
 * Idempotent: a cada arrencada comprova si ja existeixen rols/policies/permisos
 * i només crea els que falten. Els rols:
 *   - partner       : sense permisos /items directes; tota la seva data passa
 *                     per l'extensió /portal/* (aïllament server-side per
 *                     directus_users.partner). Requereix camp `partner` a
 *                     directus_users (migració 04 + hook partners).
 *   - POLSER_cpso   : CRUD de partners, referits, interaccions, documents, etc.
 *   - POLSER_admin  : CRUD de tot el domini EXCEPTE commission_rules
 *   - POLSER_ceo    : l'únic que pot escriure commission_rules (i reversals)
 *
 * NOTA (licència): Directus 12 (versió lliure) té les "custom permission rules"
 * (filtres, camps restringits, presets) gated per llicència. Per això NOMÉS es
 * creen permisos senzills (action + collection + fields ['*']). L'aïllament per
 * partner i l'ocultació de dades personals es fan a l'extensió /portal/*.
 */

const COLLECTIONS = [
  'partners',
  'partner_members',
  'referrals',
  'referral_events',
  'commission_rules',
  'wallet_ledger',
  'payouts',
  'interactions',
  'documents',
  'notifications',
  'notification_deliveries',
  'odoo_sync_log',
  'settings',
];

const ACTIONS = ['create', 'read', 'update', 'delete'] as const;

function allCollectionsPermissions(policy: string, collections: string[]): Array<Record<string, unknown>> {
  const perms: Array<Record<string, unknown>> = [];
  for (const collection of collections) {
    for (const action of ACTIONS) {
      perms.push({ policy, collection, action, fields: ['*'] });
    }
  }
  return perms;
}

const CP_SO_COLLECTIONS = ['partners', 'referrals', 'interactions', 'referral_events', 'documents'];

export default ({ init, action }: any, { services, database, getSchema, logger }: any) => {
  init('routes.after', async () => {
    try {
      const schema = await getSchema();
      const opts = { schema, knex: database, accountability: { admin: true } };

      const rolesService = new services.RolesService(opts);
      const policiesService = new services.PoliciesService(opts);
      const accessService = new services.AccessService(opts);
      const permissionsService = new services.PermissionsService(opts);

      const ROLES = [
        { name: 'POLSER_ceo', app_access: true },
        { name: 'POLSER_admin', app_access: true },
        { name: 'POLSER_cpso', app_access: true },
        { name: 'partner', app_access: false },
      ];

      const existingRoles: Array<{ id: string; name: string }> = await rolesService.readByQuery({ limit: -1 });
      const roleIdByName = new Map(existingRoles.map((r) => [r.name, r.id]));
      for (const role of ROLES) {
        if (!roleIdByName.has(role.name)) {
          const id = await rolesService.createOne({
            name: role.name,
            admin_access: false,
            app_access: role.app_access,
          });
          roleIdByName.set(role.name, id);
        }
      }

      const existingPolicies: Array<{ id: string; name: string }> = await policiesService.readByQuery({ limit: -1 });
      const policyIdByName = new Map(existingPolicies.map((p) => [p.name, p.id]));
      for (const role of ROLES) {
        if (!policyIdByName.has(role.name)) {
          const id = await policiesService.createOne({ name: role.name, app_access: role.app_access });
          policyIdByName.set(role.name, id);
        }
      }

      // Vincula cada rol amb la seva policy (directus_access)
      const existingAccess: Array<{ role: string; policy: string }> = await accessService.readByQuery({ limit: -1 });
      const accessSet = new Set(existingAccess.map((a) => `${a.role}:${a.policy}`));
      for (const role of ROLES) {
        const roleId = roleIdByName.get(role.name);
        const policyId = policyIdByName.get(role.name);
        if (roleId && policyId && !accessSet.has(`${roleId}:${policyId}`)) {
          await accessService.createOne({ role: roleId, policy: policyId });
        }
      }

      // Permisos
      const existingPerms: Array<{ policy: string; collection: string; action: string }> =
        await permissionsService.readByQuery({ limit: -1 });
      const permSet = new Set(existingPerms.map((p) => `${p.policy}:${p.collection}:${p.action}`));

      const permissionDefs: Array<Record<string, unknown>> = [
        // ---- partner: catàleg + fitxers per baixar materials; la resta passa per /portal/* ----
        { policy: 'partner', collection: 'services', action: 'read', fields: ['*'] },
        { policy: 'partner', collection: 'directus_files', action: 'read', fields: ['*'] },
        // ---- cpso: operativa comercial ----
        ...allCollectionsPermissions('POLSER_cpso', CP_SO_COLLECTIONS),
        { policy: 'POLSER_cpso', collection: 'wallet_ledger', action: 'read', fields: ['*'] },
        { policy: 'POLSER_cpso', collection: 'commission_rules', action: 'read', fields: ['*'] },
        { policy: 'POLSER_cpso', collection: 'payouts', action: 'read', fields: ['*'] },
        { policy: 'POLSER_cpso', collection: 'notifications', action: 'read', fields: ['*'] },
        { policy: 'POLSER_cpso', collection: 'odoo_sync_log', action: 'read', fields: ['*'] },
        // admin: tot el domini excepte commission_rules
        ...allCollectionsPermissions('POLSER_admin', COLLECTIONS.filter((c) => c !== 'commission_rules')),
        // ceo: tot, inclòs commission_rules
        ...allCollectionsPermissions('POLSER_ceo', COLLECTIONS),
      ];

      for (const perm of permissionDefs) {
        const policyId = policyIdByName.get(perm.policy as string);
        if (!policyId) continue;
        const key = `${policyId}:${perm.collection}:${perm.action}`;
        if (!permSet.has(key)) {
          await permissionsService.createOne({ ...perm, policy: policyId });
        }
      }

      logger.info('[rbac] rols i permisos verificats/creats');
    } catch (err) {
      logger.error(`[rbac] error inicialitzant RBAC: ${(err as Error).message}`);
    }
  });
};
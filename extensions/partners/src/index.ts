/**
 * Sincronitza directus_users.partner amb partner_members (F4).
 *
 * Necessita la migració 04 (camp `partner` a directus_users). A l'arrencada
 * fa un backfill i manté el valor en sync quan es creen/modifiquen/eliminen
 * vincles de partner_members. El valor s'usa a l'extensió /portal/* per a
 * l'aïllament per partner.
 */

export default ({ init, action }: any, { database, logger }: any) => {
  const clearUsersWithoutPartner = async () => {
    const users = await database('partner_members').distinct('user');
    const userIds = users.map((u: { user: string }) => u.user);
    await database('directus_users')
      .update({ partner: null })
      .whereNotIn('id', userIds.length ? userIds : ['00000000-0000-0000-0000-000000000000']);
  };

  const syncUser = async (userId: string) => {
    if (!userId) return;
    const row = await database('partner_members').select('partner').whereRaw('"user" = ?', [userId]).first();
    await database('directus_users').where('id', userId).update({ partner: row ? row.partner : null });
  };

  init('routes.after', async () => {
    try {
      const members: Array<{ user: string; partner: string }> = await database('partner_members').select('user', 'partner');
      for (const m of members) {
        await database('directus_users').where('id', m.user).update({ partner: m.partner });
      }
      await clearUsersWithoutPartner();
      logger.info('[partners] directus_users.partner sincronitzat');
    } catch (err) {
      logger.error(`[partners] error sincronitzant directus_users.partner: ${(err as Error).message}`);
    }
  });

  action('partner_members.items.create', async (meta: any) => {
    try {
      const item = await database('partner_members').where('id', meta.key).first();
      if (item) await syncUser(item.user);
    } catch (err) {
      logger.error(`[partners] error en create: ${(err as Error).message}`);
    }
  });

  action('partner_members.items.update', async (meta: any) => {
    try {
      const keys = Array.isArray(meta.keys) ? meta.keys : [meta.key];
      for (const key of keys) {
        const item = await database('partner_members').where('id', key).first();
        if (item) await syncUser(item.user);
      }
    } catch (err) {
      logger.error(`[partners] error en update: ${(err as Error).message}`);
    }
  });

  action('partner_members.items.delete', async () => {
    try {
      await clearUsersWithoutPartner();
    } catch (err) {
      logger.error(`[partners] error netejant partner després de delete: ${(err as Error).message}`);
    }
  });
};
// src/index.ts
var src_default = ({ init, action }, { database, logger }) => {
  const clearUsersWithoutPartner = async () => {
    const users = await database("partner_members").distinct("user");
    const userIds = users.map((u) => u.user);
    await database("directus_users").update({ partner: null }).whereNotIn("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
  };
  const syncUser = async (userId) => {
    if (!userId) return;
    const row = await database("partner_members").select("partner").whereRaw('"user" = ?', [userId]).first();
    await database("directus_users").where("id", userId).update({ partner: row ? row.partner : null });
  };
  init("routes.after", async () => {
    try {
      const members = await database("partner_members").select("user", "partner");
      for (const m of members) {
        await database("directus_users").where("id", m.user).update({ partner: m.partner });
      }
      await clearUsersWithoutPartner();
      logger.info("[partners] directus_users.partner sincronitzat");
    } catch (err) {
      logger.error(`[partners] error sincronitzant directus_users.partner: ${err.message}`);
    }
  });
  action("partner_members.items.create", async (meta) => {
    try {
      const item = await database("partner_members").where("id", meta.key).first();
      if (item) await syncUser(item.user);
    } catch (err) {
      logger.error(`[partners] error en create: ${err.message}`);
    }
  });
  action("partner_members.items.update", async (meta) => {
    try {
      const keys = Array.isArray(meta.keys) ? meta.keys : [meta.key];
      for (const key of keys) {
        const item = await database("partner_members").where("id", key).first();
        if (item) await syncUser(item.user);
      }
    } catch (err) {
      logger.error(`[partners] error en update: ${err.message}`);
    }
  });
  action("partner_members.items.delete", async () => {
    try {
      await clearUsersWithoutPartner();
    } catch (err) {
      logger.error(`[partners] error netejant partner despr\xE9s de delete: ${err.message}`);
    }
  });
};
export {
  src_default as default
};

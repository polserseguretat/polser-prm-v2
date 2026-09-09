import { randomBytes } from 'node:crypto';
import { ForbiddenError, InvalidPayloadError } from '@directus/errors';

/**
 * API del Portal de Partners (F4) — /portal/*
 *
 * Per què aquesta extensió i no permisos de Directus? Directus 12 (versió lliure)
 * té "custom permission rules" (filtres/camps/presets en permisos) gated per
 * llicència. Per tant l'aïllament per partner es fa AQUÍ, server-side, amb
 * consultes directes (knex) escopides per directus_users.partner. El portal
 * només fa servir aquests endpoints (mai /items directament).
 *
 * Totes les rutes requereixen autenticació (middleware `authenticate` de
 * Directus) i que l'usuari tingui un `partner` assignat.
 */

const REFERRAL_FIELDS = [
  'id',
  'partner',
  'referral_code',
  'service',
  'service_type',
  'status',
  'stage_date',
  'estimated_value',
  'source',
  'created_at',
  'updated_at',
];

export default {
  id: 'portal',
  handler(router: any, { database, logger }: any) {
    const getContext = async (req: any) => {
      const userId = req.accountability?.user;
      if (!userId) throw new ForbiddenError({ reason: 'Autenticació requerida.' });

      const user = await database('directus_users').select('id', 'email', 'role', 'partner').where('id', userId).first();
      if (!user || !user.partner) {
        throw new ForbiddenError({ reason: 'L\'usuari no té cap partner assignat.' });
      }
      return user;
    };

    // --- Perfil ---
    router.get('/me', async (req: any, res: any, next: any) => {
      try {
        const user = await getContext(req);
        const partner = await database('partners').where('id', user.partner).first();
        res.json({
          data: {
            user: { id: user.id, email: user.email, role: user.role },
            partner,
          },
        });
      } catch (err) {
        next(err);
      }
    });

    // --- Catàleg de serveis ---
    router.get('/services', async (req: any, res: any, next: any) => {
      try {
        await getContext(req);
        const rows = await database('services').where('active', true).orderBy('name', 'asc');
        res.json({ data: rows });
      } catch (err) {
        next(err);
      }
    });

    // --- Referits (només els del partner, sense dades personals) ---
    router.get('/referrals', async (req: any, res: any, next: any) => {
      try {
        const user = await getContext(req);
        const rows = await database('referrals')
          .select(...REFERRAL_FIELDS)
          .where('partner', user.partner)
          .orderBy('created_at', 'desc');
        res.json({ data: rows });
      } catch (err) {
        next(err);
      }
    });

    router.get('/referrals/:id', async (req: any, res: any, next: any) => {
      try {
        const user = await getContext(req);
        const row = await database('referrals')
          .select(...REFERRAL_FIELDS)
          .where({ id: req.params.id, partner: user.partner })
          .first();
        if (!row) throw new ForbiddenError({ reason: 'Referit no trobat.' });
        res.json({ data: row });
      } catch (err) {
        next(err);
      }
    });

    router.get('/referrals/:id/events', async (req: any, res: any, next: any) => {
      try {
        const user = await getContext(req);
        const rows = await database('referral_events as e')
          .join('referrals as r', 'r.id', 'e.referral')
          .select('e.id', 'e.from_status', 'e.to_status', 'e.reason', 'e.lost_reason', 'e.created_at')
          .where({ 'r.id': req.params.id, 'r.partner': user.partner })
          .orderBy('e.created_at', 'asc');
        res.json({ data: rows });
      } catch (err) {
        next(err);
      }
    });

    router.post('/referrals', async (req: any, res: any, next: any) => {
      try {
        const user = await getContext(req);
        const body = req.body ?? {};
        const client_name = String(body.client_name ?? '').trim();
        const service = String(body.service ?? '').trim();

        if (!client_name || !service) {
          throw new InvalidPayloadError({ reason: 'client_name i service són obligatoris.' });
        }

        const referral_code = `REF-${randomBytes(4).toString('hex').toUpperCase()}`;
        const [row] = await database('referrals')
          .insert({
            partner: user.partner,
            referral_code,
            client_name,
            client_phone: body.client_phone ? String(body.client_phone) : null,
            client_email: body.client_email ? String(body.client_email) : null,
            client_address: body.client_address ? String(body.client_address) : null,
            service,
            service_type: body.service_type ? String(body.service_type) : null,
            notes: body.notes ? String(body.notes) : null,
            source: 'portal',
            status: 'lead',
          })
          .returning(...REFERRAL_FIELDS);

        logger.info(`[portal] referit creat ${referral_code} per partner ${user.partner}`);
        res.json({ data: row });
      } catch (err) {
        next(err);
      }
    });

    // --- Cartera ---
    router.get('/wallet', async (req: any, res: any, next: any) => {
      try {
        const user = await getContext(req);
        const rows = await database('wallet_ledger')
          .select('id', 'type', 'amount', 'period', 'status', 'description', 'created_at')
          .where('partner', user.partner)
          .orderBy('created_at', 'desc');
        res.json({ data: rows });
      } catch (err) {
        next(err);
      }
    });

    router.post('/payouts', async (req: any, res: any, next: any) => {
      try {
        const user = await getContext(req);
        const amount = Number(req.body?.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          throw new InvalidPayloadError({ reason: 'Quantitat no vàlida.' });
        }
        const [row] = await database('payouts')
          .insert({ partner: user.partner, amount, status: 'solicitada' })
          .returning('id', 'amount', 'status', 'created_at');
        res.json({ data: row });
      } catch (err) {
        next(err);
      }
    });

    // --- Materials (publicats) ---
    router.get('/documents', async (req: any, res: any, next: any) => {
      try {
        await getContext(req);
        const rows = await database('documents')
          .select('id', 'title', 'type', 'category', 'file', 'version', 'updated_at')
          .where('published', true)
          .orderBy('updated_at', 'desc');
        res.json({ data: rows });
      } catch (err) {
        next(err);
      }
    });

    // --- Notificacions ---
    router.get('/notifications', async (req: any, res: any, next: any) => {
      try {
        await getContext(req);
        const rows = await database('notifications')
          .select('id', 'title', 'body', 'image', 'created_at')
          .where('status', 'sent')
          .orderBy('created_at', 'desc');
        res.json({ data: rows });
      } catch (err) {
        next(err);
      }
    });
  },
};
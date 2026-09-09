import { createHash, randomInt } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { InvalidCredentialsError, InvalidPayloadError } from '@directus/errors';

/**
 * Auth OTP — login sense contrasenya per a partners (plan §6.6, F3).
 *
 * L'extensió es munta a /auth-otp (Directus prefixa els endpoints pel nom):
 *   POST /auth-otp/request-otp   -> valida email de partner actiu i genera el codi
 *   POST /auth-otp/verify-otp    -> verifica el codi i emet un JWT de Directus
 *
 * El codi es guarda com a HASH (sha256) a auth_otps amb TTL i single-use.
 * L'email s'envia amb MailService si hi ha SMTP configurat; si no, es loga
 * el codi (dev) i es pot revelar a la resposta amb OTP_DEV_REVEAL=true.
 */

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_PER_HOUR = 5;

// Rate limit en memòria per email. Suficient per al portal; si algun dia hi ha
// múltiples instàncies de Directus, moure-ho a una font compartida (Redis/DB).
const requests = new Map<string, number[]>();

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isRateLimited(email: string): boolean {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const stamps = (requests.get(email) ?? []).filter((t) => now - t < windowMs);
  if (stamps.length >= OTP_MAX_PER_HOUR) {
    requests.set(email, stamps);
    return true;
  }
  stamps.push(now);
  requests.set(email, stamps);
  return false;
}

function ttlSeconds(value: string | number): number {
  if (typeof value === 'number') return value;
  const match = /^(\d+)(ms|s|m|h|d)?$/.exec(value.trim());
  if (!match) return 900;
  const n = Number(match[1]);
  switch (match[2]) {
    case 'ms':
      return Math.round(n / 1000);
    case 'h':
      return n * 3600;
    case 'd':
      return n * 86400;
    case 'm':
      return n * 60;
    default:
      return n;
  }
}

export default {
  id: 'auth-otp',
  handler(router: any, context: any) {
    const { database, env, logger, services, getSchema } = context;
    const { MailService } = services;

    router.post('/request-otp', async (req: any, res: any, next: any) => {
      try {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        if (!/^\S+@\S+\.\S+$/.test(email)) {
          return next(new InvalidPayloadError({ reason: 'Correu electrònic no vàlid.' }));
        }

        if (isRateLimited(email)) {
          // Silenciós per no revelar res i mitigar força bruta/enumeració
          return res.status(200).json({ ok: true });
        }

        const user = await database('directus_users')
          .select('id', 'email', 'status', 'role')
          .where('email', email)
          .first();

        const member = user
          ? await database('partner_members as pm')
              .join('partners as p', 'p.id', 'pm.partner')
              .select('p.status as partner_status')
              .whereRaw('pm."user" = ?', [user.id])
              .first()
          : null;

        const allowed = user && user.status === 'active' && member && member.partner_status === 'actiu';

        // Sempre respon 200 per no revelar l'existència del compte
        if (!allowed) {
          logger.info(`[auth-otp] sol·licitud per a ${email}: compte no actiu o inexistent`);
          return res.status(200).json({ ok: true });
        }

        const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

        await database('auth_otps').insert({
          email,
          code_hash: sha256(code),
          expires_at: new Date(Date.now() + OTP_TTL_MS),
          used: false,
        });

        // Neteja: caducats i usats de fa més de 24 h
        await database('auth_otps').where('expires_at', '<', new Date()).del();
        await database('auth_otps')
          .where('used', true)
          .where('created_at', '<', new Date(Date.now() - 24 * 60 * 60 * 1000))
          .del();

        try {
          const schema = await getSchema();
          const mail = new MailService({ schema, knex: database });
          await mail.send({
            to: email,
            subject: "El teu codi d'accés · Portal Partners POLSER",
            text: `El teu codi d'accés és: ${code}. Caduca en 10 minuts.`,
            html: `<p>El teu codi d'accés és:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>Caduca en 10 minuts.</p>`,
          });
        } catch (err) {
          logger.warn(`[auth-otp] no s'ha pogut enviar l'email a ${email}: ${(err as Error).message}`);
        }

        logger.info(`[auth-otp] codi generat per a ${email}`);
        if (env.OTP_DEV_REVEAL === 'true') {
          // Només desenvolupament: revela el codi per provar sense SMTP
          return res.status(200).json({ ok: true, code });
        }

        return res.status(200).json({ ok: true });
      } catch (err) {
        return next(err);
      }
    });

    router.post('/verify-otp', async (req: any, res: any, next: any) => {
      try {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';

        if (!email || !/^\d{6}$/.test(code)) {
          return next(new InvalidPayloadError({ reason: 'Dades no vàlides.' }));
        }

        const record = await database('auth_otps').where('email', email).orderBy('created_at', 'desc').first();

        const valid =
          record &&
          !record.used &&
          new Date(record.expires_at).getTime() > Date.now() &&
          record.code_hash === sha256(code);

        if (!valid) {
          throw new InvalidCredentialsError({ reason: 'Codi incorrecte o caducat.' });
        }

        await database('auth_otps').where('id', record.id).update({ used: true });

        const user = await database('directus_users').select('id', 'role').where('email', email).first();
        if (!user) {
          throw new InvalidCredentialsError({ reason: 'Usuari no trobat.' });
        }

        const ttl = env.ACCESS_TOKEN_TTL || '15m';
        const accessToken = jwt.sign(
          { id: user.id, role: user.role, app_access: false, admin_access: false },
          env.SECRET,
          { expiresIn: ttl, issuer: 'directus' },
        );

        return res.status(200).json({ access_token: accessToken, expires: ttlSeconds(ttl) });
      } catch (err) {
        return next(err);
      }
    });
  },
};
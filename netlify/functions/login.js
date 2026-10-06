import { json, sign, safeEqual } from './_auth.js';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const { ADMIN_EMAIL, ADMIN_PASSWORD, SESSION_SECRET } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !SESSION_SECRET)
    return json({ error: 'Server is missing ADMIN_EMAIL, ADMIN_PASSWORD or SESSION_SECRET.' }, 500);
  let body = {};
  try { body = await req.json(); } catch {}
  const ok = safeEqual((body.email || '').trim().toLowerCase(), ADMIN_EMAIL.trim().toLowerCase())
          & safeEqual(body.password || '', ADMIN_PASSWORD);
  if (!ok) return json({ error: 'Incorrect email or password.' }, 401);
  const maxAge = 60 * 60 * 24 * 7;
  const token = sign({ exp: Date.now() + maxAge * 1000 });
  return json({ ok: true }, 200, {
    'set-cookie': `session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`
  });
};

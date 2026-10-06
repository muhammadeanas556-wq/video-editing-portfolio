import { json } from './_auth.js';

export default async () =>
  json({ ok: true }, 200, {
    'set-cookie': 'session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'
  });

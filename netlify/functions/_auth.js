import crypto from 'node:crypto';

const secret = () => process.env.SESSION_SECRET || '';

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }
  });

export function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verify(token) {
  if (!token || !secret()) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
}

export function isAdmin(req) {
  const m = (req.headers.get('cookie') || '').match(/(?:^|;\s*)session=([^;]+)/);
  return !!verify(m && m[1]);
}

export function safeEqual(x, y) {
  const h = v => crypto.createHash('sha256').update(String(v)).digest();
  return crypto.timingSafeEqual(h(x), h(y));
}

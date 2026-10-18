// Core API for the video admin. Framework-free: takes a Web `Request`, returns a Web `Response`.
// The storage backend is injected so the exact same code runs on Netlify (Blobs) and in tests (memory).
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import VL from './video-links.cjs'; // static import so Netlify's bundler includes it

const SLOT_IDS = VL.SLOT_IDS;
const COOKIE = 'admin_session';
const SESSION_SECONDS = 60 * 60 * 12; // 12 hours
const MAX_BODY = 256 * 1024;
const LIMITS = { title: 80, cat: 80, services: 160, description: 600, url: 2048, poster: 2048 };

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

/* ------------------------------------------------------------------ helpers */
const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers
    }
  });

const sha = (v) => createHash('sha256').update(String(v)).digest();
const safeEqual = (a, b) => timingSafeEqual(sha(a), sha(b));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function cookieHeader(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

function authConfig(env) {
  const email = (env.ADMIN_EMAIL || '').trim();
  const password = env.ADMIN_PASSWORD || '';
  const secret = env.SESSION_SECRET || '';
  const missing = [];
  if (!email) missing.push('ADMIN_EMAIL');
  if (!password) missing.push('ADMIN_PASSWORD');
  if (secret.length < 32) missing.push('SESSION_SECRET (at least 32 characters)');
  if (missing.length) throw new HttpError(500, 'Server is not configured. Set these Netlify environment variables: ' + missing.join(', ') + '.');
  // Rotating the password or the secret invalidates every existing session.
  const key = createHmac('sha256', secret).update(sha(password)).digest();
  return { email, password, key };
}

function signSession(cfg) {
  const payload = Buffer.from(JSON.stringify({ e: cfg.email, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS })).toString('base64url');
  const sig = createHmac('sha256', cfg.key).update(payload).digest('base64url');
  return payload + '.' + sig;
}

function readSession(req, cfg) {
  const raw = parseCookies(req.headers.get('cookie'))[COOKIE];
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', cfg.key).update(payload).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now() / 1000) return null;
    return data;
  } catch { return null; }
}

function requireAuth(req, env) {
  const cfg = authConfig(env);
  const s = readSession(req, cfg);
  if (!s) throw new HttpError(401, 'Please sign in.');
  return s;
}

// Defence in depth on top of SameSite=Strict: a write must come from our own origin.
function requireSameOrigin(req) {
  const origin = req.headers.get('origin');
  if (!origin) return;
  let o;
  try { o = new URL(origin).host; } catch { throw new HttpError(403, 'Bad origin.'); }
  const allowed = [new URL(req.url).host, req.headers.get('host'), req.headers.get('x-forwarded-host')].filter(Boolean);
  if (!allowed.includes(o)) throw new HttpError(403, 'Cross-site requests are not allowed.');
}

async function readJson(req) {
  const ct = (req.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('application/json')) throw new HttpError(415, 'Send the request as application/json.');
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'Request is too large.');
  try { return JSON.parse(text || 'null'); } catch { throw new HttpError(400, 'The request body is not valid JSON.'); }
}

/* --------------------------------------------------------------- validation */
const emptyProject = (id) => ({ id, title: '', cat: '', services: '', description: '', url: '', shape: 'auto', poster: '', platform: '', updatedAt: null });

function text(input, field) {
  if (input == null) return '';
  if (typeof input !== 'string') throw new HttpError(422, `${field} must be text.`);
  const v = input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (v.length > LIMITS[field]) throw new HttpError(422, `${field[0].toUpperCase() + field.slice(1)} is too long (max ${LIMITS[field]} characters).`);
  return v;
}

function posterUrl(input) {
  const v = text(input, 'poster');
  if (!v) return '';
  let u;
  try { u = new URL(v); } catch { throw new HttpError(422, 'The poster image link is not a valid link.'); }
  if (u.protocol !== 'https:' || u.username || u.password) throw new HttpError(422, 'The poster image link must start with https://');
  return u.href;
}

// TikTok short links (vm.tiktok.com/…) must be turned into the full video link so they can be embedded.
async function resolveTikTokShortLink(url, fetchImpl) {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    let res;
    try {
      res = await fetchImpl(current, {
        redirect: 'manual',
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; PortfolioAdmin/1.0)' },
        signal: AbortSignal.timeout(6000)
      });
    } catch { break; }
    const loc = res.headers.get('location');
    if (!loc) break;
    let next;
    try { next = new URL(loc, current); } catch { break; }
    if (!/(^|\.)tiktok\.com$/i.test(next.hostname)) break; // never follow redirects off TikTok
    const info = VL.parse(next.origin + next.pathname);
    if (info.ok && !info.empty && !info.needsResolve) return info;
    current = next.href;
  }
  throw new HttpError(422, 'Could not open that TikTok short link. Open the video in TikTok, copy its full link (tiktok.com/@name/video/…) and paste that instead.');
}

async function buildRecord(id, input, fetchImpl) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(422, 'Invalid slot data.');
  const rawUrl = text(input.url, 'url');
  let info = VL.parse(rawUrl);
  if (!info.ok) throw new HttpError(422, info.error);
  if (info.needsResolve) info = await resolveTikTokShortLink(info.url, fetchImpl);
  const shape = input.shape == null || input.shape === '' ? 'auto' : String(input.shape);
  if (!VL.SHAPES.includes(shape)) throw new HttpError(422, 'Player shape must be automatic, vertical or horizontal.');
  const rec = {
    id,
    title: text(input.title, 'title'),
    cat: text(input.cat, 'cat'),
    services: text(input.services, 'services'),
    description: text(input.description, 'description'),
    url: info.empty ? '' : info.url,
    shape,
    poster: posterUrl(input.poster),
    platform: info.empty ? '' : info.platform,
    updatedAt: new Date().toISOString()
  };
  const blank = !rec.url && !rec.title && !rec.cat && !rec.services && !rec.description && !rec.poster;
  return { rec, blank };
}

/* ------------------------------------------------------------------ storage */
async function readSlot(store, id) {
  const v = await store.get(id, { type: 'json' });
  return v && typeof v === 'object' ? { ...emptyProject(id), ...v, id } : null;
}
async function readAll(store) {
  const all = await Promise.all(SLOT_IDS.map((id) => readSlot(store, id)));
  return all.filter(Boolean);
}
async function writeSlot(store, id, rec, blank) {
  if (blank) { await store.delete(id); return emptyProject(id); }
  await store.setJSON(id, rec);
  return rec;
}

/* ------------------------------------------------------------------- router */
export function createHandler({ getStore, env = process.env, fetchImpl = fetch } = {}) {
  const failures = new Map(); // best-effort brute-force throttle (per warm function instance)

  async function route(req, ctx) {
    const url = new URL(req.url);
    // Works whether Netlify passes the public path or the internal function path.
    const path = url.pathname.replace(/^\/\.netlify\/functions\/api/, '/api').replace(/\/+$/, '') || '/';
    const method = req.method.toUpperCase();
    const allow = (...m) => { if (!m.includes(method)) throw new HttpError(405, `Method ${method} is not allowed on ${path}.`, { allow: m.join(', ') }); };

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { allow: 'GET, POST, PUT, DELETE, OPTIONS' } });

    /* ---- auth ---- */
    if (path === '/api/login') {
      allow('POST'); requireSameOrigin(req);
      const cfg = authConfig(env);
      const ip = ctx?.ip || req.headers.get('x-nf-client-connection-ip') || 'unknown';
      const f = failures.get(ip);
      if (f && f.count >= 8 && Date.now() - f.first < 15 * 60 * 1000) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
      const body = await readJson(req);
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body?.password === 'string' ? body.password : '';
      const ok = safeEqual(email, cfg.email.toLowerCase()) && safeEqual(password, cfg.password);
      if (!ok) {
        const now = Date.now();
        failures.set(ip, !f || now - f.first > 15 * 60 * 1000 ? { count: 1, first: now } : { count: f.count + 1, first: f.first });
        await sleep(400);
        throw new HttpError(401, 'Incorrect email or password.');
      }
      failures.delete(ip);
      return json(200, { ok: true }, { 'set-cookie': cookieHeader(signSession(cfg), SESSION_SECONDS) });
    }
    if (path === '/api/logout') {
      allow('POST'); requireSameOrigin(req);
      return json(200, { ok: true }, { 'set-cookie': cookieHeader('', 0) });
    }
    if (path === '/api/session') {
      allow('GET');
      const s = requireAuth(req, env);
      return json(200, { ok: true, email: s.e });
    }
    if (path === '/api/config') {
      allow('GET'); requireAuth(req, env);
      return json(200, { cloudName: env.CLOUDINARY_CLOUD_NAME || '', uploadPreset: env.CLOUDINARY_UPLOAD_PRESET || '' });
    }

    /* ---- projects ---- */
    if (path === '/api/projects' || path === '/api/public-projects') {
      if (path === '/api/public-projects') allow('GET'); else allow('GET', 'PUT');
      const store = getStore();
      if (method === 'GET') return json(200, await readAll(store)); // public: this is the published portfolio content
      requireAuth(req, env); requireSameOrigin(req);
      const body = await readJson(req);
      if (!Array.isArray(body)) throw new HttpError(422, 'Expected a list of slots.');
      if (body.length > SLOT_IDS.length) throw new HttpError(422, 'Too many slots.');
      const seen = new Set(); const errors = {}; const built = [];
      for (const item of body) {
        const id = item && item.id;
        if (!SLOT_IDS.includes(id) || seen.has(id)) throw new HttpError(422, 'Unknown or duplicate slot ID.');
        seen.add(id);
        try { built.push({ id, ...(await buildRecord(id, item, fetchImpl)) }); }
        catch (e) { if (e instanceof HttpError) errors[id] = e.message; else throw e; }
      }
      const bad = Object.keys(errors);
      if (bad.length) throw new HttpError(422, `Nothing was saved. Fix ${bad.map((id) => 'slot ' + id.replace('slot-', '')).join(', ')} first.`, { errors });
      const projects = await Promise.all(built.map((b) => writeSlot(store, b.id, b.rec, b.blank)));
      return json(200, { projects });
    }

    const m = /^\/api\/projects\/([^/]+)$/.exec(path);
    if (m) {
      const id = decodeURIComponent(m[1]);
      allow('GET', 'PUT', 'DELETE');
      if (!SLOT_IDS.includes(id)) throw new HttpError(404, 'Unknown video slot.');
      const store = getStore();
      if (method === 'GET') return json(200, (await readSlot(store, id)) || emptyProject(id));
      requireAuth(req, env); requireSameOrigin(req);
      if (method === 'DELETE') {
        await store.delete(id);
        return json(200, { project: emptyProject(id) });
      }
      const body = await readJson(req);
      const { rec, blank } = await buildRecord(id, body, fetchImpl);
      return json(200, { project: await writeSlot(store, id, rec, blank) });
    }

    throw new HttpError(404, 'Unknown API route.');
  }

  return async function handler(req, ctx) {
    try {
      return await route(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) {
        return json(err.status, { error: err.message, ...(err.extra.errors ? { errors: err.extra.errors } : {}) }, err.extra.allow ? { allow: err.extra.allow } : {});
      }
      console.error('[api] unexpected error:', err && err.stack || err);
      const blobsMissing = err && /MissingBlobsEnvironment/i.test(String(err.name || err.constructor?.name));
      return json(500, { error: blobsMissing
        ? 'Storage is not available. This function must run on Netlify (or via `netlify dev`).'
        : 'Server error while talking to storage. Nothing was changed. Please try again.' });
    }
  };
}

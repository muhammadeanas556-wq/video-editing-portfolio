import { getStore } from '@netlify/blobs';
import { json, isAdmin } from './_auth.js';

const blank = () => Array.from({ length: 6 }, () => ({ title: '', cat: '', services: '', video: '', poster: '' }));
const clean = v => String(v ?? '').slice(0, 1000);

export default async (req) => {
  const store = getStore('portfolio');

  if (req.method === 'GET') {
    const data = await store.get('projects', { type: 'json' });
    return json(Array.isArray(data) ? data : blank());
  }

  if (req.method === 'PUT') {
    if (!isAdmin(req)) return json({ error: 'Not signed in.' }, 401);
    let body;
    try { body = await req.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }
    if (!Array.isArray(body)) return json({ error: 'Expected an array.' }, 400);
    const projects = body.slice(0, 6).map(p => ({
      title: clean(p.title), cat: clean(p.cat), services: clean(p.services),
      video: clean(p.video), poster: clean(p.poster)
    }));
    await store.setJSON('projects', projects);
    return json({ ok: true, projects });
  }

  return json({ error: 'Method not allowed' }, 405);
};

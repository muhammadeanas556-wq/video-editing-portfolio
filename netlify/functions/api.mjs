// Single Netlify Function that serves every /api/* route (all HTTP methods).
import { getStore } from '@netlify/blobs';
import { createHandler } from './_shared/app.mjs';

const handler = createHandler({
  // "strong" consistency: a save is visible on the very next read, from any region.
  getStore: () => getStore({ name: 'video-portfolio', consistency: 'strong' }),
  env: process.env
});

export default (req, context) => handler(req, context);

export const config = {
  path: ['/api', '/api/*']
};

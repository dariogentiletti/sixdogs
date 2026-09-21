// SIXDOGS live status, a Cloudflare Worker at https://live.sixdogs.gg
// Paste this whole file into the Worker's code editor (see website/DEPLOY.md, step 4).
//
// The whole subdomain exists for this one thing, so the root and /status are
// the same endpoint. Open https://live.sixdogs.gg to eyeball it.
//   POST /  or  /status   the bot sends the latest summary (needs PUSH_TOKEN)
//   GET  /  or  /status   the website reads it
//
// Needs two settings on the Worker:
//   STATUS      a KV namespace binding (stores the one latest summary)
//   PUSH_TOKEN  a secret, the same text as STATUS_PUSH_TOKEN in the bot's settings

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};
const json = (body, status = 200, extra = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, ...extra },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    // Treat the root and /status as one endpoint. The bot already pushes to
    // /status, so accepting both means no setting has to change.
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path !== '/' && path !== '/status') return json({ error: 'not found' }, 404);

    if (request.method === 'GET') {
      const saved = await env.STATUS.get('latest');
      return json(saved ?? { v: 1, state: 'unknown' }, 200, { 'cache-control': 'public, max-age=30' });
    }

    if (request.method === 'POST') {
      const auth = request.headers.get('authorization') ?? '';
      if (!env.PUSH_TOKEN || auth !== `Bearer ${env.PUSH_TOKEN}`) return json({ error: 'unauthorized' }, 401);
      const text = await request.text();
      if (text.length > 20000) return json({ error: 'too big' }, 413);
      let data;
      try { data = JSON.parse(text); } catch { return json({ error: 'not JSON' }, 400); }
      if (data?.v !== 1) return json({ error: 'unknown format' }, 400);
      await env.STATUS.put('latest', JSON.stringify(data));
      return json({ ok: true });
    }

    return json({ error: 'method not allowed' }, 405);
  },
};

/**
 * Duran Carasso — Publicador de Instagram (Cloudflare Worker, plan gratis)
 *
 * Publica y agenda carruseles en Instagram vía Instagram Graph API.
 * Sin coste de API. Aloja las imágenes él mismo (KV) para que Instagram
 * pueda leerlas por URL pública, crea el carrusel y lo publica.
 *
 * Endpoints:
 *   GET  /health            -> {ok:true}
 *   POST /publish           -> publica ahora o agenda (header x-app-secret)
 *   GET  /jobs              -> lista de posts (calendario) (header x-app-secret)
 *   POST /jobs/cancel       -> cancela un agendado (header x-app-secret)
 *   GET  /img/:id           -> sirve una imagen (público, lo lee Instagram)
 *
 * Variables (wrangler secret put / vars):
 *   IG_TOKEN      token de larga duración de Instagram Graph API
 *   IG_USER_ID    id de la cuenta de Instagram Business
 *   APP_SECRET    secreto compartido con la app (protege /publish y /jobs)
 * Bindings KV:
 *   MEDIA  (imágenes temporales)   JOBS  (posts agendados / historial)
 * Cron: cada 5 min procesa los agendados que ya toca publicar.
 */

const GRAPH = 'https://graph.facebook.com/v21.0';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,x-app-secret',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
function b64ToBytes(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function rid() {
  return crypto.randomUUID().replace(/-/g, '');
}
function bytesToB64(buf) {
  let bin = '';
  const b = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < b.length; i += chunk) bin += String.fromCharCode.apply(null, b.subarray(i, i + chunk));
  return btoa(bin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (path === '/health') return json({ ok: true });

    // Servir imagen (público: Instagram la descarga)
    if (path.startsWith('/img/')) {
      const id = path.slice(5);
      const obj = await env.MEDIA.get(id, { type: 'arrayBuffer' });
      if (!obj) return new Response('not found', { status: 404 });
      const ct = (await env.MEDIA.get(id + ':ct')) || 'image/jpeg';
      return new Response(obj, { headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400' } });
    }

    // A partir de aquí, requiere secreto
    const secret = request.headers.get('x-app-secret');
    if (!env.APP_SECRET || secret !== env.APP_SECRET) return json({ error: 'unauthorized' }, 401);

    // Leer una página de propiedad: devuelve título, texto e imágenes (base64)
    if (path === '/scrape' && request.method === 'GET') {
      const target = url.searchParams.get('url');
      if (!target || !/^https?:\/\//i.test(target)) return json({ error: 'bad_url' }, 400);
      try {
        const html = await (await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DuranCarassoBot/1.0)' } })).text();
        const pick = (re) => { const m = html.match(re); return m ? m[1].trim() : ''; };
        const title = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || pick(/<title[^>]*>([^<]+)</i);
        const desc = pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) || pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
        const bodyTxt = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
        const text = ((title ? title + '. ' : '') + (desc ? desc + ' ' : '') + bodyTxt).slice(0, 2200);
        const urls = [], seen = {};
        const addUrl = (u) => { if (!u) return; try { u = new URL(u, target).href; } catch (e) { return; } if (seen[u]) return; if (!/\.(jpe?g|png|webp)(\?|$)/i.test(u)) return; if (/logo|icon|sprite|favicon|placeholder|blank|avatar/i.test(u)) return; seen[u] = 1; urls.push(u); };
        addUrl(pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i));
        const re = /<img[^>]+(?:data-src|data-lazy-src|data-original|src)=["']([^"']+)["']/gi; let mm;
        while ((mm = re.exec(html)) && urls.length < 20) addUrl(mm[1]);
        const images = [];
        for (let i = 0; i < urls.length && images.length < 8; i++) {
          try {
            const ir = await fetch(urls[i]);
            const ct = ir.headers.get('content-type') || 'image/jpeg';
            if (!/image\//.test(ct)) continue;
            const buf = await ir.arrayBuffer();
            if (buf.byteLength < 8000 || buf.byteLength > 6000000) continue; // salta iconos y enormes
            images.push('data:' + ct + ';base64,' + bytesToB64(buf));
          } catch (e) {}
        }
        return json({ name: title, text, images });
      } catch (e) { return json({ error: 'fetch_failed', detail: String(e) }, 502); }
    }

    if (path === '/jobs' && request.method === 'GET') {
      const list = await env.JOBS.list({ prefix: 'job:' });
      const jobs = [];
      for (const k of list.keys) {
        const v = await env.JOBS.get(k.name, { type: 'json' });
        if (v) jobs.push(v);
      }
      jobs.sort((a, b) => (a.when || 0) - (b.when || 0));
      return json({ jobs });
    }

    if (path === '/jobs/cancel' && request.method === 'POST') {
      const { id } = await request.json();
      const key = 'job:' + id;
      const v = await env.JOBS.get(key, { type: 'json' });
      if (v && v.status === 'scheduled') {
        v.status = 'cancelled';
        await env.JOBS.put(key, JSON.stringify(v));
      }
      return json({ ok: true });
    }

    if (path === '/publish' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
      const { images, caption, when } = body; // images: [{b64, ct}], when: ms epoch (0/undefined = ahora)
      if (!Array.isArray(images) || images.length < 2) return json({ error: 'need_2_to_10_images' }, 400);
      if (images.length > 10) return json({ error: 'max_10_images' }, 400);

      // Guarda las imágenes en KV y construye URLs públicas
      const origin = url.origin;
      const imageUrls = [];
      const ttl = when && when > Date.now() ? Math.floor((when - Date.now()) / 1000) + 172800 : 86400;
      for (const im of images) {
        const id = rid() + '.jpg';
        await env.MEDIA.put(id, b64ToBytes(im.b64), { expirationTtl: Math.max(ttl, 3600) });
        await env.MEDIA.put(id + ':ct', im.ct || 'image/jpeg', { expirationTtl: Math.max(ttl, 3600) });
        imageUrls.push(origin + '/img/' + id);
      }

      const jobId = rid();
      const job = {
        id: jobId,
        caption: caption || '',
        imageUrls,
        when: when || 0,
        status: when && when > Date.now() ? 'scheduled' : 'publishing',
        createdAt: Date.now(),
      };
      await env.JOBS.put('job:' + jobId, JSON.stringify(job), { expirationTtl: 60 * 60 * 24 * 90 });

      if (job.status === 'scheduled') return json({ ok: true, scheduled: true, id: jobId, when: job.when });

      // Publicar ahora
      const res = await publish(job, env);
      job.status = res.ok ? 'published' : 'error';
      job.result = res;
      job.publishedAt = Date.now();
      await env.JOBS.put('job:' + jobId, JSON.stringify(job), { expirationTtl: 60 * 60 * 24 * 90 });
      return json(res, res.ok ? 200 : 502);
    }

    return json({ error: 'not_found' }, 404);
  },

  // Cron: publica los agendados que ya toca
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const list = await env.JOBS.list({ prefix: 'job:' });
      const now = Date.now();
      for (const k of list.keys) {
        const job = await env.JOBS.get(k.name, { type: 'json' });
        if (!job || job.status !== 'scheduled') continue;
        if ((job.when || 0) > now) continue;
        job.status = 'publishing';
        await env.JOBS.put(k.name, JSON.stringify(job));
        const res = await publish(job, env);
        job.status = res.ok ? 'published' : 'error';
        job.result = res;
        job.publishedAt = Date.now();
        await env.JOBS.put(k.name, JSON.stringify(job), { expirationTtl: 60 * 60 * 24 * 90 });
      }
    })());
  },
};

// Flujo de carrusel de Instagram Graph API
async function publish(job, env) {
  const token = env.IG_TOKEN, ig = env.IG_USER_ID;
  if (!token || !ig) return { ok: false, step: 'config', error: 'missing IG_TOKEN or IG_USER_ID' };
  try {
    // 1) contenedor por cada imagen
    const children = [];
    for (const imageUrl of job.imageUrls) {
      const r = await fbPost(`${GRAPH}/${ig}/media`, { image_url: imageUrl, is_carousel_item: 'true', access_token: token });
      if (!r.id) return { ok: false, step: 'child', error: r.error || r };
      children.push(r.id);
    }
    // 2) contenedor del carrusel
    const car = await fbPost(`${GRAPH}/${ig}/media`, {
      media_type: 'CAROUSEL',
      caption: job.caption || '',
      children: children.join(','),
      access_token: token,
    });
    if (!car.id) return { ok: false, step: 'carousel', error: car.error || car };
    // 3) esperar a que el contenedor esté listo
    await waitReady(car.id, token);
    // 4) publicar
    const pub = await fbPost(`${GRAPH}/${ig}/media_publish`, { creation_id: car.id, access_token: token });
    if (!pub.id) return { ok: false, step: 'publish', error: pub.error || pub };
    return { ok: true, mediaId: pub.id };
  } catch (e) {
    return { ok: false, step: 'exception', error: String(e) };
  }
}

async function fbPost(endpoint, params) {
  const form = new URLSearchParams();
  for (const k in params) form.set(k, params[k]);
  const r = await fetch(endpoint, { method: 'POST', body: form });
  return r.json();
}

async function waitReady(creationId, token, tries = 10) {
  for (let i = 0; i < tries; i++) {
    const r = await (await fetch(`${GRAPH}/${creationId}?fields=status_code&access_token=${token}`)).json();
    if (r.status_code === 'FINISHED') return true;
    if (r.status_code === 'ERROR') throw new Error('container ERROR');
    await new Promise((res) => setTimeout(res, 3000));
  }
  return false; // intentamos publicar igualmente
}

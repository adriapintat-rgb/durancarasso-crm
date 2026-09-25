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

    // Aprender de tu propio Instagram (Graph API lee TU cuenta): trae posts reales
    // -> corpus de marca (caption + tipo + imagen + engagement). Se usa como modelo.
    if (path === '/learn' && request.method === 'POST') {
      const token = env.IG_TOKEN, ig = env.IG_USER_ID;
      if (!token || !ig) return json({ error: 'missing IG_TOKEN or IG_USER_ID' }, 400);
      try {
        const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,children{media_url,media_type}';
        let next = `${GRAPH}/${ig}/media?fields=${encodeURIComponent(fields)}&limit=50&access_token=${token}`;
        const posts = [];
        for (let page = 0; page < 3 && next && posts.length < 120; page++) {
          const d = await (await fetch(next)).json();
          if (d.error) return json({ error: 'ig_error', detail: d.error }, 502);
          for (const m of (d.data || [])) {
            const cap = (m.caption || '').trim();
            let imgUrl = m.media_url || m.thumbnail_url || '';
            if (m.children && m.children.data && m.children.data[0]) imgUrl = m.children.data[0].media_url || imgUrl;
            posts.push({
              id: m.id, caption: cap, type: classifyPost(cap), img: imgUrl,
              permalink: m.permalink || '', likes: m.like_count || 0, comments: m.comments_count || 0,
              ts: m.timestamp || '', slides: (m.children && m.children.data ? m.children.data.length : 1),
            });
          }
          next = d.paging && d.paging.next ? d.paging.next : '';
        }
        await env.JOBS.put('brand:corpus', JSON.stringify({ posts, updatedAt: Date.now() }));
        const byType = {}; posts.forEach((p) => { byType[p.type] = (byType[p.type] || 0) + 1; });
        return json({ ok: true, count: posts.length, byType });
      } catch (e) { return json({ error: 'learn_failed', detail: String(e) }, 502); }
    }

    // Devuelve el corpus de marca (opcional ?type= filtra). Adjunta imagen base64 de
    // los top N como referencia visual para la generación.
    if (path === '/brand' && request.method === 'GET') {
      const store = await env.JOBS.get('brand:corpus', { type: 'json' });
      if (!store || !store.posts) return json({ posts: [], updatedAt: 0 });
      const type = (url.searchParams.get('type') || '').toLowerCase();
      const withImg = Math.min(parseInt(url.searchParams.get('img') || '0', 10) || 0, 3);
      let posts = store.posts.filter((p) => (p.caption || '').length > 20);
      if (type) { const f = posts.filter((p) => p.type === type); if (f.length >= 2) posts = f; }
      posts.sort((a, b) => (b.likes + b.comments * 3) - (a.likes + a.comments * 3));
      posts = posts.slice(0, 8);
      const refs = [];
      for (let i = 0; i < posts.length && refs.length < withImg; i++) {
        if (!posts[i].img) continue;
        try {
          const ir = await fetch(posts[i].img);
          const ct = ir.headers.get('content-type') || 'image/jpeg';
          if (!/image\//.test(ct)) continue;
          const buf = await ir.arrayBuffer();
          if (buf.byteLength > 6000000) continue;
          refs.push('data:' + ct + ';base64,' + bytesToB64(buf));
        } catch (e) {}
      }
      return json({ posts, refs, updatedAt: store.updatedAt });
    }

    // Cerebro de IA: llama a la API de Anthropic (para la versión alojada, sin window.claude)
    if (path === '/ai' && request.method === 'POST') {
      if (!env.ANTHROPIC_KEY) return json({ error: 'no_ai_key' }, 500);
      let body; try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
      const { prompt, images } = body;
      if (!prompt) return json({ error: 'no_prompt' }, 400);
      const content = [];
      (images || []).slice(0, 8).forEach((d) => {
        const m = /^data:([^;]+);base64,(.*)$/.exec(d || '');
        if (m) content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
      });
      content.push({ type: 'text', text: String(prompt).slice(0, 24000) });
      const ALLOW = ['claude-opus-5', 'claude-opus-5-5', 'claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'];
      const chosen = ALLOW.indexOf(body.model) >= 0 ? body.model : (env.AI_MODEL || 'claude-sonnet-5');
      const payload = {
        model: chosen,
        max_tokens: 2000,
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content }],
      };
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': env.ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const d = await r.json();
        if (d.error) return json({ error: 'ai_error', detail: d.error }, 502);
        const text = (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
        const model = payload.model;
        const PRICE = { 'claude-opus-5': [5, 25], 'claude-opus-5-5': [4, 20], 'claude-opus-4-8': [5, 25], 'claude-sonnet-5': [2, 10], 'claude-haiku-4-5': [1, 5], 'claude-fable-5-1': [10, 50] };
        const u = d.usage || {};
        const p = PRICE[model] || [5, 25];
        const inTok = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        const cost = (inTok / 1e6) * p[0] + ((u.output_tokens || 0) / 1e6) * p[1];
        return json({ text, model, usage: u, cost });
      } catch (e) { return json({ error: 'ai_failed', detail: String(e) }, 502); }
    }

    // Autodiagnóstico: confirma secret correcto y qué claves faltan (sin gastar IA)
    if (path === '/diag' && request.method === 'GET') {
      return json({ ok: true, ai: !!env.ANTHROPIC_KEY, ig: !!(env.IG_TOKEN && env.IG_USER_ID), model: env.AI_MODEL || 'claude-sonnet-5' });
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

// Clasifica un post por su caption -> tipo de carrusel (para coger el modelo exacto)
function classifyPost(caption) {
  const t = (caption || '').toLowerCase();
  if (/alquiler|rent|arrenda|temporada/.test(t)) return 'alquiler';
  if (/promoci[oó]n|obra nueva|nueva construcci|pisos? nuevos|de obra/.test(t)) return 'promocion';
  if (/villa|casa|chalet|masia|mas[ií]a|torre|finca/.test(t)) return 'villa';
  if (/[aá]tico|apartamento|piso|d[uú]plex|estudio|loft/.test(t)) return 'apartamento';
  if (/vida|lifestyle|experiencia|descubre|zona|entorno|rinc[oó]n|verano|invierno|mar|monta[nñ]a/.test(t)) return 'lifestyle';
  return 'general';
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

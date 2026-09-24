// ── ANÁLISIS DE UNA SEDE ─────────────────────────────────────────────────────
function analizarSede_(s) {
  var id = placeId_(s), f = fichaPlaces_(id);
  var webUrl = s.web || f.websiteUri || '';
  var gbpRev = resenasGBP_(s), gbpPosts = postsGBP_(s), gbpInfo = infoGBP_(s);
  var snap = {
    sede: s.code, nombre: s.nombre,
    ficha: {
      nombre: (f.displayName || {}).text, direccion: f.formattedAddress, telefono: f.nationalPhoneNumber,
      web: f.websiteUri || '', estado: f.businessStatus, categoria: f.primaryType,
      rating: f.rating || 0, numResenas: f.userRatingCount || 0, fotos: (f.photos || []).length,
      tieneHorario: !!f.regularOpeningHours, horario: ((f.regularOpeningHours || {}).weekdayDescriptions || []).join(' | '),
      descripcionActual: gbpInfo ? ((gbpInfo.profile || {}).description || '') : ((f.editorialSummary || {}).text || ''),
      maps: f.googleMapsUri
    },
    resenasRecientes: gbpRev ? gbpRev.slice(0, 10) : (f.reviews || []).map(mapReviewPlaces_),
    nivel2: !!gbpRev,
    ultimoPostDias: gbpPosts ? gbpPosts.dias : null,
    web: webUrl ? auditarWeb_(webUrl, f.nationalPhoneNumber) : null,
    pagespeed: webUrl ? pageSpeed_(webUrl) : null,
    competencia: competencia_(s, id),
    metricas: metricasGBP_(s),
    anterior: JSON.parse(P.getProperty('SNAP_' + s.code) || 'null'),
    busquedaMarca: ''   // se rellena con el lote de búsquedas
  };
  snap.completitud = completitud_(snap, gbpInfo);
  snap.posicion = posicion_(snap);
  snap.problemas = reglas_(snap);
  return snap;
}

function reglas_(s) {
  var p = [], f = s.ficha;
  function add(prio, tipo, texto) { p.push({ prioridad: prio, tipo: tipo, texto: texto }); }
  if (f.estado && f.estado !== 'OPERATIONAL') add('ALTA', 'FICHA', 'Estado de la ficha: ' + f.estado);
  if (!f.tieneHorario) add('ALTA', 'FICHA', 'Sin horario publicado');
  if (!f.telefono) add('ALTA', 'FICHA', 'Sin teléfono');
  if (!f.web) add('ALTA', 'FICHA', 'Sin web enlazada');
  if (f.fotos < UMBRAL.fotosMin) add('MEDIA', 'FOTOS', 'Solo ' + f.fotos + ' fotos visibles');
  if (s.anterior && s.anterior.rating - f.rating >= UMBRAL.caidaRating) add('ALTA', 'RESEÑAS', 'La nota baja de ' + s.anterior.rating + ' a ' + f.rating);
  if (s.anterior && s.anterior.numResenas === f.numResenas) add('MEDIA', 'RESEÑAS', 'Ninguna reseña nueva esta semana');
  var sinResp = s.resenasRecientes.filter(function (r) { return r.respondida === false; });
  if (sinResp.length) add('ALTA', 'RESEÑAS', sinResp.length + ' reseña(s) sin responder');
  if (s.ultimoPostDias !== null && s.ultimoPostDias > UMBRAL.diasSinPost) add('MEDIA', 'POSTS', s.ultimoPostDias + ' días sin publicar');
  if (s.web) {
    if (s.web.error) add('ALTA', 'WEB', 'La web no responde: ' + s.web.error);
    else {
      if (!s.web.title) add('ALTA', 'SEO', 'Página sin <title>');
      if (!s.web.metaDescription) add('MEDIA', 'SEO', 'Sin meta description');
      if (s.web.h1 !== 1) add('MEDIA', 'SEO', 'La página tiene ' + s.web.h1 + ' H1 (debe ser 1)');
      if (!s.web.schemaLocal) add('MEDIA', 'SEO', 'Sin schema LocalBusiness/RealEstateAgent');
      if (s.web.telefonoEnWeb === false) add('MEDIA', 'NAP', 'El teléfono de la ficha no aparece en la web');
    }
  }
  if (s.pagespeed && !s.pagespeed.error) {
    if (s.pagespeed.seo < UMBRAL.seoMin) add('MEDIA', 'SEO', 'PageSpeed SEO ' + s.pagespeed.seo + '/100');
    if (s.pagespeed.perf < UMBRAL.perfMin) add('MEDIA', 'WEB', 'Rendimiento móvil ' + s.pagespeed.perf + '/100');
  }
  if (s.posicion && s.posicion.porResenas > 3) add('MEDIA', 'COMPETENCIA', 'Puesto ' + s.posicion.porResenas + ' de ' + s.posicion.total + ' en número de reseñas');
  return p;
}

/** Checklist de lo que un cliente espera ver al buscar la marca. */
function completitud_(s, g) {
  var f = s.ficha, items = [];
  function chk(ok, texto) { items.push({ ok: !!ok, texto: texto }); }
  chk(f.telefono, 'Teléfono');
  chk(f.web, 'Web enlazada');
  chk(f.tieneHorario, 'Horario');
  chk(f.fotos >= UMBRAL.fotosMin, 'Fotos suficientes');
  chk(f.numResenas >= 20, 'Mínimo 20 reseñas');
  chk(f.rating >= 4.5, 'Nota ≥ 4,5');
  chk(s.resenasRecientes.every(function (r) { return r.respondida !== false; }), 'Reseñas respondidas');
  if (s.web && !s.web.error) {
    chk(s.web.schemaLocal, 'Schema en la web');
    chk(s.web.telefonoEnWeb !== false, 'Mismo teléfono en ficha y web');
    chk(s.web.metaDescription, 'Meta description');
  }
  if (g) {
    chk(((g.categories || {}).additionalCategories || []).length >= 2, 'Categorías secundarias');
    chk(((g.profile || {}).description || '').length >= 500, 'Descripción ≥ 500 caracteres');
    chk((g.serviceItems || []).length >= 5, 'Servicios dados de alta');
    chk((g.specialHours || {}).specialHourPeriods, 'Horario de festivos');
    chk(s.ultimoPostDias !== null && s.ultimoPostDias <= UMBRAL.diasSinPost, 'Post en los últimos 7 días');
  }
  var ok = items.filter(function (i) { return i.ok; }).length;
  return {
    porcentaje: Math.round(100 * ok / items.length),
    falta: items.filter(function (i) { return !i.ok; }).map(function (i) { return i.texto; }),
    parcial: !g
  };
}

// ── WEB GLOBAL (SEO técnico + buscadores con IA), una vez por semana ─────────
function auditarDominio_(url) {
  var m = String(url || '').match(/^https?:\/\/[^\/]+/);
  if (!m) return null;
  var base = m[0], out = { dominio: base, problemas: [] };
  function get(path) {
    try { var r = UrlFetchApp.fetch(base + path, { muteHttpExceptions: true, followRedirects: true });
          return r.getResponseCode() === 200 ? r.getContentText() : null; } catch (e) { return null; }
  }
  var robots = get('/robots.txt');
  if (robots === null) out.problemas.push('Sin robots.txt');
  else {
    ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended'].forEach(function (bot) {
      var bloque = robots.split(/user-agent:/i).filter(function (b) { return b.trim().toLowerCase().indexOf(bot.toLowerCase()) === 0; })[0];
      if (bloque && /disallow:\s*\/\s*$/im.test(bloque)) out.problemas.push('robots.txt bloquea ' + bot + ' (no apareceréis en respuestas de IA)');
    });
    if (!/sitemap:/i.test(robots)) out.problemas.push('robots.txt no declara el sitemap');
  }
  if (get('/sitemap.xml') === null && !(robots && /sitemap:/i.test(robots))) out.problemas.push('Sin sitemap.xml');
  if (get('/llms.txt') === null) out.problemas.push('Sin llms.txt (ayuda a ChatGPT/Claude/Perplexity a entender la marca)');
  var home = get('/');
  if (home) {
    var langs = (home.match(/hreflang=["']([a-z-]+)["']/gi) || []).map(function (x) { return x.split(/["']/)[1].toLowerCase(); });
    out.hreflang = langs.filter(function (x, i) { return langs.indexOf(x) === i; });
    if (!out.hreflang.length) out.problemas.push('Sin etiquetas hreflang (la web tiene es/ca/en)');
    else if (out.hreflang.indexOf('fr') === -1) out.problemas.push('Sin versión en francés (clave para Andorra y Cerdanya)');
    if (!/"@type"\s*:\s*"(Organization|RealEstateAgent)"/i.test(home)) out.problemas.push('Portada sin schema Organization/RealEstateAgent');
    if (!/FAQPage/i.test(home)) out.problemas.push('Sin FAQ con schema FAQPage (respuestas directas para Google e IA)');
  } else out.problemas.push('La portada no responde');
  return out;
}

// ── COMPETENCIA ──────────────────────────────────────────────────────────────
function competencia_(s, miId) {
  try {
    var r = http_('post', 'https://places.googleapis.com/v1/places:searchText', {
      'X-Goog-Api-Key': prop_('GOOGLE_API_KEY', true),
      'X-Goog-FieldMask': 'places.id,places.displayName,places.rating,places.userRatingCount,places.photos,places.websiteUri,places.googleMapsUri'
    }, { textQuery: s.mercado, languageCode: 'es', pageSize: UMBRAL.numCompetidores + 3 });
    return (r.places || []).filter(function (p) {
      return p.id !== miId && !/dur[aá]n\s*carasso/i.test((p.displayName || {}).text || '');
    }).slice(0, UMBRAL.numCompetidores).map(function (p) {
      return { nombre: (p.displayName || {}).text, rating: p.rating || 0, resenas: p.userRatingCount || 0,
               fotos: (p.photos || []).length, web: p.websiteUri || '', maps: p.googleMapsUri };
    });
  } catch (e) { return []; }
}

function posicion_(s) {
  if (!s.competencia || !s.competencia.length) return null;
  var todos = s.competencia.concat([{ yo: true, rating: s.ficha.rating, resenas: s.ficha.numResenas }]);
  function puesto(campo) {
    return todos.slice().sort(function (a, b) { return b[campo] - a[campo]; }).findIndex(function (x) { return x.yo; }) + 1;
  }
  var lider = s.competencia.slice().sort(function (a, b) { return b.resenas - a.resenas; })[0];
  return { porNota: puesto('rating'), porResenas: puesto('resenas'), total: todos.length, lider: lider };
}

// ── FUENTES: GOOGLE PLACES (público) ─────────────────────────────────────────
function placeId_(s) {
  var k = 'PLACE_' + s.code, id = P.getProperty(k);
  if (id) return id;
  var r = http_('post', 'https://places.googleapis.com/v1/places:searchText', {
    'X-Goog-Api-Key': prop_('GOOGLE_API_KEY', true), 'X-Goog-FieldMask': 'places.id,places.displayName'
  }, { textQuery: s.query, languageCode: 'es' });
  if (!r.places || !r.places.length) throw new Error('No encuentro la ficha de ' + s.nombre + ' (revisa SEDES.query)');
  var nuestra = r.places.filter(function (p) { return /dur[aá]n\s*carasso/i.test((p.displayName || {}).text || ''); })[0] || r.places[0];
  P.setProperty(k, nuestra.id);
  return nuestra.id;
}

function fichaPlaces_(id) {
  return http_('get', 'https://places.googleapis.com/v1/places/' + id + '?languageCode=es', {
    'X-Goog-Api-Key': prop_('GOOGLE_API_KEY', true),
    'X-Goog-FieldMask': 'id,displayName,formattedAddress,nationalPhoneNumber,websiteUri,businessStatus,primaryType,rating,userRatingCount,reviews,photos,regularOpeningHours,editorialSummary,googleMapsUri'
  });
}

function mapReviewPlaces_(r) {
  return { id: r.name, autor: (r.authorAttribution || {}).displayName || '', estrellas: r.rating,
           texto: (r.text || r.originalText || {}).text || '', fecha: r.publishTime, respondida: null };
}

// ── FUENTES: BUSINESS PROFILE API (Nivel 2) ──────────────────────────────────
var STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
function v4_(s) { return 'https://mybusiness.googleapis.com/v4/accounts/' + prop_('GBP_ACCOUNT_ID') + '/locations/' + s.gbpLocationId; }

function resenasGBP_(s) {
  if (!nivel2_(s)) return null;
  var r = gbp_('GET', v4_(s) + '/reviews?pageSize=20&orderBy=updateTime%20desc');
  return (r.reviews || []).map(function (x) {
    return { id: x.name, autor: (x.reviewer || {}).displayName || '', estrellas: STARS[x.starRating] || 0,
             texto: x.comment || '', fecha: x.createTime, respondida: !!x.reviewReply };
  });
}

function postsGBP_(s) {
  if (!nivel2_(s)) return null;
  var last = (gbp_('GET', v4_(s) + '/localPosts?pageSize=1').localPosts || [])[0];
  return { dias: last ? Math.floor((Date.now() - new Date(last.createTime)) / 864e5) : null };
}

function infoGBP_(s) {
  if (!nivel2_(s)) return null;
  return gbp_('GET', 'https://mybusinessbusinessinformation.googleapis.com/v1/locations/' + s.gbpLocationId +
    '?readMask=title,categories,profile,regularHours,specialHours,serviceItems,websiteUri,phoneNumbers,openInfo');
}

/** Llamadas, rutas, clics web e impresiones: últimos 28 días vs 28 anteriores. */
function metricasGBP_(s) {
  if (!nivel2_(s)) return null;
  try {
    var hoy = new Date(), ini = new Date(hoy - 56 * 864e5), corte = new Date(hoy - 28 * 864e5);
    var m = ['CALL_CLICKS', 'WEBSITE_CLICKS', 'BUSINESS_DIRECTION_REQUESTS', 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH', 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH'];
    var q = m.map(function (x) { return 'dailyMetrics=' + x; }).join('&') +
      '&dailyRange.start_date.year=' + ini.getFullYear() + '&dailyRange.start_date.month=' + (ini.getMonth() + 1) + '&dailyRange.start_date.day=' + ini.getDate() +
      '&dailyRange.end_date.year=' + hoy.getFullYear() + '&dailyRange.end_date.month=' + (hoy.getMonth() + 1) + '&dailyRange.end_date.day=' + hoy.getDate();
    var r = gbp_('GET', 'https://businessprofileperformance.googleapis.com/v1/locations/' + s.gbpLocationId + ':fetchMultiDailyMetricsTimeSeries?' + q);
    var out = {};
    (r.multiDailyMetricTimeSeries || []).forEach(function (g) {
      (g.dailyMetricTimeSeries || []).forEach(function (t) {
        var k = t.dailyMetric.replace('BUSINESS_', '').replace(/_(MOBILE|DESKTOP)_SEARCH/, '_BUSQUEDA');
        out[k] = out[k] || { ult28: 0, prev28: 0 };
        ((t.timeSeries || {}).datedValues || []).forEach(function (v) {
          var d = new Date(v.date.year, v.date.month - 1, v.date.day), n = Number(v.value || 0);
          if (d >= corte) out[k].ult28 += n; else out[k].prev28 += n;
        });
      });
    });
    return out;
  } catch (e) { return { error: String(e) }; }
}

// ── FUENTES: WEB ─────────────────────────────────────────────────────────────
function auditarWeb_(url, telefono) {
  try {
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() >= 400) return { url: url, error: 'HTTP ' + res.getResponseCode() };
    var h = res.getContentText();
    var m = function (re) { var x = h.match(re); return x ? x[1].trim() : ''; };
    var tel = String(telefono || '').replace(/\D/g, '').replace(/^(34|376)(?=\d{6,9}$)/, '');
    var telRe = tel ? new RegExp(tel.split('').join('[\\s.\\-()]*')) : null;
    return {
      url: url,
      title: m(/<title[^>]*>([^<]*)<\/title>/i),
      metaDescription: m(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i) || m(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i),
      h1: (h.match(/<h1[\s>]/gi) || []).length,
      canonical: /<link[^>]+rel=["']canonical["']/i.test(h),
      schemaLocal: /application\/ld\+json[\s\S]{0,5000}?(LocalBusiness|RealEstateAgent)/i.test(h),
      hreflang: (h.match(/hreflang=/gi) || []).length,
      telefonoEnWeb: telRe ? telRe.test(h) : null
    };
  } catch (e) { return { url: url, error: String(e) }; }
}

function pageSpeed_(url) {
  try {
    var r = http_('get', 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed?strategy=mobile&category=SEO&category=PERFORMANCE&url=' +
      encodeURIComponent(url) + '&key=' + prop_('GOOGLE_API_KEY', true));
    var c = r.lighthouseResult.categories, a = r.lighthouseResult.audits;
    return { seo: Math.round(c.seo.score * 100), perf: Math.round(c.performance.score * 100), lcp: (a['largest-contentful-paint'] || {}).displayValue || '' };
  } catch (e) { return { error: String(e) }; }
}

// ── UTILIDADES HTTP ──────────────────────────────────────────────────────────
function http_(method, url, headers, body) {
  var o = { method: method, headers: headers || {}, muteHttpExceptions: true };
  if (body) { o.contentType = 'application/json'; o.payload = JSON.stringify(body); }
  var r = UrlFetchApp.fetch(url, o);
  if (r.getResponseCode() >= 300) throw new Error(r.getResponseCode() + ' ' + url.split('?')[0] + ': ' + r.getContentText().slice(0, 300));
  return JSON.parse(r.getContentText() || '{}');
}
function gbp_(method, url, body) {
  return http_(method.toLowerCase(), url, { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, body);
}

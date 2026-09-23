/**
 * AGENTE GBP · Durán Carasso
 * Vigila las fichas de Google (Perfil de Empresa) + SEO web de las 4 sedes,
 * detecta qué falta o ha cambiado, redacta acciones/respuestas/posts con Claude
 * y avisa por email (y Google Chat opcional). Publicar en Google siempre
 * requiere aprobación humana en la hoja GBP_Borradores.
 *
 * Script Properties (Configuración del proyecto → Propiedades del script):
 *   ANTHROPIC_API_KEY   obligatorio
 *   GOOGLE_API_KEY      obligatorio (Places API (New) + PageSpeed Insights API)
 *   NOTIFY_EMAILS       obligatorio, separados por coma
 *   CHAT_WEBHOOK        opcional, webhook de un espacio de Google Chat
 *   GBP_ACCOUNT_ID      opcional, activa reseñas sin responder / posts / publicar
 *   SHEET_ID            opcional, por defecto la hoja del CRM
 */

// ── CONFIG ───────────────────────────────────────────────────────────────────
var SEDES = [
  { code: 'BCN', nombre: 'Barcelona', query: 'Durán Carasso Inmobiliaria Carrer de Muntaner 259 Barcelona', web: '', gbpLocationId: '' },
  { code: 'AND', nombre: 'Andorra',   query: 'Durán Carasso Andorra',   web: '', gbpLocationId: '' },
  { code: 'CRD', nombre: 'Cerdanya',  query: 'Durán Carasso Cerdanya',  web: '', gbpLocationId: '' },
  { code: 'STG', nombre: 'Sitges',    query: 'Durán Carasso Sitges',    web: '', gbpLocationId: '' }
];
// web vacío → se usa la web que tenga la ficha de Google.
// gbpLocationId → solo si GBP_ACCOUNT_ID está configurado (ver listarUbicacionesGBP()).

var UMBRAL = {
  fotosMin: 10,            // Places API devuelve máx. 10 fotos: <10 = ficha pobre
  diasSinPost: 7,          // días máx. sin publicación
  seoMin: 90,              // PageSpeed SEO (0-100)
  perfMin: 50,             // PageSpeed rendimiento móvil (0-100)
  caidaRating: 0.1         // bajada de nota que dispara alerta
};

var CLAUDE_MODEL = 'claude-opus-5';
var DEFAULT_SHEET_ID = '1QtAQ_RbGwsJ18jZeTinkKJfAHl7oYodusJ7xjHKXTa0';

var P = PropertiesService.getScriptProperties();
function prop_(k, req) {
  var v = P.getProperty(k);
  if (req && !v) throw new Error('Falta la propiedad del script: ' + k);
  return v || '';
}

// ── ENTRADAS (ejecutar desde el editor) ─────────────────────────────────────
/** 1ª vez: crea triggers (diario 8:30 + reseñas cada 3h) y resuelve placeIds. */
function instalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('ejecutarDiario').timeBased().everyDays(1).atHour(8).nearMinute(30).inTimezone('Europe/Madrid').create();
  ScriptApp.newTrigger('vigilarResenas').timeBased().everyHours(3).create();
  SEDES.forEach(function (s) { Logger.log(s.code + ' → ' + placeId_(s)); });
  hoja_('GBP_Historico'); hoja_('GBP_Tareas'); hoja_('GBP_Borradores');
  Logger.log('Instalado. Revisa que cada placeId corresponde a la sede correcta.');
}

/** Informe diario completo: ficha + web + SEO → Claude → hojas + aviso. */
function ejecutarDiario() {
  var snaps = SEDES.map(function (s) {
    try { return analizarSede_(s); }
    catch (e) { return { sede: s.code, nombre: s.nombre, error: String(e), problemas: [{ prioridad: 'ALTA', tipo: 'SISTEMA', texto: 'No se pudo analizar: ' + e }] }; }
  });
  var plan = pedirPlanClaude_(snaps);
  guardar_(snaps, plan);
  notificar_(snaps, plan);
  snaps.forEach(function (s) { if (!s.error) P.setProperty('SNAP_' + s.sede, JSON.stringify(resumenSnap_(s))); });
}

/** Ligero: solo avisa si entra una reseña nueva (urgente si ≤3★). Sin coste de Claude. */
function vigilarResenas() {
  var alertas = [];
  SEDES.forEach(function (s) {
    var nuevas = resenasNuevas_(s, fichaPlaces_(placeId_(s)), resenasGBP_(s));
    nuevas.forEach(function (r) {
      alertas.push((r.estrellas <= 3 ? '🔴 ' : '🟢 ') + s.nombre + ' · ' + r.estrellas + '★ · ' + r.autor + ': "' + recorta_(r.texto, 200) + '"');
    });
  });
  if (alertas.length) enviar_('Nuevas reseñas en Google (' + alertas.length + ')', alertas.join('\n\n'), alertas.map(esc_).join('<br><br>'));
}

/** Publica en Google los borradores marcados APROBADO (requiere GBP_ACCOUNT_ID). */
function publicarAprobados() {
  var sh = hoja_('GBP_Borradores'), data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var row = data[i], estado = String(row[6]).toUpperCase();
    if (estado !== 'APROBADO') continue;
    var sede = SEDES.filter(function (s) { return s.code === row[1]; })[0];
    try {
      if (row[2] === 'RESPUESTA') gbp_('PUT', 'https://mybusiness.googleapis.com/v4/' + row[3] + '/reply', { comment: row[5] });
      else if (row[2] === 'POST') publicarPost_(sede, row[5]);
      sh.getRange(i + 1, 7).setValue('PUBLICADO ' + fecha_());
    } catch (e) { sh.getRange(i + 1, 7).setValue('ERROR: ' + e); }
  }
}

/** Ayuda: lista las ubicaciones de tu cuenta GBP para rellenar gbpLocationId. */
function listarUbicacionesGBP() {
  var acc = prop_('GBP_ACCOUNT_ID', true);
  var r = gbp_('GET', 'https://mybusinessbusinessinformation.googleapis.com/v1/accounts/' + acc + '/locations?readMask=name,title,storefrontAddress&pageSize=100');
  (r.locations || []).forEach(function (l) { Logger.log(l.name + ' · ' + l.title + ' · ' + ((l.storefrontAddress || {}).locality || '')); });
}

// ── ANÁLISIS POR SEDE ────────────────────────────────────────────────────────
function analizarSede_(s) {
  var f = fichaPlaces_(placeId_(s));
  var webUrl = s.web || f.websiteUri || '';
  var web = webUrl ? auditarWeb_(webUrl, f.nationalPhoneNumber) : null;
  var psi = webUrl ? pageSpeed_(webUrl) : null;
  var gbpRev = resenasGBP_(s);
  var gbpPosts = postsGBP_(s);
  var prev = JSON.parse(P.getProperty('SNAP_' + s.code) || 'null');

  var snap = {
    sede: s.code, nombre: s.nombre,
    ficha: {
      nombre: (f.displayName || {}).text, direccion: f.formattedAddress, telefono: f.nationalPhoneNumber,
      web: f.websiteUri || '', estado: f.businessStatus, categoria: f.primaryType,
      rating: f.rating || 0, numResenas: f.userRatingCount || 0, fotos: (f.photos || []).length,
      tieneHorario: !!f.regularOpeningHours, horario: ((f.regularOpeningHours || {}).weekdayDescriptions || []).join(' | '),
      descripcion: ((f.editorialSummary || {}).text) || '', maps: f.googleMapsUri
    },
    resenasRecientes: gbpRev ? gbpRev.slice(0, 10) : (f.reviews || []).map(mapReviewPlaces_),
    gbpActivo: !!gbpRev,
    ultimoPostDias: gbpPosts ? gbpPosts.dias : null,
    web: web, pagespeed: psi, anterior: prev, problemas: []
  };
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
  if (f.fotos < UMBRAL.fotosMin) add('MEDIA', 'FOTOS', 'Solo ' + f.fotos + ' fotos visibles (objetivo ≥' + UMBRAL.fotosMin + ')');
  if (!f.descripcion) add('BAJA', 'FICHA', 'Google no muestra descripción/resumen');
  if (s.anterior && s.anterior.rating - f.rating >= UMBRAL.caidaRating) add('ALTA', 'RESEÑAS', 'La nota baja de ' + s.anterior.rating + ' a ' + f.rating);
  if (s.anterior && s.anterior.numResenas === f.numResenas) add('BAJA', 'RESEÑAS', 'Sin reseñas nuevas desde el último informe: pedir reseñas a clientes recientes');
  var sinResp = s.resenasRecientes.filter(function (r) { return r.respondida === false; });
  if (sinResp.length) add('ALTA', 'RESEÑAS', sinResp.length + ' reseña(s) sin responder');
  if (s.ultimoPostDias === null && s.gbpActivo) add('MEDIA', 'POSTS', 'Ninguna publicación en la ficha');
  if (s.ultimoPostDias !== null && s.ultimoPostDias > UMBRAL.diasSinPost) add('MEDIA', 'POSTS', s.ultimoPostDias + ' días sin publicar en Google');
  if (s.web) {
    if (s.web.error) add('ALTA', 'WEB', 'La web no responde: ' + s.web.error);
    else {
      if (!s.web.title) add('ALTA', 'SEO', 'Página sin <title>');
      if (!s.web.metaDescription) add('MEDIA', 'SEO', 'Sin meta description');
      if (s.web.h1 !== 1) add('MEDIA', 'SEO', 'La página tiene ' + s.web.h1 + ' H1 (debe ser 1)');
      if (!s.web.schemaLocal) add('MEDIA', 'SEO', 'Sin schema LocalBusiness/RealEstateAgent (JSON-LD)');
      if (!s.web.telefonoEnWeb) add('MEDIA', 'NAP', 'El teléfono de la ficha no aparece en la web (coherencia NAP)');
      if (!s.web.canonical) add('BAJA', 'SEO', 'Sin etiqueta canonical');
    }
  }
  if (s.pagespeed && !s.pagespeed.error) {
    if (s.pagespeed.seo < UMBRAL.seoMin) add('MEDIA', 'SEO', 'PageSpeed SEO ' + s.pagespeed.seo + '/100');
    if (s.pagespeed.perf < UMBRAL.perfMin) add('MEDIA', 'WEB', 'Rendimiento móvil ' + s.pagespeed.perf + '/100 (LCP ' + s.pagespeed.lcp + ')');
  }
  return p;
}

// ── FUENTES DE DATOS ─────────────────────────────────────────────────────────
function placeId_(s) {
  var k = 'PLACE_' + s.code, id = P.getProperty(k);
  if (id) return id;
  var r = http_('post', 'https://places.googleapis.com/v1/places:searchText', {
    'X-Goog-Api-Key': prop_('GOOGLE_API_KEY', true), 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress'
  }, { textQuery: s.query, languageCode: 'es' });
  if (!r.places || !r.places.length) throw new Error('No encuentro la ficha de ' + s.nombre + ' (revisa SEDES.query)');
  P.setProperty(k, r.places[0].id);
  return r.places[0].id;
}

function fichaPlaces_(id) {
  var fields = 'id,displayName,formattedAddress,nationalPhoneNumber,websiteUri,businessStatus,primaryType,rating,userRatingCount,reviews,photos,regularOpeningHours,editorialSummary,googleMapsUri';
  return http_('get', 'https://places.googleapis.com/v1/places/' + id + '?languageCode=es', {
    'X-Goog-Api-Key': prop_('GOOGLE_API_KEY', true), 'X-Goog-FieldMask': fields
  });
}

function mapReviewPlaces_(r) {
  return { id: r.name, autor: (r.authorAttribution || {}).displayName || '', estrellas: r.rating, texto: (r.text || r.originalText || {}).text || '', fecha: r.publishTime, respondida: null };
}

var STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
function resenasGBP_(s) {
  if (!prop_('GBP_ACCOUNT_ID') || !s.gbpLocationId) return null;
  var r = gbp_('GET', 'https://mybusiness.googleapis.com/v4/accounts/' + prop_('GBP_ACCOUNT_ID') + '/locations/' + s.gbpLocationId + '/reviews?pageSize=20&orderBy=updateTime%20desc');
  return (r.reviews || []).map(function (x) {
    return { id: x.name, autor: (x.reviewer || {}).displayName || '', estrellas: STARS[x.starRating] || 0, texto: x.comment || '', fecha: x.createTime, respondida: !!x.reviewReply };
  });
}

function postsGBP_(s) {
  if (!prop_('GBP_ACCOUNT_ID') || !s.gbpLocationId) return null;
  var r = gbp_('GET', 'https://mybusiness.googleapis.com/v4/accounts/' + prop_('GBP_ACCOUNT_ID') + '/locations/' + s.gbpLocationId + '/localPosts?pageSize=1');
  var last = (r.localPosts || [])[0];
  return { dias: last ? Math.floor((Date.now() - new Date(last.createTime)) / 864e5) : null };
}

function publicarPost_(s, texto) {
  gbp_('POST', 'https://mybusiness.googleapis.com/v4/accounts/' + prop_('GBP_ACCOUNT_ID') + '/locations/' + s.gbpLocationId + '/localPosts', {
    languageCode: 'es', summary: texto, topicType: 'STANDARD',
    callToAction: { actionType: 'LEARN_MORE', url: s.web || fichaPlaces_(placeId_(s)).websiteUri }
  });
}

function resenasNuevas_(s, ficha, gbpRev) {
  var lista = gbpRev || (ficha.reviews || []).map(mapReviewPlaces_);
  var k = 'LASTREV_' + s.code, last = P.getProperty(k) || '';
  var nuevas = lista.filter(function (r) { return r.fecha && r.fecha > last; });
  var max = lista.reduce(function (m, r) { return r.fecha > m ? r.fecha : m; }, last);
  P.setProperty(k, max);
  return last ? nuevas : []; // primera ejecución: solo guarda referencia
}

function auditarWeb_(url, telefono) {
  try {
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() >= 400) return { url: url, error: 'HTTP ' + res.getResponseCode() };
    var h = res.getContentText();
    var m = function (re) { var x = h.match(re); return x ? x[1].trim() : ''; };
    var tel = String(telefono || '').replace(/\D/g, '');
    var htmlDigits = h.replace(/\D/g, '');
    return {
      url: url,
      title: m(/<title[^>]*>([^<]*)<\/title>/i),
      metaDescription: m(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i) || m(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i),
      h1: (h.match(/<h1[\s>]/gi) || []).length,
      canonical: /<link[^>]+rel=["']canonical["']/i.test(h),
      schemaLocal: /application\/ld\+json[\s\S]{0,5000}?(LocalBusiness|RealEstateAgent)/i.test(h),
      hreflang: (h.match(/hreflang=/gi) || []).length,
      telefonoEnWeb: tel ? htmlDigits.indexOf(tel) !== -1 : null
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

// ── CLAUDE ───────────────────────────────────────────────────────────────────
var SCHEMA_PLAN = {
  type: 'object', additionalProperties: false, required: ['resumen', 'sedes'],
  properties: {
    resumen: { type: 'string' },
    sedes: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['sede', 'acciones', 'post', 'respuestas'],
      properties: {
        sede: { type: 'string', enum: SEDES.map(function (s) { return s.code; }) },
        acciones: { type: 'array', items: {
          type: 'object', additionalProperties: false, required: ['prioridad', 'accion', 'motivo'],
          properties: { prioridad: { type: 'string', enum: ['ALTA', 'MEDIA', 'BAJA'] }, accion: { type: 'string' }, motivo: { type: 'string' } }
        } },
        post: { type: 'string' },
        respuestas: { type: 'array', items: {
          type: 'object', additionalProperties: false, required: ['id', 'texto'],
          properties: { id: { type: 'string' }, texto: { type: 'string' } }
        } }
      }
    } }
  }
};

var SYSTEM_PROMPT = [
  'Eres el responsable de SEO local y de las fichas de Google (Perfil de Empresa) de Durán Carasso,',
  'inmobiliaria de lujo con sedes en Barcelona (BCN), Andorra (AND), Cerdanya (CRD) y Sitges (STG).',
  'Recibes un JSON con el estado actual de cada sede y los problemas detectados por reglas automáticas.',
  'Devuelve para cada sede:',
  '- acciones: máximo 5, concretas y ejecutables hoy por el equipo de marketing (qué tocar y dónde), ordenadas por impacto.',
  '  Ten en cuenta la fecha: si se acerca un festivo local/nacional (Cataluña o Andorra) recuerda fijar el horario especial.',
  '- post: una publicación para la ficha de Google (máx. 1.200 caracteres, tono premium y cercano, sin emojis excesivos,',
  '  con palabras clave locales de esa sede). Cadena vacía si la sede ha publicado hace menos de 4 días.',
  '- respuestas: borrador de respuesta solo para reseñas con respondida=false (usa su id exacto). En el idioma de la reseña,',
  '  personalizada, sin plantillas genéricas; en reseñas negativas, empatía + invitación a hablar por teléfono.',
  'resumen: 3-4 frases para dirección con lo más importante del día. No inventes datos que no estén en el JSON.'
].join('\n');

function pedirPlanClaude_(snaps) {
  var input = { fecha: fecha_(), sedes: snaps };
  var body = {
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    fallbacks: 'default',
    system: SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: SCHEMA_PLAN } },
    messages: [{ role: 'user', content: JSON.stringify(input) }]
  };
  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: {
      'x-api-key': prop_('ANTHROPIC_API_KEY', true),
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01'
    },
    payload: JSON.stringify(body)
  });
  var code = res.getResponseCode(), j = JSON.parse(res.getContentText());
  if (code !== 200) throw new Error('Claude API ' + code + ': ' + res.getContentText().slice(0, 500));
  if (j.stop_reason === 'refusal') throw new Error('Claude rechazó la petición: ' + JSON.stringify(j.stop_details));
  if (j.stop_reason === 'max_tokens') throw new Error('Respuesta de Claude truncada (max_tokens)');
  var txt = j.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
  return JSON.parse(txt);
}

// ── SALIDA: HOJAS + AVISOS ───────────────────────────────────────────────────
var CABECERAS = {
  GBP_Historico: ['Fecha', 'Sede', 'Nota', 'Nº reseñas', 'Fotos', 'Horario', 'SEO', 'Rendimiento', 'Problemas'],
  GBP_Tareas: ['Fecha', 'Sede', 'Prioridad', 'Acción', 'Motivo', 'Estado'],
  GBP_Borradores: ['Fecha', 'Sede', 'Tipo', 'ID reseña', 'Reseña original', 'Texto propuesto (editable)', 'Estado (PENDIENTE/APROBADO)']
};

function hoja_(nombre) {
  var ss = SpreadsheetApp.openById(prop_('SHEET_ID') || DEFAULT_SHEET_ID);
  var sh = ss.getSheetByName(nombre);
  if (!sh) { sh = ss.insertSheet(nombre); sh.appendRow(CABECERAS[nombre]); sh.setFrozenRows(1); }
  return sh;
}

function guardar_(snaps, plan) {
  var hoy = fecha_();
  var hist = snaps.filter(function (s) { return !s.error; }).map(function (s) {
    var ps = s.pagespeed || {};
    return [hoy, s.sede, s.ficha.rating, s.ficha.numResenas, s.ficha.fotos, s.ficha.tieneHorario ? 'Sí' : 'No', ps.seo || '', ps.perf || '', s.problemas.length];
  });
  appendRows_(hoja_('GBP_Historico'), hist);

  var tareas = [], borr = [];
  plan.sedes.forEach(function (ps) {
    ps.acciones.forEach(function (a) { tareas.push([hoy, ps.sede, a.prioridad, a.accion, a.motivo, 'PENDIENTE']); });
    if (ps.post) borr.push([hoy, ps.sede, 'POST', '', '', ps.post, 'PENDIENTE']);
    var snap = snaps.filter(function (s) { return s.sede === ps.sede; })[0] || { resenasRecientes: [] };
    ps.respuestas.forEach(function (r) {
      var orig = snap.resenasRecientes.filter(function (x) { return x.id === r.id; })[0];
      if (orig) borr.push([hoy, ps.sede, 'RESPUESTA', r.id, orig.estrellas + '★ ' + orig.autor + ': ' + recorta_(orig.texto, 300), r.texto, 'PENDIENTE']);
    });
  });
  appendRows_(hoja_('GBP_Tareas'), tareas);
  appendRows_(hoja_('GBP_Borradores'), borr);
}

function appendRows_(sh, rows) {
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function notificar_(snaps, plan) {
  var altas = 0, html = '<div style="font-family:Arial,sans-serif;max-width:680px">' +
    '<h2 style="color:#0D3550;margin:0 0 8px">Agente Google · ' + fecha_() + '</h2>' +
    '<p style="background:#F5F4F1;padding:12px;border-radius:8px">' + esc_(plan.resumen) + '</p>';
  var txt = plan.resumen + '\n';
  snaps.forEach(function (s) {
    var ps = plan.sedes.filter(function (x) { return x.sede === s.sede; })[0] || { acciones: [], post: '', respuestas: [] };
    var f = s.ficha || {};
    html += '<h3 style="color:#0D3550;border-bottom:2px solid #B8922A;padding-bottom:4px">' + s.nombre +
      (s.error ? '' : ' · ' + f.rating + '★ (' + f.numResenas + ') · ' + f.fotos + ' fotos' + (s.pagespeed && s.pagespeed.seo ? ' · SEO ' + s.pagespeed.seo : '')) + '</h3><ul>';
    ps.acciones.forEach(function (a) {
      if (a.prioridad === 'ALTA') altas++;
      var c = a.prioridad === 'ALTA' ? '#B03020' : a.prioridad === 'MEDIA' ? '#C45E0A' : '#6B6B6B';
      html += '<li><b style="color:' + c + '">' + a.prioridad + '</b> ' + esc_(a.accion) + ' <span style="color:#6B6B6B">— ' + esc_(a.motivo) + '</span></li>';
      txt += '\n[' + s.sede + '][' + a.prioridad + '] ' + a.accion;
    });
    html += '</ul>';
    if (ps.post || ps.respuestas.length) html += '<p style="color:#1A8FBF">✍️ ' + (ps.post ? '1 post' : '') + (ps.post && ps.respuestas.length ? ' + ' : '') +
      (ps.respuestas.length ? ps.respuestas.length + ' respuesta(s)' : '') + ' en GBP_Borradores para aprobar.</p>';
  });
  html += '<p style="font-size:12px;color:#6B6B6B">Para publicar: cambia el Estado a APROBADO en la hoja GBP_Borradores y ejecuta publicarAprobados().</p></div>';
  enviar_('Agente Google · ' + (altas ? altas + ' tareas urgentes' : 'todo en orden') + ' · ' + fecha_(), txt, html);
}

function enviar_(asunto, texto, html) {
  prop_('NOTIFY_EMAILS', true).split(',').forEach(function (to) {
    GmailApp.sendEmail(to.trim(), asunto, texto, { htmlBody: html, name: 'Agente Google DC' });
  });
  var hook = prop_('CHAT_WEBHOOK');
  if (hook) UrlFetchApp.fetch(hook, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ text: '*' + asunto + '*\n' + recorta_(texto, 3500) }) });
}

// ── UTILIDADES ───────────────────────────────────────────────────────────────
function http_(method, url, headers, body) {
  var o = { method: method, headers: headers || {}, muteHttpExceptions: true };
  if (body) { o.contentType = 'application/json'; o.payload = JSON.stringify(body); }
  var r = UrlFetchApp.fetch(url, o);
  if (r.getResponseCode() >= 300) throw new Error(r.getResponseCode() + ' ' + url.split('?')[0] + ': ' + r.getContentText().slice(0, 300));
  return JSON.parse(r.getContentText());
}

function gbp_(method, url, body) {
  return http_(method.toLowerCase(), url, { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, body);
}

function resumenSnap_(s) { return { rating: s.ficha.rating, numResenas: s.ficha.numResenas, fotos: s.ficha.fotos }; }
function fecha_() { return Utilities.formatDate(new Date(), 'Europe/Madrid', 'yyyy-MM-dd'); }
function recorta_(t, n) { t = String(t || ''); return t.length > n ? t.slice(0, n) + '…' : t; }
function esc_(t) { return String(t || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

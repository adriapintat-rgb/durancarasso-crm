/**
 * ═══════════════════════════════════════════════════════════════════════
 *  DURÁN CARASSO · Agente Google  (fichas + SEO + competencia)
 *  Mismo sistema que el Reputation Agent. Cada lunes a las 8:00:
 *    1. Revisa las 4 fichas de Google, la web y la competencia de cada zona.
 *    2. Con IA (Gemini) decide qué mejorar, cuándo, y redacta el texto listo.
 *    3. Envía un email con botones de 1 clic:
 *         ✅ Hecho    🔄 Dame otra propuesta    ❌ No me sirve
 *    4. Aprende: lo que marcas como "no me sirve" no lo vuelve a proponer.
 *  Las reseñas las gestiona el Reputation Agent (aquí no se duplican avisos).
 *  Coste: 0 € (cuota gratuita de Gemini y Google).
 * ═══════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────
//  1) CONFIGURACIÓN
// ─────────────────────────────────────────────────────────────────────────
const CONFIG = {
  EMAIL_DESTINO: 'adriap@durancarasso.com',
  GEMINI_API_KEY: 'PEGA_AQUI_TU_API_KEY',      // la misma del Reputation Agent (aistudio.google.com/apikey)
  GOOGLE_API_KEY: 'PEGA_AQUI_TU_CLAVE_GOOGLE', // Google Cloud → Credenciales (Places API New + PageSpeed)
  GEMINI_MODEL: 'gemini-3.7-flash',   // si está saturado prueba solo los de GEMINI_RESERVA
  GEMINI_RESERVA: ['gemini-3.5-flash', 'gemini-flash-lite-latest'],
  MARCA: 'Durán Carasso',
  WEB: 'https://www.durancarasso.es',
  TONO: 'Premium, cercano y discreto. Sin exageraciones ni emojis. Nunca inventar inmuebles, precios ni cifras.',
  SERVICIOS: 'compra y venta, alquiler, valoración gratuita, obra nueva (más de 20 promociones y 1.800 viviendas en 6 años), inversiones (más de 350 activos)',
  NOMBRE_HOJA: 'DuranCarasso_AgenteGoogle_Log',
  PAGESPEED: true,   // velocidad y SEO técnico de la web (añade ~20 s por sede)
};

const SEDES = [
  { code: 'BCN', nombre: 'Barcelona', idioma: 'castellano',
    buscar: 'Durán Carasso Carrer de Muntaner 259 Barcelona', mercado: 'inmobiliaria de lujo Barcelona',
    direccion: 'Carrer de Muntaner 259, 08021 Barcelona', telefono: '931 59 51 25',
    zonas: 'Sarrià-Sant Gervasi, Tres Torres, Pedralbes, Eixample', competidores: 'Engel & Völkers, Lucas Fox, Bcn Advisors, Selekta, Valords' },
  { code: 'STG', nombre: 'Sitges', idioma: 'castellano',
    buscar: 'Durán Carasso Camí dels Capellans 73 Sitges', mercado: 'inmobiliaria de lujo Sitges',
    direccion: 'Av. Camí dels Capellans 73, 08870 Sitges', telefono: '935 17 80 67',
    zonas: 'Sitges, Garraf, Vilanova i la Geltrú, Cunit', competidores: 'Happy Houses, Envy Realty, Premium Houses, Selekta' },
  { code: 'CRD', nombre: 'Cerdanya', idioma: 'catalán',
    buscar: "Durán Carasso Carrer d'Espanya 16 Puigcerdà", mercado: 'inmobiliaria Puigcerdà Cerdanya',
    direccion: "Carrer d'Espanya 16, 17520 Puigcerdà", telefono: '972 47 56 77',
    zonas: 'Puigcerdà, Alp, Llívia, Bellver de Cerdanya, Fontanals, Isòvol', competidores: 'Coldwell Banker Glollar, Ladosada, Alex Ros, Vincle' },
  { code: 'AND', nombre: 'Andorra', idioma: 'catalán',
    buscar: 'Durán Carasso Carrer de la Unió 9 Escaldes-Engordany', mercado: 'inmobiliaria de lujo Andorra',
    direccion: "Carrer de la Unió 9, Escaldes-Engordany (en la web: Av. 8 d'Agost 9, local 1C → unificar)", telefono: '+376 841 800',
    zonas: 'Escaldes-Engordany, Andorra la Vella, Ordino', competidores: "Lucas Fox, Andorra Sotheby's, Windsor & Meyers, Colonial, Dúplex" },
];

// ─────────────────────────────────────────────────────────────────────────
//  2) FUNCIONES PARA EJECUTAR (desplegable de arriba → ▷ Ejecutar)
// ─────────────────────────────────────────────────────────────────────────
/** Comprueba las claves y que encuentra las 4 fichas. Mira el "Registro de ejecución". */
function testFichas() {
  SEDES.forEach(function (s) {
    try {
      const f = ficha_(s);
      Logger.log('✅ ' + s.nombre + ' → ' + (f.displayName || {}).text + ' · ' + f.formattedAddress + ' · ' + (f.rating || '–') + '★ (' + (f.userRatingCount || 0) + ' reseñas)');
    } catch (e) { Logger.log('❌ ' + s.nombre + ' → ' + e.message); }
  });
  try { Logger.log('✅ Gemini responde: ' + gemini_('Responde solo: OK', {})); }
  catch (e) { Logger.log('❌ Gemini → ' + e.message); }
}

/** Envía el informe ahora mismo (tarda 2-5 min). */
function enviarInformeAhora() { ejecutar_(true); }

/** Deja el informe automático cada lunes a las 8:00. */
function instalarTrigger() {
  borrarTriggers_(['informeSemanal', 'continuarInforme']);
  ScriptApp.newTrigger('informeSemanal').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).inTimezone('Europe/Madrid').create();
  Logger.log('✅ Trigger instalado: informe cada lunes a las 8:00.');
}

// Las lanzan los triggers
function informeSemanal() { ejecutar_(true); }
function continuarInforme() { ejecutar_(false); }

// ─────────────────────────────────────────────────────────────────────────
//  3) FLUJO: una sede por vez; si se acerca el límite de 6 min, sigue solo en 1 min
// ─────────────────────────────────────────────────────────────────────────
function ejecutar_(nuevo) {
  const t0 = Date.now(), trabajo = hoja_('Trabajo');
  if (!nuevo && trabajo.getLastRow() === 0) return;   // no hay informe a medias
  if (nuevo) {
    trabajo.clearContents();
    trabajo.appendRow(['dominio', JSON.stringify(auditarDominio_())]);
  }
  borrarTriggers_(['continuarInforme']);
  const hechas = trabajo.getDataRange().getValues().map(function (r) { return r[0]; });
  const dominio = JSON.parse(trabajo.getRange(1, 2).getValue() || 'null');

  for (let i = 0; i < SEDES.length; i++) {
    const s = SEDES[i];
    if (hechas.indexOf(s.code) !== -1) continue;
    if (Date.now() - t0 > 4 * 60 * 1000) {
      ScriptApp.newTrigger('continuarInforme').timeBased().after(60 * 1000).create();
      Logger.log('⏳ Continúa en 1 minuto (límite de tiempo de Google).');
      return;
    }
    let r;
    try {
      const datos = analizarSede_(s);
      datos.busquedaMarca = buscarMarca_(s);
      r = { datos: datos, plan: planIA_(s, datos, i === 0 ? dominio : null) };
    } catch (e) { r = { error: e.message }; }
    trabajo.appendRow([s.code, JSON.stringify(r)]);
  }

  const resultados = {};
  trabajo.getDataRange().getValues().forEach(function (row) { if (row[0] !== 'dominio') resultados[row[0]] = JSON.parse(row[1]); });
  enviarInforme_(resultados, dominio);
  trabajo.clearContents();
}

// ─────────────────────────────────────────────────────────────────────────
//  4) DATOS DE CADA SEDE (Google Places + web)
// ─────────────────────────────────────────────────────────────────────────
function analizarSede_(s) {
  const f = ficha_(s), web = f.websiteUri || CONFIG.WEB;
  const d = {
    nombreFicha: (f.displayName || {}).text || '', direccion: f.formattedAddress || '', telefono: f.nationalPhoneNumber || '',
    web: f.websiteUri || '', estado: f.businessStatus || '', rating: f.rating || 0, resenas: f.userRatingCount || 0,
    fotos: (f.photos || []).length, horario: !!f.regularOpeningHours, maps: f.googleMapsUri || '',
    competencia: competencia_(s, f.id),
    seoWeb: auditarWeb_(web, f.nationalPhoneNumber),
    pagespeed: CONFIG.PAGESPEED ? pageSpeed_(web) : null,
    anterior: JSON.parse(PropertiesService.getScriptProperties().getProperty('ANT_' + s.code) || 'null'),
  };
  const todos = d.competencia.concat([{ yo: true, resenas: d.resenas, rating: d.rating }]).sort(function (a, b) { return b.resenas - a.resenas; });
  d.puesto = todos.findIndex(function (x) { return x.yo; }) + 1;
  d.totalZona = todos.length;
  d.falta = checklist_(s, d);
  d.completa = Math.round(100 * (CHECKS - d.falta.length) / CHECKS);
  return d;
}

const CHECKS = 10;
function checklist_(s, d) {
  const f = [];
  if (!d.telefono) f.push('Teléfono');
  if (!d.web) f.push('Web enlazada');
  if (!d.horario) f.push('Horario');
  if (d.fotos < 10) f.push('Más fotos (fachada, oficina, equipo)');
  if (d.resenas < 30) f.push('Mínimo 30 reseñas');
  if (d.rating < 4.5) f.push('Nota ≥ 4,5');
  if (/[|·\-–]\s*(inmobiliaria|agencia|immobiliària)/i.test(d.nombreFicha)) f.push('Nombre sin palabras clave (riesgo de suspensión)');
  const w = d.seoWeb && !d.seoWeb.error ? d.seoWeb : null;   // si la web no responde, no se juzga
  if (w && !w.schema) f.push('Schema en la web');
  if (w && w.telefono === false) f.push('Mismo teléfono en ficha y web');
  if (w && !w.metaDescription) f.push('Meta description');
  return f;
}

function ficha_(s) {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('PLACE_' + s.code);
  if (!id) {
    const r = places_('places:searchText', 'places.id,places.displayName', { textQuery: s.buscar, languageCode: 'es' });
    const lista = (r.places || []);
    const nuestra = lista.filter(function (p) { return /dur[aá]n\s*carasso/i.test((p.displayName || {}).text || ''); })[0] || lista[0];
    if (!nuestra) throw new Error('No encuentro la ficha de ' + s.nombre + ' en Google');
    id = nuestra.id; props.setProperty('PLACE_' + s.code, id);
  }
  return places_('places/' + id + '?languageCode=es',
    'id,displayName,formattedAddress,nationalPhoneNumber,websiteUri,businessStatus,rating,userRatingCount,photos,regularOpeningHours,googleMapsUri');
}

function competencia_(s, miId) {
  try {
    const r = places_('places:searchText', 'places.id,places.displayName,places.rating,places.userRatingCount',
      { textQuery: s.mercado, languageCode: 'es', pageSize: 8 });
    return (r.places || []).filter(function (p) {
      return p.id !== miId && !/dur[aá]n\s*carasso/i.test((p.displayName || {}).text || '');
    }).slice(0, 5).map(function (p) { return { nombre: (p.displayName || {}).text, rating: p.rating || 0, resenas: p.userRatingCount || 0 }; });
  } catch (e) { return []; }
}

function places_(ruta, campos, body) {
  const res = UrlFetchApp.fetch('https://places.googleapis.com/v1/' + ruta, {
    method: body ? 'post' : 'get', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'X-Goog-Api-Key': CONFIG.GOOGLE_API_KEY, 'X-Goog-FieldMask': campos },
    payload: body ? JSON.stringify(body) : undefined,
  });
  if (res.getResponseCode() >= 400) {
    const t = res.getContentText();
    throw new Error(/not been used|disabled|PERMISSION/i.test(t) ? 'Activa "Places API (New)" en Google Cloud para esta clave' : 'Google ' + res.getResponseCode() + ': ' + t.slice(0, 200));
  }
  return JSON.parse(res.getContentText());
}

function auditarWeb_(url, telefono) {
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) return { error: 'La web responde ' + res.getResponseCode() };
    const h = res.getContentText();
    const tel = String(telefono || '').replace(/\D/g, '').replace(/^(34|376)(?=\d{6,9}$)/, '');
    return {
      title: (h.match(/<title[^>]*>([^<]*)/i) || [])[1] || '',
      metaDescription: /<meta[^>]+name=["']description["'][^>]+content=["'][^"']{20,}/i.test(h) || /<meta[^>]+content=["'][^"']{20,}["'][^>]+name=["']description/i.test(h),
      h1: (h.match(/<h1[\s>]/gi) || []).length,
      schema: /application\/ld\+json[\s\S]{0,5000}?(LocalBusiness|RealEstateAgent)/i.test(h),
      telefono: tel ? new RegExp(tel.split('').join('[\\s.\\-()]*')).test(h) : null,
    };
  } catch (e) { return { error: e.message }; }
}

function pageSpeed_(url) {
  try {
    const r = JSON.parse(UrlFetchApp.fetch('https://www.googleapis.com/pagespeedonline/v5/runPagespeed?strategy=mobile&category=SEO&category=PERFORMANCE&url=' +
      encodeURIComponent(url) + '&key=' + CONFIG.GOOGLE_API_KEY, { muteHttpExceptions: true }).getContentText());
    const c = r.lighthouseResult.categories;
    return { seo: Math.round(c.seo.score * 100), velocidadMovil: Math.round(c.performance.score * 100) };
  } catch (e) { return null; }
}

/** Revisión de la web común a todas las sedes (SEO técnico + buscadores con IA). */
function auditarDominio_() {
  const out = [];
  let vivo = false;
  try { vivo = UrlFetchApp.fetch(CONFIG.WEB, { muteHttpExceptions: true, followRedirects: true }).getResponseCode() === 200; } catch (e) {}
  if (!vivo) return ['No se pudo revisar la web (' + CONFIG.WEB + ' no responde)'];
  function get(p) {
    try { const r = UrlFetchApp.fetch(CONFIG.WEB + p, { muteHttpExceptions: true, followRedirects: true });
          return r.getResponseCode() === 200 ? r.getContentText() : null; } catch (e) { return null; }
  }
  const robots = get('/robots.txt');
  if (robots === null) out.push('Sin robots.txt');
  else {
    ['GPTBot', 'ClaudeBot', 'PerplexityBot'].forEach(function (bot) {
      const bloque = robots.split(/user-agent:/i).filter(function (b) { return b.trim().toLowerCase().indexOf(bot.toLowerCase()) === 0; })[0];
      if (bloque && /disallow:\s*\/\s*$/im.test(bloque)) out.push('robots.txt bloquea a ' + bot + ' (no apareceréis en respuestas de IA)');
    });
    if (!/sitemap:/i.test(robots)) out.push('robots.txt no indica el sitemap');
  }
  if (get('/llms.txt') === null) out.push('Falta llms.txt (ayuda a ChatGPT, Gemini y Perplexity a entender la marca)');
  const home = get('/');
  if (home) {
    if (!/hreflang=["']fr/i.test(home)) out.push('Sin versión en francés (clave para Andorra y Cerdanya)');
    if (!/FAQPage/i.test(home)) out.push('Sin preguntas frecuentes con schema FAQPage');
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
//  5) IA (Gemini)
// ─────────────────────────────────────────────────────────────────────────
function gemini_(prompt, o) {
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: o.temp || 0.6 } };
  if (o.json) body.generationConfig.responseMimeType = 'application/json';
  if (o.buscar) body.tools = [{ google_search: {} }];
  const modelos = [CONFIG.GEMINI_MODEL].concat(CONFIG.GEMINI_RESERVA || []);
  for (let intento = 0; intento < modelos.length; intento++) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + modelos[intento] + ':generateContent';
    const res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-goog-api-key': CONFIG.GEMINI_API_KEY }, payload: JSON.stringify(body) });
    const code = res.getResponseCode();
    // modelo saturado, retirado o sin cuota → siguiente modelo de reserva
    if ((code === 404 || code === 429 || code >= 500) && intento < modelos.length - 1) { Utilities.sleep(3000); continue; }
    if (code >= 400) throw new Error('Gemini ' + code + ': ' + res.getContentText().slice(0, 200));
    const parts = ((((JSON.parse(res.getContentText()).candidates || [])[0] || {}).content || {}).parts) || [];
    const txt = parts.map(function (p) { return p.text || ''; }).join('').trim();
    if (!txt) throw new Error('Gemini no devolvió texto');
    return o.json ? JSON.parse(txt.replace(/^```(json)?|```$/g, '').trim()) : txt;
  }
}

function buscarMarca_(s) {
  try {
    return gemini_('Busca en Google como lo haría un cliente: "' + CONFIG.MARCA + ' ' + s.nombre + '" y "' + s.mercado + '".\n' +
      'Datos oficiales: ' + s.direccion + ' · ' + s.telefono + ' · ' + CONFIG.WEB + '\n' +
      'Responde en castellano, máximo 5 viñetas cortas: qué aparece de la marca y si la web oficial sale primero; ' +
      'direcciones, teléfonos u horarios distintos en otras webs (con la web); qué tienen los competidores (' + s.competidores +
      ') que nosotros no; si ' + CONFIG.MARCA + ' aparece en rankings de "mejor inmobiliaria ' + s.nombre + '". Solo hechos.', { buscar: true, temp: 0.2 });
  } catch (e) { return ''; }
}

function planIA_(s, d, dominio) {
  const mem = memoria_(s.code);
  // si la web no se pudo revisar (fallo puntual), la IA no debe proponer nada sobre ella
  const web = (dominio || []).filter(function (x) { return x.indexOf('No se pudo revisar') !== 0; });
  const datos = JSON.parse(JSON.stringify(d));
  if (datos.seoWeb && datos.seoWeb.error) datos.seoWeb = 'no revisada esta semana (no opines sobre la web)';
  const prompt = 'Eres el responsable de SEO local y de las fichas de Google de ' + CONFIG.MARCA + ', inmobiliaria premium. ' +
    'Tono de los textos: ' + CONFIG.TONO + '\nServicios reales: ' + CONFIG.SERVICIOS + '.\n' +
    'Sede: ' + s.nombre + ' · zonas: ' + s.zonas + ' · dirección oficial: ' + s.direccion + ' · teléfono oficial: ' + s.telefono +
    ' · idioma de los textos: ' + s.idioma + ' · competidores de referencia: ' + s.competidores + '.\n' +
    'Fecha: ' + Utilities.formatDate(new Date(), 'Europe/Madrid', 'dd/MM/yyyy') + '.\n\n' +
    'DATOS DE ESTA SEMANA:\n' + JSON.stringify(datos) + '\n' +
    (web.length ? 'PROBLEMAS DE LA WEB (comunes a todas las sedes, inclúyelos como acciones): ' + web.join('; ') + '\n' : '') +
    (mem.length ? 'EL EQUIPO YA DESCARTÓ O HIZO ESTO (no lo repitas): ' + mem.join(' | ') + '\n' : '') +
    '\nObjetivo: que quien busque "' + CONFIG.MARCA + ' ' + s.nombre + '" encuentre una ficha completa, activa, coherente con la web ' +
    'y mejor que la competencia. Responde SOLO con JSON válido:\n' +
    '{"titular":"1 frase para dirección con lo más importante de la sede",' +
    '"estado":"1-2 frases: cómo está y qué ha cambiado respecto a \'anterior\'",' +
    '"vsCompetencia":"1-2 frases con cifras frente a la competencia",' +
    '"acciones":[{"prioridad":"ALTA|MEDIA|BAJA","accion":"qué hacer y dónde exactamente","motivo":"por qué",' +
    '"recomendada":"la mejor opción y por qué","cuando":"fecha o franja concreta (temporada: Cerdanya/Andorra esquí dic-mar y verano; Sitges primavera-verano; festivos próximos)",' +
    '"contenido":"texto o código listo para copiar (mensaje de WhatsApp para pedir reseñas, meta description, JSON-LD…) o vacío"}],' +
    '"post":"publicación para la ficha de Google en ' + s.idioma + ', máx. 1.000 caracteres, SIN teléfonos, emails ni enlaces (Google los rechaza)",' +
    '"descripcion":"nueva descripción de la ficha en ' + s.idioma + ' (650-750 caracteres, sin teléfonos ni enlaces) o vacío si no hace falta"}\n' +
    'titular, estado, vsCompetencia y acciones SIEMPRE en castellano (solo post y descripcion van en ' + s.idioma + '). ' +
    'No metas el post ni la descripción dentro de acciones. Máximo 4 acciones, ordenadas por impacto. Si la dirección o el teléfono de la ficha no coinciden con los oficiales, o el nombre ' +
    'de la ficha lleva palabras clave ("| Inmobiliaria en…", riesgo de suspensión), ponlo como acción ALTA. No inventes datos.';
  try {
    const p = gemini_(prompt, { json: true });
    p.acciones = (p.acciones || []).slice(0, 4);
    p.post = limpiarPost_(p.post || '');
    return p;
  } catch (e) { return planFallback_(s, d, e.message); }
}

/** Si la IA falla, el informe llega igual con lo que detectan las reglas. */
function planFallback_(s, d, motivo) {
  return {
    titular: 'Ficha al ' + d.completa + '% · ' + d.resenas + ' reseñas · puesto ' + d.puesto + ' de ' + d.totalZona + ' en la zona (sin IA esta semana)',
    errorIA: String(motivo).slice(0, 160),
    estado: '', vsCompetencia: '', post: '', descripcion: '',
    acciones: d.falta.slice(0, 4).map(function (f) {
      return { prioridad: 'MEDIA', accion: 'Completar: ' + f, motivo: 'Detectado en la revisión automática', recomendada: '', cuando: 'Esta semana', contenido: '' };
    }),
  };
}

function limpiarPost_(t) {
  const prohibido = /https?:\/\/|www\.|@\w+\.\w|\+?\d[\d\s.-]{7,}\d/i;
  return String(t).split(/(?<=[.!?…])\s+/).filter(function (f) { return !prohibido.test(f); }).join(' ').trim().slice(0, 1500);
}

/** Otra versión de una propuesta (botón 🔄). */
function otraVersionIA_(p) {
  const s = sede_(p.sede);
  const t = gemini_('Eres el responsable de las fichas de Google de ' + CONFIG.MARCA + ' (' + s.nombre + '). Tono: ' + CONFIG.TONO +
    '\nEsta propuesta no convenció al equipo:\nTipo: ' + p.tipo + '\nTítulo: ' + p.titulo + '\nTexto: ' + p.texto +
    '\n\nEscribe UNA alternativa distinta (otro enfoque), en ' + (p.tipo === 'TAREA' ? 'castellano' : s.idioma) +
    ', lista para usar, sin explicaciones' + (p.tipo === 'POST' ? ', sin teléfonos, emails ni enlaces, máx. 1.000 caracteres' : '') + '.', { temp: 0.95 });
  return p.tipo === 'POST' ? limpiarPost_(t) : t;
}

// ─────────────────────────────────────────────────────────────────────────
//  6) PROPUESTAS + EMAIL
// ─────────────────────────────────────────────────────────────────────────
const COL = { navy: '#0D3550', gold: '#B8922A', gris: '#6B6B6B', borde: '#E2E0DB', fondo: '#F5F4F1', verde: '#1a7f37', rojo: '#cf222e', naranja: '#9a6700', azul: '#0b5cad' };

function enviarInforme_(res, dominio) {
  const hoy = Utilities.formatDate(new Date(), 'Europe/Madrid', 'dd/MM/yyyy');
  const hp = hoja_('Propuestas'), hh = hoja_('Historico');
  let urgentes = 0, total = 0, cuerpo = '', resumen = '';

  SEDES.forEach(function (s) {
    const r = res[s.code];
    cuerpo += '<h2 style="color:' + COL.navy + ';font-size:19px;border-bottom:2px solid ' + COL.gold + ';padding-bottom:6px;margin:26px 0 10px">' + s.nombre + '</h2>';
    if (!r || r.error) { cuerpo += '<p style="color:' + COL.rojo + '">No se pudo analizar: ' + esc_(r ? r.error : 'sin datos') + '</p>'; resumen += '<b>' + s.nombre + ':</b> error<br>'; return; }
    const d = r.datos, p = r.plan, a = d.anterior || {};
    resumen += '<b>' + s.nombre + ':</b> ' + esc_(p.titular) + '<br>';
    cuerpo += kpis_(d, a);
    if (d.falta.length) cuerpo += '<p style="font-size:12px;color:' + COL.gris + ';margin:6px 0">Falta: ' + esc_(d.falta.join(' · ')) + '</p>';
    if (p.estado) cuerpo += '<p style="margin:10px 0">' + esc_(p.estado) + '</p>';
    if (p.vsCompetencia) cuerpo += '<p style="margin:10px 0"><b>Vs. competencia:</b> ' + esc_(p.vsCompetencia) + '</p>';
    cuerpo += tablaCompetencia_(d);

    const items = p.acciones.map(function (x) {
      return { tipo: 'TAREA', prioridad: x.prioridad, titulo: x.accion, texto: x.contenido || x.recomendada || '',
               detalle: x.motivo + (x.recomendada ? '\n✅ Mejor opción: ' + x.recomendada : '') + (x.cuando ? '\n🗓️ Cuándo: ' + x.cuando : '') };
    });
    if (p.post) items.push({ tipo: 'POST', prioridad: 'MEDIA', titulo: 'Publicación semanal para la ficha', texto: p.post, detalle: '' });
    if (p.descripcion) items.push({ tipo: 'DESCRIPCION', prioridad: 'MEDIA', titulo: 'Nueva descripción de la ficha', texto: p.descripcion.slice(0, 750), detalle: '' });
    items.forEach(function (it) {
      it.sede = s.code; it.id = 'p' + Utilities.getUuid().replace(/-/g, '').slice(0, 10); it.token = Utilities.getUuid().slice(0, 8);
      hp.appendRow([new Date(), it.id, it.token, it.sede, it.tipo, it.prioridad, it.titulo, it.detalle, it.texto, 'PENDIENTE']);
      if (it.prioridad === 'ALTA') urgentes++;
      total++;
      cuerpo += tarjeta_(it);
    });
    if (d.busquedaMarca) cuerpo += '<div style="margin-top:12px;background:#fff;border:1px dashed ' + COL.borde + ';border-radius:8px;padding:10px 12px;font-size:12px">' +
      '<b style="color:' + COL.navy + '">🔎 Qué ve un cliente al buscar la marca</b><div style="white-space:pre-wrap;margin-top:4px;color:#333">' + esc_(d.busquedaMarca.slice(0, 1200)) + '</div></div>';

    hh.appendRow([new Date(), s.code, d.rating, d.resenas, d.completa, d.puesto, d.pagespeed ? d.pagespeed.seo : '', d.falta.join(' · ')]);
    PropertiesService.getScriptProperties().setProperty('ANT_' + s.code, JSON.stringify({ rating: d.rating, resenas: d.resenas, completa: d.completa, puesto: d.puesto }));
  });

  const sinIA = SEDES.map(function (s) { return res[s.code] && res[s.code].plan && res[s.code].plan.errorIA; }).filter(Boolean)[0];
  const avisoIA = sinIA ? '<div style="background:#fdecea;border-radius:8px;padding:10px 14px;margin-top:10px;font-size:12px"><b>⚠️ La IA (Gemini) no respondió:</b> ' + esc_(sinIA) +
    '<br>El informe se ha hecho solo con las reglas. Revisa que la clave permita "Generative Language API".</div>' : '';
  const web = dominio && dominio.length ? '<div style="background:#fff8e1;border-radius:8px;padding:12px 16px;margin-top:14px;font-size:13px"><b>🌐 Web (común a las 4 sedes)</b><br>· ' +
    dominio.map(esc_).join('<br>· ') + '</div>' : '';
  const html = marco_('Informe semanal · ' + hoy,
    '<div style="background:' + COL.fondo + ';border-radius:8px;padding:12px 16px;line-height:1.6">' + resumen + '</div>' +
    '<p style="font-size:13px;color:' + COL.gris + '">' + total + ' propuestas' + (urgentes ? ' · <b style="color:' + COL.rojo + '">' + urgentes + ' urgentes</b>' : '') +
    '. Cada una tiene botones de 1 clic: ✅ Hecho · 🔄 Dame otra propuesta · ❌ No me sirve.</p>' + avisoIA + web + cuerpo);
  MailApp.sendEmail({ to: CONFIG.EMAIL_DESTINO, subject: (urgentes ? '🔴 ' + urgentes + ' urgentes · ' : '🟢 ') + 'Fichas de Google · ' + hoy + ' · ' + CONFIG.MARCA, htmlBody: html });
}

function kpis_(d, a) {
  function flecha(antes, ahora, menosEsMejor) {
    if (antes == null || antes === ahora) return '';
    const mejor = menosEsMejor ? ahora < antes : ahora > antes;
    return ' <span style="font-size:13px;color:' + (mejor ? COL.verde : COL.rojo) + '">' + (ahora > antes ? '▲' : '▼') + '</span>';
  }
  function celda(valor, etiqueta, color) {
    return '<td align="center" style="padding:10px 4px"><div style="font-size:22px;font-weight:bold;color:' + (color || '#1c1c1c') + '">' + valor + '</div>' +
      '<div style="font-size:11px;color:' + COL.gris + '">' + etiqueta + '</div></td>';
  }
  const c = d.completa >= 90 ? COL.verde : d.completa >= 70 ? COL.naranja : COL.rojo;
  return '<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid ' + COL.borde + ';border-radius:8px"><tr>' +
    celda(d.completa + '%' + flecha(a.completa, d.completa), 'Ficha completa', c) +
    celda(d.rating + '★' + flecha(a.rating, d.rating), 'Nota') +
    celda(d.resenas + flecha(a.resenas, d.resenas), 'Reseñas') +
    celda(d.puesto + 'º' + flecha(a.puesto, d.puesto, true), 'de ' + d.totalZona + ' en reseñas') + '</tr></table>';
}

function tablaCompetencia_(d) {
  if (!d.competencia.length) return '';
  const filas = d.competencia.slice(0, 4).concat([{ nombre: CONFIG.MARCA, rating: d.rating, resenas: d.resenas, yo: true }])
    .sort(function (a, b) { return b.resenas - a.resenas; });
  const td = 'padding:6px 8px;border-bottom:1px solid ' + COL.borde + ';font-size:12px';
  return '<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;margin:8px 0">' +
    '<tr style="color:' + COL.gris + '"><td style="' + td + '">Inmobiliaria</td><td align="right" style="' + td + '">Nota</td><td align="right" style="' + td + '">Reseñas</td></tr>' +
    filas.map(function (f) {
      const st = f.yo ? 'font-weight:bold;color:' + COL.navy + ';background:#FBF6EA;' : '';
      return '<tr><td style="' + td + ';' + st + '">' + esc_(f.nombre) + '</td><td align="right" style="' + td + ';' + st + '">' + (f.rating || '–') + '★</td>' +
        '<td align="right" style="' + td + ';' + st + '">' + f.resenas + '</td></tr>';
    }).join('') + '</table>';
}

function tarjeta_(it) {
  const color = it.prioridad === 'ALTA' ? COL.rojo : it.prioridad === 'MEDIA' ? COL.naranja : COL.gris;
  const nombre = { TAREA: 'Tarea', POST: 'Publicación', DESCRIPCION: 'Descripción' }[it.tipo];
  let base = '';
  try { base = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  const q = base ? base + '?id=' + it.id + '&t=' + it.token + '&a=' : '';
  return '<div style="border:1px solid ' + COL.borde + ';border-left:5px solid ' + color + ';border-radius:8px;padding:12px 16px;margin:12px 0;background:#fff">' +
    '<div style="font-size:11px;font-weight:bold;color:' + color + ';text-transform:uppercase">' + esc_(it.prioridad) + ' · ' + nombre + '</div>' +
    '<div style="font-weight:bold;margin:4px 0 6px">' + esc_(it.titulo) + '</div>' +
    (it.detalle ? '<div style="font-size:13px;color:#444;white-space:pre-wrap">' + esc_(it.detalle) + '</div>' : '') +
    (it.texto ? '<div style="background:' + COL.fondo + ';border-radius:6px;padding:10px 12px;margin-top:8px;font-size:13px;white-space:pre-wrap">' + esc_(it.texto) + '</div>' : '') +
    (q ? '<table cellpadding="0" cellspacing="0" style="margin-top:10px"><tr>' +
      '<td style="padding:0 8px 0 0">' + btn_(q + 'hecho', COL.verde, '#fff', it.tipo === 'TAREA' ? '✅ Hecho' : '✅ Publicado') + '</td>' +
      '<td style="padding:0 8px 0 0">' + btn_(q + 'otra', COL.azul, '#fff', '🔄 Dame otra') + '</td>' +
      '<td>' + btn_(q + 'no', '#fff', '#1c1c1c', '❌ No me sirve', true) + '</td></tr></table>'
      : '<div style="font-size:11px;color:' + COL.gris + ';margin-top:8px">(Los botones se activan al implementar la aplicación web.)</div>') +
    '</div>';
}

function btn_(href, bg, fg, label, borde) {
  return '<table border="0" cellspacing="0" cellpadding="0" style="display:inline-block"><tr>' +
    '<td align="center" bgcolor="' + bg + '" style="border-radius:6px;' + (borde ? 'border:1px solid #ccc;' : '') + '">' +
    '<a href="' + href + '" style="display:inline-block;padding:9px 14px;color:' + fg + ';text-decoration:none;font-weight:bold;font-size:13px;font-family:Arial,sans-serif">' + label + '</a>' +
    '</td></tr></table>';
}

function marco_(titulo, contenido) {
  return '<html><head><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"></head>' +
    '<body style="margin:0;background:#eceff3;padding:16px"><div style="font-family:Arial,sans-serif;max-width:660px;margin:auto;color:#1c1c1c;background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden">' +
    '<div style="background:' + COL.navy + ';color:#fff;padding:18px 20px"><div style="font-size:10px;letter-spacing:3px;opacity:.6;text-transform:uppercase">' + CONFIG.MARCA + ' · Agente Google</div>' +
    '<div style="font-size:20px;font-weight:bold;margin-top:4px">' + titulo + '</div></div><div style="padding:16px 20px">' + contenido +
    '<p style="color:#777;font-size:11px;margin-top:24px">Automatización gratuita · ' + CONFIG.MARCA + ' Agente Google. Lo que marcas como "No me sirve" no se vuelve a proponer.</p></div></div></body></html>';
}

// ─────────────────────────────────────────────────────────────────────────
//  7) WEB APP · botones del email (doGet)
// ─────────────────────────────────────────────────────────────────────────
function doGet(e) {
  const q = e.parameter || {};
  const p = buscarPropuesta_(q.id);
  if (!p) return pagina_('Enlace no válido o caducado', 'Puede que esta propuesta ya no exista.');
  if (q.t !== p.token) return pagina_('Enlace no autorizado', 'El enlace de seguridad no coincide.');

  if (q.a === 'hecho') { marcar_(p, 'HECHO'); return pagina_('✅ Anotado como hecho', '¡Bien! El agente lo tendrá en cuenta la próxima semana.'); }
  if (q.a === 'no') { marcar_(p, 'DESCARTADO'); return pagina_('❌ Descartado', 'Anotado: no volverá a proponerlo.'); }
  if (q.a === 'otra') {
    try {
      const nuevo = otraVersionIA_(p);
      p.hoja.getRange(p.fila, 9).setValue(nuevo);
      p.texto = nuevo;
      MailApp.sendEmail({ to: CONFIG.EMAIL_DESTINO, subject: '🔄 Otra propuesta · ' + sede_(p.sede).nombre + ' · ' + p.titulo,
        htmlBody: marco_('Otra propuesta · ' + sede_(p.sede).nombre, tarjeta_(p)) });
      return pagina_('🔄 Nueva propuesta enviada', 'Te hemos mandado otra versión a tu email.');
    } catch (err) { return pagina_('⚠️ No se pudo generar', err.message); }
  }
  return pagina_('Acción no reconocida', '');
}

function pagina_(titulo, texto) {
  return HtmlService.createHtmlOutput('<div style="font-family:Arial,sans-serif;max-width:520px;margin:60px auto;text-align:center;color:#1c1c1c">' +
    '<h1 style="font-size:26px">' + titulo + '</h1><p style="color:#555;font-size:15px">' + esc_(texto) + '</p>' +
    '<p style="color:#999;font-size:12px;margin-top:32px">' + CONFIG.MARCA + ' · Agente Google</p></div>').setTitle(CONFIG.MARCA + ' · Agente Google');
}

// ─────────────────────────────────────────────────────────────────────────
//  8) REGISTRO (Sheet) + MEMORIA
// ─────────────────────────────────────────────────────────────────────────
const CABECERAS = {
  Propuestas: ['Fecha', 'ID', 'Token', 'Sede', 'Tipo', 'Prioridad', 'Título', 'Detalle', 'Texto', 'Estado'],
  Historico: ['Fecha', 'Sede', 'Nota', 'Reseñas', 'Ficha %', 'Puesto en reseñas', 'SEO web', 'Falta'],
  Trabajo: [],
};

function hoja_(nombre) {
  const files = DriveApp.getFilesByName(CONFIG.NOMBRE_HOJA);
  let ss;
  if (files.hasNext()) ss = SpreadsheetApp.open(files.next());
  else { ss = SpreadsheetApp.create(CONFIG.NOMBRE_HOJA); ss.getSheets()[0].setName('Propuestas').appendRow(CABECERAS.Propuestas); }
  let sh = ss.getSheetByName(nombre);
  if (!sh) { sh = ss.insertSheet(nombre); if (CABECERAS[nombre].length) sh.appendRow(CABECERAS[nombre]); }
  return sh;
}

function buscarPropuesta_(id) {
  if (!id) return null;
  const sh = hoja_('Propuestas'), v = sh.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][1]) === String(id))
      return { hoja: sh, fila: i + 1, id: v[i][1], token: String(v[i][2]), sede: v[i][3], tipo: v[i][4], prioridad: v[i][5], titulo: v[i][6], detalle: v[i][7], texto: v[i][8], estado: v[i][9] };
  }
  return null;
}

function marcar_(p, estado) { p.hoja.getRange(p.fila, 10).setValue(estado); }

/** Lo que el equipo ya hizo o descartó en esta sede (últimas 15). */
function memoria_(code) {
  const v = hoja_('Propuestas').getDataRange().getValues().slice(1).filter(function (r) {
    return r[3] === code && (r[9] === 'DESCARTADO' || r[9] === 'HECHO');
  });
  return v.slice(-15).map(function (r) { return r[9] + ': ' + r[6]; });
}

// ─────────────────────────────────────────────────────────────────────────
//  9) UTILIDADES
// ─────────────────────────────────────────────────────────────────────────
function sede_(code) { return SEDES.filter(function (s) { return s.code === code; })[0] || SEDES[0]; }
function esc_(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function borrarTriggers_(fns) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (fns.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t); });
}

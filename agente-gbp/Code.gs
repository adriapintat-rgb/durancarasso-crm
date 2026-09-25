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
  PAGESPEED: true,   // velocidad y SEO técnico de la web (una vez por informe, ~30 s)
};

// Las claves se recuerdan: al pegar una versión nueva con PEGA_AQUI… se usan las guardadas la última vez.
(function () {
  const p = PropertiesService.getScriptProperties();
  ['GEMINI_API_KEY', 'GOOGLE_API_KEY'].forEach(function (k) {
    if (/^PEGA_AQUI/.test(CONFIG[k])) CONFIG[k] = p.getProperty(k) || CONFIG[k];
    else if (p.getProperty(k) !== CONFIG[k]) p.setProperty(k, CONFIG[k]);
  });
})();

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
//  3) FLUJO: datos sede a sede → la IA decide para las 4 → email (si se acerca el límite de 6 min, sigue solo en 1 min)
// ─────────────────────────────────────────────────────────────────────────
function ejecutar_(nuevo) {
  const t0 = Date.now(), trabajo = hoja_('Trabajo');
  if (!nuevo && trabajo.getLastRow() === 0) return;   // no hay informe a medias
  if (nuevo) {
    trabajo.clearContents();
    trabajo.appendRow(['dominio', JSON.stringify(auditarDominio_())]);
  }
  borrarTriggers_(['continuarInforme']);
  const filas = {};
  trabajo.getDataRange().getValues().forEach(function (r) { filas[r[0]] = JSON.parse(r[1]); });
  function seguirLuego() {
    ScriptApp.newTrigger('continuarInforme').timeBased().after(60 * 1000).create();
    Logger.log('⏳ Continúa en 1 minuto (límite de tiempo de Google).');
  }

  // 1) Datos de cada sede (una por vez)
  for (let i = 0; i < SEDES.length; i++) {
    const s = SEDES[i];
    if (filas[s.code]) continue;
    if (Date.now() - t0 > 3.5 * 60 * 1000) return seguirLuego();
    let r;
    try { r = analizarSede_(s); } catch (e) { r = { error: e.message }; }
    trabajo.appendRow([s.code, JSON.stringify(r)]);
    filas[s.code] = r;
  }
  // 2) La IA decide para las 4 sedes a la vez; cada llamada con su propio margen de tiempo
  if (!filas.plan) {
    if (Date.now() - t0 > 90 * 1000) return seguirLuego();
    filas.plan = tareasIA_(filas, filas.dominio);
    trabajo.appendRow(['plan', JSON.stringify(filas.plan)]);
  }
  if (!filas.textos) {
    if (Date.now() - t0 > 90 * 1000) return seguirLuego();
    filas.textos = textosIA_(filas);
    trabajo.appendRow(['textos', JSON.stringify(filas.textos)]);
  }
  const plan = filas.plan;
  plan.posts = filas.textos.posts || {}; plan.descripciones = filas.textos.descripciones || {};
  if (filas.textos.error && !plan.errorIA) plan.errorIA = 'textos: ' + filas.textos.error;
  enviarInforme_(filas, plan, filas.dominio);
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
  const ps = CONFIG.PAGESPEED ? pageSpeed_(CONFIG.WEB) : null;
  if (ps && ps.velocidadMovil < 50) out.push('Web lenta en móvil: ' + ps.velocidadMovil + '/100 en PageSpeed (Google lo penaliza)');
  if (ps && ps.seo < 90) out.push('SEO técnico mejorable: ' + ps.seo + '/100 en PageSpeed');
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
//  5) IA (Gemini)
// ─────────────────────────────────────────────────────────────────────────
function gemini_(prompt, o) {
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: o.temp || 0.6 } };
  if (o.json) body.generationConfig.responseMimeType = 'application/json';
  if (o.schema) body.generationConfig.responseSchema = o.schema;   // obliga a Gemini a devolver un JSON válido con esta forma
  const modelos = [CONFIG.GEMINI_MODEL, CONFIG.GEMINI_MODEL].concat(CONFIG.GEMINI_RESERVA || []);  // 2 intentos con el principal
  const agotados = {};
  for (let intento = 0; intento < modelos.length; intento++) {
    if (agotados[modelos[intento]]) continue;
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + modelos[intento] + ':generateContent';
    let res;
    try {
      res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { 'x-goog-api-key': CONFIG.GEMINI_API_KEY }, payload: JSON.stringify(body) });
    } catch (e) { if (intento < modelos.length - 1) continue; throw new Error('Gemini no respondió a tiempo'); }
    const code = res.getResponseCode();
    // modelo saturado, retirado, sin cuota o sin respuesta → siguiente modelo de reserva
    if (code === 404 || code === 429) agotados[modelos[intento]] = true;   // sin cuota hoy o retirado: no se reintenta
    if ((code === 0 || code === 404 || code === 429 || code >= 500) && intento < modelos.length - 1) { if (code >= 500) Utilities.sleep(3000); continue; }
    if (code >= 400) throw new Error('Gemini ' + code + ': ' + res.getContentText().slice(0, 200));
    let parts;
    try { parts = ((((JSON.parse(res.getContentText()).candidates || [])[0] || {}).content || {}).parts) || []; }
    catch (e) { if (intento < modelos.length - 1) continue; throw new Error('Gemini no respondió a tiempo'); }
    const txt = parts.map(function (p) { return p.text || ''; }).join('').trim();
    if (!txt) { if (intento < modelos.length - 1) continue; throw new Error('Gemini no devolvió texto'); }
    if (!o.json) return txt;
    // a veces Gemini devuelve un JSON roto (p. ej. con código dentro): se reintenta con otro modelo
    try { return JSON.parse(txt.replace(/^```(json)?|```$/g, '').trim().replace(/,\s*([}\]])/g, '$1')); }
    catch (e) { if (intento < modelos.length - 1) continue; throw new Error('Gemini devolvió un JSON no válido (' + e.message + ')'); }
  }
}

function sedesConDatos_(filas) { return SEDES.filter(function (s) { return filas[s.code] && !filas[s.code].error; }); }
function introIA_() {
  return 'Eres el responsable de SEO local y de las fichas de Google de ' + CONFIG.MARCA + ', inmobiliaria premium con 4 sedes. ' +
    'Tono: ' + CONFIG.TONO + '\nServicios reales: ' + CONFIG.SERVICIOS + '.\nFecha: ' + Utilities.formatDate(new Date(), 'Europe/Madrid', 'dd/MM/yyyy') +
    ' (temporadas: Cerdanya y Andorra esquí dic-mar y verano; Sitges primavera-verano).\n';
}

/** Una sola decisión para las 4 sedes: pocas tareas, sin repetir, con pasos concretos. */
function tareasIA_(filas, dominio) {
  const sedes = sedesConDatos_(filas);
  if (!sedes.length) return planFallback_(filas, dominio, 'no hay datos de ninguna sede');
  const web = (dominio || []).filter(function (x) { return x.indexOf('No se pudo revisar') !== 0; });
  const datos = sedes.map(function (s) {
    const d = JSON.parse(JSON.stringify(filas[s.code]));
    if (d.seoWeb && d.seoWeb.error) d.seoWeb = 'no revisada esta semana (no opines sobre la web)';
    return { sede: s.code, nombre: s.nombre, zonas: s.zonas, direccionOficial: s.direccion, telefonoOficial: s.telefono, competidoresReferencia: s.competidores, datos: d };
  });
  const mem = memoria_();
  const S = 'STRING', txt = { type: S };
  try {
    const plan = gemini_(introIA_() +
      '\nDATOS DE ESTA SEMANA POR SEDE (competencia = inmobiliarias de la zona en Google Maps; anterior = semana pasada):\n' + JSON.stringify(datos) + '\n' +
      (web.length ? 'PROBLEMAS DE LA WEB (comunes a todas las sedes): ' + web.join('; ') + '\n' : '') +
      (mem.length ? 'EL EQUIPO YA HIZO O DESCARTÓ ESTO (no lo vuelvas a proponer): ' + mem.join(' | ') + '\n' : '') +
      '\nElige las POCAS tareas con más impacto de esta semana. Responde en JSON: resumen (2 frases para dirección: cómo están las fichas y lo más importante) ' +
      'y tareas (prioridad; sedes = códigos afectados BCN, STG, CRD, AND; que = acción en imperativo, máx. 12 palabras; porque = 1 frase con el dato que lo justifica, ' +
      'con cifras de la competencia si aplica; pasos = máx. 4, que digan exactamente dónde, p. ej. business.google.com → elige la sede → Editar perfil → Nombre; ' +
      'cuando = fecha o franja concreta; texto = texto listo para copiar si hace falta, como un mensaje de WhatsApp para pedir reseñas o una meta description, o vacío).\n' +
      'REGLAS: máximo 5 tareas, ordenadas por impacto. Si un problema afecta a varias sedes es UNA sola tarea con todas esas sedes (nunca repitas la misma tarea por sede). ' +
      'Nombre de ficha con palabras clave (| Inmobiliaria en…) o dirección/teléfono distintos de los oficiales = ALTA; el nombre correcto es solo ' + CONFIG.MARCA +
      ', sin ciudad ni actividad. No propongas posts ni descripciones (van aparte). Todo en castellano. Sin código. No inventes datos.',
      { json: true, schema: { type: 'OBJECT', required: ['resumen', 'tareas'], properties: { resumen: txt,
        tareas: { type: 'ARRAY', items: { type: 'OBJECT', required: ['prioridad', 'sedes', 'que', 'porque', 'pasos', 'cuando'], properties: {
          prioridad: { type: S, enum: ['ALTA', 'MEDIA', 'BAJA'] }, sedes: { type: 'ARRAY', items: txt }, que: txt, porque: txt,
          pasos: { type: 'ARRAY', items: txt }, cuando: txt, texto: txt } } } } } });
    const codigos = sedes.map(function (s) { return s.code; });
    plan.tareas = (plan.tareas || []).slice(0, 5).map(function (t) {
      t.sedes = (t.sedes || []).filter(function (c) { return codigos.indexOf(c) !== -1; });
      if (!t.sedes.length) t.sedes = codigos;
      return t;
    });
    return plan;
  } catch (e) { return planFallback_(filas, dominio, e.message); }
}

/** Textos listos para pegar: un post por sede + descripción solo si toca. */
function textosIA_(filas) {
  const sedes = sedesConDatos_(filas), S = 'STRING', out = { posts: {}, descripciones: {} };
  if (!sedes.length) return out;
  try {
    const necesitan = sedes.filter(function (s) { return necesitaDescripcion_(s.code); });
    const campos = function (lista, que) { const o = {}; lista.forEach(function (s) { o[s.code] = { type: S, description: que + ' de ' + s.nombre + ', escrito en ' + s.idioma }; }); return o; };
    const schema = { type: 'OBJECT', required: ['posts'], properties: { posts: { type: 'OBJECT', properties: campos(sedes, 'publicación'), required: sedes.map(function (s) { return s.code; }) } } };
    if (necesitan.length) schema.properties.descripciones = { type: 'OBJECT', properties: campos(necesitan, 'descripción de la ficha'), required: necesitan.map(function (s) { return s.code; }) };
    const t = gemini_(introIA_() + '\nSedes: ' + JSON.stringify(sedes.map(function (s) { return { sede: s.code, nombre: s.nombre, idioma: s.idioma, zonas: s.zonas }; })) +
      '\n\nEscribe en JSON: posts = una publicación para la ficha de Google de cada sede (en su idioma, máx. 900 caracteres, un tema útil y de temporada)' +
      (necesitan.length ? '; descripciones = nueva descripción de la ficha para ' + necesitan.map(function (s) { return s.nombre; }).join(', ') + ' (en su idioma, 650-750 caracteres)' : '') +
      '.\nSin teléfonos, emails ni enlaces (Google los rechaza). Ortografía correcta (en catalán con apóstrofos: l\'oficina, d\'Espanya). No inventes datos, precios ni inmuebles.',
      { json: true, schema: schema });
    sedes.forEach(function (s) {
      if ((t.posts || {})[s.code]) out.posts[s.code] = limpiarPost_(t.posts[s.code]);
      if ((t.descripciones || {})[s.code] && necesitaDescripcion_(s.code)) out.descripciones[s.code] = limpiarPost_(t.descripciones[s.code]).slice(0, 750);
    });
  } catch (e) { out.error = String(e.message).slice(0, 150); }
  return out;
}

/** Si la IA falla, el informe llega igual con lo que detectan las reglas (agrupado, sin repetir por sede). */
function planFallback_(filas, dominio, motivo) {
  const grupos = {}, orden = [];
  SEDES.forEach(function (s) {
    const d = filas[s.code];
    if (!d || d.error) return;
    d.falta.forEach(function (f) { if (!grupos[f]) { grupos[f] = []; orden.push(f); } grupos[f].push(s.code); });
  });
  orden.sort(function (a, b) { return (/suspensión/.test(b) ? 1 : 0) - (/suspensión/.test(a) ? 1 : 0); });
  const tareas = orden.slice(0, 5).map(function (f) {
    return { prioridad: /suspensión/.test(f) ? 'ALTA' : 'MEDIA', sedes: grupos[f], que: 'Completar: ' + f, porque: 'Detectado en la revisión automática.', pasos: [], cuando: 'Esta semana', texto: '' };
  });
  return { resumen: '', errorIA: String(motivo).slice(0, 160), tareas: tareas, posts: {}, descripciones: {} };
}

function limpiarPost_(t) {
  const prohibido = /https?:\/\/|www\.|@\w+\.\w|\+?\d[\d\s.-]{7,}\d/i;
  return String(t).split(/(?<=[.!?…])\s+/).filter(function (f) { return !prohibido.test(f); }).join(' ').trim().slice(0, 1500);
}

function detalleTarea_(t) {
  const pasos = (t.pasos || []).filter(String).slice(0, 4);
  return (t.porque ? 'Por qué: ' + t.porque : '') +
    (pasos.length ? '\nCómo:\n' + pasos.map(function (x, i) { return (i + 1) + '. ' + String(x).replace(/^\d+[.)]\s*/, ''); }).join('\n') : '') +
    (t.cuando ? '\nCuándo: ' + t.cuando : '');
}

/** Otra versión de una propuesta (botón 🔄). Devuelve { titulo, detalle, texto }. */
function otraVersionIA_(p) {
  const s = sede_(String(p.sede).split(',')[0]);
  if (p.tipo === 'TAREA') {
    const t = gemini_('Eres el responsable de las fichas de Google de ' + CONFIG.MARCA + ', inmobiliaria premium. Tono: ' + CONFIG.TONO +
      '\nEsta tarea no convenció al equipo:\nQué: ' + p.titulo + '\n' + p.detalle + '\nTexto: ' + (p.texto || '(ninguno)') +
      '\n\nPropón UNA alternativa con otro enfoque para lograr el mismo objetivo. Responde SOLO con JSON válido, en castellano: ' +
      '{"que":"acción en imperativo, máx. 12 palabras","porque":"1 frase","pasos":["máx. 4 pasos exactos"],"cuando":"franja concreta","texto":"texto listo para copiar o vacío"}. ' +
      'El nombre de la ficha debe ser solo "' + CONFIG.MARCA + '", sin ciudad ni actividad. No inventes datos.',
      { json: true, temp: 0.95, schema: { type: 'OBJECT', required: ['que', 'porque', 'pasos', 'cuando'], properties: {
        que: { type: 'STRING' }, porque: { type: 'STRING' }, pasos: { type: 'ARRAY', items: { type: 'STRING' } }, cuando: { type: 'STRING' }, texto: { type: 'STRING' } } } });
    return { titulo: t.que || p.titulo, detalle: detalleTarea_(t), texto: t.texto || '' };
  }
  const txt = gemini_('Eres el responsable de las fichas de Google de ' + CONFIG.MARCA + ' (' + s.nombre + '). Tono: ' + CONFIG.TONO +
    '\nEste texto no convenció al equipo:\n' + p.texto +
    '\n\nEscribe UNA alternativa distinta (otro enfoque), en ' + s.idioma + ', lista para pegar en Google, sin explicaciones, ' +
    'sin teléfonos, emails ni enlaces, máx. ' + (p.tipo === 'POST' ? '900' : '750') + ' caracteres.', { temp: 0.95 });
  return { titulo: p.titulo, detalle: p.detalle, texto: limpiarPost_(txt).slice(0, p.tipo === 'POST' ? 1500 : 750) };
}

// ─────────────────────────────────────────────────────────────────────────
//  6) PROPUESTAS + EMAIL
// ─────────────────────────────────────────────────────────────────────────
const COL = { navy: '#0D3550', gold: '#B8922A', gris: '#6B6B6B', borde: '#E2E0DB', fondo: '#F5F4F1', verde: '#1a7f37', rojo: '#cf222e', naranja: '#9a6700', azul: '#0b5cad' };

function enviarInforme_(filas, plan, dominio) {
  const hoy = Utilities.formatDate(new Date(), 'Europe/Madrid', 'dd/MM/yyyy');
  const hp = hoja_('Propuestas'), hh = hoja_('Historico');
  let urgentes = 0, total = 0;
  function guardar(it) {
    it.id = 'p' + Utilities.getUuid().replace(/-/g, '').slice(0, 10); it.token = Utilities.getUuid().slice(0, 8);
    hp.appendRow([new Date(), it.id, it.token, it.sede, it.tipo, it.prioridad, it.titulo, it.detalle, it.texto, 'PENDIENTE']);
    if (it.prioridad === 'ALTA') urgentes++;
    total++;
    return tarjeta_(it);
  }

  // 1) Tareas de la semana (ya agrupadas entre sedes)
  const tareas = plan.tareas.map(function (t) {
    return guardar({ tipo: 'TAREA', prioridad: t.prioridad || 'MEDIA', sede: t.sedes.join(','), titulo: t.que, detalle: detalleTarea_(t), texto: t.texto || '' });
  }).join('');
  // 2) Textos listos para pegar en cada ficha
  let textos = '';
  SEDES.forEach(function (s) {
    if (plan.posts[s.code]) textos += guardar({ tipo: 'POST', prioridad: 'MEDIA', sede: s.code, titulo: 'Publicación · ' + s.nombre,
      detalle: 'Dónde: business.google.com → ' + s.nombre + ' → Añadir novedad (con una foto propia).', texto: plan.posts[s.code] });
    if (plan.descripciones[s.code]) textos += guardar({ tipo: 'DESCRIPCION', prioridad: 'MEDIA', sede: s.code, titulo: 'Nueva descripción · ' + s.nombre,
      detalle: 'Dónde: business.google.com → ' + s.nombre + ' → Editar perfil → Descripción.', texto: plan.descripciones[s.code] });
  });
  // 3) Referencia: competencia por zona + histórico
  let competencia = '';
  SEDES.forEach(function (s) {
    const d = filas[s.code];
    if (!d || d.error) return;
    competencia += '<div style="font-weight:bold;color:' + COL.navy + ';margin:14px 0 2px">' + s.nombre + ' · puesto ' + d.puesto + ' de ' + d.totalZona + ' en reseñas</div>' + tablaCompetencia_(d);
    hh.appendRow([new Date(), s.code, d.rating, d.resenas, d.completa, d.puesto, '', d.falta.join(' · ')]);
    PropertiesService.getScriptProperties().setProperty('ANT_' + s.code, JSON.stringify({ rating: d.rating, resenas: d.resenas, completa: d.completa, puesto: d.puesto }));
  });

  const h2 = function (t) { return '<h2 style="color:' + COL.navy + ';font-size:18px;border-bottom:2px solid ' + COL.gold + ';padding-bottom:6px;margin:28px 0 8px">' + t + '</h2>'; };
  const avisoIA = plan.errorIA ? '<div style="background:#fdecea;border-radius:8px;padding:10px 14px;margin-top:10px;font-size:12px"><b>⚠️ La IA (Gemini) no respondió:</b> ' + esc_(plan.errorIA) +
    (/^textos:/.test(plan.errorIA) ? '<br>Esta semana faltan los textos (posts y descripciones).' : '<br>Esta semana las tareas salen solo de las reglas.') +
    (/429|quota/i.test(plan.errorIA) ? ' Motivo: se ha gastado la cuota gratuita diaria de Gemini (se renueva cada día).' : ' Suele ser puntual: el próximo informe se reintenta solo.') +
    (/API key|403|PERMISSION/i.test(plan.errorIA) ? ' Revisa la clave de Gemini en CONFIG.' : '') + '</div>' : '';
  const web = dominio && dominio.length ? '<p style="font-size:12px;color:' + COL.gris + ';margin-top:14px"><b>🌐 Web (común a las 4 sedes):</b> ' + dominio.map(esc_).join(' · ') + '</p>' : '';
  const html = marco_('Semana del ' + hoy,
    (plan.resumen ? '<p style="font-size:15px;line-height:1.5;margin:0 0 12px">' + esc_(plan.resumen) + '</p>' : '') +
    tablaKpis_(filas) + avisoIA +
    h2('🎯 Qué hacer esta semana (' + plan.tareas.length + ')') +
    '<p style="font-size:12px;color:' + COL.gris + ';margin:0">Cuando lo hagas pulsa ✅. Si no te convence, 🔄 te da otra opción al momento.</p>' + tareas +
    (textos ? h2('✍️ Textos listos para pegar') + textos : '') +
    h2('📊 Competencia por zona') + competencia + web);
  MailApp.sendEmail({ to: CONFIG.EMAIL_DESTINO, subject: (urgentes ? '🔴 ' + urgentes + ' urgentes · ' : '🟢 ') + 'Fichas de Google · ' + hoy + ' · ' + CONFIG.MARCA, htmlBody: html });
}

/** Una fila por sede: ficha, nota, reseñas y puesto, con flecha frente a la semana anterior. */
function tablaKpis_(filas) {
  function flecha(antes, ahora, menosEsMejor) {
    if (antes == null || antes === ahora) return '';
    const mejor = menosEsMejor ? ahora < antes : ahora > antes;
    return ' <span style="color:' + (mejor ? COL.verde : COL.rojo) + '">' + (ahora > antes ? '▲' : '▼') + '</span>';
  }
  const td = 'padding:8px 6px;border-bottom:1px solid ' + COL.borde + ';font-size:13px';
  return '<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid ' + COL.borde + ';border-radius:8px">' +
    '<tr style="color:' + COL.gris + ';font-size:11px"><td style="' + td + '">Sede</td><td align="center" style="' + td + '">Ficha completa</td>' +
    '<td align="center" style="' + td + '">Nota</td><td align="center" style="' + td + '">Reseñas</td><td align="center" style="' + td + '">Puesto zona</td></tr>' +
    SEDES.map(function (s) {
      const d = filas[s.code];
      if (!d || d.error) return '<tr><td style="' + td + '"><b>' + s.nombre + '</b></td><td colspan="4" style="' + td + ';color:' + COL.rojo + '">No se pudo analizar: ' + esc_(d ? d.error : 'sin datos').slice(0, 120) + '</td></tr>';
      const a = d.anterior || {}, c = d.completa >= 90 ? COL.verde : d.completa >= 70 ? COL.naranja : COL.rojo;
      return '<tr><td style="' + td + '"><b>' + s.nombre + '</b></td>' +
        '<td align="center" style="' + td + ';color:' + c + ';font-weight:bold">' + d.completa + '%' + flecha(a.completa, d.completa) + '</td>' +
        '<td align="center" style="' + td + '">' + d.rating + '★' + flecha(a.rating, d.rating) + '</td>' +
        '<td align="center" style="' + td + '">' + d.resenas + flecha(a.resenas, d.resenas) + '</td>' +
        '<td align="center" style="' + td + '">' + d.puesto + 'º de ' + d.totalZona + flecha(a.puesto, d.puesto, true) + '</td></tr>';
    }).join('') + '</table>';
}

function tablaCompetencia_(d) {
  if (!d.competencia.length) return '';
  const filas = d.competencia.slice(0, 4).concat([{ nombre: CONFIG.MARCA, rating: d.rating, resenas: d.resenas, yo: true }])
    .sort(function (a, b) { return b.resenas - a.resenas; });
  const td = 'padding:5px 8px;border-bottom:1px solid ' + COL.borde + ';font-size:12px';
  return '<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff">' +
    filas.map(function (f) {
      const st = f.yo ? 'font-weight:bold;color:' + COL.navy + ';background:#FBF6EA;' : '';
      return '<tr><td style="' + td + ';' + st + '">' + esc_(f.nombre) + '</td><td align="right" style="' + td + ';' + st + '">' + (f.rating || '–') + '★</td>' +
        '<td align="right" style="' + td + ';' + st + '">' + f.resenas + ' reseñas</td></tr>';
    }).join('') + '</table>';
}

function nombresSedes_(codigos) {
  const c = String(codigos || '').split(',').filter(String);
  if (c.length === SEDES.length) return 'Las 4 sedes';
  return c.map(function (x) { return sede_(x).nombre; }).join(' · ');
}

/** Tarjeta de una propuesta. Con web=true se pinta para la página de los botones (texto copiable). */
function tarjeta_(it, web) {
  const color = it.prioridad === 'ALTA' ? COL.rojo : it.prioridad === 'MEDIA' ? COL.naranja : COL.gris;
  const nombre = { TAREA: 'Tarea', POST: 'Publicación', DESCRIPCION: 'Descripción' }[it.tipo];
  let base = '';
  try { base = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  const q = base ? base + '?id=' + it.id + '&t=' + it.token + '&a=' : '';
  const br = function (t) { return esc_(t).replace(/\n/g, '<br>'); };
  return '<div style="border:1px solid ' + COL.borde + ';border-left:5px solid ' + color + ';border-radius:8px;padding:12px 16px;margin:12px 0;background:#fff;text-align:left">' +
    '<div style="font-size:11px;font-weight:bold;color:' + color + ';text-transform:uppercase">' + esc_(it.prioridad) + ' · ' + nombre + ' · ' + esc_(nombresSedes_(it.sede)) + '</div>' +
    '<div style="font-weight:bold;font-size:15px;margin:4px 0 6px">' + esc_(it.titulo) + '</div>' +
    (it.detalle ? '<div style="font-size:13px;color:#444;line-height:1.5">' + br(it.detalle) + '</div>' : '') +
    (it.texto ? '<div' + (web ? ' id="tx"' : '') + ' style="background:' + COL.fondo + ';border-radius:6px;padding:10px 12px;margin-top:8px;font-size:13px;line-height:1.5">' + br(it.texto) + '</div>' +
      (web ? '<button onclick="copiar()" style="margin-top:8px;padding:8px 12px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer">📋 Copiar texto</button> <span id="ok" style="font-size:12px;color:' + COL.verde + '"></span>' : '') : '') +
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
    '<a href="' + href + '" target="_top" style="display:inline-block;padding:9px 14px;color:' + fg + ';text-decoration:none;font-weight:bold;font-size:13px;font-family:Arial,sans-serif">' + label + '</a>' +
    '</td></tr></table>';
}

function marco_(titulo, contenido) {
  return '<html><head><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"></head>' +
    '<body style="margin:0;background:#eceff3;padding:16px"><div style="font-family:Arial,sans-serif;max-width:660px;margin:auto;color:#1c1c1c;background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden">' +
    '<div style="background:' + COL.navy + ';color:#fff;padding:18px 20px"><div style="font-size:10px;letter-spacing:3px;opacity:.6;text-transform:uppercase">' + CONFIG.MARCA + ' · Agente Google</div>' +
    '<div style="font-size:20px;font-weight:bold;margin-top:4px">' + titulo + '</div></div><div style="padding:16px 20px">' + contenido +
    '<p style="color:#777;font-size:11px;margin-top:24px">Automatización gratuita · ' + CONFIG.MARCA + ' Agente Google. Lo que marcas como ✅ o ❌ no se vuelve a proponer.</p></div></div></body></html>';
}

// ─────────────────────────────────────────────────────────────────────────
//  7) WEB APP · botones del email (doGet)
// ─────────────────────────────────────────────────────────────────────────
function doGet(e) {
  const q = e.parameter || {};
  const p = buscarPropuesta_(q.id);
  if (!p) return pagina_('Enlace no válido o caducado', 'Puede que esta propuesta ya no exista.');
  if (q.t !== p.token) return pagina_('Enlace no autorizado', 'El enlace de seguridad no coincide.');

  if (q.a === 'hecho') { marcar_(p, 'HECHO'); return pagina_('✅ Anotado como hecho', 'El agente lo tendrá en cuenta y no volverá a proponerlo.'); }
  if (q.a === 'no') { marcar_(p, 'DESCARTADO'); return pagina_('❌ Descartado', 'Anotado: no volverá a proponerlo.'); }
  if (q.a === 'otra') {
    try {
      const n = otraVersionIA_(p);
      p.hoja.getRange(p.fila, 7, 1, 3).setValues([[n.titulo, n.detalle, n.texto]]);
      p.titulo = n.titulo; p.detalle = n.detalle; p.texto = n.texto;
      return pagina_('🔄 Otra propuesta', 'Si te sirve, cópiala y pulsa ✅. Si no, pide otra.', tarjeta_(p, true));
    } catch (err) { return pagina_('⚠️ No se pudo generar', err.message + ' · Vuelve a intentarlo en un minuto.'); }
  }
  return pagina_('Acción no reconocida', '');
}

function pagina_(titulo, texto, extra) {
  return HtmlService.createHtmlOutput('<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<div style="font-family:Arial,sans-serif;max-width:620px;margin:40px auto;padding:0 16px;text-align:center;color:#1c1c1c">' +
    '<h1 style="font-size:24px">' + titulo + '</h1><p style="color:#555;font-size:15px">' + esc_(texto) + '</p>' + (extra || '') +
    '<p style="color:#999;font-size:12px;margin-top:32px">' + CONFIG.MARCA + ' · Agente Google</p></div>' +
    '<script>function copiar(){var el=document.getElementById("tx"),r=document.createRange();r.selectNodeContents(el);' +
    'var s=window.getSelection();s.removeAllRanges();s.addRange(r);var ok=false;try{ok=document.execCommand("copy");}catch(e){}' +
    'document.getElementById("ok").textContent=ok?"Copiado ✅":"Seleccionado: pulsa Ctrl+C";}</script>').setTitle(CONFIG.MARCA + ' · Agente Google');
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

/** Lo que el equipo ya hizo o descartó (últimas 25), para no repetirlo. */
function memoria_() {
  const v = hoja_('Propuestas').getDataRange().getValues().slice(1).filter(function (r) { return r[9] === 'DESCARTADO' || r[9] === 'HECHO'; });
  return v.slice(-25).map(function (r) { return r[9] + ' (' + nombresSedes_(r[3]) + '): ' + r[6]; });
}

/** Solo propone descripción nueva si no se hizo ni se propuso en las últimas 4 semanas. */
function necesitaDescripcion_(code) {
  const hace28 = Date.now() - 28 * 24 * 3600 * 1000;
  return !hoja_('Propuestas').getDataRange().getValues().slice(1).some(function (r) {
    return r[4] === 'DESCRIPCION' && String(r[3]).split(',').indexOf(code) !== -1 && (r[9] === 'HECHO' || new Date(r[0]).getTime() > hace28);
  });
}

// ─────────────────────────────────────────────────────────────────────────
//  9) UTILIDADES
// ─────────────────────────────────────────────────────────────────────────
function sede_(code) { return SEDES.filter(function (s) { return s.code === code; })[0] || SEDES[0]; }
function esc_(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function borrarTriggers_(fns) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (fns.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t); });
}

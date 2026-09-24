// ARCHIVO GENERADO: no editar aquí; los fuentes están en agente-gbp/*.gs

// ═══ Config.gs ═══
/**
 * AGENTE GOOGLE · Durán Carasso
 * Gestor semanal de las fichas de Google + SEO de las 4 sedes.
 * Analiza, compara con la competencia, propone cambios que se aprueban o editan
 * desde el propio email, y aprende de lo que el equipo aprueba, edita o descarta.
 *
 * Script Properties (Configuración del proyecto → Propiedades del script):
 *   ANTHROPIC_API_KEY   obligatorio
 *   GOOGLE_API_KEY      obligatorio (Places API (New) + PageSpeed Insights API)
 *   WEBAPP_URL          opcional: URL /exec de la app web (se detecta sola al implementarla)
 *   NOTIFY_EMAILS       opcional (por defecto DEFAULT_EMAILS)
 *   GBP_ACCOUNT_ID      opcional → Nivel 2: publicar, reseñas sin responder, métricas
 *   SHEET_ID            opcional (por defecto la hoja del CRM)
 *   AUTOPILOTO          opcional, JSON (ver AUTOPILOTO_DEFECTO)
 */

var SEDES = [
  { code: 'BCN', nombre: 'Barcelona', query: 'Durán Carasso Inmobiliaria Carrer de Muntaner 259 Barcelona', mercado: 'inmobiliaria de lujo en Barcelona', web: '', gbpLocationId: '' },
  { code: 'STG', nombre: 'Sitges',    query: 'Durán Carasso Camí dels Capellans 73 Sitges', mercado: 'inmobiliaria de lujo en Sitges', web: '', gbpLocationId: '' },
  { code: 'CRD', nombre: 'Cerdanya',  query: 'Durán Carasso Puigcerdà Cerdanya', mercado: 'inmobiliaria en Puigcerdà Cerdanya', web: '', gbpLocationId: '' },
  { code: 'AND', nombre: 'Andorra',   query: "Durán Carasso Avinguda 8 d'Agost 9 Escaldes-Engordany Andorra", mercado: 'inmobiliaria de lujo en Andorra', web: '', gbpLocationId: '' }
];

// Contexto para la IA (fuente: durancarasso.es y prensa, sept. 2026). Editable.
var PERFIL_EMPRESA = {
  marca: 'Durán Carasso (DC group), inmobiliaria premium fundada por Carlos Durán y Mónica Abad, ~50 personas',
  web: 'https://www.durancarasso.es (es, ca, en)',
  servicios: ['Compra y venta', 'Alquiler', 'Valoración gratuita y sin compromiso',
    'Obra nueva: más de 20 promociones y 1.800 viviendas comercializadas en 6 años',
    'Inversiones: cartera de más de 350 activos (edificios, oficinas, locales, logístico, suelo)'],
  otrasZonas: 'También opera en Vilanova i la Geltrú e Ibiza (fuera de este agente)',
  estilo: 'Tono premium, cercano y discreto. Sin exageraciones ni emojis en exceso. No inventar inmuebles ni precios.'
};
var PERFIL_SEDES = {
  BCN: { direccion: 'Carrer de Muntaner 259, 08021 Barcelona', telefono: '931 59 51 25',
         zonas: 'Sarrià-Sant Gervasi, Tres Torres, Pedralbes, Eixample y Barcelona ciudad', idiomas: 'es, ca, en',
         competidores: 'Engel & Völkers, Lucas Fox, Bcn Advisors, Selekta Properties, Valords' },
  STG: { direccion: 'Av. Camí dels Capellans 73, 08870 Sitges (sede central)', telefono: '935 17 80 67',
         zonas: 'Sitges, Garraf, Vilanova i la Geltrú, Cunit', idiomas: 'es, ca, en',
         competidores: 'Happy Houses, Envy Realty, Premium Houses, Selekta Properties' },
  CRD: { direccion: 'Puigcerdà centro (oficina boutique abierta en julio de 2024)', telefono: '',
         zonas: 'Puigcerdà, Alp, Llívia, Bellver de Cerdanya, Fontanals, Urtx, Isòvol', idiomas: 'ca, es, fr',
         competidores: 'Coldwell Banker Glollar, Ladosada, Alex Ros, Vincle Cerdanya' },
  AND: { direccion: "Av. 8 d'Agost 9, local 1C, Escaldes-Engordany", telefono: '+376 841 800',
         zonas: 'Escaldes-Engordany, Andorra la Vella, Ordino, Els Vilars d’Engordany', idiomas: 'ca, es, fr, en',
         competidores: "Lucas Fox Andorra, Andorra Sotheby's, Windsor & Meyers, Colonial Real Estate, Immobiliària Dúplex" }
};
// web vacío → se usa la web que tenga la ficha de Google.
// gbpLocationId → Nivel 2 (ver listarUbicacionesGBP()).

var UMBRAL = {
  fotosMin: 10,      // Places API devuelve máx. 10 fotos: <10 = ficha pobre
  diasSinPost: 7,
  seoMin: 90,
  perfMin: 50,
  caidaRating: 0.1,
  numCompetidores: 5
};

// Qué puede hacer el agente sin preguntar. Todo en false = todo pasa por aprobación.
var AUTOPILOTO_DEFECTO = {
  responder5estrellas: false,  // publica solo las respuestas a reseñas de 5★
  postSiNoRespondes48h: false  // publica el post semanal si nadie lo descarta en 48 h
};

var CLAUDE_MODEL = 'claude-opus-5';
var DEFAULT_EMAILS = 'adriap@durancarasso.com';
var DEFAULT_SHEET_ID = '1QtAQ_RbGwsJ18jZeTinkKJfAHl7oYodusJ7xjHKXTa0';
var GBP_PANEL_URL = 'https://business.google.com/locations';

var P = PropertiesService.getScriptProperties();
function prop_(k, req) {
  var v = P.getProperty(k);
  if (req && !v) throw new Error('Falta la propiedad del script: ' + k);
  return v || '';
}
function autopiloto_() {
  var a = JSON.parse(prop_('AUTOPILOTO') || '{}'), r = {};
  for (var k in AUTOPILOTO_DEFECTO) r[k] = k in a ? !!a[k] : AUTOPILOTO_DEFECTO[k];
  return r;
}
function nivel2_(s) { return !!(prop_('GBP_ACCOUNT_ID') && s && s.gbpLocationId); }
function sede_(code) { return SEDES.filter(function (s) { return s.code === code; })[0]; }

// ═══ Menu.gs ═══
// ── MENÚ EN LA HOJA DEL CRM ──────────────────────────────────────────────────
// Si el script está dentro de la hoja (Extensiones → Apps Script), aparece el menú
// "🤖 Agente Google" y todo se configura con clics, sin tocar código.

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🤖 Agente Google')
    .addItem('1 · Configurar claves', 'configurarClaves')
    .addItem('2 · Comprobar que todo funciona', 'diagnostico')
    .addItem('3 · Activar agente (lunes 8:30 + alertas)', 'activarDesdeMenu')
    .addItem('4 · Enviar informe ahora', 'enviarAhoraDesdeMenu')
    .addSeparator()
    .addItem('Desactivar agente', 'desactivar')
    .addToUi();
}

function configurarClaves() {
  var ui = SpreadsheetApp.getUi();
  var campos = [
    ['ANTHROPIC_API_KEY', 'Clave de Anthropic (empieza por sk-ant-)', true],
    ['GOOGLE_API_KEY', 'Clave de Google Cloud (empieza por AIza)', true],
    ['NOTIFY_EMAILS', 'Emails que reciben el informe, separados por coma.\nDéjalo vacío para usar ' + DEFAULT_EMAILS, false]
  ];
  for (var i = 0; i < campos.length; i++) {
    var c = campos[i], actual = prop_(c[0]);
    var r = ui.prompt('Agente Google · ' + (i + 1) + '/' + campos.length,
      c[1] + (actual ? '\n\n(Ya configurada. Déjalo vacío para mantenerla.)' : ''), ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    var v = r.getResponseText().trim();
    if (v) P.setProperty(c[0], v);
    else if (c[2] && !actual) { ui.alert('Esta clave es obligatoria. Vuelve a empezar cuando la tengas.'); return; }
  }
  diagnostico();
}

/** Revisa cada pieza y dice exactamente qué falta y cómo arreglarlo. */
function diagnostico() {
  var r = comprobaciones_();
  var txt = r.map(function (x) { return (x.ok ? '✅ ' : x.opcional ? '⚪ ' : '❌ ') + x.nombre + (x.detalle ? '\n     ' + x.detalle : ''); }).join('\n\n');
  var listo = r.every(function (x) { return x.ok || x.opcional; });
  mostrar_('Agente Google · ' + (listo ? 'listo ✅' : 'falta algo'), txt + (listo ? '\n\nTodo correcto. Siguiente: menú → 3 · Activar agente.' : ''));
  return r;
}

function comprobaciones_() {
  var out = [];
  function add(nombre, ok, detalle, opcional) { out.push({ nombre: nombre, ok: ok, detalle: detalle || '', opcional: !!opcional }); }

  var ak = prop_('ANTHROPIC_API_KEY');
  if (!ak) add('Clave de Anthropic', false, 'Menú → 1 · Configurar claves');
  else {
    var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/models?limit=1', { muteHttpExceptions: true,
      headers: { 'x-api-key': ak, 'anthropic-version': '2023-06-01' } });
    add('Clave de Anthropic', res.getResponseCode() === 200,
      res.getResponseCode() === 200 ? '' : 'Anthropic responde ' + res.getResponseCode() + ': revisa la clave o que la cuenta tenga saldo');
  }

  if (!prop_('GOOGLE_API_KEY')) add('Clave de Google', false, 'Menú → 1 · Configurar claves');
  else {
    SEDES.forEach(function (s) {
      try {
        var f = fichaPlaces_(placeId_(s));
        add('Ficha ' + s.nombre, true, (f.displayName || {}).text + ' · ' + (f.formattedAddress || '') + ' · ' + (f.rating || '–') + '★ (' + (f.userRatingCount || 0) + ')');
      } catch (e) {
        var m = String(e);
        add('Ficha ' + s.nombre, false, /403|PERMISSION|not been used|disabled/i.test(m)
          ? 'Activa "Places API (New)" en Google Cloud para esta clave' : m.slice(0, 200));
      }
    });
    try { pageSpeed_('https://www.google.com').error ? add('PageSpeed Insights API', false, 'Actívala en Google Cloud (misma clave)') : add('PageSpeed Insights API', true); }
    catch (e) { add('PageSpeed Insights API', false, String(e).slice(0, 200)); }
  }

  var url = webappUrl_();
  if (/\/dev$/.test(url)) add('Botones del email (app web)', false, 'Usa la URL que termina en /exec: guárdala en Propiedades del script como WEBAPP_URL');
  else add('Botones del email (app web)', !!url, url ? '' :
    'Implementar → Nueva implementación → tipo "Aplicación web" → Ejecutar como: yo · Acceso: cualquier usuario → Implementar');

  var triggers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  add('Agente activado', triggers.indexOf('ejecutarSemanal') !== -1, 'Menú → 3 · Activar agente');

  add('Nivel 2: publicar solo en Google', !!prop_('GBP_ACCOUNT_ID') && SEDES.some(function (s) { return s.gbpLocationId; }),
    'Opcional. Sin esto, al aprobar te da el texto para pegarlo en Google (ver README)', true);
  return out;
}

function activarDesdeMenu() {
  var faltan = comprobaciones_().filter(function (x) { return !x.ok && !x.opcional && x.nombre !== 'Agente activado'; });
  if (faltan.length) return mostrar_('Antes de activar', 'Falta:\n\n' + faltan.map(function (x) { return '❌ ' + x.nombre + '\n     ' + x.detalle; }).join('\n\n'));
  instalar();
  mostrar_('Agente activado ✅', 'Cada lunes a las 8:30 recibirás el informe en ' + (prop_('NOTIFY_EMAILS') || DEFAULT_EMAILS) +
    '.\nCada 3 h vigila reseñas negativas.\n\nSi quieres el primer informe ya: menú → 4 · Enviar informe ahora (tarda 2-4 min).');
}

function enviarAhoraDesdeMenu() {
  SpreadsheetApp.getActive().toast('Analizando las 4 sedes… tarda 2-4 minutos.', 'Agente Google', 240);
  try {
    ejecutarSemanal();
    mostrar_('Informe enviado ✅', 'Revisa ' + (prop_('NOTIFY_EMAILS') || DEFAULT_EMAILS) + '. Las propuestas también están en la pestaña GBP_Propuestas.');
  } catch (e) { mostrar_('Error', String(e) + '\n\nEjecuta "2 · Comprobar que todo funciona" para ver qué falta.'); }
}

function desactivar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  mostrar_('Agente desactivado', 'No se enviarán más informes ni alertas hasta que lo vuelvas a activar.');
}

function mostrar_(titulo, texto) {
  try { SpreadsheetApp.getUi().alert(titulo, texto, SpreadsheetApp.getUi().ButtonSet.OK); }
  catch (e) { Logger.log(titulo + '\n' + texto); }
}

function webappUrl_() {
  if (prop_('WEBAPP_URL')) return prop_('WEBAPP_URL');
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}

// ═══ Agente.gs ═══
// ── ENTRADAS (ejecutar desde el editor o por trigger) ────────────────────────

/** 1ª vez: crea los triggers (lunes 8:30 + vigilancia cada 3 h), las hojas y resuelve las fichas. */
function instalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('ejecutarSemanal').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).nearMinute(30).inTimezone('Europe/Madrid').create();
  ScriptApp.newTrigger('vigilarUrgente').timeBased().everyHours(3).create();
  Object.keys(CABECERAS).forEach(hoja_);
  secreto_();
  SEDES.forEach(function (s) {
    var f = fichaPlaces_(placeId_(s));
    Logger.log(s.code + ' → ' + (f.displayName || {}).text + ' · ' + f.formattedAddress);
    resenasNuevas_(s, lista_(s, f)); // fija la referencia para no avisar de reseñas antiguas
  });
  Logger.log('Instalado. Comprueba que cada sede apunta a la ficha correcta.');
}

/** Informe semanal: analiza, compara, propone y envía el email con botones. */
function ejecutarSemanal() {
  var snaps = SEDES.map(function (s) {
    try { return analizarSede_(s); }
    catch (e) { return { sede: s.code, nombre: s.nombre, error: String(e) }; }
  });
  var ok = snaps.filter(function (s) { return !s.error; });
  var plan = pedirPlanClaude_(ok);
  guardarHistorico_(ok);
  var props = propuestasDesdePlan_(ok, plan);
  enviarSemanal_(snaps, plan, props);
  ok.forEach(function (s) {
    P.setProperty('SNAP_' + s.sede, JSON.stringify({ rating: s.ficha.rating, numResenas: s.ficha.numResenas, fotos: s.ficha.fotos, completitud: s.completitud.porcentaje }));
  });
}

/** Cada 3 h: reseñas negativas nuevas → borrador inmediato + aviso. Aplica el piloto automático. */
function vigilarUrgente() {
  var urgentes = [];
  SEDES.forEach(function (s) {
    try {
      resenasNuevas_(s, lista_(s)).forEach(function (r) {
        if (r.estrellas > 3) return;
        urgentes.push(crearPropuestas_([{
          sede: s.code, tipo: 'RESPUESTA', prioridad: 'ALTA', titulo: 'Reseña de ' + r.estrellas + '★ de ' + r.autor,
          contexto: r.estrellas + '★ · ' + r.autor + ': ' + r.texto, propuesta: respuestaUrgente_(s, r),
          referencia: r.id, estrellas: r.estrellas
        }])[0]);
      });
    } catch (e) { Logger.log(s.code + ': ' + e); }
  });
  if (urgentes.length) enviarUrgente_(urgentes);
  var auto = aplicarAutopiloto_();
  if (auto.length) enviar_('Agente Google · publicado automáticamente (' + auto.length + ')',
    auto.join('\n'), '<div style="font-family:Arial,sans-serif">' + auto.map(esc_).join('<br>') + '</div>');
}

/** Ayuda Nivel 2: lista las ubicaciones de la cuenta para rellenar gbpLocationId. */
function listarUbicacionesGBP() {
  var r = gbp_('GET', 'https://mybusinessbusinessinformation.googleapis.com/v1/accounts/' + prop_('GBP_ACCOUNT_ID', true) +
    '/locations?readMask=name,title,storefrontAddress&pageSize=100');
  (r.locations || []).forEach(function (l) { Logger.log(l.name + ' · ' + l.title + ' · ' + ((l.storefrontAddress || {}).locality || '')); });
}

/** Prueba rápida del email sin esperar al lunes. */
function probarAhora() { ejecutarSemanal(); }

// ── LÓGICA ───────────────────────────────────────────────────────────────────
function lista_(s, f) {
  return resenasGBP_(s) || ((f || fichaPlaces_(placeId_(s))).reviews || []).map(mapReviewPlaces_);
}

function resenasNuevas_(s, lista) {
  var k = 'LASTREV_' + s.code, last = P.getProperty(k) || '';
  var nuevas = lista.filter(function (r) { return r.fecha && r.fecha > last; });
  P.setProperty(k, lista.reduce(function (m, r) { return r.fecha > m ? r.fecha : m; }, last));
  return last ? nuevas : [];
}

function propuestasDesdePlan_(snaps, plan) {
  var lista = [];
  plan.sedes.forEach(function (ps) {
    var snap = snaps.filter(function (s) { return s.sede === ps.sede; })[0] || { resenasRecientes: [], ficha: {} };
    ps.acciones.forEach(function (a) {
      lista.push({ sede: ps.sede, tipo: 'TAREA', prioridad: a.prioridad, titulo: a.accion,
        contexto: a.motivo + '\n\n✅ Recomendado: ' + a.recomendada + '\n🗓️ Cuándo: ' + a.cuando +
          (a.opciones.length ? '\n\nOpciones: ' + a.opciones.join(' · ') : ''),
        propuesta: a.contenido || a.recomendada, _accion: a });
    });
    if (ps.post) lista.push({ sede: ps.sede, tipo: 'POST', prioridad: 'MEDIA', titulo: 'Publicación semanal', propuesta: ps.post });
    if (ps.descripcion) lista.push({ sede: ps.sede, tipo: 'DESCRIPCION', prioridad: 'MEDIA', titulo: 'Nueva descripción de la ficha',
      contexto: 'Actual: ' + (snap.ficha.descripcionActual || '(vacía)'), propuesta: ps.descripcion });
    ps.respuestas.forEach(function (r) {
      var o = snap.resenasRecientes.filter(function (x) { return x.id === r.id; })[0];
      if (o) lista.push({ sede: ps.sede, tipo: 'RESPUESTA', prioridad: o.estrellas <= 3 ? 'ALTA' : 'MEDIA',
        titulo: 'Respuesta a ' + o.autor + ' (' + o.estrellas + '★)', contexto: o.estrellas + '★ · ' + o.autor + ': ' + o.texto,
        propuesta: r.texto, referencia: r.id, estrellas: o.estrellas });
    });
  });
  return crearPropuestas_(lista);
}

function aplicarAutopiloto_() {
  var ap = autopiloto_(), hechos = [];
  if (!ap.responder5estrellas && !ap.postSiNoRespondes48h) return hechos;
  var data = hoja_('GBP_Propuestas').getDataRange().getValues().slice(1);
  data.forEach(function (r) {
    if (r[C.ESTADO] !== 'PENDIENTE' || !nivel2_(sede_(r[C.SEDE]))) return;
    var edadH = (Date.now() - new Date(r[C.FECHA]).getTime()) / 36e5;
    var toca = (ap.responder5estrellas && r[C.TIPO] === 'RESPUESTA' && Number(r[C.EST]) === 5) ||
               (ap.postSiNoRespondes48h && r[C.TIPO] === 'POST' && edadH >= 48);
    if (!toca) return;
    var res = decidir_(r[C.ID], 'publicar', '', 'Autopiloto');
    hechos.push((res.ok ? '✅ ' : '⚠️ ') + r[C.SEDE] + ' · ' + r[C.TITULO] + ' → ' + res.mensaje);
  });
  return hechos;
}

function guardarHistorico_(snaps) {
  var hoy = fecha_(), hist = [], comp = [];
  snaps.forEach(function (s) {
    var ps = s.pagespeed || {}, po = s.posicion || {}, m = s.metricas || {};
    hist.push([hoy, s.sede, s.ficha.rating, s.ficha.numResenas, s.ficha.fotos, s.completitud.porcentaje, ps.seo || '', ps.perf || '',
      po.porResenas || '', po.porNota || '', (m.CALL_CLICKS || {}).ult28 || '', (m.DIRECTION_REQUESTS || {}).ult28 || '',
      (m.WEBSITE_CLICKS || {}).ult28 || '', s.completitud.falta.join(' · ')]);
    (s.competencia || []).forEach(function (c) { comp.push([hoy, s.sede, c.nombre, c.rating, c.resenas, c.fotos, c.web]); });
  });
  appendRows_(hoja_('GBP_Historico'), hist);
  appendRows_(hoja_('GBP_Competencia'), comp);
}

/** Resultado del mes: compara la foto de hace ~4 semanas con la de hoy. */
function resultadosMes_() {
  var data = hoja_('GBP_Historico').getDataRange().getValues().slice(1), out = {};
  var limite = Date.now() - 26 * 864e5;
  SEDES.forEach(function (s) {
    var filas = data.filter(function (r) { return r[1] === s.code; });
    if (filas.length < 2) return;
    var ahora = filas[filas.length - 1];
    var antes = filas.filter(function (r) { return new Date(r[0]).getTime() <= limite; }).pop() || filas[0];
    if (antes === ahora) return;
    out[s.code] = { nota: [antes[2], ahora[2]], resenas: [antes[3], ahora[3]], ficha: [antes[5], ahora[5]], puesto: [antes[8], ahora[8]],
                    llamadas: ahora[10], rutas: ahora[11], clics: ahora[12] };
  });
  return out;
}

function pendientesAnteriores_() {
  var hoy = fecha_();
  return hoja_('GBP_Propuestas').getDataRange().getValues().slice(1).filter(function (r) {
    return r[C.ESTADO] === 'PENDIENTE' && r[C.FECHA] !== hoy && Utilities.formatDate(new Date(r[C.FECHA]), 'Europe/Madrid', 'yyyy-MM-dd') !== hoy;
  }).length;
}

// ── UTILIDADES ───────────────────────────────────────────────────────────────
function fecha_() { return Utilities.formatDate(new Date(), 'Europe/Madrid', 'yyyy-MM-dd'); }
function recorta_(t, n) { t = String(t || ''); return t.length > n ? t.slice(0, n) + '…' : t; }
function esc_(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

// ═══ Datos.gs ═══
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
    busquedaMarca: auditarBusqueda_(s, f)
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
    var tel = String(telefono || '').replace(/\D/g, '');
    return {
      url: url,
      title: m(/<title[^>]*>([^<]*)<\/title>/i),
      metaDescription: m(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i) || m(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i),
      h1: (h.match(/<h1[\s>]/gi) || []).length,
      canonical: /<link[^>]+rel=["']canonical["']/i.test(h),
      schemaLocal: /application\/ld\+json[\s\S]{0,5000}?(LocalBusiness|RealEstateAgent)/i.test(h),
      hreflang: (h.match(/hreflang=/gi) || []).length,
      telefonoEnWeb: tel ? h.replace(/\D/g, '').indexOf(tel) !== -1 : null
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

// ═══ IA.gs ═══
// ── CLAUDE: PLAN SEMANAL ─────────────────────────────────────────────────────
var SCHEMA_PLAN = {
  type: 'object', additionalProperties: false, required: ['resumen', 'sedes'],
  properties: {
    resumen: { type: 'string' },
    sedes: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['sede', 'estado', 'vsCompetencia', 'acciones', 'post', 'descripcion', 'respuestas'],
      properties: {
        sede: { type: 'string', enum: SEDES.map(function (s) { return s.code; }) },
        estado: { type: 'string' },
        vsCompetencia: { type: 'string' },
        acciones: { type: 'array', items: {
          type: 'object', additionalProperties: false,
          required: ['prioridad', 'accion', 'motivo', 'opciones', 'recomendada', 'cuando', 'contenido'],
          properties: {
            prioridad: { type: 'string', enum: ['ALTA', 'MEDIA', 'BAJA'] },
            accion: { type: 'string' }, motivo: { type: 'string' },
            opciones: { type: 'array', items: { type: 'string' } },
            recomendada: { type: 'string' }, cuando: { type: 'string' },
            contenido: { type: 'string' }
          }
        } },
        post: { type: 'string' },
        descripcion: { type: 'string' },
        respuestas: { type: 'array', items: {
          type: 'object', additionalProperties: false, required: ['id', 'texto'],
          properties: { id: { type: 'string' }, texto: { type: 'string' } }
        } }
      }
    } }
  }
};

var SYSTEM_PROMPT = [
  'Eres el gestor de SEO local y de las fichas de Google (Perfil de Empresa) de Durán Carasso, inmobiliaria de lujo',
  'con sedes en Barcelona (BCN), Sitges (STG), Cerdanya (CRD) y Andorra (AND). Trabajas para el equipo de marketing.',
  'Objetivo: que quien busque "Durán Carasso" o "inmobiliaria de lujo + ciudad" encuentre una ficha completa, activa,',
  'coherente con la web y mejor que la de la competencia, y que eso se traduzca en más llamadas, visitas y clics.',
  '',
  'Recibes el estado semanal de cada sede: ficha, web, PageSpeed, completitud, competencia (top 5 en Google Maps),',
  'posición, métricas (si hay), búsqueda de marca y problemas detectados. También recibes "decisiones_del_equipo":',
  'propuestas tuyas anteriores que el equipo editó o descartó. Aprende de ellas: imita sus correcciones de tono,',
  'longitud y contenido y no repitas lo que descartaron salvo que haya cambiado algo importante.',
  '',
  'Devuelve para cada sede:',
  '- estado: 1-2 frases sobre cómo está la ficha y qué ha cambiado desde la semana pasada.',
  '- vsCompetencia: 1-3 frases comparando con la competencia con cifras (nota, reseñas, fotos) y qué hacen mejor.',
  '- acciones: máximo 4, por impacto, concretas (qué tocar y dónde exactamente). Por acción: 2-3 opciones cortas,',
  '  la recomendada y por qué, cuándo (fecha o franja concreta según urgencia, temporada de la zona — Cerdanya/Andorra:',
  '  esquí dic-mar y verano; Sitges: primavera-verano; Barcelona: todo el año — y festivos próximos de Cataluña/Andorra),',
  '  y contenido: el texto o código listo para copiar y pegar si aplica (JSON-LD, meta description, mensaje de WhatsApp',
  '  para pedir reseñas…) o cadena vacía. No incluyas aquí el post, la descripción ni las respuestas a reseñas.',
  '- post: publicación semanal para la ficha (máx. 1.200 caracteres, tono premium y cercano, palabras clave locales,',
  '  sin inventar inmuebles ni precios). Cadena vacía si publicaron hace menos de 4 días.',
  '- descripcion: nueva descripción de negocio (650-750 caracteres, sin URLs ni teléfonos, keywords locales) solo si la',
  '  actual falta, es corta o claramente mejorable; si no, cadena vacía.',
  '- respuestas: borrador solo para reseñas con respondida=false (usa su id exacto), en el idioma de la reseña,',
  '  personalizada; en negativas: empatía, sin excusas, invitación a hablar por teléfono.',
  'resumen: 3-4 frases para dirección con lo más importante de la semana.',
  'Usa "empresa" y "perfil_sedes": propón solo servicios que la empresa ofrece, usa las zonas reales de cada sede,',
  'escribe posts y descripción en el primer idioma de la sede (y respuestas en el idioma de la reseña), y compara',
  'también con los competidores de referencia si aparecen en los datos. Si la dirección o el teléfono de la ficha no',
  'coinciden con perfil_sedes, avísalo como acción ALTA.',
  'No inventes datos que no estén en el JSON.'
].join('\n');

function pedirPlanClaude_(snaps) {
  var input = { fecha: fecha_(), empresa: PERFIL_EMPRESA, perfil_sedes: PERFIL_SEDES, sedes: snaps, decisiones_del_equipo: memoria_() };
  return JSON.parse(textoClaude_(claude_({
    model: CLAUDE_MODEL, max_tokens: 20000, system: SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: SCHEMA_PLAN } },
    messages: [{ role: 'user', content: JSON.stringify(input) }]
  })));
}

/** Borrador inmediato para una reseña negativa (fuera del ciclo semanal). */
function respuestaUrgente_(s, r) {
  return textoClaude_(claude_({
    model: CLAUDE_MODEL, max_tokens: 4000, system: SYSTEM_PROMPT,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content:
      'Redacta solo la respuesta pública (sin comillas ni explicaciones) a esta reseña de la sede ' + s.nombre + '.\n' +
      JSON.stringify({ estrellas: r.estrellas, autor: r.autor, texto: r.texto, decisiones_del_equipo: memoria_() }) }]
  })).trim();
}

/** Qué ve un cliente al buscar la marca (web search). Se recalcula cada semana. */
function auditarBusqueda_(s, f) {
  var k = 'BUSQ_' + s.code, prev = JSON.parse(P.getProperty(k) || 'null');
  if (prev && Date.now() - prev.ts < 6 * 864e5) return prev.texto;
  try {
    var texto = textoClaude_(claude_({
      model: CLAUDE_MODEL, max_tokens: 8000,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6,
                user_location: { type: 'approximate', country: s.code === 'AND' ? 'AD' : 'ES' } }],
      messages: [{ role: 'user', content:
        'Busca como lo haría un cliente: "Durán Carasso ' + s.nombre + '" y "' + s.mercado + '".\n' +
        'Datos oficiales: ' + JSON.stringify({ direccion: f.formattedAddress || '', telefono: f.nationalPhoneNumber || '', web: f.websiteUri || '' }) + '\n' +
        'Responde en español, máx. 1.000 caracteres, en viñetas: 1) qué aparece de la marca y si la web oficial sale primero;' +
        ' 2) datos incoherentes en otros sitios (con URL); 3) qué tienen los competidores que a nosotros nos falta.' +
        ' Solo hechos encontrados.' }]
    }));
    P.setProperty(k, JSON.stringify({ ts: Date.now(), texto: texto }));
    return texto;
  } catch (e) { return prev ? prev.texto : ''; }
}

// ── LLAMADA A LA API ─────────────────────────────────────────────────────────
/** POST /v1/messages con fallback de servidor; continúa si la búsqueda web devuelve pause_turn. */
function claude_(body) {
  body.fallbacks = 'default';
  for (var i = 0; i < 4; i++) {
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
    if (j.stop_reason !== 'pause_turn') return j;
    body.messages = body.messages.concat([{ role: 'assistant', content: j.content }]);
  }
  throw new Error('Claude no terminó tras varios pause_turn');
}

function textoClaude_(j) {
  return j.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
}

// ═══ Propuestas.gs ═══
// ── HOJAS ────────────────────────────────────────────────────────────────────
var CABECERAS = {
  GBP_Propuestas: ['ID', 'Fecha', 'Sede', 'Tipo', 'Prioridad', 'Título', 'Contexto', 'Propuesta', 'Texto final',
                   'Estado', 'Feedback', 'Actualizado', 'Referencia', 'Estrellas'],
  GBP_Historico: ['Fecha', 'Sede', 'Nota', 'Nº reseñas', 'Fotos', 'Ficha %', 'SEO', 'Rendimiento', 'Puesto reseñas',
                  'Puesto nota', 'Llamadas 28d', 'Rutas 28d', 'Clics web 28d', 'Falta'],
  GBP_Competencia: ['Fecha', 'Sede', 'Nombre', 'Nota', 'Reseñas', 'Fotos', 'Web']
};
var C = { ID: 0, FECHA: 1, SEDE: 2, TIPO: 3, PRIO: 4, TITULO: 5, CTX: 6, PROP: 7, FINAL: 8, ESTADO: 9, FEED: 10, ACT: 11, REF: 12, EST: 13 };
// Tipos: POST, RESPUESTA, DESCRIPCION (publicables en Google) · TAREA (la hace el equipo)
// Estados: PENDIENTE → PUBLICADO | HECHO | DESCARTADO | APROBADO_MANUAL | ERROR

function hoja_(nombre) {
  var ss = prop_('SHEET_ID') ? SpreadsheetApp.openById(prop_('SHEET_ID')) : (SpreadsheetApp.getActive() || SpreadsheetApp.openById(DEFAULT_SHEET_ID));
  var sh = ss.getSheetByName(nombre);
  if (!sh) { sh = ss.insertSheet(nombre); sh.appendRow(CABECERAS[nombre]); sh.setFrozenRows(1); }
  return sh;
}

function appendRows_(sh, rows) {
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

// ── PROPUESTAS ───────────────────────────────────────────────────────────────
/** Crea propuestas y devuelve los objetos con su ID (para pintar el email). */
function crearPropuestas_(lista) {
  var hoy = fecha_(), rows = lista.map(function (p) {
    p.id = Utilities.getUuid().slice(0, 8);
    return [p.id, hoy, p.sede, p.tipo, p.prioridad || '', p.titulo || '', p.contexto || '', p.propuesta || '', '',
            'PENDIENTE', '', hoy, p.referencia || '', p.estrellas || ''];
  });
  appendRows_(hoja_('GBP_Propuestas'), rows);
  return lista;
}

function buscarPropuesta_(id) {
  var sh = hoja_('GBP_Propuestas'), data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) if (data[i][C.ID] === id) return { fila: i + 1, row: data[i], sh: sh };
  return null;
}

function actualizarPropuesta_(p, cambios) {
  for (var k in cambios) p.sh.getRange(p.fila, C[k] + 1).setValue(cambios[k]);
  p.sh.getRange(p.fila, C.ACT + 1).setValue(new Date());
}

function publicable_(tipo) { return tipo === 'POST' || tipo === 'RESPUESTA' || tipo === 'DESCRIPCION'; }

/**
 * Ejecuta una decisión del equipo sobre una propuesta.
 * accion: 'publicar' | 'hecho' | 'descartar'. Devuelve { ok, estado, mensaje }.
 */
function decidir_(id, accion, texto, feedback) {
  var p = buscarPropuesta_(id);
  if (!p) return { ok: false, mensaje: 'Propuesta no encontrada' };
  var estado = p.row[C.ESTADO];
  if (estado !== 'PENDIENTE' && estado !== 'ERROR') return { ok: false, estado: estado, mensaje: 'Ya estaba ' + estado.toLowerCase() };
  var tipo = p.row[C.TIPO], s = sede_(p.row[C.SEDE]);
  var final = String(texto || p.row[C.PROP]).trim();

  if (accion === 'descartar') {
    actualizarPropuesta_(p, { ESTADO: 'DESCARTADO', FEED: feedback || '' });
    return { ok: true, estado: 'DESCARTADO', mensaje: 'Descartada. El agente lo tendrá en cuenta.' };
  }
  if (accion === 'hecho' || !publicable_(tipo)) {
    actualizarPropuesta_(p, { ESTADO: 'HECHO', FINAL: final, FEED: feedback || '' });
    return { ok: true, estado: 'HECHO', mensaje: 'Marcada como hecha.' };
  }
  if (!nivel2_(s)) {
    actualizarPropuesta_(p, { ESTADO: 'APROBADO_MANUAL', FINAL: final, FEED: feedback || '' });
    return { ok: true, estado: 'APROBADO_MANUAL', manual: true, texto: final,
             mensaje: 'Aprobada. Cópiala y pégala en tu panel de Google (publicación automática disponible en Nivel 2).' };
  }
  try {
    publicarEnGoogle_(s, tipo, final, p.row[C.REF]);
    actualizarPropuesta_(p, { ESTADO: 'PUBLICADO', FINAL: final, FEED: feedback || '' });
    return { ok: true, estado: 'PUBLICADO', mensaje: 'Publicado en Google ✅' };
  } catch (e) {
    actualizarPropuesta_(p, { ESTADO: 'ERROR', FINAL: final, FEED: String(e).slice(0, 300) });
    return { ok: false, estado: 'ERROR', mensaje: 'Error al publicar: ' + e };
  }
}

function publicarEnGoogle_(s, tipo, texto, ref) {
  if (tipo === 'RESPUESTA') return gbp_('PUT', 'https://mybusiness.googleapis.com/v4/' + ref + '/reply', { comment: texto });
  if (tipo === 'POST') return gbp_('POST', v4_(s) + '/localPosts', {
    languageCode: 'es', summary: texto, topicType: 'STANDARD',
    callToAction: { actionType: 'LEARN_MORE', url: s.web || fichaPlaces_(placeId_(s)).websiteUri }
  });
  if (tipo === 'DESCRIPCION') return gbp_('PATCH', 'https://mybusinessbusinessinformation.googleapis.com/v1/locations/' +
    s.gbpLocationId + '?updateMask=profile.description', { profile: { description: texto } });
  throw new Error('Tipo no publicable: ' + tipo);
}

/** Lo que el agente "recuerda": ediciones y descartes recientes del equipo. */
function memoria_() {
  var data = hoja_('GBP_Propuestas').getDataRange().getValues().slice(1), out = [];
  for (var i = data.length - 1; i >= 0 && out.length < 15; i--) {
    var r = data[i], est = r[C.ESTADO];
    var editada = r[C.FINAL] && String(r[C.FINAL]).trim() !== String(r[C.PROP]).trim();
    if (est === 'DESCARTADO') out.push({ tipo: r[C.TIPO], sede: r[C.SEDE], propuesta: recorta_(r[C.PROP] || r[C.TITULO], 400), decision: 'DESCARTADA', motivo: r[C.FEED] });
    else if (editada) out.push({ tipo: r[C.TIPO], sede: r[C.SEDE], propuesta: recorta_(r[C.PROP], 400), decision: 'EDITADA', version_equipo: recorta_(r[C.FINAL], 400) });
  }
  return out;
}

// ── ENLACES FIRMADOS (para los botones del email) ────────────────────────────
function secreto_() {
  var k = prop_('LINK_SECRET');
  if (!k) { k = Utilities.getUuid() + Utilities.getUuid(); P.setProperty('LINK_SECRET', k); }
  return k;
}
function token_(id) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(id, secreto_())).slice(0, 22);
}
function enlace_(id, accion) {
  var u = webappUrl_();
  if (!u) throw new Error('Falta implementar la app web (menú → 2 · Comprobar)');
  return u + '?id=' + encodeURIComponent(id) + '&a=' + accion + '&t=' + token_(id);
}

// ═══ Email.gs ═══
// ── EMAILS ───────────────────────────────────────────────────────────────────
var COL = { navy: '#0D3550', gold: '#B8922A', bg: '#F5F4F1', sub: '#6B6B6B', border: '#E2E0DB', green: '#1E6B3A', red: '#B03020', orange: '#C45E0A' };
var NOMBRE_TIPO = { POST: 'Publicación', DESCRIPCION: 'Descripción', RESPUESTA: 'Respuesta a reseña', TAREA: 'Tarea' };

function btn_(txt, url, color, fondo) {
  return '<a href="' + esc_(url) + '" style="display:inline-block;padding:9px 14px;margin:4px 6px 0 0;border-radius:8px;font-size:13px;' +
    'font-weight:600;text-decoration:none;color:' + color + ';background:' + fondo + ';border:1px solid ' + (fondo === '#ffffff' ? COL.border : fondo) + '">' + txt + '</a>';
}
function color_(prio) { return prio === 'ALTA' ? COL.red : prio === 'MEDIA' ? COL.orange : COL.sub; }
function flecha_(a, b, invertir) {
  if (a === '' || b === '' || a == null || b == null || a === b) return '';
  var mejor = invertir ? b < a : b > a;
  return ' <span style="color:' + (mejor ? COL.green : COL.red) + '">' + (b > a ? '▲' : '▼') + '</span>';
}

function tarjetaPropuesta_(p) {
  var publicable = publicable_(p.tipo), s = sede_(p.sede);
  var html = '<div style="border:1px solid ' + COL.border + ';border-left:4px solid ' + color_(p.prioridad) + ';border-radius:10px;padding:12px 14px;margin:10px 0;background:#fff">' +
    '<div style="font-size:11px;font-weight:700;letter-spacing:.5px;color:' + color_(p.prioridad) + '">' + esc_(p.prioridad) + ' · ' + NOMBRE_TIPO[p.tipo].toUpperCase() + '</div>' +
    '<div style="font-weight:600;margin:4px 0">' + esc_(p.titulo) + '</div>';
  if (p._accion) {
    html += '<div style="font-size:13px;color:' + COL.sub + '">' + esc_(p._accion.motivo) + '</div>' +
      '<div style="font-size:13px;margin-top:6px">✅ <b>Mejor opción:</b> ' + esc_(p._accion.recomendada) + '</div>' +
      '<div style="font-size:13px">🗓️ <b>Cuándo:</b> ' + esc_(p._accion.cuando) + '</div>' +
      (p._accion.opciones.length > 1 ? '<div style="font-size:12px;color:' + COL.sub + ';margin-top:4px">Alternativas: ' + esc_(p._accion.opciones.join(' · ')) + '</div>' : '');
  } else if (p.tipo === 'RESPUESTA') {
    html += '<div style="font-size:13px;color:' + COL.sub + ';font-style:italic">"' + esc_(recorta_(p.contexto.replace(/^.*?: /, ''), 220)) + '"</div>';
  }
  if (publicable || (p._accion && p._accion.contenido)) {
    html += '<div style="font-size:13px;white-space:pre-wrap;background:' + COL.bg + ';border-radius:8px;padding:10px;margin-top:8px">' +
      esc_(recorta_(p.propuesta, 420)) + '</div>';
  }
  html += '<div style="margin-top:6px">';
  if (publicable) {
    html += btn_(nivel2_(s) ? '✅ Publicar' : '✅ Aprobar', enlace_(p.id, 'publicar'), '#ffffff', COL.green) +
            btn_('✏️ Editar', enlace_(p.id, 'editar'), COL.navy, '#ffffff');
  } else {
    html += btn_('✅ Hecho', enlace_(p.id, 'publicar'), '#ffffff', COL.green) +
            btn_(p._accion && p._accion.contenido ? '📋 Ver contenido' : '👁️ Ver', enlace_(p.id, 'editar'), COL.navy, '#ffffff');
  }
  return html + btn_('❌ Descartar', enlace_(p.id, 'descartar'), COL.red, '#ffffff') + '</div></div>';
}

function tablaCompetencia_(s) {
  if (!s.competencia || !s.competencia.length) return '';
  var filas = [{ nombre: 'Durán Carasso', rating: s.ficha.rating, resenas: s.ficha.numResenas, fotos: s.ficha.fotos, yo: true }]
    .concat(s.competencia.slice(0, 4))
    .sort(function (a, b) { return b.resenas - a.resenas; });
  var td = 'padding:6px 8px;border-bottom:1px solid ' + COL.border + ';font-size:12px';
  return '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:8px 0;background:#fff;border-radius:8px">' +
    '<tr style="color:' + COL.sub + '"><td style="' + td + '">Inmobiliaria</td><td style="' + td + ';text-align:right">Nota</td><td style="' + td + ';text-align:right">Reseñas</td></tr>' +
    filas.map(function (c) {
      var st = c.yo ? 'font-weight:700;color:' + COL.navy + ';background:#FBF6EA' : '';
      return '<tr style="' + st + '"><td style="' + td + '">' + esc_(c.nombre) + '</td><td style="' + td + ';text-align:right">' + (c.rating || '–') +
        '★</td><td style="' + td + ';text-align:right">' + c.resenas + '</td></tr>';
    }).join('') + '</table>';
}

function enviarSemanal_(snaps, plan, props) {
  var mes = new Date().getDate() <= 7 ? resultadosMes_() : null;
  var urg = props.filter(function (p) { return p.prioridad === 'ALTA'; }).length;
  var pend = pendientesAnteriores_();
  var h = '<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:640px;margin:0 auto;background:' + COL.bg + ';padding:0 0 20px;color:#111">' +
    '<div style="background:' + COL.navy + ';color:#fff;padding:20px 18px"><div style="font-size:10px;letter-spacing:3px;opacity:.5;text-transform:uppercase">Agente Google · Durán Carasso</div>' +
    '<div style="font-size:20px;font-weight:600;margin-top:4px">Informe semanal · ' + fecha_() + '</div></div>' +
    '<div style="padding:16px 18px"><p style="background:#fff;border-radius:10px;padding:14px;margin:0;border:1px solid ' + COL.border + '">' + esc_(plan.resumen) + '</p>' +
    '<p style="font-size:13px;color:' + COL.sub + ';margin:10px 0 0">' + props.length + ' propuestas nuevas' + (urg ? ' · <b style="color:' + COL.red + '">' + urg + ' urgentes</b>' : '') +
    (pend ? ' · ' + pend + ' pendientes de semanas anteriores' : '') + '. Pulsa ✅ para aprobar, ✏️ para editar o ❌ para descartar.</p>';

  if (mes && Object.keys(mes).length) {
    h += '<h3 style="color:' + COL.navy + ';margin:22px 0 6px">📈 Resultados del último mes</h3><table style="width:100%;border-collapse:collapse;background:#fff;font-size:12px">' +
      '<tr style="color:' + COL.sub + '"><td style="padding:6px">Sede</td><td>Nota</td><td>Reseñas</td><td>Ficha</td><td>Puesto</td><td>Llamadas</td><td>Rutas</td><td>Clics web</td></tr>';
    SEDES.forEach(function (s) {
      var m = mes[s.code]; if (!m) return;
      h += '<tr style="border-top:1px solid ' + COL.border + '"><td style="padding:6px;font-weight:600">' + s.nombre + '</td>' +
        '<td>' + m.nota[1] + flecha_(m.nota[0], m.nota[1]) + '</td><td>' + m.resenas[1] + flecha_(m.resenas[0], m.resenas[1]) + '</td>' +
        '<td>' + m.ficha[1] + '%' + flecha_(m.ficha[0], m.ficha[1]) + '</td><td>' + (m.puesto[1] || '–') + flecha_(m.puesto[0], m.puesto[1], true) + '</td>' +
        '<td>' + (m.llamadas || '–') + '</td><td>' + (m.rutas || '–') + '</td><td>' + (m.clics || '–') + '</td></tr>';
    });
    h += '</table>';
  }

  snaps.forEach(function (s) {
    h += '<h2 style="color:' + COL.navy + ';font-size:18px;border-bottom:2px solid ' + COL.gold + ';padding-bottom:6px;margin:28px 0 8px">' + esc_(s.nombre) + '</h2>';
    if (s.error) { h += '<p style="color:' + COL.red + '">No se pudo analizar: ' + esc_(s.error) + '</p>'; return; }
    var ps = plan.sedes.filter(function (x) { return x.sede === s.sede; })[0] || {};
    var pc = s.completitud.porcentaje, cc = pc >= 90 ? COL.green : pc >= 70 ? COL.orange : COL.red;
    var ant = s.anterior || {};
    h += '<table style="width:100%;border-collapse:collapse;text-align:center;background:#fff;border-radius:10px;border:1px solid ' + COL.border + '"><tr>' +
      '<td style="padding:10px"><div style="font-size:22px;font-weight:700;color:' + cc + '">' + pc + '%' + flecha_(ant.completitud, pc) + '</div><div style="font-size:11px;color:' + COL.sub + '">Ficha completa</div></td>' +
      '<td><div style="font-size:22px;font-weight:700">' + s.ficha.rating + '★' + flecha_(ant.rating, s.ficha.rating) + '</div><div style="font-size:11px;color:' + COL.sub + '">Nota</div></td>' +
      '<td><div style="font-size:22px;font-weight:700">' + s.ficha.numResenas + flecha_(ant.numResenas, s.ficha.numResenas) + '</div><div style="font-size:11px;color:' + COL.sub + '">Reseñas</div></td>' +
      (s.posicion ? '<td><div style="font-size:22px;font-weight:700">' + s.posicion.porResenas + 'º</div><div style="font-size:11px;color:' + COL.sub + '">de ' + s.posicion.total + ' en reseñas</div></td>' : '') +
      '</tr></table>';
    if (s.completitud.falta.length) h += '<p style="font-size:12px;color:' + COL.sub + ';margin:6px 0">Falta: ' + esc_(s.completitud.falta.join(' · ')) + '</p>';
    if (ps.estado) h += '<p style="margin:10px 0">' + esc_(ps.estado) + '</p>';
    if (ps.vsCompetencia) h += '<p style="margin:10px 0"><b>Vs. competencia:</b> ' + esc_(ps.vsCompetencia) + '</p>';
    h += tablaCompetencia_(s);
    props.filter(function (p) { return p.sede === s.sede; })
      .sort(function (a, b) { return ['ALTA', 'MEDIA', 'BAJA'].indexOf(a.prioridad) - ['ALTA', 'MEDIA', 'BAJA'].indexOf(b.prioridad); })
      .forEach(function (p) { h += tarjetaPropuesta_(p); });
    if (s.busquedaMarca) h += '<details style="margin-top:10px"><summary style="cursor:pointer;color:' + COL.navy + ';font-size:13px">🔎 Qué ve un cliente al buscar la marca</summary>' +
      '<p style="white-space:pre-wrap;font-size:12px;color:#333">' + esc_(s.busquedaMarca) + '</p></details>';
  });
  h += '<p style="font-size:11px;color:' + COL.sub + ';margin-top:28px">Todas las propuestas quedan en la hoja GBP_Propuestas. Lo que editas o descartas, el agente lo aprende para la semana siguiente.</p></div></div>';

  var txt = plan.resumen + '\n\n' + props.map(function (p) { return '[' + p.sede + '][' + p.prioridad + '] ' + NOMBRE_TIPO[p.tipo] + ': ' + p.titulo; }).join('\n');
  enviar_('Agente Google · ' + (urg ? urg + ' urgentes · ' : '') + props.length + ' propuestas · ' + fecha_(), txt, h);
}

function enviarUrgente_(props) {
  var h = '<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:640px;margin:0 auto">' +
    '<div style="background:' + COL.red + ';color:#fff;padding:16px 18px;border-radius:10px 10px 0 0;font-weight:600">🔴 Reseña negativa nueva · respuesta preparada</div>' +
    '<div style="padding:8px 4px">' + props.map(tarjetaPropuesta_).join('') +
    '<p style="font-size:12px;color:' + COL.sub + '">Consejo: llama al cliente antes de responder en público si es posible.</p></div></div>';
  enviar_('🔴 Reseña negativa en ' + props.map(function (p) { return sede_(p.sede).nombre; }).join(', '),
    props.map(function (p) { return p.contexto + '\n→ ' + p.propuesta; }).join('\n\n'), h);
}

function enviar_(asunto, texto, html) {
  (prop_('NOTIFY_EMAILS') || DEFAULT_EMAILS).split(',').forEach(function (to) {
    GmailApp.sendEmail(to.trim(), asunto, texto, { htmlBody: html, name: 'Agente Google DC' });
  });
}

// ═══ WebApp.gs ═══
// ── APP WEB: página que abren los botones del email ──────────────────────────
// Los enlaces del email solo ABREN esta página (GET no cambia nada: los antivirus
// de correo que pre-abren enlaces no pueden publicar). La acción se confirma con un botón.

function doGet(e) {
  var id = (e.parameter || {}).id || '', t = (e.parameter || {}).t || '', a = (e.parameter || {}).a || 'editar';
  var tpl = HtmlService.createTemplateFromFile('Pagina');
  tpl.error = '';
  tpl.d = null;
  if (!id || t !== token_(id)) tpl.error = 'Enlace no válido o caducado.';
  else {
    var p = buscarPropuesta_(id);
    if (!p) tpl.error = 'Esta propuesta ya no existe.';
    else {
      var r = p.row, s = sede_(r[C.SEDE]);
      tpl.d = {
        id: id, t: t, accion: a, sede: s ? s.nombre : r[C.SEDE], tipo: r[C.TIPO], titulo: r[C.TITULO],
        contexto: r[C.CTX], texto: r[C.FINAL] || r[C.PROP], estado: r[C.ESTADO],
        publicable: publicable_(r[C.TIPO]), nivel2: nivel2_(s), panel: GBP_PANEL_URL
      };
    }
  }
  return tpl.evaluate().setTitle('Agente Google · Durán Carasso')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Llamado desde la página con google.script.run. */
function accionWeb(id, t, accion, texto, feedback) {
  if (t !== token_(id)) return { ok: false, mensaje: 'Enlace no válido.' };
  if (['publicar', 'hecho', 'descartar'].indexOf(accion) === -1) return { ok: false, mensaje: 'Acción no válida.' };
  return decidir_(id, accion, texto, feedback);
}

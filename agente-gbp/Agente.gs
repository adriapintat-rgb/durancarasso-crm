// ── FLUJO SEMANAL POR FASES ──────────────────────────────────────────────────
// Apps Script corta cada ejecución a los 6 min, así que el informe avanza por fases y se reprograma solo:
//   DATOS    (domingo 20:00) analiza cada sede → lote de búsquedas de marca
//   BUSQUEDA espera el lote → lote de planes (uno por sede)
//   PLAN     espera el lote
//   ENVIO    lunes 8:30 (o en cuanto esté listo si se pidió "ahora") → propuestas + email
var MAX_EJECUCION_MS = 4.5 * 60 * 1000;
var ESPERA_LOTE_MIN = 10;
var MAX_ESPERAS = 30;           // 30 × 10 min = 5 h esperando un lote antes de avisar

// SEGURIDAD: la app web (botones del email) es pública y Apps Script deja llamar desde ella a cualquier
// función sin "_" final. Por eso todo lo interno termina en "_", los triggers comprueban que los lanza un
// trigger real del proyecto y las funciones del menú exigen estar dentro de la hoja (getUi).
function esTrigger_(e) {
  var uid = e && e.triggerUid;
  return !!uid && ScriptApp.getProjectTriggers().some(function (t) { return t.getUniqueId() === uid; });
}

/** Trigger del domingo: prepara el informe del lunes. */
function ejecutarSemanal(e) { if (esTrigger_(e)) iniciarSemanal_(false); }

/** Menú "Enviar informe ahora": mismo flujo, se envía en cuanto está listo (15-60 min). */
function enviarAhora_() { iniciarSemanal_(true); }

function iniciarSemanal_(inmediato) {
  var e = estado_();
  if (e && e.fase !== 'FIN' && Date.now() - e.inicio < 12 * 36e5) {
    if (!inmediato) return;               // ya hay un informe en marcha
  }
  guardarEstado_({ fase: 'DATOS', idx: 0, inmediato: inmediato, inicio: Date.now(), esperas: 0 });
  var sh = hoja_('GBP_Estado');
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 3).clearContent();
  avanzar_();
}

/** Trigger de continuación (de un solo uso, se reprograma solo). */
function avanzarSemanal(e) { if (esTrigger_(e)) avanzar_(); }

/** Motor de fases. */
function avanzar_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  var t0 = Date.now(), e = estado_();
  try {
    while (e && e.fase !== 'FIN') {
      if (Date.now() - t0 > MAX_EJECUCION_MS) { programar_(60 * 1000); return; }

      if (e.fase === 'DATOS') {
        if (e.idx < SEDES.length) {
          var s = SEDES[e.idx], snap;
          try { snap = analizarSede_(s); } catch (err) { snap = { sede: s.code, nombre: s.nombre, error: String(err) }; }
          if (e.idx === 0 && snap.ficha) e.dominio = auditarDominio_(snap.ficha.web);
          guardarSnap_(snap); e.idx++; guardarEstado_(e); continue;
        }
        var ok = snaps_().filter(function (x) { return !x.error; });
        if (!ok.length) throw new Error('No se pudo analizar ninguna sede: ' + snaps_().map(function (x) { return x.sede + ': ' + x.error; }).join(' | '));
        e.lote = crearLote_(ok.map(peticionBusqueda_));
        e.fase = 'BUSQUEDA'; e.esperas = 0; guardarEstado_(e);
        programar_(ESPERA_LOTE_MIN * 60 * 1000); return;
      }

      if (e.fase === 'BUSQUEDA') {
        var rb = resultadosLote_(e.lote);
        if (!rb && ++e.esperas < MAX_ESPERAS / 2) { guardarEstado_(e); programar_(ESPERA_LOTE_MIN * 60 * 1000); return; }
        var todos = snaps_(), primera = todos.filter(function (x) { return !x.error; })[0];
        todos.forEach(function (x) {
          if (x.error) return;
          var r = rb && rb['busq-' + x.sede];
          x.busquedaMarca = r && r.ok ? textoClaude_(r.mensaje).trim() : '';
          guardarSnap_(x);
        });
        e.lote = crearLote_(todos.filter(function (x) { return !x.error; }).map(function (x) {
          return peticionPlan_(x, x === primera && e.dominio ? { web_global: e.dominio } : null);
        }));
        e.fase = 'PLAN'; e.esperas = 0; guardarEstado_(e);
        programar_(ESPERA_LOTE_MIN * 60 * 1000); return;
      }

      if (e.fase === 'PLAN') {
        var rp = resultadosLote_(e.lote);
        if (!rp) {
          if (++e.esperas >= MAX_ESPERAS) throw new Error('El lote de Claude no ha terminado tras ' + (MAX_ESPERAS * ESPERA_LOTE_MIN / 60) + ' h');
          guardarEstado_(e); programar_(ESPERA_LOTE_MIN * 60 * 1000); return;
        }
        snaps_().forEach(function (x) {
          if (x.error) return;
          var r = rp['plan-' + x.sede], plan;
          try { plan = r && r.ok ? JSON.parse(textoClaude_(r.mensaje)) : { error: r ? r.error : 'sin respuesta' }; }
          catch (err) { plan = { error: 'JSON no válido: ' + err }; }
          guardarPlan_(x.sede, plan);
        });
        e.fase = 'ENVIO'; guardarEstado_(e); continue;
      }

      if (e.fase === 'ENVIO') {
        var lunes = proximoEnvio_(e.inicio);
        if (!e.inmediato && Date.now() < lunes.getTime()) { programar_(lunes); return; }
        enviarInforme_(e);
        e.fase = 'FIN'; guardarEstado_(e); return;
      }
    }
  } catch (err) {
    if (e) { e.fase = 'FIN'; e.error = String(err); guardarEstado_(e); }
    avisarError_('el informe semanal', err);
  } finally { lock.releaseLock(); }
}

function enviarInforme_(e) {
  var snaps = snaps_(), planes = planes_(), ok = snaps.filter(function (x) { return !x.error; });
  var plan = {
    resumen: SEDES.map(function (s) {
      var p = planes[s.code];
      return s.nombre + ': ' + (p && p.titular ? p.titular : p && p.error ? 'plan no disponible (' + p.error + ')' : 'sin datos');
    }).join('\n'),
    sedes: ok.filter(function (x) { return planes[x.sede] && !planes[x.sede].error; })
             .map(function (x) { var p = planes[x.sede]; p.sede = x.sede; return p; }),
    dominio: e.dominio
  };
  guardarHistorico_(ok);
  var props = propuestasDesdePlan_(ok, plan);
  enviarSemanal_(snaps, plan, props);
  ok.forEach(function (s) {
    P.setProperty('SNAP_' + s.sede, JSON.stringify({ rating: s.ficha.rating, numResenas: s.ficha.numResenas, fotos: s.ficha.fotos, completitud: s.completitud.porcentaje }));
  });
}

/** Lunes 8:30 siguiente al inicio (hora de Madrid). */
function proximoEnvio_(inicio) {
  var d = new Date(inicio);
  for (var i = 0; i < 8; i++) {
    var c = new Date(d.getTime() + i * 864e5);
    if (Utilities.formatDate(c, 'Europe/Madrid', 'u') === '1') {
      var f = Utilities.formatDate(c, 'Europe/Madrid', "yyyy-MM-dd'T'08:30:00XXX");
      var t = new Date(f.replace(/([+-]\d\d):?(\d\d)$/, '$1:$2'));
      if (t.getTime() > inicio) return t;
    }
  }
  return new Date(inicio);
}

/** Deja un único trigger de continuación (evita acumular triggers de un solo uso). */
function programar_(cuando) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'avanzarSemanal') ScriptApp.deleteTrigger(t); });
  var b = ScriptApp.newTrigger('avanzarSemanal').timeBased();
  (cuando instanceof Date ? b.at(cuando) : b.after(Math.max(60 * 1000, cuando))).create();
}

// ── ESTADO (hoja oculta GBP_Estado + propiedades) ────────────────────────────
function estado_() { return JSON.parse(P.getProperty('ESTADO_SEMANAL') || 'null'); }
function guardarEstado_(e) { P.setProperty('ESTADO_SEMANAL', JSON.stringify(e)); }

function filaSede_(code) {
  var sh = hoja_('GBP_Estado'), data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) if (data[i][0] === code) return { sh: sh, fila: i + 1 };
  var n = sh.getLastRow() + 1; sh.getRange(n, 1).setValue(code); return { sh: sh, fila: n };
}
function guardarSnap_(snap) { var f = filaSede_(snap.sede); f.sh.getRange(f.fila, 2).setValue(JSON.stringify(snap)); }
function guardarPlan_(code, plan) { var f = filaSede_(code); f.sh.getRange(f.fila, 3).setValue(JSON.stringify(plan)); }
function snaps_() {
  var data = hoja_('GBP_Estado').getDataRange().getValues().slice(1);
  return SEDES.map(function (s) {
    var r = data.filter(function (x) { return x[0] === s.code; })[0];
    return r && r[1] ? JSON.parse(r[1]) : null;
  }).filter(Boolean);
}
function planes_() {
  var out = {};
  hoja_('GBP_Estado').getDataRange().getValues().slice(1).forEach(function (r) { if (r[2]) out[r[0]] = JSON.parse(r[2]); });
  return out;
}

// ── VIGILANCIA CADA 3 H ──────────────────────────────────────────────────────
/** Reseñas negativas nuevas → borrador inmediato + aviso. Aplica el piloto automático. */
function vigilarUrgente(e) { if (esTrigger_(e)) vigilar_(); }

function vigilar_() {
  var urgentes = [], avisos = [];
  SEDES.forEach(function (s) {
    try {
      var f = fichaPlaces_(placeId_(s)), gbp = resenasGBP_(s);
      var nuevas = resenasNuevas_(s, gbp || (f.reviews || []).map(mapReviewPlaces_));
      nuevas.forEach(function (r) {
        if (r.estrellas > 3) return;
        urgentes.push(crearPropuestas_([{
          sede: s.code, tipo: 'RESPUESTA', prioridad: 'ALTA', titulo: 'Reseña de ' + r.estrellas + '★ de ' + r.autor,
          contexto: r.estrellas + '★ · ' + r.autor + ': ' + r.texto, propuesta: respuestaUrgente_(s, r),
          referencia: r.id, estrellas: r.estrellas
        }])[0]);
      });
      // Nivel 1: Google solo enseña 5 reseñas "relevantes"; si sube el total y baja la nota sin verla, avisamos igual.
      var aviso = cambioOculto_(s, f, nuevas.length > 0 || !!gbp);
      if (aviso) avisos.push(aviso);
    } catch (e) { Logger.log(s.code + ': ' + e); }
  });
  if (urgentes.length) enviarUrgente_(urgentes);
  if (avisos.length) enviar_('🟠 Posible reseña negativa: revisa Google', avisos.join('\n'),
    '<div style="font-family:Arial,sans-serif;font-size:14px">' + avisos.map(esc_).join('<br><br>') + '</div>');
  var auto = aplicarAutopiloto_();
  if (auto.length) enviar_('Agente Google · publicado automáticamente (' + auto.length + ')',
    auto.join('\n'), '<div style="font-family:Arial,sans-serif">' + auto.map(esc_).join('<br>') + '</div>');
}

function cambioOculto_(s, f, yaCubierto) {
  var k = 'CUENTA_' + s.code, prev = JSON.parse(P.getProperty(k) || 'null');
  var ahora = { n: f.userRatingCount || 0, r: f.rating || 0 };
  P.setProperty(k, JSON.stringify(ahora));
  if (!prev || yaCubierto || ahora.n <= prev.n || ahora.r >= prev.r) return '';
  return s.nombre + ': ' + (ahora.n - prev.n) + ' reseña(s) nueva(s) y la nota baja de ' + prev.r + ' a ' + ahora.r +
    '. Google no la muestra aún por API: ábrela y respóndela → ' + (f.googleMapsUri || '');
}

function resenasNuevas_(s, lista) {
  var k = 'LASTREV_' + s.code, last = P.getProperty(k) || '';
  var nuevas = lista.filter(function (r) { return r.fecha && r.fecha > last; });
  P.setProperty(k, lista.reduce(function (m, r) { return r.fecha > m ? r.fecha : m; }, last));
  return last ? nuevas : [];
}

// ── INSTALACIÓN Y AYUDAS ─────────────────────────────────────────────────────
/** Crea los triggers (domingo 20:00 → email lunes 8:30, y vigilancia cada 3 h), las hojas y fija la referencia de reseñas. */
function instalar_() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('ejecutarSemanal').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(20).inTimezone('Europe/Madrid').create();
  ScriptApp.newTrigger('vigilarUrgente').timeBased().everyHours(3).create();
  Object.keys(CABECERAS).forEach(hoja_);
  secreto_();
  SEDES.forEach(function (s) {
    var f = fichaPlaces_(placeId_(s));
    Logger.log(s.code + ' → ' + (f.displayName || {}).text + ' · ' + f.formattedAddress);
    resenasNuevas_(s, resenasGBP_(s) || (f.reviews || []).map(mapReviewPlaces_));
    cambioOculto_(s, f, true);
  });
}

/** Nivel 2 (menú o editor): lista las ubicaciones de la cuenta para rellenar gbpLocationId. */
function listarUbicacionesGBP() {
  SpreadsheetApp.getUi();
  var r = gbp_('GET', 'https://mybusinessbusinessinformation.googleapis.com/v1/accounts/' + prop_('GBP_ACCOUNT_ID', true) +
    '/locations?readMask=name,title,storefrontAddress&pageSize=100');
  var txt = (r.locations || []).map(function (l) { return l.name + ' · ' + l.title + ' · ' + ((l.storefrontAddress || {}).locality || ''); }).join('\n');
  mostrar_('Ubicaciones de tu cuenta', txt || 'No hay ubicaciones');
}

function avisarError_(que, err) {
  Logger.log(err && err.stack || err);
  try { enviar_('⚠️ Agente Google: error en ' + que, String(err),
    '<div style="font-family:Arial,sans-serif;font-size:14px"><b>Error en ' + esc_(que) + ':</b><br>' + esc_(String(err)) +
    '<br><br>Abre la hoja → menú 🤖 Agente Google → 2 · Comprobar que todo funciona.</div>'); } catch (e) { Logger.log(e); }
}

// ── LÓGICA DE PROPUESTAS ─────────────────────────────────────────────────────
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
    if (ps.post) lista.push({ sede: ps.sede, tipo: 'POST', prioridad: 'MEDIA', titulo: 'Publicación semanal', propuesta: limpiarPost_(ps.post) });
    if (ps.descripcion) lista.push({ sede: ps.sede, tipo: 'DESCRIPCION', prioridad: 'MEDIA', titulo: 'Nueva descripción de la ficha',
      contexto: 'Actual: ' + (snap.ficha.descripcionActual || '(vacía)'), propuesta: ps.descripcion.slice(0, 750) });
    ps.respuestas.forEach(function (r) {
      var o = snap.resenasRecientes.filter(function (x) { return x.id === r.id; })[0];
      if (o) lista.push({ sede: ps.sede, tipo: 'RESPUESTA', prioridad: o.estrellas <= 3 ? 'ALTA' : 'MEDIA',
        titulo: 'Respuesta a ' + o.autor + ' (' + o.estrellas + '★)', contexto: o.estrellas + '★ · ' + o.autor + ': ' + o.texto,
        propuesta: r.texto, referencia: r.id, estrellas: o.estrellas });
    });
  });
  return crearPropuestas_(lista);
}

/** Google rechaza posts con teléfonos o URLs: red de seguridad por si la IA los cuela. */
function limpiarPost_(t) {
  var prohibido = /https?:\/\/|www\.|@\w+\.\w|\+?\d[\d\s.-]{7,}\d/i;   // URLs, emails y teléfonos
  return String(t).split(/(?<=[.!?…])\s+/).filter(function (f) { return !prohibido.test(f); }).join(' ').trim().slice(0, 1500);
}

function aplicarAutopiloto_() {
  var ap = autopiloto_(), hechos = [];
  if (!ap.responder5estrellas && !ap.postSiNoRespondes48h) return hechos;
  hoja_('GBP_Propuestas').getDataRange().getValues().slice(1).forEach(function (r) {
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
    return r[C.ESTADO] === 'PENDIENTE' && Utilities.formatDate(new Date(r[C.FECHA]), 'Europe/Madrid', 'yyyy-MM-dd') !== hoy;
  }).length;
}

// ── UTILIDADES ───────────────────────────────────────────────────────────────
function fecha_() { return Utilities.formatDate(new Date(), 'Europe/Madrid', 'yyyy-MM-dd'); }
function recorta_(t, n) { t = String(t || ''); return t.length > n ? t.slice(0, n) + '…' : t; }
function esc_(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

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

// ── HOJAS ────────────────────────────────────────────────────────────────────
var CABECERAS = {
  GBP_Propuestas: ['ID', 'Fecha', 'Sede', 'Tipo', 'Prioridad', 'Título', 'Contexto', 'Propuesta', 'Texto final',
                   'Estado', 'Feedback', 'Actualizado', 'Referencia', 'Estrellas'],
  GBP_Historico: ['Fecha', 'Sede', 'Nota', 'Nº reseñas', 'Fotos', 'Ficha %', 'SEO', 'Rendimiento', 'Puesto reseñas',
                  'Puesto nota', 'Llamadas 28d', 'Rutas 28d', 'Clics web 28d', 'Falta'],
  GBP_Competencia: ['Fecha', 'Sede', 'Nombre', 'Nota', 'Reseñas', 'Fotos', 'Web'],
  GBP_Estado: ['Sede', 'Datos de la semana (JSON)', 'Plan (JSON)']   // interna, oculta
};
var C = { ID: 0, FECHA: 1, SEDE: 2, TIPO: 3, PRIO: 4, TITULO: 5, CTX: 6, PROP: 7, FINAL: 8, ESTADO: 9, FEED: 10, ACT: 11, REF: 12, EST: 13 };
// Tipos: POST, RESPUESTA, DESCRIPCION (publicables en Google) · TAREA (la hace el equipo)
// Estados: PENDIENTE → PUBLICADO | HECHO | DESCARTADO | APROBADO_MANUAL | ERROR

/** La hoja donde vive el agente. Se fija al instalar para que triggers y app web usen siempre la misma. */
function libro_() {
  if (prop_('SHEET_ID')) return SpreadsheetApp.openById(prop_('SHEET_ID'));
  var ss = SpreadsheetApp.getActive();
  if (!ss) throw new Error('Instala el agente desde el menú de una hoja de Google (Extensiones → Apps Script)');
  P.setProperty('SHEET_ID', ss.getId());
  return ss;
}

function hoja_(nombre) {
  var ss = libro_(), sh = ss.getSheetByName(nombre);
  if (!sh) {
    sh = ss.insertSheet(nombre); sh.appendRow(CABECERAS[nombre]); sh.setFrozenRows(1);
    if (nombre === 'GBP_Estado') sh.hideSheet();
  }
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
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, mensaje: 'El agente está ocupado, prueba en unos segundos.' };
  try { return decidirSinLock_(id, accion, texto, feedback); } finally { lock.releaseLock(); }
}

function decidirSinLock_(id, accion, texto, feedback) {
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
  if (!nivel2_(s) || (tipo === 'RESPUESTA' && String(p.row[C.REF]).indexOf('accounts/') !== 0)) {
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
    languageCode: idioma_(s.code), summary: texto, topicType: 'STANDARD',
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

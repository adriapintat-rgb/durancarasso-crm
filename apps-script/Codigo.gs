/**
 * DC · Personas — Backend (Google Apps Script)
 * Registro de jornada, ausencias, horarios, tareas y documentos.
 *
 * Diseño:
 *  - Todas las escrituras de fichaje son APPEND-ONLY. Nunca se edita ni borra una fila.
 *    Una corrección es una fila nueva con origen=CORRECCION + motivo + autor.
 *  - Cada fichaje encadena un hash SHA-256 con el hash de la fila anterior.
 *    Alterar una fila rompe la cadena y `verificarCadena` lo detecta.
 *  - Autenticación por PIN validado en servidor. El PIN nunca viaja al cliente.
 *  - Un único endpoint POST (Content-Type: text/plain) para evitar preflight CORS.
 *
 * Instalación: ver docs/SETUP.md
 */

// ── CONFIG ───────────────────────────────────────────────────────────────────
var SHEET_ID = PropertiesService.getScriptProperties().getProperty('SHEET_ID') || '';
var SECRET   = PropertiesService.getScriptProperties().getProperty('SECRET')   || '';
var TOKEN_HORAS = 12;          // caducidad de sesión
var TZ = 'Europe/Madrid';

var HOJAS = {
  empleados:  'Empleados',
  fichajes:   'Fichajes',
  ausencias:  'Ausencias',
  horarios:   'Horarios',
  festivos:   'Festivos',
  tareas:     'Tareas',
  documentos: 'Documentos',
  auditoria:  'Auditoria'
};

var CABECERAS = {
  Empleados:  ['nombre','email','pin','rol','departamento','oficina','horario_id','fecha_alta','vacaciones_anuales','activo'],
  Fichajes:   ['id','ts_iso','fecha','hora','trabajador','email','tipo','lat','lng','precision_m','dispositivo','origen','motivo','autor','hash_prev','hash'],
  Ausencias:  ['id','ts_solicitud','trabajador','email','tipo','fecha_inicio','fecha_fin','dias','medio_dia','motivo','estado','validador','ts_validacion','comentario'],
  Horarios:   ['horario_id','nombre','lun','mar','mie','jue','vie','sab','dom','pausa_min','horas_semana'],
  Festivos:   ['fecha','nombre','ambito'],
  Tareas:     ['id','ts','trabajador','fecha','proyecto','tarea','minutos','nota'],
  Documentos: ['id','trabajador','tipo','nombre','url','fecha','requiere_firma','firmado_ts'],
  Auditoria:  ['ts','actor','accion','detalle','ip']
};

var TIPOS_FICHAJE = ['ENTRADA','PAUSA_INI','PAUSA_FIN','SALIDA'];

// ── ENTRYPOINTS ──────────────────────────────────────────────────────────────
function doPost(e) {
  var res;
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    res = router(body);
  } catch (err) {
    res = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(res))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  // Solo salud del servicio. Todo lo demás va por POST.
  return ContentService.createTextOutput(JSON.stringify({ ok: true, servicio: 'DC Personas', version: 1 }))
    .setMimeType(ContentService.MimeType.JSON);
}

function router(b) {
  var a = b.action;
  if (a === 'ping')       return { ok: true, hora: new Date().toISOString() };
  if (a === 'auth')       return auth(b);
  if (a === 'setup')      return setupHojas(b);
  if (a === 'listaEmpleados') return listaEmpleados();

  // A partir de aquí hace falta sesión válida
  var ses = validarToken(b.token);
  if (!ses.ok) return { ok: false, error: 'SESION_CADUCADA' };
  var emp = buscarEmpleado(ses.nombre);
  if (!emp) return { ok: false, error: 'EMPLEADO_NO_ENCONTRADO' };
  var esDir = String(emp.rol || '').toUpperCase() === 'DIRECCION';

  switch (a) {
    case 'bootstrap':       return bootstrap(emp, esDir);
    case 'fichar':          return fichar(emp, b);
    case 'misFichajes':     return misFichajes(emp, b);
    case 'estadoEquipo':    return estadoEquipo();
    case 'solicitarAusencia': return solicitarAusencia(emp, b);
    case 'cancelarAusencia':  return cancelarAusencia(emp, b);
    case 'misAusencias':    return misAusencias(emp, b);
    case 'ausenciasEquipo': return ausenciasEquipo(b);
    case 'imputarTarea':    return imputarTarea(emp, b);
    case 'misTareas':       return misTareas(emp, b);
    case 'misDocumentos':   return misDocumentos(emp);
    case 'firmarDocumento': return firmarDocumento(emp, b);

    // ── Solo dirección ──
    case 'validarAusencia': return esDir ? validarAusencia(emp, b) : denegado();
    case 'corregirFichaje': return esDir ? corregirFichaje(emp, b)  : denegado();
    case 'informe':         return esDir ? informe(b)               : denegado();
    case 'incidencias':     return esDir ? incidencias(b)           : denegado();
    case 'verificarCadena': return esDir ? verificarCadena()        : denegado();
    case 'altaEmpleado':    return esDir ? altaEmpleado(emp, b)     : denegado();
    case 'subirDocumento':  return esDir ? subirDocumento(emp, b)   : denegado();
  }
  return { ok: false, error: 'ACCION_DESCONOCIDA: ' + a };
}

function denegado() { return { ok: false, error: 'SIN_PERMISOS' }; }

/** Lista pública para la pantalla de acceso. No expone PIN ni email. */
function listaEmpleados() {
  var out = leer(HOJAS.empleados)
    .filter(function (e) { return String(e.activo).toUpperCase() !== 'NO'; })
    .map(function (e) { return { nombre: e.nombre, departamento: e.departamento, rol: e.rol }; });
  return { ok: true, empleados: out };
}

// ── HOJAS / UTILIDADES ───────────────────────────────────────────────────────
function ss() {
  return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function hoja(nombre) {
  var libro = ss();
  var h = libro.getSheetByName(nombre);
  if (!h) {
    h = libro.insertSheet(nombre);
    if (CABECERAS[nombre]) h.appendRow(CABECERAS[nombre]);
  }
  return h;
}

function leer(nombre) {
  var h = hoja(nombre);
  var v = h.getDataRange().getValues();
  if (v.length < 2) return [];
  var cols = v[0].map(function (c) { return String(c).trim(); });
  var out = [];
  for (var i = 1; i < v.length; i++) {
    var o = {};
    for (var j = 0; j < cols.length; j++) o[cols[j]] = v[i][j];
    o._fila = i + 1;
    out.push(o);
  }
  return out;
}

function uid(pref) {
  return pref + '-' + Utilities.getUuid().slice(0, 8).toUpperCase();
}

function ahora() { return new Date(); }
function fmtFecha(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }
function fmtHora(d)  { return Utilities.formatDate(d, TZ, 'HH:mm:ss'); }

function sha256(txt) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, txt, Utilities.Charset.UTF_8);
  return raw.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function auditar(actor, accion, detalle) {
  try { hoja(HOJAS.auditoria).appendRow([new Date().toISOString(), actor, accion, detalle || '', '']); } catch (e) {}
}

// ── AUTENTICACIÓN ────────────────────────────────────────────────────────────
function firmar(payload) {
  var sig = Utilities.computeHmacSha256Signature(payload, SECRET);
  return Utilities.base64EncodeWebSafe(sig);
}

function auth(b) {
  var nombre = String(b.nombre || '').trim();
  var pin = String(b.pin || '').trim();
  var emp = buscarEmpleado(nombre);
  if (!emp)  return { ok: false, error: 'EMPLEADO_NO_ENCONTRADO' };
  if (String(emp.activo).toUpperCase() === 'NO') return { ok: false, error: 'EMPLEADO_INACTIVO' };
  if (String(emp.pin).trim() !== pin) {
    auditar(nombre, 'LOGIN_FALLIDO', '');
    return { ok: false, error: 'PIN_INCORRECTO' };
  }
  var exp = Date.now() + TOKEN_HORAS * 3600 * 1000;
  var payload = Utilities.base64EncodeWebSafe(nombre + '|' + exp);
  var token = payload + '.' + firmar(payload);
  auditar(nombre, 'LOGIN', '');
  return {
    ok: true,
    token: token,
    empleado: {
      nombre: emp.nombre, email: emp.email, rol: emp.rol,
      departamento: emp.departamento, oficina: emp.oficina,
      horario_id: emp.horario_id, vacaciones_anuales: Number(emp.vacaciones_anuales || 0),
      fecha_alta: emp.fecha_alta ? String(emp.fecha_alta) : ''
    }
  };
}

function validarToken(token) {
  if (!token || token.indexOf('.') < 0) return { ok: false };
  var parts = token.split('.');
  if (firmar(parts[0]) !== parts[1]) return { ok: false };
  var claro = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
  var trozos = claro.split('|');
  if (Number(trozos[1]) < Date.now()) return { ok: false };
  return { ok: true, nombre: trozos[0] };
}

function buscarEmpleado(nombre) {
  var todos = leer(HOJAS.empleados);
  for (var i = 0; i < todos.length; i++) {
    if (String(todos[i].nombre).trim() === String(nombre).trim()) return todos[i];
  }
  return null;
}

// ── BOOTSTRAP ────────────────────────────────────────────────────────────────
function bootstrap(emp, esDir) {
  var empleados = leer(HOJAS.empleados)
    .filter(function (e) { return String(e.activo).toUpperCase() !== 'NO'; })
    .map(function (e) {
      return { nombre: e.nombre, email: e.email, rol: e.rol, departamento: e.departamento,
               oficina: e.oficina, horario_id: e.horario_id,
               vacaciones_anuales: Number(e.vacaciones_anuales || 0) };
    });
  return {
    ok: true,
    empleados: empleados,
    horarios: leer(HOJAS.horarios),
    festivos: leer(HOJAS.festivos).map(function (f) {
      return { fecha: normFecha(f.fecha), nombre: f.nombre, ambito: f.ambito };
    }),
    esDireccion: esDir,
    servidorHora: new Date().toISOString()
  };
}

function normFecha(v) {
  if (v instanceof Date) return fmtFecha(v);
  return String(v || '').trim().slice(0, 10);
}

// ── FICHAJES ─────────────────────────────────────────────────────────────────
function ultimoHash() {
  var h = hoja(HOJAS.fichajes);
  var n = h.getLastRow();
  if (n < 2) return 'GENESIS';
  return String(h.getRange(n, 16).getValue() || 'GENESIS');
}

function ultimoEstado(nombre) {
  var filas = leer(HOJAS.fichajes).filter(function (f) {
    return String(f.trabajador).trim() === nombre && normFecha(f.fecha) === fmtFecha(ahora());
  });
  if (!filas.length) return { estado: 'FUERA', desde: null };
  var ult = filas[filas.length - 1];
  var mapa = { ENTRADA: 'TRABAJANDO', PAUSA_INI: 'PAUSA', PAUSA_FIN: 'TRABAJANDO', SALIDA: 'FUERA' };
  return { estado: mapa[String(ult.tipo).trim()] || 'FUERA', desde: String(ult.ts_iso || '') };
}

function transicionValida(estado, tipo) {
  if (tipo === 'ENTRADA')   return estado === 'FUERA';
  if (tipo === 'PAUSA_INI') return estado === 'TRABAJANDO';
  if (tipo === 'PAUSA_FIN') return estado === 'PAUSA';
  if (tipo === 'SALIDA')    return estado === 'TRABAJANDO' || estado === 'PAUSA';
  return false;
}

function fichar(emp, b) {
  var tipo = String(b.tipo || '').toUpperCase();
  if (TIPOS_FICHAJE.indexOf(tipo) < 0) return { ok: false, error: 'TIPO_INVALIDO' };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (e) { return { ok: false, error: 'SERVICIO_OCUPADO' }; }

  try {
    var est = ultimoEstado(emp.nombre);
    if (!transicionValida(est.estado, tipo)) {
      return { ok: false, error: 'TRANSICION_INVALIDA', estado: est.estado };
    }
    var d = ahora();
    var id = uid('F');
    var prev = ultimoHash();
    var base = [id, d.toISOString(), emp.nombre, tipo].join('|');
    var hash = sha256(prev + '|' + base);

    hoja(HOJAS.fichajes).appendRow([
      id, d.toISOString(), fmtFecha(d), fmtHora(d), emp.nombre, emp.email, tipo,
      b.lat || '', b.lng || '', b.acc || '', b.dispositivo || '', 'APP', '', '',
      prev, hash
    ]);

    var nuevo = { ENTRADA: 'TRABAJANDO', PAUSA_INI: 'PAUSA', PAUSA_FIN: 'TRABAJANDO', SALIDA: 'FUERA' }[tipo];
    return { ok: true, id: id, ts: d.toISOString(), fecha: fmtFecha(d), hora: fmtHora(d), estado: nuevo, hash: hash };
  } finally {
    lock.releaseLock();
  }
}

function misFichajes(emp, b) {
  var desde = String(b.desde || '1900-01-01');
  var hasta = String(b.hasta || '2999-12-31');
  var quien = b.trabajador && String(emp.rol).toUpperCase() === 'DIRECCION' ? String(b.trabajador) : emp.nombre;
  var filas = leer(HOJAS.fichajes).filter(function (f) {
    var fe = normFecha(f.fecha);
    return String(f.trabajador).trim() === quien && fe >= desde && fe <= hasta;
  }).map(limpiarFichaje);
  return { ok: true, fichajes: filas, estado: ultimoEstado(quien) };
}

function limpiarFichaje(f) {
  return {
    id: f.id, ts: String(f.ts_iso), fecha: normFecha(f.fecha), hora: String(f.hora),
    trabajador: f.trabajador, tipo: String(f.tipo).trim(),
    lat: f.lat, lng: f.lng, origen: f.origen, motivo: f.motivo, autor: f.autor
  };
}

function estadoEquipo() {
  var hoy = fmtFecha(ahora());
  var porPersona = {};
  leer(HOJAS.fichajes).forEach(function (f) {
    if (normFecha(f.fecha) !== hoy) return;
    porPersona[String(f.trabajador).trim()] = f;
  });
  var mapa = { ENTRADA: 'TRABAJANDO', PAUSA_INI: 'PAUSA', PAUSA_FIN: 'TRABAJANDO', SALIDA: 'FUERA' };
  var out = [];
  leer(HOJAS.empleados).forEach(function (e) {
    if (String(e.activo).toUpperCase() === 'NO') return;
    var f = porPersona[String(e.nombre).trim()];
    out.push({
      nombre: e.nombre, departamento: e.departamento, oficina: e.oficina,
      estado: f ? (mapa[String(f.tipo).trim()] || 'FUERA') : 'SIN_FICHAR',
      desde: f ? String(f.ts_iso) : ''
    });
  });
  return { ok: true, equipo: out, hoy: hoy };
}

function corregirFichaje(dir, b) {
  var trabajador = String(b.trabajador || '').trim();
  var tipo = String(b.tipo || '').toUpperCase();
  var ts = String(b.ts || '');
  var motivo = String(b.motivo || '').trim();
  if (!trabajador || TIPOS_FICHAJE.indexOf(tipo) < 0) return { ok: false, error: 'DATOS_INVALIDOS' };
  if (!motivo) return { ok: false, error: 'MOTIVO_OBLIGATORIO' };

  var emp = buscarEmpleado(trabajador);
  var d = new Date(ts);
  if (isNaN(d.getTime())) return { ok: false, error: 'FECHA_INVALIDA' };

  var id = uid('C');
  var prev = ultimoHash();
  var base = [id, d.toISOString(), trabajador, tipo].join('|');
  var hash = sha256(prev + '|' + base);

  hoja(HOJAS.fichajes).appendRow([
    id, d.toISOString(), fmtFecha(d), fmtHora(d), trabajador, emp ? emp.email : '', tipo,
    '', '', '', '', 'CORRECCION', motivo, dir.nombre, prev, hash
  ]);
  auditar(dir.nombre, 'CORRECCION_FICHAJE', trabajador + ' ' + tipo + ' ' + d.toISOString() + ' — ' + motivo);
  return { ok: true, id: id };
}

function verificarCadena() {
  var filas = leer(HOJAS.fichajes);
  var prev = 'GENESIS';
  var rotas = [];
  filas.forEach(function (f) {
    var base = [f.id, String(f.ts_iso), f.trabajador, String(f.tipo).trim()].join('|');
    var esperado = sha256(prev + '|' + base);
    if (esperado !== String(f.hash).trim()) rotas.push({ fila: f._fila, id: f.id, trabajador: f.trabajador });
    prev = String(f.hash).trim();
  });
  return { ok: true, total: filas.length, integridad: rotas.length === 0, rotas: rotas };
}

// ── AUSENCIAS ────────────────────────────────────────────────────────────────
function diasEntre(desde, hasta) {
  var a = new Date(desde + 'T00:00:00'), b2 = new Date(hasta + 'T00:00:00');
  return Math.round((b2 - a) / 86400000) + 1;
}

function diasLaborables(desde, hasta) {
  var festivos = {};
  leer(HOJAS.festivos).forEach(function (f) { festivos[normFecha(f.fecha)] = true; });
  var n = 0, d = new Date(desde + 'T00:00:00'), fin = new Date(hasta + 'T00:00:00');
  while (d <= fin) {
    var dow = d.getDay();
    var key = Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
    if (dow !== 0 && dow !== 6 && !festivos[key]) n++;
    d.setDate(d.getDate() + 1);
  }
  return n;
}

function solicitarAusencia(emp, b) {
  var tipo = String(b.tipo || '').trim();
  var desde = String(b.desde || '').slice(0, 10);
  var hasta = String(b.hasta || '').slice(0, 10);
  var medio = b.medioDia ? 'SI' : 'NO';
  if (!tipo || !desde || !hasta) return { ok: false, error: 'DATOS_INCOMPLETOS' };
  if (hasta < desde) return { ok: false, error: 'RANGO_INVALIDO' };

  // Solapamiento con solicitudes vivas
  var mias = leer(HOJAS.ausencias).filter(function (a) {
    return String(a.trabajador).trim() === emp.nombre &&
           ['PENDIENTE', 'APROBADA'].indexOf(String(a.estado).toUpperCase()) >= 0;
  });
  for (var i = 0; i < mias.length; i++) {
    var d1 = normFecha(mias[i].fecha_inicio), d2 = normFecha(mias[i].fecha_fin);
    if (desde <= d2 && hasta >= d1) return { ok: false, error: 'SOLAPAMIENTO', con: mias[i].id };
  }

  var dias = medio === 'SI' ? 0.5 : diasLaborables(desde, hasta);
  var id = uid('A');
  hoja(HOJAS.ausencias).appendRow([
    id, new Date().toISOString(), emp.nombre, emp.email, tipo, desde, hasta,
    dias, medio, String(b.motivo || ''), 'PENDIENTE', '', '', ''
  ]);
  auditar(emp.nombre, 'SOLICITUD_AUSENCIA', tipo + ' ' + desde + '→' + hasta + ' (' + dias + 'd)');
  return { ok: true, id: id, dias: dias };
}

function cancelarAusencia(emp, b) {
  var id = String(b.id || '');
  var filas = leer(HOJAS.ausencias);
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i].id) !== id) continue;
    if (String(filas[i].trabajador).trim() !== emp.nombre) return denegado();
    if (String(filas[i].estado).toUpperCase() === 'DENEGADA') return { ok: false, error: 'YA_DENEGADA' };
    hoja(HOJAS.ausencias).getRange(filas[i]._fila, 11).setValue('CANCELADA');
    hoja(HOJAS.ausencias).getRange(filas[i]._fila, 13).setValue(new Date().toISOString());
    auditar(emp.nombre, 'CANCELA_AUSENCIA', id);
    return { ok: true };
  }
  return { ok: false, error: 'NO_ENCONTRADA' };
}

function saldoVacaciones(nombre, year, anuales) {
  var consumidos = 0, pendientes = 0;
  leer(HOJAS.ausencias).forEach(function (a) {
    if (String(a.trabajador).trim() !== nombre) return;
    if (String(a.tipo).toUpperCase().indexOf('VACAC') < 0) return;
    if (normFecha(a.fecha_inicio).slice(0, 4) !== String(year)) return;
    var est = String(a.estado).toUpperCase();
    if (est === 'APROBADA') consumidos += Number(a.dias || 0);
    if (est === 'PENDIENTE') pendientes += Number(a.dias || 0);
  });
  return { totales: anuales, consumidos: consumidos, pendientes: pendientes,
           disponibles: anuales - consumidos - pendientes };
}

function misAusencias(emp, b) {
  var year = String(b.year || new Date().getFullYear());
  var mias = leer(HOJAS.ausencias).filter(function (a) {
    return String(a.trabajador).trim() === emp.nombre &&
           normFecha(a.fecha_inicio).slice(0, 4) === year;
  }).map(limpiarAusencia);
  return { ok: true, ausencias: mias, saldo: saldoVacaciones(emp.nombre, year, Number(emp.vacaciones_anuales || 0)) };
}

function limpiarAusencia(a) {
  return {
    id: a.id, ts: String(a.ts_solicitud), trabajador: a.trabajador, tipo: a.tipo,
    desde: normFecha(a.fecha_inicio), hasta: normFecha(a.fecha_fin),
    dias: Number(a.dias || 0), medioDia: String(a.medio_dia).toUpperCase() === 'SI',
    motivo: a.motivo, estado: String(a.estado).toUpperCase(),
    validador: a.validador, comentario: a.comentario
  };
}

function ausenciasEquipo(b) {
  var year = String(b.year || new Date().getFullYear());
  var filas = leer(HOJAS.ausencias).filter(function (a) {
    return normFecha(a.fecha_inicio).slice(0, 4) === year;
  }).map(limpiarAusencia);
  return { ok: true, ausencias: filas };
}

function validarAusencia(dir, b) {
  var id = String(b.id || '');
  var decision = String(b.decision || '').toUpperCase(); // APROBADA | DENEGADA
  if (['APROBADA', 'DENEGADA'].indexOf(decision) < 0) return { ok: false, error: 'DECISION_INVALIDA' };
  var filas = leer(HOJAS.ausencias);
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i].id) !== id) continue;
    var h = hoja(HOJAS.ausencias);
    h.getRange(filas[i]._fila, 11).setValue(decision);
    h.getRange(filas[i]._fila, 12).setValue(dir.nombre);
    h.getRange(filas[i]._fila, 13).setValue(new Date().toISOString());
    h.getRange(filas[i]._fila, 14).setValue(String(b.comentario || ''));
    auditar(dir.nombre, 'VALIDA_AUSENCIA', id + ' → ' + decision);
    notificarAusencia(filas[i], decision, dir.nombre);
    return { ok: true };
  }
  return { ok: false, error: 'NO_ENCONTRADA' };
}

function notificarAusencia(fila, decision, validador) {
  try {
    if (!fila.email) return;
    MailApp.sendEmail({
      to: String(fila.email),
      subject: 'Tu solicitud de ' + fila.tipo + ' ha sido ' + decision.toLowerCase(),
      body: 'Hola ' + fila.trabajador + ',\n\n' +
            'Tu solicitud de ' + fila.tipo + ' del ' + normFecha(fila.fecha_inicio) +
            ' al ' + normFecha(fila.fecha_fin) + ' (' + fila.dias + ' días) ha sido ' +
            decision.toLowerCase() + ' por ' + validador + '.\n\n— DC Personas'
    });
  } catch (e) {}
}

// ── TAREAS / PROYECTOS ───────────────────────────────────────────────────────
function imputarTarea(emp, b) {
  var minutos = Number(b.minutos || 0);
  if (minutos <= 0) return { ok: false, error: 'MINUTOS_INVALIDOS' };
  var id = uid('T');
  hoja(HOJAS.tareas).appendRow([
    id, new Date().toISOString(), emp.nombre, String(b.fecha || fmtFecha(ahora())),
    String(b.proyecto || ''), String(b.tarea || ''), minutos, String(b.nota || '')
  ]);
  return { ok: true, id: id };
}

function misTareas(emp, b) {
  var desde = String(b.desde || '1900-01-01'), hasta = String(b.hasta || '2999-12-31');
  var filas = leer(HOJAS.tareas).filter(function (t) {
    var fe = normFecha(t.fecha);
    return String(t.trabajador).trim() === emp.nombre && fe >= desde && fe <= hasta;
  }).map(function (t) {
    return { id: t.id, fecha: normFecha(t.fecha), proyecto: t.proyecto, tarea: t.tarea,
             minutos: Number(t.minutos || 0), nota: t.nota };
  });
  return { ok: true, tareas: filas };
}

// ── DOCUMENTOS ───────────────────────────────────────────────────────────────
function misDocumentos(emp) {
  var filas = leer(HOJAS.documentos).filter(function (d) {
    var t = String(d.trabajador).trim();
    return t === emp.nombre || t === '*' || t === 'TODOS';
  }).map(function (d) {
    return { id: d.id, tipo: d.tipo, nombre: d.nombre, url: d.url, fecha: normFecha(d.fecha),
             requiereFirma: String(d.requiere_firma).toUpperCase() === 'SI',
             firmado: d.firmado_ts ? String(d.firmado_ts) : '' };
  });
  return { ok: true, documentos: filas };
}

function firmarDocumento(emp, b) {
  var id = String(b.id || '');
  var filas = leer(HOJAS.documentos);
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i].id) !== id) continue;
    var t = String(filas[i].trabajador).trim();
    if (t !== emp.nombre && t !== '*' && t !== 'TODOS') return denegado();
    hoja(HOJAS.documentos).getRange(filas[i]._fila, 8).setValue(new Date().toISOString());
    auditar(emp.nombre, 'FIRMA_DOCUMENTO', id);
    return { ok: true };
  }
  return { ok: false, error: 'NO_ENCONTRADO' };
}

function subirDocumento(dir, b) {
  var id = uid('D');
  hoja(HOJAS.documentos).appendRow([
    id, String(b.trabajador || '*'), String(b.tipo || 'General'), String(b.nombre || ''),
    String(b.url || ''), fmtFecha(ahora()), b.requiereFirma ? 'SI' : 'NO', ''
  ]);
  auditar(dir.nombre, 'ALTA_DOCUMENTO', id + ' → ' + b.trabajador);
  return { ok: true, id: id };
}

// ── DIRECCIÓN: informes e incidencias ────────────────────────────────────────
function informe(b) {
  var desde = String(b.desde || '1900-01-01'), hasta = String(b.hasta || '2999-12-31');
  var filas = leer(HOJAS.fichajes).filter(function (f) {
    var fe = normFecha(f.fecha);
    return fe >= desde && fe <= hasta && (!b.trabajador || String(f.trabajador).trim() === String(b.trabajador));
  }).map(limpiarFichaje);
  return { ok: true, fichajes: filas, desde: desde, hasta: hasta };
}

function incidencias(b) {
  var desde = String(b.desde || fmtFecha(ahora())), hasta = String(b.hasta || fmtFecha(ahora()));
  var porClave = {};
  leer(HOJAS.fichajes).forEach(function (f) {
    var fe = normFecha(f.fecha);
    if (fe < desde || fe > hasta) return;
    var k = String(f.trabajador).trim() + '|' + fe;
    (porClave[k] = porClave[k] || []).push(f);
  });
  var out = [];
  Object.keys(porClave).forEach(function (k) {
    var evs = porClave[k].sort(function (a, c) { return String(a.ts_iso) < String(c.ts_iso) ? -1 : 1; });
    var partes = k.split('|');
    var tipos = evs.map(function (e) { return String(e.tipo).trim(); });
    var minutos = minutosTrabajados(evs);
    if (tipos.indexOf('SALIDA') < 0) out.push({ trabajador: partes[0], fecha: partes[1], tipo: 'SIN_SALIDA', detalle: 'Jornada sin fichaje de salida' });
    if (minutos > 9 * 60)  out.push({ trabajador: partes[0], fecha: partes[1], tipo: 'JORNADA_LARGA', detalle: (minutos / 60).toFixed(1) + ' h' });
    if (minutos > 0 && minutos < 60) out.push({ trabajador: partes[0], fecha: partes[1], tipo: 'JORNADA_CORTA', detalle: (minutos / 60).toFixed(1) + ' h' });
  });
  return { ok: true, incidencias: out };
}

function minutosTrabajados(evs) {
  var total = 0, ini = null, enPausa = false, pausaIni = null;
  evs.forEach(function (e) {
    var t = String(e.tipo).trim(), d = new Date(String(e.ts_iso));
    if (t === 'ENTRADA') ini = d;
    if (t === 'PAUSA_INI' && ini) { pausaIni = d; enPausa = true; }
    if (t === 'PAUSA_FIN' && enPausa) { total -= (d - pausaIni) / 60000; enPausa = false; }
    if (t === 'SALIDA' && ini) { total += (d - ini) / 60000; ini = null; }
  });
  return Math.max(0, Math.round(total));
}

function altaEmpleado(dir, b) {
  if (buscarEmpleado(b.nombre)) return { ok: false, error: 'YA_EXISTE' };
  hoja(HOJAS.empleados).appendRow([
    String(b.nombre || ''), String(b.email || ''), String(b.pin || ''),
    String(b.rol || 'EMPLEADO'), String(b.departamento || ''), String(b.oficina || ''),
    String(b.horario_id || 'STD'), fmtFecha(ahora()), Number(b.vacaciones_anuales || 23), 'SI'
  ]);
  auditar(dir.nombre, 'ALTA_EMPLEADO', String(b.nombre));
  return { ok: true };
}

// ── SETUP INICIAL ────────────────────────────────────────────────────────────
/**
 * Ejecutar UNA VEZ desde el editor de Apps Script (Ejecutar → setupInicial).
 * Crea las hojas con sus cabeceras y datos semilla.
 */
function setupInicial() {
  Object.keys(CABECERAS).forEach(function (n) {
    var h = hoja(n);
    if (h.getLastRow() === 0) h.appendRow(CABECERAS[n]);
  });
  var hHor = hoja(HOJAS.horarios);
  if (hHor.getLastRow() < 2) {
    hHor.appendRow(['STD', 'Jornada estándar', '09:00-18:00', '09:00-18:00', '09:00-18:00', '09:00-18:00', '09:00-15:00', '', '', 60, 40]);
    hHor.appendRow(['INT', 'Jornada intensiva', '08:00-15:00', '08:00-15:00', '08:00-15:00', '08:00-15:00', '08:00-15:00', '', '', 30, 35]);
  }
  if (!PropertiesService.getScriptProperties().getProperty('SECRET')) {
    PropertiesService.getScriptProperties().setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  }
  return 'Hojas creadas. Recuerda rellenar Empleados y desplegar como Aplicación web.';
}

function setupHojas(b) {
  if (String(b.clave || '') !== 'DC-SETUP') return denegado();
  return { ok: true, mensaje: setupInicial() };
}

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
  auditoria:  'Auditoria',
  turnos:        'Turnos',
  centros:       'Centros',
  compensaciones:'Compensaciones',
  objetivos:     'Objetivos',
  evaluaciones:  'Evaluaciones',
  encuestas:     'Encuestas',
  respuestas:    'Respuestas',
  publicaciones: 'Publicaciones',
  vacantes:      'Vacantes',
  candidatos:    'Candidatos',
  checklists:    'Checklists',
  tiposAusencia: 'TiposAusencia',
  intentos:      'Intentos'
};

var CABECERAS = {
  Empleados:  ['nombre','email','pin','rol','departamento','oficina','horario_id','fecha_alta','vacaciones_anuales','activo','telefono','dni','coste_hora','empresa','responsable','fecha_baja'],
  Fichajes:   ['id','ts_iso','fecha','hora','trabajador','email','tipo','lat','lng','precision_m','dispositivo','origen','motivo','autor','modalidad','centro','hash_prev','hash'],
  Ausencias:  ['id','ts_solicitud','trabajador','email','tipo','fecha_inicio','fecha_fin','dias','medio_dia','motivo','estado','validador','ts_validacion','comentario','justificante','dias_arrastre'],
  Horarios:   ['horario_id','nombre','lun','mar','mie','jue','vie','sab','dom','pausa_min','horas_semana'],
  Festivos:   ['fecha','nombre','ambito'],
  Tareas:     ['id','ts','trabajador','fecha','proyecto','tarea','minutos','nota'],
  Documentos: ['id','trabajador','tipo','nombre','url','fecha','requiere_firma','firmado_ts'],
  Auditoria:  ['ts','actor','accion','detalle','ip'],
  Turnos:         ['id','trabajador','desde','hasta','horario_id','nota','autor','ts'],
  Centros:        ['id','nombre','direccion','lat','lng','radio_m','activo'],
  Compensaciones: ['id','trabajador','fecha','minutos','tipo','nota','autor','ts'],
  Objetivos:      ['id','trabajador','titulo','descripcion','metrica','meta','actual','periodo','peso','estado','valoracion','comentario','autor','ts'],
  Evaluaciones:   ['id','campana','trabajador','evaluador','competencia','nota_auto','nota_manager','comentario_auto','comentario_manager','estado','ts'],
  Encuestas:      ['id','titulo','descripcion','preguntas','desde','hasta','anonima','activa','autor','ts'],
  Respuestas:     ['id','encuesta_id','trabajador','respuestas','ts'],
  Publicaciones:  ['id','ts','autor','categoria','titulo','cuerpo','fijado','destinatarios'],
  Vacantes:       ['id','titulo','departamento','oficina','descripcion','estado','autor','ts'],
  Candidatos:     ['id','vacante_id','nombre','email','telefono','fase','valoracion','nota','cv_url','ts'],
  Checklists:     ['id','trabajador','tipo','tarea','responsable','fecha_limite','hecho_ts','hecho_por','orden'],
  TiposAusencia:  ['tipo','dias_anuales','cuenta_saldo','requiere_justificante','arrastrable','color','activo'],
  Intentos:       ['ts','nombre','ip','resultado']
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
  var p = (e && e.parameter) || {};

  // Feed de calendario por suscripción (Google Calendar / Outlook)
  if (p.ics) {
    var ics = icsAusencias(p.ics);
    if (!ics) return ContentService.createTextOutput('Token no válido').setMimeType(ContentService.MimeType.TEXT);
    return ContentService.createTextOutput(ics).setMimeType(ContentService.MimeType.ICAL);
  }

  // API de lectura para otras herramientas (clave en Propiedades del script)
  if (p.api) {
    var clave = PropertiesService.getScriptProperties().getProperty('API_KEY');
    if (!clave || p.api !== clave) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'CLAVE_INVALIDA' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var recurso = String(p.recurso || 'fichajes');
    var permitidos = { fichajes: HOJAS.fichajes, ausencias: HOJAS.ausencias,
                       empleados: HOJAS.empleados, tareas: HOJAS.tareas };
    if (!permitidos[recurso]) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'RECURSO_INVALIDO' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var datos = leer(permitidos[recurso]);
    if (recurso === 'empleados') datos = datos.map(function (x) { delete x.pin; return x; });
    return ContentService.createTextOutput(JSON.stringify({ ok: true, recurso: recurso, datos: datos }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Validación de ausencias desde el email, con enlace firmado
  if (p.v) return paginaValidacion(p.v, p.d);

  return ContentService.createTextOutput(JSON.stringify({ ok: true, servicio: 'DC Personas', version: 3 }))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ── Validación por enlace firmado ───────────────────────────────────────── */
function tokenValidacion(idAusencia, validador) {
  var exp = Date.now() + 14 * 86400000;   // el enlace caduca a los 14 días
  var payload = Utilities.base64EncodeWebSafe('VAL|' + idAusencia + '|' + validador + '|' + exp);
  return payload + '.' + firmar(payload);
}

function paginaValidacion(token, decision) {
  var partes = String(token).split('.');
  if (partes.length !== 2 || firmar(partes[0]) !== partes[1]) return paginaHtml('Enlace no válido', 'Este enlace no es correcto o ha sido manipulado.', false);
  var claro = Utilities.newBlob(Utilities.base64DecodeWebSafe(partes[0])).getDataAsString().split('|');
  if (claro[0] !== 'VAL') return paginaHtml('Enlace no válido', 'Este enlace no sirve para validar ausencias.', false);
  if (Number(claro[3]) < Date.now()) return paginaHtml('Enlace caducado', 'Entra en la app para resolver la solicitud.', false);

  var id = claro[1], validador = buscarEmpleado(claro[2]);
  if (!validador) return paginaHtml('Sin permisos', 'La persona que valida ya no está de alta.', false);

  var fila = leer(HOJAS.ausencias).filter(function (a) { return String(a.id) === id; })[0];
  if (!fila) return paginaHtml('Solicitud no encontrada', 'Puede que se haya cancelado.', false);
  if (String(fila.estado).toUpperCase() !== 'PENDIENTE') {
    return paginaHtml('Ya estaba resuelta',
      'Esta solicitud de <b>' + fila.trabajador + '</b> figura como <b>' + String(fila.estado).toLowerCase() +
      '</b>' + (fila.validador ? ', resuelta por ' + fila.validador : '') + '.', false);
  }

  var dec = String(decision || '').toUpperCase();
  if (dec !== 'APROBADA' && dec !== 'DENEGADA') {
    return paginaHtml('Falta la decisión', 'Usa uno de los dos botones del correo.', false);
  }

  validarAusencia(validador, { id: id, decision: dec, comentario: 'Resuelta desde el correo' });
  return paginaHtml(dec === 'APROBADA' ? 'Solicitud aprobada' : 'Solicitud denegada',
    '<b>' + fila.trabajador + '</b> — ' + fila.tipo + ' del ' + normFecha(fila.fecha_inicio) +
    ' al ' + normFecha(fila.fecha_fin) + ' (' + fila.dias + ' días).<br><br>' +
    'Ya está notificado por correo. Puedes cerrar esta ventana.', dec === 'APROBADA');
}

function paginaHtml(titulo, cuerpo, bien) {
  var color = bien ? '#2F6B4F' : '#0E3946';
  return HtmlService.createHtmlOutput(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + titulo + '</title>' +
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:460px;margin:12vh auto;padding:0 22px;color:#243138">' +
    '<div style="border-top:3px solid ' + color + ';padding-top:22px">' +
    '<div style="font-family:Georgia,serif;font-size:16px;letter-spacing:4px;text-transform:uppercase;color:#0E3946">Durán Carasso</div>' +
    '<h1 style="font-family:Georgia,serif;font-weight:400;font-size:25px;color:' + color + ';margin:18px 0 12px">' + titulo + '</h1>' +
    '<div style="font-size:14px;line-height:1.7">' + cuerpo + '</div></div></div>'
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function router(b) {
  var a = b.action;
  if (a === 'ping')       return { ok: true, hora: new Date().toISOString() };
  if (a === 'auth')       return auth(b);
  if (a === 'setup')      return setupHojas(b);
  if (a === 'listaEmpleados') return listaEmpleados(b);
  if (a === 'estadoEquipoPublico') return estadoEquipoPublico();

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
    case 'miPerfil':        return miPerfil(emp);
    case 'actualizarPerfil':return actualizarPerfil(emp, b);
    case 'cambiarPin':      return cambiarPin(emp, b);
    case 'misObjetivos':    return misObjetivos(emp);
    case 'avanzarObjetivo': return avanzarObjetivo(emp, b);
    case 'miEvaluacion':    return miEvaluacion(emp, b);
    case 'autoevaluar':     return autoevaluar(emp, b);
    case 'encuestasAbiertas': return encuestasAbiertas(emp);
    case 'responderEncuesta': return responderEncuesta(emp, b);
    case 'publicaciones':   return publicaciones(emp);
    case 'miChecklist':     return miChecklist(emp);
    case 'marcarChecklist': return marcarChecklist(emp, b);
    case 'miBolsa':         return miBolsa(emp, b);

    // ── Solo dirección ──
    case 'validarAusencia': return esDir ? validarAusencia(emp, b) : denegado();
    case 'corregirFichaje': return esDir ? corregirFichaje(emp, b)  : denegado();
    case 'informe':         return esDir ? informe(b)               : denegado();
    case 'incidencias':     return esDir ? incidencias(b)           : denegado();
    case 'verificarCadena': return esDir ? verificarCadena()        : denegado();
    case 'altaEmpleado':    return esDir ? altaEmpleado(emp, b)     : denegado();
    case 'subirDocumento':  return esDir ? subirDocumento(emp, b)   : denegado();
    case 'guardarTurno':    return esDir ? guardarTurno(emp, b)     : denegado();
    case 'borrarTurno':     return esDir ? borrarTurno(emp, b)      : denegado();
    case 'turnosEquipo':    return esDir ? turnosEquipo(b)          : denegado();
    case 'guardarCentro':   return esDir ? guardarCentro(emp, b)    : denegado();
    case 'centros':         return esDir ? { ok: true, centros: leer(HOJAS.centros) } : denegado();
    case 'compensar':       return esDir ? compensar(emp, b)        : denegado();
    case 'bolsaEquipo':     return esDir ? bolsaEquipo(b)           : denegado();
    case 'guardarObjetivo': return esDir ? guardarObjetivo(emp, b)  : denegado();
    case 'valorarObjetivo': return esDir ? valorarObjetivo(emp, b)  : denegado();
    case 'objetivosEquipo': return esDir ? objetivosEquipo(b)       : denegado();
    case 'lanzarEvaluacion':return esDir ? lanzarEvaluacion(emp, b) : denegado();
    case 'evaluarManager':  return esDir ? evaluarManager(emp, b)   : denegado();
    case 'evaluacionesEquipo': return esDir ? evaluacionesEquipo(b) : denegado();
    case 'guardarEncuesta': return esDir ? guardarEncuesta(emp, b)  : denegado();
    case 'encuestasTodas':  return esDir ? { ok: true, encuestas: leerEncuestas() } : denegado();
    case 'resultadosEncuesta': return esDir ? resultadosEncuesta(b) : denegado();
    case 'publicar':        return esDir ? publicar(emp, b)         : denegado();
    case 'borrarPublicacion': return esDir ? borrarPublicacion(emp, b) : denegado();
    case 'vacantes':        return esDir ? vacantesYcandidatos()    : denegado();
    case 'guardarVacante':  return esDir ? guardarVacante(emp, b)   : denegado();
    case 'guardarCandidato':return esDir ? guardarCandidato(emp, b) : denegado();
    case 'moverCandidato':  return esDir ? moverCandidato(emp, b)   : denegado();
    case 'checklistEquipo': return esDir ? checklistEquipo(b)       : denegado();
    case 'crearChecklist':  return esDir ? crearChecklist(emp, b)   : denegado();
    case 'analytics':       return esDir ? analytics(b)             : denegado();
    case 'tokenCalendario': return tokenCalendario(emp, b);
    case 'auditoria':       return esDir ? auditoria(b)           : denegado();
    case 'editarEmpleado':  return esDir ? editarEmpleado(emp, b) : denegado();
    case 'resetPin':        return esDir ? resetPin(emp, b)       : denegado();
    case 'guardarTipoAusencia': return esDir ? guardarTipoAusencia(emp, b) : denegado();
    case 'tiposAusencia':   return { ok: true, tipos: tiposAusencia() };
  }
  return { ok: false, error: 'ACCION_DESCONOCIDA: ' + a };
}

function denegado() { return { ok: false, error: 'SIN_PERMISOS' }; }

/**
 * Estado del equipo para el widget del CRM. Devuelve solo nombre y estado,
 * nunca fichajes ni datos personales, y hay que habilitarlo a propósito.
 */
function estadoEquipoPublico() {
  if (String(PropertiesService.getScriptProperties().getProperty('WIDGET_CRM') || 'NO').toUpperCase() !== 'SI') {
    return { ok: false, error: 'WIDGET_DESACTIVADO' };
  }
  return { ok: true, equipo: estadoEquipo().equipo.map(function (e) {
    return { nombre: e.nombre, estado: e.estado };
  }) };
}

/** Lista pública para la pantalla de acceso. No expone PIN ni email. */
function listaEmpleados(b) {
  // Protegida con la clave de acceso del centro para no exponer la plantilla
  var clave = PropertiesService.getScriptProperties().getProperty('CLAVE_ACCESO');
  if (clave && String(b && b.clave || '') !== clave) return { ok: false, error: 'CLAVE_ACCESO_REQUERIDA' };
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

var MAX_INTENTOS = 5;          // intentos fallidos antes de bloquear
var VENTANA_BLOQUEO_MIN = 15;  // minutos que dura el bloqueo

/** El PIN nunca se guarda en claro: se almacena SHA-256(pin + salt). */
function hashPin(pin, salt) { return sha256(String(pin) + '|' + salt); }
function esHash(v) { return /^[0-9a-f]{64}$/.test(String(v).trim()); }

function intentosRecientes(nombre) {
  var limite = Date.now() - VENTANA_BLOQUEO_MIN * 60000;
  return leer(HOJAS.intentos).filter(function (i) {
    return String(i.nombre).trim() === nombre &&
           String(i.resultado).toUpperCase() === 'FALLIDO' &&
           new Date(String(i.ts)).getTime() > limite;
  }).length;
}
function registrarIntento(nombre, resultado) {
  try { hoja(HOJAS.intentos).appendRow([new Date().toISOString(), nombre, '', resultado]); } catch (e) {}
}

function auth(b) {
  var nombre = String(b.nombre || '').trim();
  var pin = String(b.pin || '').trim();
  var emp = buscarEmpleado(nombre);
  if (!emp)  return { ok: false, error: 'EMPLEADO_NO_ENCONTRADO' };
  if (String(emp.activo).toUpperCase() === 'NO') return { ok: false, error: 'EMPLEADO_INACTIVO' };

  if (intentosRecientes(nombre) >= MAX_INTENTOS) {
    auditar(nombre, 'LOGIN_BLOQUEADO', 'demasiados intentos');
    return { ok: false, error: 'CUENTA_BLOQUEADA', minutos: VENTANA_BLOQUEO_MIN };
  }

  var guardado = String(emp.pin).trim();
  var correcto = esHash(guardado) ? (hashPin(pin, nombre) === guardado) : (guardado === pin);
  if (!correcto) {
    registrarIntento(nombre, 'FALLIDO');
    auditar(nombre, 'LOGIN_FALLIDO', '');
    return { ok: false, error: 'PIN_INCORRECTO', restantes: MAX_INTENTOS - intentosRecientes(nombre) };
  }
  registrarIntento(nombre, 'OK');
  // Migración transparente: el primer acceso con PIN en claro lo convierte en hash
  if (!esHash(guardado)) escribirPin(emp, pin);
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

function escribirPin(emp, pin) {
  var h = hoja(HOJAS.empleados);
  var cols = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0].map(String);
  h.getRange(emp._fila, cols.indexOf('pin') + 1).setValue(hashPin(pin, emp.nombre));
}

function buscarEmpleado(nombre) {
  var todos = leer(HOJAS.empleados);
  for (var i = 0; i < todos.length; i++) {
    if (String(todos[i].nombre).trim() === String(nombre).trim()) return todos[i];
  }
  return null;
}

// ── BOOTSTRAP ────────────────────────────────────────────────────────────────
function turnosDe(nombre) {
  return leer(HOJAS.turnos).filter(function (t) { return String(t.trabajador).trim() === nombre; })
    .map(function (t) {
      return { id: t.id, desde: normFecha(t.desde), hasta: normFecha(t.hasta),
               horario_id: t.horario_id, nota: t.nota };
    });
}

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
    centros: leer(HOJAS.centros).filter(function (c) { return String(c.activo).toUpperCase() !== 'NO'; })
      .map(function (c) { return { id: c.id, nombre: c.nombre, direccion: c.direccion,
                                   lat: Number(c.lat), lng: Number(c.lng), radio_m: Number(c.radio_m || 150) }; }),
    turnos: turnosDe(emp.nombre),
    tiposAusencia: tiposAusencia(),
    exigirCentro: exigeCentro(),
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
  return String(h.getRange(n, 18).getValue() || 'GENESIS');
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

    var centro = centroDe(b.lat, b.lng);
    if (tipo === 'ENTRADA' && exigeCentro() && !centro && b.lat) {
      return { ok: false, error: 'FUERA_DE_CENTRO' };
    }

    hoja(HOJAS.fichajes).appendRow([
      id, d.toISOString(), fmtFecha(d), fmtHora(d), emp.nombre, emp.email, tipo,
      b.lat || '', b.lng || '', b.acc || '', b.dispositivo || '', 'APP', '', '',
      String(b.modalidad || 'OFICINA'), centro ? centro.nombre : '',
      prev, hash
    ]);

    var nuevo = { ENTRADA: 'TRABAJANDO', PAUSA_INI: 'PAUSA', PAUSA_FIN: 'TRABAJANDO', SALIDA: 'FUERA' }[tipo];
    return { ok: true, id: id, ts: d.toISOString(), fecha: fmtFecha(d), hora: fmtHora(d), estado: nuevo, hash: hash, centro: centro ? centro.nombre : '' };
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
    lat: f.lat, lng: f.lng, origen: f.origen, motivo: f.motivo, autor: f.autor,
    modalidad: f.modalidad || 'OFICINA', centro: f.centro || ''
  };
}

/* ── Geovallas ─────────────────────────────────────────────────────────── */
function exigeCentro() {
  return String(PropertiesService.getScriptProperties().getProperty('EXIGIR_CENTRO') || 'NO').toUpperCase() === 'SI';
}
function centroDe(lat, lng) {
  if (!lat || !lng) return null;
  var centros = leer(HOJAS.centros).filter(function (c) { return String(c.activo).toUpperCase() !== 'NO'; });
  for (var i = 0; i < centros.length; i++) {
    var d = distanciaM(Number(lat), Number(lng), Number(centros[i].lat), Number(centros[i].lng));
    if (d <= Number(centros[i].radio_m || 150)) return { nombre: centros[i].nombre, distancia: Math.round(d) };
  }
  return null;
}
function distanciaM(la1, lo1, la2, lo2) {
  var R = 6371000, rad = Math.PI / 180;
  var dLa = (la2 - la1) * rad, dLo = (lo2 - lo1) * rad;
  var a = Math.sin(dLa / 2) * Math.sin(dLa / 2) +
          Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
    '', '', '', '', 'CORRECCION', motivo, dir.nombre, '', '', prev, hash
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
  var year = Number(desde.slice(0, 4));
  var def = tiposAusencia().filter(function (t) { return t.tipo === tipo; })[0];

  if (def && def.requiereJustificante && !b.justificante) {
    return { ok: false, error: 'JUSTIFICANTE_OBLIGATORIO' };
  }

  // El arrastre del año anterior se gasta primero, si sigue en plazo
  var arrastreUsado = 0;
  if (def && def.cuentaSaldo) {
    var s = saldos(emp, year).filter(function (x) { return x.tipo === tipo; })[0];
    if (s) {
      if (dias > s.disponibles) {
        return { ok: false, error: 'SIN_DIAS', disponibles: s.disponibles, solicitados: dias };
      }
      if (s.arrastreVigente && s.arrastre > 0 && desde <= s.limiteArrastre) {
        arrastreUsado = Math.min(dias, s.arrastre);
      }
    }
  }

  var url = '';
  if (b.justificante) {
    var g = guardarJustificante(emp, b.justificante, tipo + ' ' + desde);
    if (!g.ok) return g;
    url = g.url;
  }

  var id = uid('A');
  hoja(HOJAS.ausencias).appendRow([
    id, new Date().toISOString(), emp.nombre, emp.email, tipo, desde, hasta,
    dias, medio, String(b.motivo || ''), 'PENDIENTE', '', '', '', url, arrastreUsado
  ]);
  auditar(emp.nombre, 'SOLICITUD_AUSENCIA', tipo + ' ' + desde + '→' + hasta + ' (' + dias + 'd' +
    (arrastreUsado ? ', ' + arrastreUsado + ' del año anterior' : '') + ')');
  avisarValidador(emp, { id: id, tipo: tipo, desde: desde, hasta: hasta, dias: dias,
                         motivo: b.motivo, justificante: url });
  return { ok: true, id: id, dias: dias, arrastre: arrastreUsado };

}

/** Guarda el certificado en una carpeta de Drive y devuelve su enlace. */
function guardarJustificante(emp, j, titulo) {
  try {
    var datos = String(j.datos || '');
    var coma = datos.indexOf(',');
    if (coma < 0) return { ok: false, error: 'ARCHIVO_INVALIDO' };
    var bytes = Utilities.base64Decode(datos.slice(coma + 1));
    if (bytes.length > 8 * 1024 * 1024) return { ok: false, error: 'ARCHIVO_DEMASIADO_GRANDE' };

    var idCarpeta = PropertiesService.getScriptProperties().getProperty('CARPETA_JUSTIFICANTES');
    var carpeta;
    if (idCarpeta) { carpeta = DriveApp.getFolderById(idCarpeta); }
    else {
      var busca = DriveApp.getFoldersByName('DC Personas · Justificantes');
      carpeta = busca.hasNext() ? busca.next() : DriveApp.createFolder('DC Personas · Justificantes');
      PropertiesService.getScriptProperties().setProperty('CARPETA_JUSTIFICANTES', carpeta.getId());
    }
    var blob = Utilities.newBlob(bytes, j.tipoMime || 'application/octet-stream',
      emp.nombre + ' · ' + titulo + ' · ' + (j.nombre || 'justificante'));
    var archivo = carpeta.createFile(blob);
    return { ok: true, url: archivo.getUrl() };
  } catch (e) {
    return { ok: false, error: 'ERROR_AL_GUARDAR: ' + e.message };
  }
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

/* ── Tipos de ausencia ───────────────────────────────────────────────────── */
var TIPOS_POR_DEFECTO = [
  ['Vacaciones',            23, 'SI', 'NO', 'SI', '#E8C9C4', 'SI'],
  ['Asuntos propios',        4, 'SI', 'NO', 'NO', '#C7E4DA', 'SI'],
  ['Permiso Navidad 24',     1, 'SI', 'NO', 'NO', '#C7E4DA', 'SI'],
  ['Permiso Navidad 31',     1, 'SI', 'NO', 'NO', '#C7E4DA', 'SI'],
  ['Tarde día cumpleaños',   1, 'SI', 'NO', 'NO', '#F0E0BC', 'SI'],
  ['Permiso retribuido',     0, 'NO', 'SI', 'NO', '#C7E4DA', 'SI'],
  ['Formación',              0, 'NO', 'NO', 'NO', '#D5D2E8', 'SI'],
  ['Mudanza',                1, 'NO', 'SI', 'NO', '#D5D2E8', 'SI'],
  ['Matrimonio',            15, 'NO', 'SI', 'NO', '#D5D2E8', 'SI'],
  ['Nacimiento hijo/a',      0, 'NO', 'SI', 'NO', '#D5D2E8', 'SI'],
  ['Fallecimiento familiar', 0, 'NO', 'SI', 'NO', '#D5D2E8', 'SI'],
  ['Otros',                  0, 'NO', 'NO', 'NO', '#DEDCD6', 'SI']
];

function tiposAusencia() {
  var filas = leer(HOJAS.tiposAusencia);
  if (!filas.length) {
    hoja(HOJAS.tiposAusencia).getRange(2, 1, TIPOS_POR_DEFECTO.length, 7).setValues(TIPOS_POR_DEFECTO);
    filas = leer(HOJAS.tiposAusencia);
  }
  return filas.filter(function (t) { return String(t.activo).toUpperCase() !== 'NO'; })
    .map(function (t) {
      return { tipo: String(t.tipo).trim(), dias: Number(t.dias_anuales || 0),
               cuentaSaldo: String(t.cuenta_saldo).toUpperCase() === 'SI',
               requiereJustificante: String(t.requiere_justificante).toUpperCase() === 'SI',
               arrastrable: String(t.arrastrable).toUpperCase() === 'SI',
               color: t.color || '#DEDCD6' };
    });
}

function limiteArrastre(year) {
  var mmdd = PropertiesService.getScriptProperties().getProperty('LIMITE_ARRASTRE') || '03-31';
  return String(year) + '-' + mmdd;
}

/**
 * Días que una persona ha cargado a un año concreto.
 * Una solicitud hecha en enero puede cargarse al año anterior si consume
 * arrastre: por eso `dias_arrastre` se contabiliza en el año previo.
 */
function consumoDelAno(nombre, tipo, year, estados) {
  var total = 0;
  leer(HOJAS.ausencias).forEach(function (a) {
    if (String(a.trabajador).trim() !== nombre) return;
    if (String(a.tipo).trim() !== tipo) return;
    if (estados.indexOf(String(a.estado).toUpperCase()) < 0) return;
    var anoInicio = Number(normFecha(a.fecha_inicio).slice(0, 4));
    var arrastre = Number(a.dias_arrastre || 0);
    var dias = Number(a.dias || 0);
    if (anoInicio === year)      total += dias - arrastre;
    if (anoInicio === year + 1)  total += arrastre;
  });
  return total;
}

/**
 * Cupo del año, prorrateado si la persona entra o sale a mitad de año.
 * Ejemplo: alta el 1 de julio con 23 días → 23 × 184/365 ≈ 11,5 días.
 */
function cupoDe(emp, t, year) {
  var base = (t.tipo.toUpperCase().indexOf('VACAC') === 0)
    ? Number(emp.vacaciones_anuales || t.dias)
    : t.dias;
  if (!base) return 0;

  var iniAno = new Date(year + '-01-01T00:00:00');
  var finAno = new Date(year + '-12-31T00:00:00');
  var desde = iniAno, hasta = finAno;

  var alta = emp.fecha_alta ? new Date(normFecha(emp.fecha_alta) + 'T00:00:00') : null;
  if (alta && !isNaN(alta) && alta > desde) desde = alta;

  var baja = emp.fecha_baja ? new Date(normFecha(emp.fecha_baja) + 'T00:00:00') : null;
  if (baja && !isNaN(baja) && baja < hasta) hasta = baja;

  if (hasta < desde) return 0;                       // no estuvo de alta ese año
  var diasAno = Math.round((finAno - iniAno) / 86400000) + 1;
  var diasAlta = Math.round((hasta - desde) / 86400000) + 1;
  if (diasAlta >= diasAno) return base;              // año completo, sin prorrateo

  return Math.round(base * diasAlta / diasAno * 2) / 2;   // se redondea a medio día
}

function arrastreDisponible(emp, t, year) {
  if (!t.arrastrable) return 0;
  var cupoPrev = cupoDe(emp, t, year - 1);
  var gastadoPrev = consumoDelAno(emp.nombre, t.tipo, year - 1, ['APROBADA', 'PENDIENTE']);
  return Math.max(0, cupoPrev - gastadoPrev);
}

function saldos(emp, year) {
  return tiposAusencia().filter(function (t) { return t.cuentaSaldo; }).map(function (t) {
    var cupo = cupoDe(emp, t, year);
    var arr = arrastreDisponible(emp, t, year);
    var vigente = fmtFecha(ahora()) <= limiteArrastre(year);
    var cons = consumoDelAno(emp.nombre, t.tipo, year, ['APROBADA']);
    var pend = consumoDelAno(emp.nombre, t.tipo, year, ['PENDIENTE']);
    var completo = (t.tipo.toUpperCase().indexOf('VACAC') === 0)
      ? Number(emp.vacaciones_anuales || t.dias) : t.dias;
    return { tipo: t.tipo, totales: cupo, prorrateado: cupo !== completo, cupoCompleto: completo,
             arrastre: arr, arrastreVigente: vigente,
             limiteArrastre: limiteArrastre(year), consumidos: cons, pendientes: pend,
             disponibles: cupo + (vigente ? arr : 0) - cons - pend };
  });
}

/** Compatibilidad: el portal sigue mostrando el saldo de vacaciones. */
function saldoVacaciones(nombre, year, anuales) {
  var emp = buscarEmpleado(nombre);
  var v = saldos(emp, year).filter(function (s) { return s.tipo.toUpperCase().indexOf('VACAC') === 0; })[0];
  return v || { totales: anuales, arrastre: 0, consumidos: 0, pendientes: 0, disponibles: anuales };
}

function misAusencias(emp, b) {
  var year = String(b.year || new Date().getFullYear());
  var mias = leer(HOJAS.ausencias).filter(function (a) {
    return String(a.trabajador).trim() === emp.nombre &&
           normFecha(a.fecha_inicio).slice(0, 4) === year;
  }).map(limpiarAusencia);
  return { ok: true, ausencias: mias,
           saldo: saldoVacaciones(emp.nombre, year, Number(emp.vacaciones_anuales || 0)),
           saldos: saldos(emp, year), tipos: tiposAusencia() };
}

function limpiarAusencia(a) {
  return {
    id: a.id, ts: String(a.ts_solicitud), trabajador: a.trabajador, tipo: a.tipo,
    desde: normFecha(a.fecha_inicio), hasta: normFecha(a.fecha_fin),
    dias: Number(a.dias || 0), medioDia: String(a.medio_dia).toUpperCase() === 'SI',
    motivo: a.motivo, estado: String(a.estado).toUpperCase(),
    validador: a.validador, comentario: a.comentario,
    justificante: a.justificante || '', diasArrastre: Number(a.dias_arrastre || 0)
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

/** Avisa a quien debe validar, con dos botones que resuelven sin abrir la app. */
function avisarValidador(emp, sol) {
  var base = ScriptApp.getService().getUrl();
  var destinos = emp.responsable ? [String((buscarEmpleado(emp.responsable) || {}).email || '')] : [];
  destinos = destinos.filter(Boolean);
  if (!destinos.length) destinos = destinatariosDireccion();
  if (!destinos.length) return;

  var quien = emp.responsable || destinatariosDireccion()[0];
  var validador = emp.responsable ? emp.responsable :
    (leer(HOJAS.empleados).filter(function (e) { return String(e.rol).toUpperCase() === 'DIRECCION'; })[0] || {}).nombre;
  if (!validador) return;

  var t = tokenValidacion(sol.id, validador);
  var btn = function (texto, dec, color) {
    return '<a href="' + base + '?v=' + encodeURIComponent(t) + '&d=' + dec + '" ' +
      'style="display:inline-block;background:' + color + ';color:#fff;text-decoration:none;' +
      'padding:12px 26px;font-size:13px;letter-spacing:.5px;margin-right:10px">' + texto + '</a>';
  };

  enviar(destinos, 'Solicitud de ' + sol.tipo + ' · ' + emp.nombre,
    '<b>' + emp.nombre + '</b> pide <b>' + sol.tipo.toLowerCase() + '</b>:<br><br>' +
    'Del <b>' + sol.desde + '</b> al <b>' + sol.hasta + '</b> · ' + sol.dias + ' día(s)' +
    (sol.motivo ? '<br>Motivo: ' + sol.motivo : '') +
    (sol.justificante ? '<br><a href="' + sol.justificante + '">Ver justificante adjunto</a>' : '') +
    '<br><br>' + btn('Aprobar', 'APROBADA', '#2F6B4F') + btn('Denegar', 'DENEGADA', '#9E3F35') +
    '<br><br><span style="font-size:11px;color:#78837F">Los botones resuelven la solicitud sin entrar en la app. ' +
    'El enlace caduca en 14 días.</span>');
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

/* ── Auditoría (solo dirección) ─────────────────────────────────────────── */
function auditoria(b) {
  var filas = leer(HOJAS.auditoria).map(function (a) {
    return { ts: String(a.ts), actor: a.actor, accion: a.accion, detalle: a.detalle };
  }).reverse();
  var limite = Number(b.limite || 200);
  return { ok: true, registros: filas.slice(0, limite), total: filas.length };
}

/* ── Gestión de la plantilla (solo dirección) ───────────────────────────── */
var CAMPOS_ADMIN = ['email', 'rol', 'departamento', 'oficina', 'horario_id',
                    'vacaciones_anuales', 'activo', 'telefono', 'dni', 'coste_hora',
                    'empresa', 'responsable', 'fecha_alta', 'fecha_baja'];

function editarEmpleado(dir, b) {
  var emp = buscarEmpleado(b.nombre);
  if (!emp) return { ok: false, error: 'NO_ENCONTRADO' };
  var h = hoja(HOJAS.empleados);
  var cols = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0].map(String);
  var cambios = [];
  CAMPOS_ADMIN.forEach(function (campo) {
    if (b[campo] === undefined) return;
    var col = cols.indexOf(campo) + 1;
    if (col <= 0) return;
    var antes = String(h.getRange(emp._fila, col).getValue());
    if (antes === String(b[campo])) return;
    h.getRange(emp._fila, col).setValue(b[campo]);
    cambios.push(campo + ': "' + antes + '" → "' + b[campo] + '"');
  });
  if (cambios.length) auditar(dir.nombre, 'EDITA_EMPLEADO', b.nombre + ' — ' + cambios.join('; '));
  return { ok: true, cambios: cambios.length };
}

function resetPin(dir, b) {
  var emp = buscarEmpleado(b.nombre);
  if (!emp) return { ok: false, error: 'NO_ENCONTRADO' };
  var nuevo = String(b.pin || '').trim();
  if (!/^\d{4}$/.test(nuevo)) return { ok: false, error: 'PIN_INVALIDO' };
  escribirPin(emp, nuevo);
  // Levanta también el bloqueo por intentos fallidos
  var h = hoja(HOJAS.intentos);
  leer(HOJAS.intentos).forEach(function (i) {
    if (String(i.nombre).trim() === emp.nombre) h.getRange(i._fila, 4).setValue('ANULADO');
  });
  auditar(dir.nombre, 'RESET_PIN', b.nombre);
  return { ok: true };
}

function guardarTipoAusencia(dir, b) {
  if (!b.tipo) return { ok: false, error: 'DATOS_INCOMPLETOS' };
  var filas = leer(HOJAS.tiposAusencia);
  var fila = [String(b.tipo), Number(b.dias || 0), b.cuentaSaldo ? 'SI' : 'NO',
              b.requiereJustificante ? 'SI' : 'NO', b.arrastrable ? 'SI' : 'NO',
              String(b.color || '#DEDCD6'), b.activo === false ? 'NO' : 'SI'];
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i].tipo).trim() !== String(b.tipo).trim()) continue;
    hoja(HOJAS.tiposAusencia).getRange(filas[i]._fila, 1, 1, 7).setValues([fila]);
    auditar(dir.nombre, 'EDITA_TIPO_AUSENCIA', String(b.tipo));
    return { ok: true };
  }
  hoja(HOJAS.tiposAusencia).appendRow(fila);
  auditar(dir.nombre, 'ALTA_TIPO_AUSENCIA', String(b.tipo));
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
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRET'))  props.setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  if (!props.getProperty('API_KEY')) props.setProperty('API_KEY', Utilities.getUuid());
  if (!props.getProperty('EXIGIR_CENTRO')) props.setProperty('EXIGIR_CENTRO', 'NO');
  if (!props.getProperty('LIMITE_ARRASTRE')) props.setProperty('LIMITE_ARRASTRE', '03-31');
  tiposAusencia();   // siembra la tabla de tipos con sus cupos

  var hCen = hoja(HOJAS.centros);
  if (hCen.getLastRow() < 2) {
    hCen.appendRow(['CT-BCN', 'Barcelona', 'Av. Diagonal, Barcelona', 41.3947, 2.1503, 150, 'SI']);
    hCen.appendRow(['CT-SIT', 'Sitges',    'Sitges',                  41.2371, 1.8055, 150, 'SI']);
    hCen.appendRow(['CT-AND', 'Andorra',   'Andorra la Vella',        42.5063, 1.5218, 150, 'SI']);
  }
  return 'Hojas creadas. Rellena Empleados, revisa Centros y despliega como Aplicación web.';
}

function setupHojas(b) {
  if (String(b.clave || '') !== 'DC-SETUP') return denegado();
  return { ok: true, mensaje: setupInicial() };
}

/* ═══════════════════════════════════════════════════════════════════════════
   MÓDULOS AMPLIADOS
   ═══════════════════════════════════════════════════════════════════════════ */

// ── PERFIL ───────────────────────────────────────────────────────────────────
var CAMPOS_EDITABLES = { telefono: 11, dni: 12 };

function miPerfil(emp) {
  return { ok: true, perfil: {
    nombre: emp.nombre, email: emp.email, rol: emp.rol, departamento: emp.departamento,
    oficina: emp.oficina, empresa: emp.empresa || '', horario_id: emp.horario_id,
    fecha_alta: emp.fecha_alta ? String(emp.fecha_alta).slice(0, 10) : '',
    vacaciones_anuales: Number(emp.vacaciones_anuales || 0),
    telefono: emp.telefono || '', dni: emp.dni || '', responsable: emp.responsable || ''
  }};
}

function actualizarPerfil(emp, b) {
  var h = hoja(HOJAS.empleados);
  var cols = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0].map(String);
  Object.keys(CAMPOS_EDITABLES).forEach(function (campo) {
    if (b[campo] === undefined) return;
    var col = cols.indexOf(campo) + 1;
    if (col > 0) h.getRange(emp._fila, col).setValue(String(b[campo]));
  });
  auditar(emp.nombre, 'ACTUALIZA_PERFIL', '');
  return { ok: true };
}

function cambiarPin(emp, b) {
  var actual = String(b.actual || '').trim(), nuevo = String(b.nuevo || '').trim();
  var guardado = String(emp.pin).trim();
  var ok = esHash(guardado) ? (hashPin(actual, emp.nombre) === guardado) : (guardado === actual);
  if (!ok) return { ok: false, error: 'PIN_ACTUAL_INCORRECTO' };
  if (!/^\d{4}$/.test(nuevo)) return { ok: false, error: 'PIN_INVALIDO' };
  if (nuevo === '0000' || nuevo === '1234') return { ok: false, error: 'PIN_DEBIL' };
  escribirPin(emp, nuevo);
  auditar(emp.nombre, 'CAMBIA_PIN', '');
  return { ok: true };
}

// ── TURNOS ───────────────────────────────────────────────────────────────────
function guardarTurno(dir, b) {
  var desde = String(b.desde || '').slice(0, 10), hasta = String(b.hasta || '').slice(0, 10);
  if (!b.trabajador || !desde || !hasta || !b.horario_id) return { ok: false, error: 'DATOS_INCOMPLETOS' };
  if (hasta < desde) return { ok: false, error: 'RANGO_INVALIDO' };
  var id = uid('TU');
  hoja(HOJAS.turnos).appendRow([id, String(b.trabajador), desde, hasta, String(b.horario_id),
                                String(b.nota || ''), dir.nombre, new Date().toISOString()]);
  auditar(dir.nombre, 'ASIGNA_TURNO', b.trabajador + ' ' + desde + '→' + hasta + ' ' + b.horario_id);
  return { ok: true, id: id };
}

function borrarTurno(dir, b) {
  var filas = leer(HOJAS.turnos);
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i].id) === String(b.id)) {
      hoja(HOJAS.turnos).deleteRow(filas[i]._fila);
      auditar(dir.nombre, 'BORRA_TURNO', String(b.id));
      return { ok: true };
    }
  }
  return { ok: false, error: 'NO_ENCONTRADO' };
}

function turnosEquipo(b) {
  var desde = String(b.desde || '1900-01-01'), hasta = String(b.hasta || '2999-12-31');
  var filas = leer(HOJAS.turnos).filter(function (t) {
    return normFecha(t.desde) <= hasta && normFecha(t.hasta) >= desde;
  }).map(function (t) {
    return { id: t.id, trabajador: t.trabajador, desde: normFecha(t.desde),
             hasta: normFecha(t.hasta), horario_id: t.horario_id, nota: t.nota };
  });
  return { ok: true, turnos: filas };
}

// ── CENTROS DE TRABAJO (geovallas) ───────────────────────────────────────────
function guardarCentro(dir, b) {
  if (!b.nombre || !b.lat || !b.lng) return { ok: false, error: 'DATOS_INCOMPLETOS' };
  if (b.id) {
    var filas = leer(HOJAS.centros);
    for (var i = 0; i < filas.length; i++) {
      if (String(filas[i].id) !== String(b.id)) continue;
      var h = hoja(HOJAS.centros);
      h.getRange(filas[i]._fila, 2, 1, 6).setValues([[String(b.nombre), String(b.direccion || ''),
        Number(b.lat), Number(b.lng), Number(b.radio_m || 150), b.activo === false ? 'NO' : 'SI']]);
      return { ok: true, id: b.id };
    }
  }
  var id = uid('CT');
  hoja(HOJAS.centros).appendRow([id, String(b.nombre), String(b.direccion || ''),
    Number(b.lat), Number(b.lng), Number(b.radio_m || 150), 'SI']);
  auditar(dir.nombre, 'ALTA_CENTRO', String(b.nombre));
  return { ok: true, id: id };
}

// ── BOLSA DE HORAS Y COMPENSACIONES ──────────────────────────────────────────
function compensar(dir, b) {
  var minutos = Number(b.minutos || 0);
  if (!b.trabajador || !minutos) return { ok: false, error: 'DATOS_INCOMPLETOS' };
  var tipo = String(b.tipo || 'DIA_LIBRE').toUpperCase(); // DIA_LIBRE | ECONOMICA | AJUSTE
  var id = uid('CO');
  hoja(HOJAS.compensaciones).appendRow([id, String(b.trabajador), String(b.fecha || fmtFecha(ahora())),
    minutos, tipo, String(b.nota || ''), dir.nombre, new Date().toISOString()]);
  auditar(dir.nombre, 'COMPENSA_HORAS', b.trabajador + ' ' + minutos + 'min ' + tipo);
  return { ok: true, id: id };
}

function compensacionesDe(nombre, year) {
  return leer(HOJAS.compensaciones).filter(function (c) {
    return String(c.trabajador).trim() === nombre &&
           (!year || normFecha(c.fecha).slice(0, 4) === String(year));
  }).map(function (c) {
    return { id: c.id, fecha: normFecha(c.fecha), minutos: Number(c.minutos || 0),
             tipo: String(c.tipo).toUpperCase(), nota: c.nota, autor: c.autor };
  });
}

function miBolsa(emp, b) {
  var year = String(b.year || new Date().getFullYear());
  return { ok: true, compensaciones: compensacionesDe(emp.nombre, year) };
}

function bolsaEquipo(b) {
  var year = String(b.year || new Date().getFullYear());
  var out = {};
  leer(HOJAS.compensaciones).forEach(function (c) {
    if (normFecha(c.fecha).slice(0, 4) !== year) return;
    var k = String(c.trabajador).trim();
    out[k] = (out[k] || 0) + Number(c.minutos || 0);
  });
  return { ok: true, compensado: out,
           detalle: leer(HOJAS.compensaciones).filter(function (c) {
             return normFecha(c.fecha).slice(0, 4) === year;
           }).map(function (c) {
             return { id: c.id, trabajador: c.trabajador, fecha: normFecha(c.fecha),
                      minutos: Number(c.minutos || 0), tipo: c.tipo, nota: c.nota };
           }) };
}

// ── OBJETIVOS ────────────────────────────────────────────────────────────────
function limpiarObjetivo(o) {
  return { id: o.id, trabajador: o.trabajador, titulo: o.titulo, descripcion: o.descripcion,
           metrica: o.metrica, meta: Number(o.meta || 0), actual: Number(o.actual || 0),
           periodo: o.periodo, peso: Number(o.peso || 0), estado: String(o.estado).toUpperCase(),
           valoracion: o.valoracion === '' ? null : Number(o.valoracion),
           comentario: o.comentario, autor: o.autor };
}

function misObjetivos(emp) {
  return { ok: true, objetivos: leer(HOJAS.objetivos)
    .filter(function (o) { return String(o.trabajador).trim() === emp.nombre; })
    .map(limpiarObjetivo) };
}

function avanzarObjetivo(emp, b) {
  var filas = leer(HOJAS.objetivos);
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i].id) !== String(b.id)) continue;
    if (String(filas[i].trabajador).trim() !== emp.nombre) return denegado();
    hoja(HOJAS.objetivos).getRange(filas[i]._fila, 7).setValue(Number(b.actual || 0));
    return { ok: true };
  }
  return { ok: false, error: 'NO_ENCONTRADO' };
}

function guardarObjetivo(dir, b) {
  if (!b.trabajador || !b.titulo) return { ok: false, error: 'DATOS_INCOMPLETOS' };
  var id = uid('OB');
  hoja(HOJAS.objetivos).appendRow([id, String(b.trabajador), String(b.titulo), String(b.descripcion || ''),
    String(b.metrica || ''), Number(b.meta || 0), Number(b.actual || 0),
    String(b.periodo || new Date().getFullYear()), Number(b.peso || 0), 'ACTIVO', '', '',
    dir.nombre, new Date().toISOString()]);
  auditar(dir.nombre, 'ALTA_OBJETIVO', b.trabajador + ' — ' + b.titulo);
  return { ok: true, id: id };
}

function valorarObjetivo(dir, b) {
  var filas = leer(HOJAS.objetivos);
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i].id) !== String(b.id)) continue;
    var h = hoja(HOJAS.objetivos);
    h.getRange(filas[i]._fila, 10).setValue('CERRADO');
    h.getRange(filas[i]._fila, 11).setValue(Number(b.valoracion || 0));
    h.getRange(filas[i]._fila, 12).setValue(String(b.comentario || ''));
    auditar(dir.nombre, 'VALORA_OBJETIVO', String(b.id));
    return { ok: true };
  }
  return { ok: false, error: 'NO_ENCONTRADO' };
}

function objetivosEquipo(b) {
  var filas = leer(HOJAS.objetivos).map(limpiarObjetivo);
  if (b.periodo) filas = filas.filter(function (o) { return String(o.periodo) === String(b.periodo); });
  return { ok: true, objetivos: filas };
}

// ── EVALUACIÓN DE DESEMPEÑO ──────────────────────────────────────────────────
var COMPETENCIAS = ['Orientación a resultados', 'Trato con el cliente', 'Trabajo en equipo',
                    'Autonomía e iniciativa', 'Conocimiento del producto', 'Comunicación'];

function lanzarEvaluacion(dir, b) {
  var campana = String(b.campana || '').trim();
  var personas = b.trabajadores || [];
  var comps = (b.competencias && b.competencias.length) ? b.competencias : COMPETENCIAS;
  if (!campana || !personas.length) return { ok: false, error: 'DATOS_INCOMPLETOS' };

  var existentes = {};
  leer(HOJAS.evaluaciones).forEach(function (e) {
    existentes[String(e.campana) + '|' + String(e.trabajador) + '|' + String(e.competencia)] = true;
  });

  var filas = [];
  personas.forEach(function (p) {
    var emp = buscarEmpleado(p);
    comps.forEach(function (c) {
      if (existentes[campana + '|' + p + '|' + c]) return;
      filas.push([uid('EV'), campana, p, (emp && emp.responsable) || dir.nombre, c,
                  '', '', '', '', 'PENDIENTE', new Date().toISOString()]);
    });
  });
  if (!filas.length) return { ok: false, error: 'YA_LANZADA' };
  hoja(HOJAS.evaluaciones).getRange(hoja(HOJAS.evaluaciones).getLastRow() + 1, 1, filas.length, 11).setValues(filas);
  auditar(dir.nombre, 'LANZA_EVALUACION', campana + ' · ' + personas.length + ' personas');
  return { ok: true, creadas: filas.length };
}

function limpiarEvaluacion(e) {
  return { id: e.id, campana: e.campana, trabajador: e.trabajador, evaluador: e.evaluador,
           competencia: e.competencia,
           notaAuto: e.nota_auto === '' ? null : Number(e.nota_auto),
           notaManager: e.nota_manager === '' ? null : Number(e.nota_manager),
           comentarioAuto: e.comentario_auto, comentarioManager: e.comentario_manager,
           estado: String(e.estado).toUpperCase() };
}

function miEvaluacion(emp, b) {
  var filas = leer(HOJAS.evaluaciones).filter(function (e) {
    return String(e.trabajador).trim() === emp.nombre &&
           (!b.campana || String(e.campana) === String(b.campana));
  }).map(limpiarEvaluacion);
  return { ok: true, evaluacion: filas };
}

function autoevaluar(emp, b) {
  var notas = b.notas || {};       // { id: {nota, comentario} }
  var filas = leer(HOJAS.evaluaciones);
  var h = hoja(HOJAS.evaluaciones), n = 0;
  filas.forEach(function (e) {
    var v = notas[String(e.id)];
    if (!v || String(e.trabajador).trim() !== emp.nombre) return;
    h.getRange(e._fila, 6).setValue(Number(v.nota));
    h.getRange(e._fila, 8).setValue(String(v.comentario || ''));
    if (String(e.estado).toUpperCase() === 'PENDIENTE') h.getRange(e._fila, 10).setValue('AUTOEVALUADA');
    n++;
  });
  auditar(emp.nombre, 'AUTOEVALUACION', n + ' competencias');
  return { ok: true, guardadas: n };
}

function evaluarManager(dir, b) {
  var notas = b.notas || {};
  var filas = leer(HOJAS.evaluaciones);
  var h = hoja(HOJAS.evaluaciones), n = 0;
  filas.forEach(function (e) {
    var v = notas[String(e.id)];
    if (!v) return;
    h.getRange(e._fila, 7).setValue(Number(v.nota));
    h.getRange(e._fila, 9).setValue(String(v.comentario || ''));
    h.getRange(e._fila, 10).setValue('CERRADA');
    n++;
  });
  auditar(dir.nombre, 'EVALUA_MANAGER', n + ' competencias');
  return { ok: true, guardadas: n };
}

function evaluacionesEquipo(b) {
  var filas = leer(HOJAS.evaluaciones).filter(function (e) {
    return !b.campana || String(e.campana) === String(b.campana);
  }).map(limpiarEvaluacion);
  var campanas = {};
  leer(HOJAS.evaluaciones).forEach(function (e) { campanas[String(e.campana)] = true; });
  return { ok: true, evaluaciones: filas, campanas: Object.keys(campanas), competencias: COMPETENCIAS };
}

// ── ENCUESTAS DE CLIMA ───────────────────────────────────────────────────────
function leerEncuestas() {
  return leer(HOJAS.encuestas).map(function (e) {
    var preguntas = [];
    try { preguntas = JSON.parse(e.preguntas || '[]'); } catch (err) {}
    return { id: e.id, titulo: e.titulo, descripcion: e.descripcion, preguntas: preguntas,
             desde: normFecha(e.desde), hasta: normFecha(e.hasta),
             anonima: String(e.anonima).toUpperCase() === 'SI',
             activa: String(e.activa).toUpperCase() !== 'NO' };
  });
}

function guardarEncuesta(dir, b) {
  if (!b.titulo || !b.preguntas || !b.preguntas.length) return { ok: false, error: 'DATOS_INCOMPLETOS' };
  var id = uid('EN');
  hoja(HOJAS.encuestas).appendRow([id, String(b.titulo), String(b.descripcion || ''),
    JSON.stringify(b.preguntas), String(b.desde || fmtFecha(ahora())),
    String(b.hasta || ''), b.anonima === false ? 'NO' : 'SI', 'SI', dir.nombre, new Date().toISOString()]);
  auditar(dir.nombre, 'ALTA_ENCUESTA', String(b.titulo));
  return { ok: true, id: id };
}

function encuestasAbiertas(emp) {
  var hoy = fmtFecha(ahora());
  var respondidas = {};
  leer(HOJAS.respuestas).forEach(function (r) {
    if (String(r.trabajador).trim() === emp.nombre) respondidas[String(r.encuesta_id)] = true;
  });
  var abiertas = leerEncuestas().filter(function (e) {
    return e.activa && (!e.hasta || e.hasta >= hoy) && (!e.desde || e.desde <= hoy);
  }).map(function (e) { e.respondida = !!respondidas[e.id]; return e; });
  return { ok: true, encuestas: abiertas };
}

function responderEncuesta(emp, b) {
  var enc = leerEncuestas().filter(function (e) { return e.id === String(b.id); })[0];
  if (!enc) return { ok: false, error: 'NO_ENCONTRADA' };
  var yaRespondio = leer(HOJAS.respuestas).some(function (r) {
    return String(r.encuesta_id) === String(b.id) && String(r.trabajador).trim() === emp.nombre;
  });
  if (yaRespondio) return { ok: false, error: 'YA_RESPONDIDA' };

  // La trazabilidad de "quién respondió" se guarda para no repetir; el contenido va
  // en una fila separada sin nombre cuando la encuesta es anónima.
  hoja(HOJAS.respuestas).appendRow([uid('RE'), String(b.id), emp.nombre, '', new Date().toISOString()]);
  hoja(HOJAS.respuestas).appendRow([uid('RE'), String(b.id), enc.anonima ? 'ANONIMO' : emp.nombre,
    JSON.stringify(b.respuestas || []), new Date().toISOString()]);
  return { ok: true };
}

function resultadosEncuesta(b) {
  var enc = leerEncuestas().filter(function (e) { return e.id === String(b.id); })[0];
  if (!enc) return { ok: false, error: 'NO_ENCONTRADA' };
  var respuestas = [];
  leer(HOJAS.respuestas).forEach(function (r) {
    if (String(r.encuesta_id) !== String(b.id) || !r.respuestas) return;
    try { respuestas.push(JSON.parse(r.respuestas)); } catch (e) {}
  });
  return { ok: true, encuesta: enc, respuestas: respuestas, total: respuestas.length };
}

// ── TABLÓN / COMUNICACIÓN INTERNA ────────────────────────────────────────────
function publicaciones(emp) {
  var filas = leer(HOJAS.publicaciones).filter(function (p) {
    var d = String(p.destinatarios || '').trim();
    return !d || d === '*' || d === 'TODOS' || d === emp.departamento || d === emp.oficina;
  }).map(function (p) {
    return { id: p.id, ts: String(p.ts), autor: p.autor, categoria: p.categoria,
             titulo: p.titulo, cuerpo: p.cuerpo,
             fijado: String(p.fijado).toUpperCase() === 'SI' };
  });
  return { ok: true, publicaciones: filas };
}

function publicar(dir, b) {
  if (!b.titulo || !b.cuerpo) return { ok: false, error: 'DATOS_INCOMPLETOS' };
  var id = uid('PU');
  hoja(HOJAS.publicaciones).appendRow([id, new Date().toISOString(), dir.nombre,
    String(b.categoria || 'General'), String(b.titulo), String(b.cuerpo),
    b.fijado ? 'SI' : 'NO', String(b.destinatarios || '*')]);
  auditar(dir.nombre, 'PUBLICA', String(b.titulo));
  return { ok: true, id: id };
}

function borrarPublicacion(dir, b) {
  var filas = leer(HOJAS.publicaciones);
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i].id) === String(b.id)) {
      hoja(HOJAS.publicaciones).deleteRow(filas[i]._fila);
      auditar(dir.nombre, 'BORRA_PUBLICACION', String(b.id));
      return { ok: true };
    }
  }
  return { ok: false, error: 'NO_ENCONTRADA' };
}

// ── RECLUTAMIENTO ────────────────────────────────────────────────────────────
var FASES = ['Recibido', 'Cribado', 'Entrevista', 'Prueba', 'Oferta', 'Contratado', 'Descartado'];

function vacantesYcandidatos() {
  return { ok: true, fases: FASES,
    vacantes: leer(HOJAS.vacantes).map(function (v) {
      return { id: v.id, titulo: v.titulo, departamento: v.departamento, oficina: v.oficina,
               descripcion: v.descripcion, estado: String(v.estado).toUpperCase(), ts: String(v.ts) };
    }),
    candidatos: leer(HOJAS.candidatos).map(function (c) {
      return { id: c.id, vacante_id: c.vacante_id, nombre: c.nombre, email: c.email,
               telefono: c.telefono, fase: c.fase, valoracion: Number(c.valoracion || 0),
               nota: c.nota, cv_url: c.cv_url, ts: String(c.ts) };
    }) };
}

function guardarVacante(dir, b) {
  if (!b.titulo) return { ok: false, error: 'DATOS_INCOMPLETOS' };
  if (b.id) {
    var filas = leer(HOJAS.vacantes);
    for (var i = 0; i < filas.length; i++) {
      if (String(filas[i].id) !== String(b.id)) continue;
      hoja(HOJAS.vacantes).getRange(filas[i]._fila, 6).setValue(String(b.estado || 'ABIERTA').toUpperCase());
      return { ok: true, id: b.id };
    }
  }
  var id = uid('VA');
  hoja(HOJAS.vacantes).appendRow([id, String(b.titulo), String(b.departamento || ''),
    String(b.oficina || ''), String(b.descripcion || ''), 'ABIERTA', dir.nombre, new Date().toISOString()]);
  auditar(dir.nombre, 'ALTA_VACANTE', String(b.titulo));
  return { ok: true, id: id };
}

function guardarCandidato(dir, b) {
  if (!b.nombre || !b.vacante_id) return { ok: false, error: 'DATOS_INCOMPLETOS' };
  var id = uid('CA');
  hoja(HOJAS.candidatos).appendRow([id, String(b.vacante_id), String(b.nombre), String(b.email || ''),
    String(b.telefono || ''), 'Recibido', Number(b.valoracion || 0), String(b.nota || ''),
    String(b.cv_url || ''), new Date().toISOString()]);
  return { ok: true, id: id };
}

function moverCandidato(dir, b) {
  var filas = leer(HOJAS.candidatos);
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i].id) !== String(b.id)) continue;
    var h = hoja(HOJAS.candidatos);
    if (b.fase) h.getRange(filas[i]._fila, 6).setValue(String(b.fase));
    if (b.valoracion !== undefined) h.getRange(filas[i]._fila, 7).setValue(Number(b.valoracion));
    if (b.nota !== undefined) h.getRange(filas[i]._fila, 8).setValue(String(b.nota));
    auditar(dir.nombre, 'MUEVE_CANDIDATO', String(b.id) + ' → ' + String(b.fase || ''));
    return { ok: true };
  }
  return { ok: false, error: 'NO_ENCONTRADO' };
}

// ── ONBOARDING / OFFBOARDING ─────────────────────────────────────────────────
var PLANTILLA_ONBOARDING = [
  'Contrato firmado', 'Alta en Seguridad Social', 'Email corporativo creado',
  'Equipo informático entregado', 'Accesos al CRM', 'Tarjeta de visita',
  'Formación de producto', 'Presentación al equipo', 'Manual de acogida entregado'
];
var PLANTILLA_OFFBOARDING = [
  'Entrevista de salida', 'Devolución de equipo', 'Revocación de accesos',
  'Traspaso de cartera de clientes', 'Finiquito calculado', 'Baja en Seguridad Social'
];

function crearChecklist(dir, b) {
  var tipo = String(b.tipo || 'ONBOARDING').toUpperCase();
  if (!b.trabajador) return { ok: false, error: 'DATOS_INCOMPLETOS' };
  var tareas = (b.tareas && b.tareas.length) ? b.tareas
             : (tipo === 'OFFBOARDING' ? PLANTILLA_OFFBOARDING : PLANTILLA_ONBOARDING);
  var filas = tareas.map(function (t, i) {
    return [uid('CK'), String(b.trabajador), tipo, String(t), String(b.responsable || dir.nombre),
            String(b.fecha_limite || ''), '', '', i + 1];
  });
  hoja(HOJAS.checklists).getRange(hoja(HOJAS.checklists).getLastRow() + 1, 1, filas.length, 9).setValues(filas);
  auditar(dir.nombre, 'CREA_CHECKLIST', b.trabajador + ' · ' + tipo);
  return { ok: true, creadas: filas.length };
}

function limpiarChecklist(c) {
  return { id: c.id, trabajador: c.trabajador, tipo: String(c.tipo).toUpperCase(), tarea: c.tarea,
           responsable: c.responsable, fechaLimite: normFecha(c.fecha_limite),
           hecho: !!c.hecho_ts, hechoTs: c.hecho_ts ? String(c.hecho_ts) : '',
           hechoPor: c.hecho_por, orden: Number(c.orden || 0) };
}

function miChecklist(emp) {
  return { ok: true, checklist: leer(HOJAS.checklists).filter(function (c) {
    return String(c.trabajador).trim() === emp.nombre || String(c.responsable).trim() === emp.nombre;
  }).map(limpiarChecklist) };
}

function marcarChecklist(emp, b) {
  var filas = leer(HOJAS.checklists);
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i].id) !== String(b.id)) continue;
    var h = hoja(HOJAS.checklists);
    if (b.hecho === false) { h.getRange(filas[i]._fila, 7).setValue(''); h.getRange(filas[i]._fila, 8).setValue(''); }
    else { h.getRange(filas[i]._fila, 7).setValue(new Date().toISOString()); h.getRange(filas[i]._fila, 8).setValue(emp.nombre); }
    return { ok: true };
  }
  return { ok: false, error: 'NO_ENCONTRADO' };
}

function checklistEquipo(b) {
  return { ok: true, checklist: leer(HOJAS.checklists).map(limpiarChecklist),
           plantillas: { ONBOARDING: PLANTILLA_ONBOARDING, OFFBOARDING: PLANTILLA_OFFBOARDING } };
}

// ── ANALYTICS ────────────────────────────────────────────────────────────────
function analytics(b) {
  var desde = String(b.desde || '1900-01-01'), hasta = String(b.hasta || '2999-12-31');
  var empleados = leer(HOJAS.empleados).filter(function (e) { return String(e.activo).toUpperCase() !== 'NO'; });

  // Horas por persona
  var porPersonaDia = {};
  leer(HOJAS.fichajes).forEach(function (f) {
    var fe = normFecha(f.fecha);
    if (fe < desde || fe > hasta) return;
    var k = String(f.trabajador).trim() + '|' + fe;
    (porPersonaDia[k] = porPersonaDia[k] || []).push(f);
  });
  var horas = {}, diasFichados = {};
  Object.keys(porPersonaDia).forEach(function (k) {
    var p = k.split('|')[0];
    horas[p] = (horas[p] || 0) + minutosTrabajados(porPersonaDia[k]);
    diasFichados[p] = (diasFichados[p] || 0) + 1;
  });

  // Absentismo por tipo
  var absentismo = {}, diasAusencia = {};
  leer(HOJAS.ausencias).forEach(function (a) {
    if (String(a.estado).toUpperCase() !== 'APROBADA') return;
    var d1 = normFecha(a.fecha_inicio);
    if (d1 < desde || d1 > hasta) return;
    var t = String(a.tipo);
    absentismo[t] = (absentismo[t] || 0) + Number(a.dias || 0);
    diasAusencia[String(a.trabajador).trim()] = (diasAusencia[String(a.trabajador).trim()] || 0) + Number(a.dias || 0);
  });

  // Coste por proyecto
  var costeHora = {};
  empleados.forEach(function (e) { costeHora[String(e.nombre).trim()] = Number(e.coste_hora || 0); });
  var proyectos = {};
  leer(HOJAS.tareas).forEach(function (t) {
    var fe = normFecha(t.fecha);
    if (fe < desde || fe > hasta) return;
    var p = String(t.proyecto || 'Sin proyecto');
    proyectos[p] = proyectos[p] || { minutos: 0, coste: 0 };
    proyectos[p].minutos += Number(t.minutos || 0);
    proyectos[p].coste += Number(t.minutos || 0) / 60 * (costeHora[String(t.trabajador).trim()] || 0);
  });

  // Plantilla por departamento y oficina
  var porDepto = {}, porOficina = {};
  empleados.forEach(function (e) {
    porDepto[String(e.departamento || '—')] = (porDepto[String(e.departamento || '—')] || 0) + 1;
    porOficina[String(e.oficina || '—')] = (porOficina[String(e.oficina || '—')] || 0) + 1;
  });

  return { ok: true, desde: desde, hasta: hasta, plantilla: empleados.length,
           horas: horas, diasFichados: diasFichados, absentismo: absentismo,
           diasAusencia: diasAusencia, proyectos: proyectos,
           porDepartamento: porDepto, porOficina: porOficina };
}

// ── FEED DE CALENDARIO (iCal) ────────────────────────────────────────────────
/**
 * Sustituye a la integración con Google/Outlook Calendar sin usar sus APIs:
 * devuelve una URL que ambos aceptan como "calendario por suscripción".
 */
function tokenCalendario(emp) {
  if (arguments.length > 1 && arguments[1] && arguments[1].revocar) {
    PropertiesService.getScriptProperties().setProperty('CAL_REV_' + emp.nombre, String(Date.now()));
    auditar(emp.nombre, 'REVOCA_CALENDARIO', '');
    return { ok: true, revocado: true };
  }
  var emitido = Date.now();
  var exp = emitido + 365 * 86400000;   // un año
  var payload = Utilities.base64EncodeWebSafe('CAL|' + emp.nombre + '|' + emitido + '|' + exp);
  return { ok: true, token: payload + '.' + firmar(payload), caduca: new Date(exp).toISOString().slice(0, 10) };
}

function icsAusencias(token) {
  var parts = String(token || '').split('.');
  if (parts.length !== 2 || firmar(parts[0]) !== parts[1]) return null;
  var claro = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
  if (claro.indexOf('CAL|') !== 0) return null;
  var trozos = claro.split('|');
  var quien = trozos[1];
  var emitido = Number(trozos[2] || 0), exp = Number(trozos[3] || 0);
  if (exp && exp < Date.now()) return null;                       // caducado
  var revocado = Number(PropertiesService.getScriptProperties().getProperty('CAL_REV_' + quien) || 0);
  if (revocado && emitido < revocado) return null;                // revocado por la persona

  var lineas = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Duran Carasso//Personas//ES',
                'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Ausencias · Durán Carasso'];
  leer(HOJAS.ausencias).forEach(function (a) {
    if (String(a.estado).toUpperCase() !== 'APROBADA') return;
    if (quien !== '*' && String(a.trabajador).trim() !== quien) return;
    var fin = new Date(normFecha(a.fecha_fin) + 'T00:00:00');
    fin.setDate(fin.getDate() + 1);   // DTEND es exclusivo en eventos de día completo
    lineas.push('BEGIN:VEVENT',
      'UID:' + a.id + '@durancarasso',
      'DTSTAMP:' + Utilities.formatDate(new Date(), 'UTC', "yyyyMMdd'T'HHmmss'Z'"),
      'DTSTART;VALUE=DATE:' + normFecha(a.fecha_inicio).replace(/-/g, ''),
      'DTEND;VALUE=DATE:' + fmtFecha(fin).replace(/-/g, ''),
      'SUMMARY:' + String(a.tipo) + ' · ' + String(a.trabajador),
      'DESCRIPTION:' + String(a.motivo || '').replace(/\n/g, ' '),
      'TRANSP:TRANSPARENT', 'END:VEVENT');
  });
  lineas.push('END:VCALENDAR');
  return lineas.join('\r\n');
}

/* ═══════════════════════════════════════════════════════════════════════════
   AUTOMATISMOS PROGRAMADOS
   Se instalan una sola vez ejecutando `instalarAutomatismos()` desde el editor.
   ═══════════════════════════════════════════════════════════════════════════ */

function instalarAutomatismos() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });

  ScriptApp.newTrigger('recordatorioSalida').timeBased().atHour(18).nearMinute(30).everyDays(1).create();
  ScriptApp.newTrigger('cierreAutomatico').timeBased().atHour(23).nearMinute(45).everyDays(1).create();
  ScriptApp.newTrigger('copiaSeguridad').timeBased().atHour(3).everyDays(1).create();
  ScriptApp.newTrigger('avisoValidaciones').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).create();
  ScriptApp.newTrigger('tareasMensuales').timeBased().onMonthDay(1).atHour(7).create();

  return 'Automatismos instalados: recordatorio 18:30, cierre 23:45, copia 03:00, ' +
         'avisos lunes 09:00 y cierre de mes el día 1.';
}

function destinatariosDireccion() {
  return leer(HOJAS.empleados)
    .filter(function (e) { return String(e.rol).toUpperCase() === 'DIRECCION' &&
                                  String(e.activo).toUpperCase() !== 'NO' && e.email; })
    .map(function (e) { return String(e.email); });
}

function enviar(destinos, asunto, cuerpo) {
  var lista = (destinos || []).filter(Boolean).join(',');
  if (!lista) return;
  try { MailApp.sendEmail({ to: lista, subject: asunto, htmlBody: plantillaEmail(asunto, cuerpo) }); }
  catch (e) { auditar('SISTEMA', 'EMAIL_FALLIDO', asunto + ' — ' + e.message); }
}

function plantillaEmail(titulo, cuerpoHtml) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#243138">' +
    '<div style="border-top:3px solid #0E3946;padding:22px 0 16px">' +
    '<div style="font-family:Georgia,serif;font-size:17px;letter-spacing:4px;text-transform:uppercase;color:#0E3946">Durán Carasso</div>' +
    '<div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#9C7C3C;margin-top:3px">Personas</div></div>' +
    '<h2 style="font-family:Georgia,serif;font-weight:400;font-size:20px;color:#0E3946;margin:14px 0 12px">' + titulo + '</h2>' +
    '<div style="font-size:14px;line-height:1.65">' + cuerpoHtml + '</div>' +
    '<div style="margin-top:26px;padding-top:14px;border-top:1px solid #E0E4E3;font-size:11px;color:#78837F">' +
    'Mensaje automático de DC · Personas. No respondas a este correo.</div></div>';
}

/* ── 18:30 · Quien sigue fichado sin haber salido ────────────────────────── */
function recordatorioSalida() {
  var hoy = fmtFecha(ahora());
  var abiertos = leer(HOJAS.empleados).filter(function (e) {
    return String(e.activo).toUpperCase() !== 'NO' && ultimoEstado(e.nombre).estado !== 'FUERA';
  }).filter(function (e) {
    return ultimoEstado(e.nombre).estado !== 'SIN_FICHAR';
  });

  abiertos.forEach(function (e) {
    if (!e.email) return;
    enviar([e.email], 'Te falta fichar la salida',
      'Hola ' + e.nombre + ',<br><br>Según el registro sigues dentro desde esta mañana. ' +
      'Si ya has terminado, ficha la salida ahora para que la jornada de hoy quede bien.<br><br>' +
      'Si no lo haces, a las 23:45 se cerrará automáticamente y quedará marcado como incidencia ' +
      'para que dirección lo corrija.');
  });

  if (abiertos.length) {
    auditar('SISTEMA', 'RECORDATORIO_SALIDA', abiertos.length + ' persona(s) el ' + hoy);
  }
  return abiertos.length;
}

/* ── 23:45 · Cierre automático de jornadas abiertas ──────────────────────── */
function cierreAutomatico() {
  var hoy = fmtFecha(ahora());
  var cerradas = [];

  leer(HOJAS.empleados).forEach(function (e) {
    if (String(e.activo).toUpperCase() === 'NO') return;
    var est = ultimoEstado(e.nombre);
    if (est.estado === 'FUERA' || est.estado === 'SIN_FICHAR') return;

    var lock = LockService.getScriptLock();
    try { lock.waitLock(10000); } catch (err) { return; }
    try {
      // Si estaba en pausa, primero se reanuda para que el cómputo cuadre
      if (est.estado === 'PAUSA') apuntarAutomatico(e, 'PAUSA_FIN', hoy, 'Cierre automático: pausa sin reanudar');
      apuntarAutomatico(e, 'SALIDA', hoy, 'Cierre automático a las 23:45 · el trabajador no fichó la salida');
      cerradas.push(e.nombre);
    } finally { lock.releaseLock(); }
  });

  if (cerradas.length) {
    auditar('SISTEMA', 'CIERRE_AUTOMATICO', cerradas.join(', '));
    enviar(destinatariosDireccion(), 'Jornadas cerradas automáticamente',
      'Estas personas no ficharon la salida del ' + hoy + ' y el sistema ha cerrado su jornada:<br><br>' +
      '<b>' + cerradas.join('</b><br><b>') + '</b><br><br>' +
      'Aparecen en <b>Incidencias</b> para que corrijas la hora real. La corrección queda registrada ' +
      'con tu nombre y su motivo, como exige el registro de jornada.');
  }
  return cerradas.length;
}

function apuntarAutomatico(emp, tipo, fecha, motivo) {
  var d = new Date(fecha + 'T23:45:00');
  var id = uid('S');
  var prev = ultimoHash();
  var hash = sha256(prev + '|' + [id, d.toISOString(), emp.nombre, tipo].join('|'));
  hoja(HOJAS.fichajes).appendRow([
    id, d.toISOString(), fmtFecha(d), fmtHora(d), emp.nombre, emp.email, tipo,
    '', '', '', 'Sistema', 'AUTOMATICO', motivo, 'SISTEMA', '', '', prev, hash
  ]);
}

/* ── 03:00 · Copia de seguridad a Drive ──────────────────────────────────── */
function copiaSeguridad() {
  var props = PropertiesService.getScriptProperties();
  var idCarpeta = props.getProperty('CARPETA_COPIAS');
  var carpeta;
  if (idCarpeta) { carpeta = DriveApp.getFolderById(idCarpeta); }
  else {
    var busca = DriveApp.getFoldersByName('DC Personas · Copias');
    carpeta = busca.hasNext() ? busca.next() : DriveApp.createFolder('DC Personas · Copias');
    props.setProperty('CARPETA_COPIAS', carpeta.getId());
  }

  var libro = ss();
  var nombre = 'DC Personas · copia ' + fmtFecha(ahora());
  DriveApp.getFileById(libro.getId()).makeCopy(nombre, carpeta);

  // Se conservan 60 copias: suficiente para recuperar sin llenar el Drive
  var archivos = [];
  var it = carpeta.getFiles();
  while (it.hasNext()) archivos.push(it.next());
  archivos.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  archivos.slice(60).forEach(function (f) { f.setTrashed(true); });

  auditar('SISTEMA', 'COPIA_SEGURIDAD', nombre);
  return nombre;
}

/* ── Lunes 09:00 · Solicitudes y jornadas pendientes ─────────────────────── */
function avisoValidaciones() {
  var pendientes = leer(HOJAS.ausencias).filter(function (a) {
    return String(a.estado).toUpperCase() === 'PENDIENTE';
  });
  var inc = incidencias({ desde: fmtFecha(new Date(Date.now() - 7 * 86400000)), hasta: fmtFecha(ahora()) });

  if (!pendientes.length && !inc.incidencias.length) return 0;

  var html = '';
  if (pendientes.length) {
    html += '<b>' + pendientes.length + ' solicitud(es) esperando respuesta:</b><br>' +
      pendientes.map(function (a) {
        return '· ' + a.trabajador + ' — ' + a.tipo + ' del ' + normFecha(a.fecha_inicio) +
               ' al ' + normFecha(a.fecha_fin) + ' (' + a.dias + ' días)';
      }).join('<br>') + '<br><br>';
  }
  if (inc.incidencias.length) {
    html += '<b>' + inc.incidencias.length + ' incidencia(s) en el registro de la última semana.</b><br>' +
            'Revísalas en Dirección → Incidencias.';
  }
  enviar(destinatariosDireccion(), 'Tienes cosas pendientes en Personas', html);
  return pendientes.length + inc.incidencias.length;
}

/* ── Día 1 · Cierre de mes y, si toca, archivo trimestral ────────────────── */
function tareasMensuales() {
  resumenMensual();
  var mes = ahora().getMonth() + 1;              // 1 = enero
  if ([1, 4, 7, 10].indexOf(mes) >= 0) archivoTrimestral();
}

function resumenMensual() {
  var hoy = ahora();
  var fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0);          // último día del mes anterior
  var ini = new Date(fin.getFullYear(), fin.getMonth(), 1);
  var desde = fmtFecha(ini), hasta = fmtFecha(fin);

  var filas = leer(HOJAS.fichajes).filter(function (f) {
    var fe = normFecha(f.fecha); return fe >= desde && fe <= hasta;
  });
  if (!filas.length) return;

  var csv = ['id;fecha;hora;trabajador;tipo;modalidad;centro;origen;motivo;autor'];
  filas.forEach(function (f) {
    csv.push([f.id, normFecha(f.fecha), f.hora, f.trabajador, String(f.tipo).trim(),
              f.modalidad || '', f.centro || '', f.origen || 'APP',
              String(f.motivo || '').replace(/;/g, ','), f.autor || ''].join(';'));
  });

  var resumen = resumenPorPersona(filas);
  var blob = Utilities.newBlob('﻿' + csv.join('\n'), 'text/csv',
    'registro-jornada-' + desde.slice(0, 7) + '.csv');

  var destinos = destinatariosDireccion();
  var gestoria = PropertiesService.getScriptProperties().getProperty('EMAIL_GESTORIA');
  if (gestoria) destinos.push(gestoria);

  try {
    MailApp.sendEmail({
      to: destinos.join(','),
      subject: 'Registro de jornada · ' + desde.slice(0, 7),
      htmlBody: plantillaEmail('Registro de jornada de ' + desde.slice(0, 7),
        'Adjunto el registro completo del ' + desde + ' al ' + hasta + '.<br><br>' +
        '<table style="border-collapse:collapse;font-size:13px">' +
        '<tr><th align="left" style="border-bottom:1px solid #ccc;padding:5px 12px 5px 0">Persona</th>' +
        '<th align="left" style="border-bottom:1px solid #ccc;padding:5px 0">Horas</th></tr>' +
        Object.keys(resumen).sort().map(function (k) {
          return '<tr><td style="padding:4px 12px 4px 0">' + k + '</td>' +
                 '<td style="padding:4px 0">' + (resumen[k] / 60).toFixed(1) + ' h</td></tr>';
        }).join('') + '</table>'),
      attachments: [blob]
    });
    auditar('SISTEMA', 'RESUMEN_MENSUAL', desde.slice(0, 7) + ' → ' + destinos.join(', '));
  } catch (e) {
    auditar('SISTEMA', 'RESUMEN_MENSUAL_FALLIDO', e.message);
  }
}

function resumenPorPersona(filas) {
  var porClave = {}, out = {};
  filas.forEach(function (f) {
    var k = String(f.trabajador).trim() + '|' + normFecha(f.fecha);
    (porClave[k] = porClave[k] || []).push(f);
  });
  Object.keys(porClave).forEach(function (k) {
    var p = k.split('|')[0];
    out[p] = (out[p] || 0) + minutosTrabajados(porClave[k]);
  });
  return out;
}

/* ── Archivo trimestral sellado en Drive ─────────────────────────────────── */
function archivoTrimestral() {
  var hoy = ahora();
  var finTrim = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
  var iniTrim = new Date(finTrim.getFullYear(), finTrim.getMonth() - 2, 1);
  var desde = fmtFecha(iniTrim), hasta = fmtFecha(finTrim);

  var filas = leer(HOJAS.fichajes).filter(function (f) {
    var fe = normFecha(f.fecha); return fe >= desde && fe <= hasta;
  });
  if (!filas.length) return;

  var integridad = verificarCadena();
  var resumen = resumenPorPersona(filas);

  var html = '<html><head><meta charset="utf-8"><style>' +
    'body{font-family:Georgia,serif;color:#17242B;margin:34px}' +
    'h1{font-size:19px;letter-spacing:3px;text-transform:uppercase;margin:0 0 4px}' +
    '.s{font-family:Arial,sans-serif;font-size:11px;color:#666;margin-bottom:24px}' +
    'table{width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:11px}' +
    'th{text-align:left;border-bottom:1.5px solid #17242B;padding:7px 6px;font-size:9px;text-transform:uppercase;letter-spacing:1px}' +
    'td{border-bottom:1px solid #E5E5E5;padding:6px}' +
    '.f{margin-top:24px;padding-top:12px;border-top:1px solid #ccc;font-family:Arial,sans-serif;font-size:10px;color:#666}' +
    '</style></head><body>' +
    '<h1>Durán Carasso</h1>' +
    '<div class="s">Registro de jornada · ' + desde + ' a ' + hasta + '</div>' +
    '<table><tr><th>Persona</th><th>Horas del periodo</th></tr>' +
    Object.keys(resumen).sort().map(function (k) {
      return '<tr><td>' + k + '</td><td>' + (resumen[k] / 60).toFixed(1) + ' h</td></tr>';
    }).join('') + '</table>' +
    '<div class="f"><b>' + filas.length + ' registros.</b> ' +
    'Cadena de integridad: <b>' + (integridad.integridad ? 'correcta' : 'ALTERADA · ' + integridad.rotas.length + ' registro(s)') + '</b>.<br>' +
    'Último sello: ' + String(filas[filas.length - 1].hash).slice(0, 32) + '…<br>' +
    'Documento generado el ' + Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm') + '. ' +
    'Conservación mínima 4 años (art. 34.9 ET).</div></body></html>';

  var props = PropertiesService.getScriptProperties();
  var idC = props.getProperty('CARPETA_ARCHIVO');
  var carpeta;
  if (idC) { carpeta = DriveApp.getFolderById(idC); }
  else {
    var b = DriveApp.getFoldersByName('DC Personas · Archivo legal');
    carpeta = b.hasNext() ? b.next() : DriveApp.createFolder('DC Personas · Archivo legal');
    props.setProperty('CARPETA_ARCHIVO', carpeta.getId());
  }
  var pdf = Utilities.newBlob(html, 'text/html', 'tmp.html')
    .getAs('application/pdf').setName('Registro jornada ' + desde + ' a ' + hasta + '.pdf');
  carpeta.createFile(pdf);
  auditar('SISTEMA', 'ARCHIVO_TRIMESTRAL', desde + ' a ' + hasta);
}

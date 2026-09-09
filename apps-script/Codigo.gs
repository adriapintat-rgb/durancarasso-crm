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
  auditoria:  'Auditoria',
  turnos:        'Turnos',
  centros:       'Centros',
  publicaciones: 'Publicaciones',
  tiposAusencia: 'TiposAusencia',
  intentos:      'Intentos',
  empresa:       'Empresa',
  descansos:     'Descansos',
  consentimientos:'Consentimientos',
  extras:        'HorasExtra',
  planificacion: 'Planificacion'
};

var CABECERAS = {
  Empleados:  ['nombre','email','pin','rol','departamento','oficina','horario_id','fecha_alta','vacaciones_anuales','activo','telefono','dni','coste_hora','empresa','responsable','fecha_baja'],
  Fichajes:   ['id','ts_iso','fecha','hora','trabajador','email','tipo','lat','lng','precision_m','dispositivo','origen','motivo','autor','modalidad','centro','descanso','hash_prev','hash'],
  Ausencias:  ['id','ts_solicitud','trabajador','email','tipo','fecha_inicio','fecha_fin','dias','medio_dia','motivo','estado','validador','ts_validacion','comentario','justificante','dias_arrastre'],
  Horarios:   ['horario_id','nombre','lun','mar','mie','jue','vie','sab','dom','pausa_min','horas_semana','tipo','dias_semana','activo'],
  Festivos:   ['fecha','nombre','ambito'],
  Tareas:     ['id','ts','trabajador','fecha','proyecto','tarea','minutos','nota'],
  Auditoria:  ['ts','actor','accion','detalle','ip'],
  Turnos:         ['id','trabajador','desde','hasta','horario_id','nota','autor','ts'],
  Centros:        ['id','nombre','direccion','lat','lng','radio_m','pais','region','localidad','activo'],
  Publicaciones:  ['id','ts','autor','categoria','titulo','cuerpo','fijado','destinatarios'],
  TiposAusencia:  ['tipo','dias_anuales','cuenta_saldo','requiere_justificante','arrastrable','color','activo'],
  Intentos:       ['ts','nombre','ip','resultado'],
  Empresa:        ['clave','valor'],
  Descansos:      ['id','nombre','minutos','desde','hasta','remunerado','computa','activo'],
  Consentimientos:['ts','trabajador','tipo','valor','version','ip'],
  HorasExtra:     ['id','ts','trabajador','fecha','minutos','motivo','estado','validador','ts_validacion','comentario'],
  Planificacion:  ['id','trabajador','fecha','horario_id','desde','hasta','nota','ts']
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
  // Una cuenta de Inspección consulta y exporta, pero no ficha ni modifica nada
  if (esInspector(emp) && ['bootstrap','informe','incidencias','verificarCadena','auditoria',
      'misAusencias','ausenciasEquipo','estadoEquipo','miPerfil','misFichajes'].indexOf(a) < 0) {
    return { ok: false, error: 'CUENTA_SOLO_LECTURA' };
  }
  var nivelUsuario = nivel(emp);
  var esGestor = nivelUsuario >= 1 || esInspector(emp);   // gestión o consulta legal
  var esDir = nivelUsuario >= 2;         // solo administrador

  switch (a) {
    case 'bootstrap':       return bootstrap(emp, esDir);
    case 'fichar':          return fichar(emp, b);
    case 'misFichajes':     return misFichajes(emp, b);
    case 'estadoEquipo':    return estadoEquipo();
    case 'solicitarAusencia': return solicitarAusencia(emp, b);
    case 'cancelarAusencia':  return cancelarAusencia(emp, b);
    case 'misAusencias':    return misAusencias(emp, b);
    case 'ausenciasEquipo': return ausenciasEquipo(b, emp);
    case 'imputarTarea':    return imputarTarea(emp, b);
    case 'misTareas':       return misTareas(emp, b);
    case 'miPerfil':        return miPerfil(emp);
    case 'actualizarPerfil':return actualizarPerfil(emp, b);
    case 'cambiarPin':      return cambiarPin(emp, b);
    case 'publicaciones':   return publicaciones(emp);
    case 'solicitarCorreccion': return solicitarCorreccion(emp, b);

    // ── Solo dirección ──
    case 'validarAusencia': return esGestor ? validarAusencia(emp, b) : denegado();
    case 'corregirFichaje': return esGestor ? corregirFichaje(emp, b) : denegado();
    case 'informe':         return esGestor ? informe(b, emp)       : denegado();
    case 'incidencias':     return esGestor ? incidencias(b, emp)   : denegado();
    case 'verificarCadena': return esDir ? verificarCadena()        : denegado();
    case 'altaEmpleado':    return esDir ? altaEmpleado(emp, b)     : denegado();
    case 'guardarTurno':    return esGestor ? guardarTurno(emp, b)  : denegado();
    case 'borrarTurno':     return esGestor ? borrarTurno(emp, b)   : denegado();
    case 'turnosEquipo':    return esGestor ? turnosEquipo(b, emp)  : denegado();
    case 'guardarCentro':   return esDir ? guardarCentro(emp, b)    : denegado();
    case 'centros':         return esDir ? { ok: true, centros: leer(HOJAS.centros) } : denegado();
    case 'publicar':        return esDir ? publicar(emp, b)         : denegado();
    case 'borrarPublicacion': return esDir ? borrarPublicacion(emp, b) : denegado();
    case 'analytics':       return esDir ? analytics(b)             : denegado();
    case 'tokenCalendario': return tokenCalendario(emp, b);
    case 'avisoPrivacidad': return avisoPrivacidad(emp);
    case 'aceptarAviso':    return aceptarAviso(emp, b);
    case 'consentimiento':  return guardarConsentimiento(emp, b);
    case 'misDatos':        return misDatos(emp);
    case 'pedirHorasExtra': return pedirHorasExtra(emp, b);
    case 'misHorasExtra':   return misHorasExtra(emp);
    case 'miPlan':          return miPlan(emp, b);
    case 'guardarPlan':     return guardarPlan(emp, b);
    case 'borrarPlan':      return borrarPlan(emp, b);
    case 'corregirJornada': return esGestor ? corregirJornada(emp, b) : denegado();
    case 'horasExtraEquipo':return esGestor ? horasExtraEquipo(emp)      : denegado();
    case 'validarHorasExtra':return esGestor ? validarHorasExtra(emp, b) : denegado();
    case 'purgar':          return esDir ? purgarAntiguos(emp, b)        : denegado();
    case 'auditoria':       return esDir ? auditoria(b)           : denegado();
    case 'editarEmpleado':  return esDir ? editarEmpleado(emp, b) : denegado();
    case 'resetPin':        return esDir ? resetPin(emp, b)       : denegado();
    case 'guardarTipoAusencia': return esDir ? guardarTipoAusencia(emp, b) : denegado();
    case 'tiposAusencia':   return { ok: true, tipos: tiposAusencia() };
    case 'configuracion':   return esDir ? configuracion()             : denegado();
    case 'guardarEmpresa':  return esDir ? guardarEmpresa(emp, b)      : denegado();
    case 'guardarHorario':  return esDir ? guardarHorario(emp, b)      : denegado();
    case 'guardarDescanso': return esDir ? guardarDescanso(emp, b)     : denegado();
    case 'guardarFestivo':  return esDir ? guardarFestivo(emp, b)      : denegado();
    case 'importarFestivos':return esDir ? importarFestivos(emp, b)    : denegado();
    case 'eliminar':        return esDir ? eliminarFila(emp, b)        : denegado();
  }
  return { ok: false, error: 'ACCION_DESCONOCIDA: ' + a };
}

function denegado() { return { ok: false, error: 'SIN_PERMISOS' }; }

/**
 * Tres niveles de acceso:
 *   0 EMPLEADO      ve y gestiona lo suyo
 *   1 MANAGER       además valida, planifica turnos y ve a su equipo
 *   2 ADMINISTRADOR además configura la empresa y gestiona la plantilla
 * DIRECCION se mantiene como sinónimo de ADMIN por las fichas ya creadas.
 */
function nivel(emp) {
  var r = String(emp && emp.rol || 'EMPLEADO').toUpperCase();
  if (r === 'ADMIN' || r === 'ADMINISTRADOR' || r === 'DIRECCION') return 2;
  if (r === 'MANAGER' || r === 'RESPONSABLE') return 1;
  return 0;
}
/** Cuenta de solo lectura para Inspección de Trabajo o representación legal. */
function esInspector(emp) {
  return String(emp && emp.rol || '').toUpperCase() === 'INSPECTOR';
}
function esEquipoDe(jefe, nombre) {
  if (nivel(jefe) >= 2) return true;                 // el admin ve a todos
  if (String(nombre).trim() === jefe.nombre) return true;
  var e = buscarEmpleado(nombre);
  return !!e && String(e.responsable || '').trim() === jefe.nombre;
}

/**
 * A quién puede ver una persona. El administrador, a toda la plantilla; el
 * manager, solo a quien le reporta y a sí mismo. Devolver null significa
 * "sin límite" y evita filtrar en balde en el caso del administrador.
 */
function ambito(emp) {
  if (nivel(emp) >= 2 || esInspector(emp)) return null;
  var mios = leer(HOJAS.empleados)
    .filter(function (e) { return String(e.responsable || '').trim() === emp.nombre; })
    .map(function (e) { return String(e.nombre).trim(); });
  mios.push(emp.nombre);
  return mios;
}
function dentroDe(lista, nombre) {
  return !lista || lista.indexOf(String(nombre).trim()) >= 0;
}

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
      fecha_alta: emp.fecha_alta ? String(emp.fecha_alta).slice(0, 10) : '',
      nivel: nivel(emp)
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
                                   lat: Number(c.lat), lng: Number(c.lng), radio_m: Number(c.radio_m || 150),
                                   localidad: c.localidad || '' }; }),
    turnos: turnosDe(emp.nombre),
    tiposAusencia: tiposAusencia(),
    exigirCentro: exigeCentro(),
    empresa: datosEmpresa(),
    descansos: descansos(),
    nivel: nivel(emp),
    rol: String(emp.rol || 'EMPLEADO').toUpperCase(),
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
  return String(h.getRange(n, 19).getValue() || 'GENESIS');
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
      String(b.modalidad || 'OFICINA'), centro ? centro.nombre : '', String(b.descanso || ''),
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
    modalidad: f.modalidad || 'OFICINA', centro: f.centro || '', descanso: f.descanso || ''
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

/**
 * Petición de corrección de un fichaje. No toca el registro: avisa a quien
 * lleva el control horario para que la aplique con su motivo y su autor.
 */
function solicitarCorreccion(emp, b) {
  var motivo = String(b.motivo || '').trim();
  var ts = String(b.ts || '');
  var tipo = String(b.tipo || '').toUpperCase();
  if (!motivo || !ts || TIPOS_FICHAJE.indexOf(tipo) < 0) return { ok: false, error: 'DATOS_INCOMPLETOS' };

  var d = new Date(ts);
  if (isNaN(d.getTime())) return { ok: false, error: 'FECHA_INVALIDA' };

  var etiqueta = { ENTRADA: 'entrada', SALIDA: 'salida',
                   PAUSA_INI: 'inicio de pausa', PAUSA_FIN: 'fin de pausa' }[tipo];
  var cuando = Utilities.formatDate(d, TZ, 'dd/MM/yyyy HH:mm');

  var destinos = [datosEmpresa().email_correcciones].filter(Boolean);
  if (emp.responsable) {
    var jefe = buscarEmpleado(emp.responsable);
    if (jefe && jefe.email) destinos.push(String(jefe.email));
  }

  enviar(destinos, 'Corrección de fichaje · ' + emp.nombre,
    '<b>' + emp.nombre + '</b> pide corregir un fichaje:<br><br>' +
    'Tipo: <b>' + etiqueta + '</b><br>Hora correcta: <b>' + cuando + '</b><br>' +
    'Motivo: ' + motivo + '<br><br>' +
    'Aplícala desde <b>Incidencias → Corregir</b>. Quedará registrada con tu nombre y el motivo, ' +
    'sin borrar el fichaje original.');

  auditar(emp.nombre, 'PIDE_CORRECCION', tipo + ' ' + cuando + ' — ' + motivo);
  return { ok: true, avisados: destinos.length };
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

  if (!esEquipoDe(dir, trabajador)) return { ok: false, error: 'FUERA_DE_TU_EQUIPO' };
  var emp = buscarEmpleado(trabajador);
  var d = new Date(ts);
  if (isNaN(d.getTime())) return { ok: false, error: 'FECHA_INVALIDA' };

  var id = uid('C');
  var prev = ultimoHash();
  var base = [id, d.toISOString(), trabajador, tipo].join('|');
  var hash = sha256(prev + '|' + base);

  hoja(HOJAS.fichajes).appendRow([
    id, d.toISOString(), fmtFecha(d), fmtHora(d), trabajador, emp ? emp.email : '', tipo,
    '', '', '', '', 'CORRECCION', motivo, dir.nombre, '', '', '', prev, hash
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

function ausenciasEquipo(b, emp) {
  var year = String(b.year || new Date().getFullYear());
  var lista = ambito(emp);
  var filas = leer(HOJAS.ausencias).filter(function (a) {
    return normFecha(a.fecha_inicio).slice(0, 4) === year && dentroDe(lista, a.trabajador);
  }).map(limpiarAusencia);
  return { ok: true, ausencias: filas, ambito: lista };
}

function validarAusencia(dir, b) {
  var id = String(b.id || '');
  var decision = String(b.decision || '').toUpperCase(); // APROBADA | DENEGADA
  if (['APROBADA', 'DENEGADA'].indexOf(decision) < 0) return { ok: false, error: 'DECISION_INVALIDA' };
  var filas = leer(HOJAS.ausencias);
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i].id) !== id) continue;
    if (!esEquipoDe(dir, filas[i].trabajador)) return { ok: false, error: 'FUERA_DE_TU_EQUIPO' };
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

// ── DIRECCIÓN: informes e incidencias ────────────────────────────────────────
function informe(b, emp) {
  var desde = String(b.desde || '1900-01-01'), hasta = String(b.hasta || '2999-12-31');
  var lista = ambito(emp);
  var filas = leer(HOJAS.fichajes).filter(function (f) {
    var fe = normFecha(f.fecha);
    return fe >= desde && fe <= hasta && dentroDe(lista, f.trabajador) &&
           (!b.trabajador || String(f.trabajador).trim() === String(b.trabajador));
  }).map(limpiarFichaje);
  return { ok: true, fichajes: filas, desde: desde, hasta: hasta };
}

function incidencias(b, emp) {
  var desde = String(b.desde || fmtFecha(ahora())), hasta = String(b.hasta || fmtFecha(ahora()));
  var lista = emp ? ambito(emp) : null;
  var porClave = {};
  leer(HOJAS.fichajes).forEach(function (f) {
    var fe = normFecha(f.fecha);
    if (fe < desde || fe > hasta || !dentroDe(lista, f.trabajador)) return;
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

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIGURACIÓN
   ═══════════════════════════════════════════════════════════════════════════ */

var EMPRESA_POR_DEFECTO = {
  nombre: 'Durán Carasso', razon_social: '', cif: '',
  logo_url: '', moneda: 'EUR', industria: 'Inmobiliaria',
  convenio: 'Oficinas y despachos de Cataluña',
  horario_defecto: 'STD', dias_vacaciones: '23', dominio_email: 'durancarasso.com',
  email_correcciones: 'mabad@durancarasso.com'
};

function datosEmpresa() {
  var filas = leer(HOJAS.empresa);
  if (!filas.length) {
    var h = hoja(HOJAS.empresa);
    Object.keys(EMPRESA_POR_DEFECTO).forEach(function (k) { h.appendRow([k, EMPRESA_POR_DEFECTO[k]]); });
    filas = leer(HOJAS.empresa);
  }
  var out = {};
  Object.keys(EMPRESA_POR_DEFECTO).forEach(function (k) { out[k] = EMPRESA_POR_DEFECTO[k]; });
  filas.forEach(function (f) { out[String(f.clave).trim()] = String(f.valor); });
  return out;
}

function guardarEmpresa(dir, b) {
  var datos = b.datos || {};
  var h = hoja(HOJAS.empresa);
  var filas = leer(HOJAS.empresa);
  var indice = {};
  filas.forEach(function (f) { indice[String(f.clave).trim()] = f._fila; });
  var cambios = [];
  Object.keys(datos).forEach(function (k) {
    var v = String(datos[k]);
    if (indice[k]) {
      if (String(h.getRange(indice[k], 2).getValue()) === v) return;
      h.getRange(indice[k], 2).setValue(v);
    } else h.appendRow([k, v]);
    cambios.push(k);
  });
  if (cambios.length) auditar(dir.nombre, 'CONFIG_EMPRESA', cambios.join(', '));
  return { ok: true, cambios: cambios.length };
}

/* ── Descansos ───────────────────────────────────────────────────────────── */
var DESCANSOS_POR_DEFECTO = [
  ['D-COM', 'Comida',   60, '14:00', '15:00', 'NO', 'NO', 'SI'],
  ['D-CAF', 'Café',     15, '',      '',      'SI', 'SI', 'SI'],
  ['D-PER', 'Personal', 0,  '',      '',      'NO', 'NO', 'SI']
];

function descansos() {
  var filas = leer(HOJAS.descansos);
  if (!filas.length) {
    hoja(HOJAS.descansos).getRange(2, 1, DESCANSOS_POR_DEFECTO.length, 8).setValues(DESCANSOS_POR_DEFECTO);
    filas = leer(HOJAS.descansos);
  }
  return filas.filter(function (d) { return String(d.activo).toUpperCase() !== 'NO'; })
    .map(function (d) {
      return { id: d.id, nombre: d.nombre, minutos: Number(d.minutos || 0),
               desde: d.desde || '', hasta: d.hasta || '',
               remunerado: String(d.remunerado).toUpperCase() === 'SI',
               computa: String(d.computa).toUpperCase() === 'SI' };
    });
}

function guardarDescanso(dir, b) {
  if (!b.nombre) return { ok: false, error: 'DATOS_INCOMPLETOS' };
  var fila = [String(b.id || uid('D')), String(b.nombre), Number(b.minutos || 0),
              String(b.desde || ''), String(b.hasta || ''),
              b.remunerado ? 'SI' : 'NO', b.computa ? 'SI' : 'NO', 'SI'];
  var filas = leer(HOJAS.descansos);
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i].id) !== String(b.id)) continue;
    hoja(HOJAS.descansos).getRange(filas[i]._fila, 1, 1, 8).setValues([fila]);
    auditar(dir.nombre, 'CONFIG_DESCANSO', String(b.nombre));
    return { ok: true, id: fila[0] };
  }
  hoja(HOJAS.descansos).appendRow(fila);
  auditar(dir.nombre, 'ALTA_DESCANSO', String(b.nombre));
  return { ok: true, id: fila[0] };
}

/* ── Horarios ────────────────────────────────────────────────────────────── */
function guardarHorario(dir, b) {
  if (!b.horario_id || !b.nombre) return { ok: false, error: 'DATOS_INCOMPLETOS' };
  var dias = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];
  var trabajados = dias.filter(function (d) { return String(b[d] || '').indexOf('-') > 0; });
  var minutos = trabajados.reduce(function (a, d) {
    var p = String(b[d]).split('-'), x = p[0].split(':'), y = p[1].split(':');
    return a + (+y[0] * 60 + +y[1]) - (+x[0] * 60 + +x[1]);
  }, 0) - trabajados.length * Number(b.pausa_min || 0);

  var fila = [String(b.horario_id), String(b.nombre)]
    .concat(dias.map(function (d) { return String(b[d] || ''); }))
    .concat([Number(b.pausa_min || 0), Math.round(minutos / 60 * 10) / 10,
             String(b.tipo || 'Fijo'), trabajados.length, 'SI']);

  var filas = leer(HOJAS.horarios);
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i].horario_id) !== String(b.horario_id)) continue;
    hoja(HOJAS.horarios).getRange(filas[i]._fila, 1, 1, fila.length).setValues([fila]);
    auditar(dir.nombre, 'CONFIG_HORARIO', String(b.nombre));
    return { ok: true };
  }
  hoja(HOJAS.horarios).appendRow(fila);
  auditar(dir.nombre, 'ALTA_HORARIO', String(b.nombre));
  return { ok: true };
}

/* ── Festivos ────────────────────────────────────────────────────────────── */
function guardarFestivo(dir, b) {
  if (!b.fecha || !b.nombre) return { ok: false, error: 'DATOS_INCOMPLETOS' };
  var filas = leer(HOJAS.festivos);
  for (var i = 0; i < filas.length; i++) {
    if (normFecha(filas[i].fecha) !== String(b.fecha).slice(0, 10)) continue;
    hoja(HOJAS.festivos).getRange(filas[i]._fila, 1, 1, 3)
      .setValues([[String(b.fecha).slice(0, 10), String(b.nombre), String(b.ambito || 'Local')]]);
    return { ok: true };
  }
  hoja(HOJAS.festivos).appendRow([String(b.fecha).slice(0, 10), String(b.nombre), String(b.ambito || 'Local')]);
  auditar(dir.nombre, 'ALTA_FESTIVO', b.fecha + ' ' + b.nombre);
  return { ok: true };
}

/**
 * Trae los festivos oficiales del año para los países y regiones donde hay
 * centros, usando date.nager.at (abierto, sin clave). Los locales de cada
 * municipio no están en ningún registro público fiable: esos se añaden a mano.
 */
function importarFestivos(dir, b) {
  var year = Number(b.year || new Date().getFullYear());
  var centros = leer(HOJAS.centros).filter(function (c) { return String(c.activo).toUpperCase() !== 'NO'; });
  if (!centros.length) return { ok: false, error: 'SIN_CENTROS' };

  var paises = {};
  centros.forEach(function (c) {
    var p = String(c.pais || 'ES').toUpperCase().trim();
    (paises[p] = paises[p] || {})[String(c.region || '').toUpperCase().trim()] = true;
  });

  var existentes = {};
  leer(HOJAS.festivos).forEach(function (f) { existentes[normFecha(f.fecha)] = true; });

  var nuevos = [], errores = [];
  Object.keys(paises).forEach(function (pais) {
    try {
      var res = UrlFetchApp.fetch('https://date.nager.at/api/v3/PublicHolidays/' + year + '/' + pais,
                                  { muteHttpExceptions: true });
      if (res.getResponseCode() !== 200) { errores.push(pais + ': HTTP ' + res.getResponseCode()); return; }
      JSON.parse(res.getContentText()).forEach(function (f) {
        var regiones = Object.keys(paises[pais]);
        var aplica = f.global || !f.counties ||
          f.counties.some(function (c) { return regiones.indexOf(String(c).toUpperCase()) >= 0; });
        if (!aplica || existentes[f.date]) return;
        existentes[f.date] = true;
        nuevos.push([f.date, f.localName || f.name, f.global ? 'Nacional ' + pais : 'Autonómico']);
      });
    } catch (e) { errores.push(pais + ': ' + e.message); }
  });

  if (nuevos.length) {
    nuevos.sort();
    hoja(HOJAS.festivos).getRange(hoja(HOJAS.festivos).getLastRow() + 1, 1, nuevos.length, 3).setValues(nuevos);
    auditar(dir.nombre, 'IMPORTA_FESTIVOS', year + ' · ' + nuevos.length + ' festivos');
  }
  return { ok: true, importados: nuevos.length, errores: errores,
           aviso: 'Los festivos locales de cada municipio hay que añadirlos a mano.' };
}

/* ── Borrado genérico con trazabilidad ───────────────────────────────────── */
var BORRABLES = {
  centros:       { hoja: 'Centros',       clave: 'id' },
  horarios:      { hoja: 'Horarios',      clave: 'horario_id' },
  descansos:     { hoja: 'Descansos',     clave: 'id' },
  festivos:      { hoja: 'Festivos',      clave: 'fecha' },
  tiposAusencia: { hoja: 'TiposAusencia', clave: 'tipo' },
  turnos:        { hoja: 'Turnos',        clave: 'id' },
  publicaciones: { hoja: 'Publicaciones', clave: 'id' }
};

/**
 * Borra una fila de una tabla de configuración. Las personas nunca se borran:
 * se marcan de baja para no romper el histórico de fichajes ni las ausencias.
 */
function eliminarFila(dir, b) {
  if (String(b.tabla) === 'empleados') return darDeBaja(dir, b);
  var def = BORRABLES[String(b.tabla)];
  if (!def) return { ok: false, error: 'TABLA_NO_BORRABLE' };
  if (def.hoja === 'Centros' && leer(HOJAS.centros).length <= 1) {
    return { ok: false, error: 'ULTIMO_CENTRO' };
  }
  var filas = leer(def.hoja);
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i][def.clave]).trim() !== String(b.id).trim() &&
        normFecha(filas[i][def.clave]) !== String(b.id).slice(0, 10)) continue;
    if (def.hoja === 'Horarios' && enUso(String(b.id))) return { ok: false, error: 'HORARIO_EN_USO' };
    hoja(def.hoja).deleteRow(filas[i]._fila);
    auditar(dir.nombre, 'ELIMINA_' + def.hoja.toUpperCase(), String(b.id));
    return { ok: true };
  }
  return { ok: false, error: 'NO_ENCONTRADO' };
}

function enUso(horarioId) {
  return leer(HOJAS.empleados).some(function (e) {
    return String(e.horario_id).trim() === horarioId && String(e.activo).toUpperCase() !== 'NO';
  });
}

function darDeBaja(dir, b) {
  var emp = buscarEmpleado(b.id || b.nombre);
  if (!emp) return { ok: false, error: 'NO_ENCONTRADO' };
  if (emp.nombre === dir.nombre) return { ok: false, error: 'NO_TE_PUEDES_BORRAR' };
  var h = hoja(HOJAS.empleados);
  var cols = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0].map(String);
  h.getRange(emp._fila, cols.indexOf('activo') + 1).setValue('NO');
  var colBaja = cols.indexOf('fecha_baja') + 1;
  if (colBaja > 0 && !h.getRange(emp._fila, colBaja).getValue()) {
    h.getRange(emp._fila, colBaja).setValue(String(b.fechaBaja || fmtFecha(ahora())));
  }
  auditar(dir.nombre, 'BAJA_EMPLEADO', emp.nombre);
  return { ok: true, baja: true };
}

function configuracion() {
  return { ok: true,
    empresa: datosEmpresa(),
    centros: leer(HOJAS.centros),
    horarios: leer(HOJAS.horarios),
    descansos: leer(HOJAS.descansos),
    festivos: leer(HOJAS.festivos).map(function (f) {
      return { fecha: normFecha(f.fecha), nombre: f.nombre, ambito: f.ambito };
    }),
    tipos: tiposAusencia(),
    roles: [
      { rol: 'EMPLEADO', nombre: 'Empleado',       descripcion: 'Ficha, pide ausencias y consulta lo suyo.' },
      { rol: 'MANAGER',  nombre: 'Manager',        descripcion: 'Además valida ausencias, corrige incidencias y planifica turnos de su equipo.' },
      { rol: 'ADMIN',    nombre: 'Administrador',  descripcion: 'Además configura la empresa, gestiona la plantilla y ve la auditoría.' }
    ],
    personas: leer(HOJAS.empleados).map(function (e) {
      return { nombre: e.nombre, rol: String(e.rol || 'EMPLEADO').toUpperCase(),
               activo: String(e.activo).toUpperCase() !== 'NO' };
    })
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   RGPD
   ═══════════════════════════════════════════════════════════════════════════ */

var VERSION_AVISO = '2026-09';
var ANOS_CONSERVACION = 4;

function textoAviso() {
  var e = datosEmpresa();
  return {
    version: VERSION_AVISO,
    responsable: e.razon_social || e.nombre,
    finalidad: 'Cumplir la obligación legal de registro diario de jornada y gestionar ausencias, ' +
               'horarios y turnos.',
    base: 'Obligación legal (art. 34.9 del Estatuto de los Trabajadores) y ejecución del contrato ' +
          'de trabajo. La geolocalización es voluntaria y se basa en tu consentimiento, que puedes ' +
          'retirar cuando quieras.',
    datos: 'Nombre, correo corporativo, departamento, centro, horario, fichajes con su hora exacta, ' +
           'ausencias con su justificante y, si lo autorizas, la ubicación en el momento de fichar.',
    conservacion: 'Los fichajes se conservan ' + ANOS_CONSERVACION + ' años, como exige la ley, y ' +
                  'después se eliminan. El resto de datos, mientras dure la relación laboral y los ' +
                  'plazos de prescripción aplicables.',
    destinatarios: 'Tu responsable directo, la dirección de la empresa, la gestoría laboral y, si lo ' +
                   'requieren, la Inspección de Trabajo y la representación legal de los trabajadores. ' +
                   'Los datos se alojan en Google Workspace (Irlanda, Unión Europea).',
    derechos: 'Puedes acceder a tus datos, rectificarlos, oponerte al tratamiento, limitarlo y pedir ' +
              'su portabilidad desde «Mi perfil → Mis datos», o escribiendo a ' + (e.email_correcciones || '') +
              '. También puedes reclamar ante la Agencia Española de Protección de Datos.',
    noAutomatizado: 'No se toman decisiones automatizadas ni se elabora ningún perfil con estos datos.'
  };
}

function avisoPrivacidad(emp) {
  var aceptado = leer(HOJAS.consentimientos).filter(function (c) {
    return String(c.trabajador).trim() === emp.nombre && String(c.tipo) === 'AVISO' &&
           String(c.version) === VERSION_AVISO;
  }).pop();
  var geo = leer(HOJAS.consentimientos).filter(function (c) {
    return String(c.trabajador).trim() === emp.nombre && String(c.tipo) === 'GEO';
  }).pop();
  return { ok: true, aviso: textoAviso(),
           aceptado: !!aceptado, fechaAceptado: aceptado ? String(aceptado.ts) : '',
           geo: geo ? String(geo.valor).toUpperCase() === 'SI' : null };
}

function aceptarAviso(emp, b) {
  hoja(HOJAS.consentimientos).appendRow([new Date().toISOString(), emp.nombre, 'AVISO', 'SI', VERSION_AVISO, '']);
  if (b.geo !== undefined) guardarConsentimiento(emp, { tipo: 'GEO', valor: !!b.geo });
  auditar(emp.nombre, 'ACEPTA_AVISO_PRIVACIDAD', VERSION_AVISO);
  return { ok: true };
}

function guardarConsentimiento(emp, b) {
  var tipo = String(b.tipo || 'GEO').toUpperCase();
  hoja(HOJAS.consentimientos).appendRow([new Date().toISOString(), emp.nombre, tipo,
    b.valor ? 'SI' : 'NO', VERSION_AVISO, '']);
  auditar(emp.nombre, 'CONSENTIMIENTO_' + tipo, b.valor ? 'otorgado' : 'retirado');
  return { ok: true };
}

/** Derecho de acceso y portabilidad: todo lo que la empresa guarda de una persona. */
function misDatos(emp) {
  var mio = function (h, campo) {
    return leer(h).filter(function (r) { return String(r[campo || 'trabajador']).trim() === emp.nombre; })
      .map(function (r) { delete r._fila; return r; });
  };
  var ficha = {};
  Object.keys(emp).forEach(function (k) { if (k !== 'pin' && k !== '_fila') ficha[k] = emp[k]; });
  return { ok: true, generado: new Date().toISOString(), datos: {
    ficha: ficha,
    fichajes: mio(HOJAS.fichajes),
    ausencias: mio(HOJAS.ausencias),
    tareas: mio(HOJAS.tareas),
    turnos: mio(HOJAS.turnos),
    horasExtra: mio(HOJAS.extras),
    consentimientos: mio(HOJAS.consentimientos),
    accesos: leer(HOJAS.auditoria).filter(function (a) { return String(a.actor).trim() === emp.nombre; })
      .map(function (a) { delete a._fila; return a; })
  }};
}

/**
 * Elimina los fichajes que superan el plazo legal de conservación.
 * Antes de borrar deja copia en Drive: la obligación es conservar cuatro años,
 * no destruir a ciegas al día siguiente.
 */
function purgarAntiguos(dir, b) {
  var limite = new Date();
  limite.setFullYear(limite.getFullYear() - ANOS_CONSERVACION);
  var corte = fmtFecha(limite);
  if (!b.confirmar) {
    var cuantos = leer(HOJAS.fichajes).filter(function (f) { return normFecha(f.fecha) < corte; }).length;
    return { ok: true, simulacion: true, corte: corte, afectados: cuantos };
  }
  copiaSeguridad();
  var h = hoja(HOJAS.fichajes);
  var filas = leer(HOJAS.fichajes);
  var borradas = 0;
  for (var i = filas.length - 1; i >= 0; i--) {
    if (normFecha(filas[i].fecha) >= corte) continue;
    h.deleteRow(filas[i]._fila);
    borradas++;
  }
  auditar(dir.nombre, 'PURGA_LEGAL', borradas + ' fichajes anteriores a ' + corte);
  return { ok: true, borradas: borradas, corte: corte };
}

/* ── Planificación personal ──────────────────────────────────────────────
   Lo que cada persona prevé trabajar. No es un fichaje ni cuenta como tal:
   sirve para comparar lo previsto con lo realmente registrado.            */
function limpiarPlan(p) {
  return { id: p.id, fecha: normFecha(p.fecha), horario_id: p.horario_id,
           desde: p.desde || '', hasta: p.hasta || '', nota: p.nota || '' };
}
function miPlan(emp, b) {
  var mes = String(b.mes || '');   // AAAA-MM
  return { ok: true, plan: leer(HOJAS.planificacion).filter(function (p) {
    return String(p.trabajador).trim() === emp.nombre &&
           (!mes || normFecha(p.fecha).slice(0, 7) === mes);
  }).map(limpiarPlan) };
}
function guardarPlan(emp, b) {
  var fecha = String(b.fecha || '').slice(0, 10);
  if (!fecha) return { ok: false, error: 'FECHA_OBLIGATORIA' };
  var fila = [uid('PL'), emp.nombre, fecha, String(b.horario_id || ''),
              String(b.desde || ''), String(b.hasta || ''), String(b.nota || ''),
              new Date().toISOString()];
  var filas = leer(HOJAS.planificacion);
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i].trabajador).trim() !== emp.nombre) continue;
    if (normFecha(filas[i].fecha) !== fecha) continue;
    fila[0] = filas[i].id;
    hoja(HOJAS.planificacion).getRange(filas[i]._fila, 1, 1, 8).setValues([fila]);
    return { ok: true, id: fila[0] };
  }
  hoja(HOJAS.planificacion).appendRow(fila);
  return { ok: true, id: fila[0] };
}
function borrarPlan(emp, b) {
  var filas = leer(HOJAS.planificacion);
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i].id) !== String(b.id)) continue;
    if (String(filas[i].trabajador).trim() !== emp.nombre) return denegado();
    hoja(HOJAS.planificacion).deleteRow(filas[i]._fila);
    return { ok: true };
  }
  return { ok: false, error: 'NO_ENCONTRADO' };
}

/**
 * Rellena de golpe la jornada teórica de un día que quedó sin fichar.
 * Sigue siendo una corrección: entrada y salida se añaden como registros
 * nuevos con su autor y su motivo, sin tocar nada de lo ya guardado.
 */
function corregirJornada(dir, b) {
  var trabajador = String(b.trabajador || '').trim();
  var fecha = String(b.fecha || '').slice(0, 10);
  var entrada = String(b.entrada || ''), salida = String(b.salida || '');
  if (!trabajador || !fecha || !entrada || !salida) return { ok: false, error: 'DATOS_INCOMPLETOS' };
  if (!esEquipoDe(dir, trabajador)) return { ok: false, error: 'FUERA_DE_TU_EQUIPO' };

  var yaTiene = leer(HOJAS.fichajes).some(function (f) {
    return String(f.trabajador).trim() === trabajador && normFecha(f.fecha) === fecha;
  });
  if (yaTiene && !b.forzar) return { ok: false, error: 'YA_TIENE_FICHAJES' };

  var motivo = String(b.motivo || '').trim() ||
    'Jornada no fichada · se aplica el horario asignado, validado por ' + dir.nombre;
  var puestos = [];
  [['ENTRADA', entrada], ['SALIDA', salida]].forEach(function (par) {
    var r = corregirFichaje(dir, { trabajador: trabajador, tipo: par[0],
      ts: fecha + 'T' + par[1] + ':00', motivo: motivo });
    if (r.ok) puestos.push(par[0]);
  });
  return { ok: puestos.length === 2, puestos: puestos };
}

/* ── Horas extra ─────────────────────────────────────────────────────────── */
function pedirHorasExtra(emp, b) {
  var minutos = Number(b.minutos || 0);
  var motivo = String(b.motivo || '').trim();
  if (!minutos || !motivo) return { ok: false, error: 'DATOS_INCOMPLETOS' };
  var id = uid('HE');
  hoja(HOJAS.extras).appendRow([id, new Date().toISOString(), emp.nombre,
    String(b.fecha || fmtFecha(ahora())), minutos, motivo, 'PENDIENTE', '', '', '']);
  auditar(emp.nombre, 'PIDE_HORAS_EXTRA', b.fecha + ' · ' + minutos + ' min');

  var destinos = emp.responsable ? [String((buscarEmpleado(emp.responsable) || {}).email || '')] : [];
  destinos = destinos.filter(Boolean);
  if (!destinos.length) destinos = destinatariosDireccion();
  enviar(destinos, 'Horas extra · ' + emp.nombre,
    '<b>' + emp.nombre + '</b> justifica <b>' + (minutos / 60).toFixed(1) + ' h</b> de exceso de jornada ' +
    'el ' + b.fecha + '.<br><br>Motivo: ' + motivo + '<br><br>Valídalas en Gestión → Horas extra.');
  return { ok: true, id: id };
}

function limpiarExtra(x) {
  return { id: x.id, trabajador: x.trabajador, fecha: normFecha(x.fecha),
           minutos: Number(x.minutos || 0), motivo: x.motivo,
           estado: String(x.estado).toUpperCase(), validador: x.validador, comentario: x.comentario };
}
function misHorasExtra(emp) {
  return { ok: true, extras: leer(HOJAS.extras)
    .filter(function (x) { return String(x.trabajador).trim() === emp.nombre; }).map(limpiarExtra) };
}
function horasExtraEquipo(emp) {
  var lista = ambito(emp);
  return { ok: true, extras: leer(HOJAS.extras)
    .filter(function (x) { return dentroDe(lista, x.trabajador); }).map(limpiarExtra) };
}
function validarHorasExtra(dir, b) {
  var decision = String(b.decision || '').toUpperCase();
  if (['APROBADA', 'DENEGADA'].indexOf(decision) < 0) return { ok: false, error: 'DECISION_INVALIDA' };
  var filas = leer(HOJAS.extras);
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i].id) !== String(b.id)) continue;
    if (!esEquipoDe(dir, filas[i].trabajador)) return { ok: false, error: 'FUERA_DE_TU_EQUIPO' };
    var h = hoja(HOJAS.extras);
    h.getRange(filas[i]._fila, 7, 1, 4).setValues([[decision, dir.nombre, new Date().toISOString(),
      String(b.comentario || '')]]);
    auditar(dir.nombre, 'VALIDA_HORAS_EXTRA', b.id + ' → ' + decision);
    return { ok: true };
  }
  return { ok: false, error: 'NO_ENCONTRADA' };
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
  datosEmpresa();   // siembra la ficha de empresa
  descansos();      // y los tipos de descanso
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRET'))  props.setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  if (!props.getProperty('API_KEY')) props.setProperty('API_KEY', Utilities.getUuid());
  if (!props.getProperty('EXIGIR_CENTRO')) props.setProperty('EXIGIR_CENTRO', 'NO');
  if (!props.getProperty('LIMITE_ARRASTRE')) props.setProperty('LIMITE_ARRASTRE', '03-31');
  tiposAusencia();   // siembra la tabla de tipos con sus cupos

  var hCen = hoja(HOJAS.centros);
  if (hCen.getLastRow() < 2) {
    hCen.appendRow(['CT-BCN', 'Barcelona', 'Av. Diagonal, Barcelona', 41.3947, 2.1503, 150, 'ES', 'ES-CT', 'Barcelona', 'SI']);
    hCen.appendRow(['CT-SIT', 'Sitges',    'Sitges',                  41.2371, 1.8055, 150, 'ES', 'ES-CT', 'Sitges',    'SI']);
    hCen.appendRow(['CT-AND', 'Andorra',   'Andorra la Vella',        42.5063, 1.5218, 150, 'AD', '',      'Andorra la Vella', 'SI']);
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
  if (!esEquipoDe(dir, b.trabajador)) return { ok: false, error: 'FUERA_DE_TU_EQUIPO' };
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

function turnosEquipo(b, emp) {
  var desde = String(b.desde || '1900-01-01'), hasta = String(b.hasta || '2999-12-31');
  var lista = emp ? ambito(emp) : null;
  var filas = leer(HOJAS.turnos).filter(function (t) {
    return normFecha(t.desde) <= hasta && normFecha(t.hasta) >= desde && dentroDe(lista, t.trabajador);
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
      h.getRange(filas[i]._fila, 2, 1, 9).setValues([[String(b.nombre), String(b.direccion || ''),
        Number(b.lat), Number(b.lng), Number(b.radio_m || 150),
        String(b.pais || 'ES').toUpperCase(), String(b.region || '').toUpperCase(),
        String(b.localidad || ''), b.activo === false ? 'NO' : 'SI']]);
      return { ok: true, id: b.id };
    }
  }
  var id = uid('CT');
  hoja(HOJAS.centros).appendRow([id, String(b.nombre), String(b.direccion || ''),
    Number(b.lat), Number(b.lng), Number(b.radio_m || 150),
    String(b.pais || 'ES').toUpperCase(), String(b.region || '').toUpperCase(),
    String(b.localidad || ''), 'SI']);
  auditar(dir.nombre, 'ALTA_CENTRO', String(b.nombre));
  return { ok: true, id: id };
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

// ── ANALYTICS ────────────────────────────────────────────────────────────────
function analytics(b) {
  // Solo el administrador llega aquí: la analítica es de toda la plantilla
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
  ScriptApp.newTrigger('purgaAnual').timeBased().onMonthDay(15).atHour(4).create();

  return 'Automatismos instalados: recordatorio 18:30, cierre 23:45, copia 03:00, ' +
         'avisos lunes 09:00 y cierre de mes el día 1.';
}

/** Cada 15 de enero se eliminan los fichajes que superan el plazo legal. */
function purgaAnual() {
  if (ahora().getMonth() !== 0) return;
  var r = purgarAntiguos({ nombre: 'SISTEMA' }, { confirmar: true });
  if (r.borradas) {
    enviar(destinatariosDireccion(), 'Purga legal de fichajes',
      'Se han eliminado <b>' + r.borradas + '</b> fichajes anteriores al ' + r.corte +
      ', que ya superaban los ' + ANOS_CONSERVACION + ' años de conservación obligatoria. ' +
      'Antes se guardó una copia en Drive.');
  }
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
    '', '', '', 'Sistema', 'AUTOMATICO', motivo, 'SISTEMA', '', '', '', prev, hash
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

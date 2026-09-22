/**
 * ═══════════════════════════════════════════════════════════════════════
 *  DURÁN CARASSO · Reputation Agent  (v2 · con botones de acción)
 *  Monitoriza reseñas de Google, las clasifica con IA y envía un email
 *  con borrador de respuesta + botones que FUNCIONAN con 1 clic:
 *    ✅ Publicar respuesta   🔄 Dame otra respuesta   🚩 Reportar a Google
 *  Coste: 0 €. Corre en la infraestructura de Google.
 * ═══════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────
//  1) CONFIGURACIÓN
// ─────────────────────────────────────────────────────────────────────────
const CONFIG = {
  EMAIL_DESTINO: 'adriap@durancarasso.com, aselles@durancarasso.com',
  GEMINI_API_KEY: 'PEGA_AQUI_TU_API_KEY',  // en Apps Script pega tu clave real; NO subir la clave al repositorio
  MARCA: 'Durán Carasso',
  TONO: 'Cercano, profesional, elegante. Trato de usted. Firma como "El equipo de Durán Carasso".',
  GEMINI_MODEL: 'gemini-1.5-flash',
  NOMBRE_HOJA: 'DuranCarasso_Reseñas_Log',
};

// ─────────────────────────────────────────────────────────────────────────
//  2) FUNCIÓN PRINCIPAL (trigger horario)
// ─────────────────────────────────────────────────────────────────────────
function revisarReseñas() {
  const sheet = getLogSheet_();
  const vistos = getReviewIdsVistos_(sheet);
  const ubicaciones = getUbicaciones_();
  if (!ubicaciones.length) { Logger.log('Sin ubicaciones. Revisa acceso Business Profile.'); return; }
  let nuevas = 0;
  ubicaciones.forEach(function (loc) {
    getReseñas_(loc.account, loc.location).forEach(function (r) {
      const id = r.reviewId || r.name;
      if (!id || vistos[id]) return;
      const estrellas = starRatingToNum_(r.starRating);
      const texto = (r.comment || '').trim();
      const autor = (r.reviewer && r.reviewer.displayName) || 'Cliente';
      const a = analizarConIA_({ ubicacion: loc.title, estrellas: estrellas, texto: texto, autor: autor });
      const token = guardarPendiente_(id, r.name, a.borrador, {
        ubicacion: loc.title, autor: autor, estrellas: estrellas, texto: texto, analisis: a
      });
      enviarEmail_(id, token, loc.title, autor, estrellas, texto, a);
      registrar_(sheet, id, loc.title, autor, estrellas, a);
      vistos[id] = true; nuevas++;
    });
  });
  Logger.log('Reseñas nuevas: ' + nuevas);
}

// ─────────────────────────────────────────────────────────────────────────
//  3) WEB APP · gestiona los clics de los botones (doGet)
// ─────────────────────────────────────────────────────────────────────────
function doGet(e) {
  const p = e.parameter || {};
  const id = p.id, token = p.t, action = p.a;
  const data = leerPendiente_(id);
  if (!data) return pagina_('Enlace no válido o caducado', 'Puede que la reseña ya se haya gestionado.');
  if (token !== data.token) return pagina_('Enlace no autorizado', 'El enlace de seguridad no coincide.');

  if (action === 'publish') {
    try {
      publicarRespuesta_(data.name, data.draft);
      return pagina_('✅ Respuesta publicada', 'Tu respuesta ya está publicada en Google. Puedes cerrar esta pestaña.');
    } catch (err) {
      return pagina_('⚠️ No se pudo publicar', 'Detalle: ' + err.message);
    }
  }

  if (action === 'regen') {
    const nueva = alternativaIA_(data.meta);
    data.draft = nueva;
    setPendiente_(id, data);
    reenviarBorrador_(id, data.token, data.meta, nueva);
    return pagina_('🔄 Nueva respuesta enviada', 'Te hemos mandado una versión alternativa a tu email. Revísala en la bandeja.');
  }

  return pagina_('Acción no reconocida', '');
}

function pagina_(titulo, texto) {
  const html = '<div style="font-family:Arial,sans-serif;max-width:520px;margin:60px auto;text-align:center;color:#1c1c1c">' +
    '<h1 style="font-size:26px">' + titulo + '</h1>' +
    '<p style="color:#555;font-size:15px">' + texto + '</p>' +
    '<p style="color:#999;font-size:12px;margin-top:32px">Durán Carasso · Reputation Agent</p></div>';
  return HtmlService.createHtmlOutput(html).setTitle('Durán Carasso · Reseñas');
}

// ─────────────────────────────────────────────────────────────────────────
//  4) ACCIONES
// ─────────────────────────────────────────────────────────────────────────
function publicarRespuesta_(reviewName, comment) {
  const token = ScriptApp.getOAuthToken();
  const res = UrlFetchApp.fetch('https://mybusiness.googleapis.com/v4/' + reviewName + '/reply', {
    method: 'put', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
    payload: JSON.stringify({ comment: comment }),
  });
  if (res.getResponseCode() >= 400) throw new Error(res.getContentText());
}

function alternativaIA_(meta) {
  const d = { ubicacion: meta.ubicacion, estrellas: meta.estrellas, texto: meta.texto, autor: meta.autor };
  const a = analizarConIA_(d, true); // true = pide una versión distinta
  return a.borrador;
}

// ─────────────────────────────────────────────────────────────────────────
//  5) ALMACÉN DE PENDIENTES (para los botones)
// ─────────────────────────────────────────────────────────────────────────
function guardarPendiente_(id, reviewName, draft, meta) {
  const token = Utilities.getUuid().slice(0, 8);
  setPendiente_(id, { name: reviewName, draft: draft, token: token, meta: meta });
  return token;
}
function setPendiente_(id, data) {
  PropertiesService.getScriptProperties().setProperty('rev_' + id, JSON.stringify(data));
}
function leerPendiente_(id) {
  const raw = PropertiesService.getScriptProperties().getProperty('rev_' + id);
  return raw ? JSON.parse(raw) : null;
}

// ─────────────────────────────────────────────────────────────────────────
//  6) BUSINESS PROFILE · ubicaciones y reseñas
// ─────────────────────────────────────────────────────────────────────────
function getUbicaciones_() {
  const token = ScriptApp.getOAuthToken();
  const out = [];
  const accRes = fetchJson_('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', token);
  ((accRes && accRes.accounts) || []).forEach(function (acc) {
    let pt = '';
    do {
      const url = 'https://mybusinessbusinessinformation.googleapis.com/v1/' + acc.name +
        '/locations?readMask=name,title&pageSize=100' + (pt ? '&pageToken=' + pt : '');
      const locRes = fetchJson_(url, token);
      ((locRes && locRes.locations) || []).forEach(function (l) {
        out.push({ account: acc.name, location: l.name, title: l.title || l.name });
      });
      pt = (locRes && locRes.nextPageToken) || '';
    } while (pt);
  });
  return out;
}

function getReseñas_(accountName, locationName) {
  const token = ScriptApp.getOAuthToken();
  const url = 'https://mybusiness.googleapis.com/v4/' + accountName + '/' + locationName +
    '/reviews?pageSize=50&orderBy=updateTime desc';
  const res = fetchJson_(url, token);
  return (res && res.reviews) || [];
}

// ─────────────────────────────────────────────────────────────────────────
//  7) IA (Gemini)
// ─────────────────────────────────────────────────────────────────────────
function analizarConIA_(d, alternativa) {
  const extra = alternativa
    ? '\nIMPORTANTE: genera una respuesta DISTINTA a las anteriores, con otro enfoque o redacción.'
    : '';
  const prompt = 'Eres el responsable de reputación online de ' + CONFIG.MARCA +
    ', inmobiliaria de lujo. Tono: ' + CONFIG.TONO + extra + '\n\n' +
    'Analiza esta reseña de Google y responde SOLO con JSON válido.\n' +
    'Ubicación: ' + d.ubicacion + '\nAutor: ' + d.autor + '\nEstrellas: ' + d.estrellas + '/5\n' +
    'Texto: "' + (d.texto || '(sin texto)') + '"\n\n' +
    '{"sentimiento":"positiva|neutra|negativa","tema":"2-4 palabras","urgencia":"alta|media|baja",' +
    '"borrador":"respuesta pública lista para Google, mismo idioma de la reseña, con el nombre del autor, ' +
    'empática si es negativa, agradecida si es positiva, sin markdown",' +
    '"accion_interna":"1 recomendación para el equipo; si es positiva pon: ninguna"}';
  try {
    const res = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + CONFIG.GEMINI_MODEL +
        ':generateContent?key=' + CONFIG.GEMINI_API_KEY,
      { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: alternativa ? 0.95 : 0.7, responseMimeType: 'application/json' } }) });
    return JSON.parse(JSON.parse(res.getContentText()).candidates[0].content.parts[0].text);
  } catch (e) { return fallback_(d); }
}

function fallback_(d) {
  const neg = d.estrellas <= 3;
  return {
    sentimiento: d.estrellas >= 4 ? 'positiva' : d.estrellas === 3 ? 'neutra' : 'negativa',
    tema: 'sin clasificar', urgencia: neg ? 'alta' : 'baja',
    borrador: neg
      ? 'Estimado/a ' + d.autor + ', lamentamos que su experiencia no haya sido la esperada. Nos gustaría ayudarle personalmente. Un cordial saludo, el equipo de ' + CONFIG.MARCA + '.'
      : 'Estimado/a ' + d.autor + ', muchas gracias por confiar en ' + CONFIG.MARCA + '. Un cordial saludo.',
    accion_interna: neg ? 'Contactar al cliente en privado y ofrecer seguimiento del director de zona.' : 'ninguna',
  };
}

// ─────────────────────────────────────────────────────────────────────────
//  8) EMAIL (con botones de acción)
// ─────────────────────────────────────────────────────────────────────────
function enviarEmail_(id, token, ubicacion, autor, estrellas, texto, a) {
  const color = a.sentimiento === 'positiva' ? '#1a7f37' : a.sentimiento === 'negativa' ? '#cf222e' : '#9a6700';
  const emoji = a.sentimiento === 'positiva' ? '🟢' : a.sentimiento === 'negativa' ? '🔴' : '🟡';
  const stars = '★'.repeat(estrellas) + '☆'.repeat(5 - estrellas);
  const asunto = emoji + ' ' + String(a.sentimiento).toUpperCase() + ' · ' + ubicacion + ' · ' + estrellas + '★ · ' + CONFIG.MARCA;

  let base = '';
  try { base = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  const q = '?id=' + encodeURIComponent(id) + '&t=' + token + '&a=';
  const linkPub = base ? base + q + 'publish' : '#';
  const linkRegen = base ? base + q + 'regen' : '#';
  const linkGoogle = 'https://business.google.com/reviews';

  const btn = function (href, bg, fg, label, border) {
    return '<a href="' + href + '" style="display:inline-block;background:' + bg + ';color:' + fg +
      ';text-decoration:none;padding:11px 18px;border-radius:6px;font-weight:bold;font-size:14px' +
      (border ? ';border:1px solid #ccc' : '') + '">' + label + '</a>';
  };

  const acciones =
    '<div style="margin-bottom:14px"><div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Acciones (1 clic)</div>' +
    '<table cellpadding="0" cellspacing="0"><tr>' +
      '<td style="padding:0 8px 8px 0">' + btn(linkPub, '#1a7f37', '#fff', '✅ Publicar esta respuesta') + '</td>' +
      '<td style="padding:0 8px 8px 0">' + btn(linkRegen, '#0b5cad', '#fff', '🔄 Dame otra respuesta') + '</td>' +
    '</tr><tr>' +
      '<td style="padding:0 8px 0 0">' + btn(linkGoogle, '#9a3412', '#fff', '🚩 Reportar a Google') + '</td>' +
      '<td style="padding:0 8px 0 0">' + btn(linkGoogle, '#fff', '#1c1c1c', '✍️ Responder yo', true) + '</td>' +
    '</tr></table></div>';

  const html =
    '<html><head><meta name="color-scheme" content="light only">' +
    '<meta name="supported-color-schemes" content="light only"></head>' +
    '<body style="margin:0;background:#eceff3;padding:16px">' +
    '<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#1c1c1c;' +
    'background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:20px">' +
    '<div style="border-left:5px solid ' + color + ';padding:8px 16px;margin-bottom:16px">' +
    '<h2 style="margin:0 0 4px">' + emoji + ' Nueva reseña · ' + ubicacion + '</h2>' +
    '<div style="color:#e3b341;font-size:20px">' + stars + '</div>' +
    '<div style="color:#666;font-size:13px">Autor: <b>' + autor + '</b> · Tema: ' + a.tema + ' · Urgencia: <b>' + a.urgencia + '</b></div></div>' +
    '<div style="background:#f6f8fa;border-radius:8px;padding:12px 16px;margin-bottom:16px"><div style="font-size:12px;color:#666;text-transform:uppercase">Reseña original</div>' +
    '<div style="margin-top:6px;font-style:italic">' + (texto || '(sin texto, solo puntuación)') + '</div></div>' +
    '<div style="border:1px solid ' + color + ';border-radius:8px;padding:12px 16px;margin-bottom:16px"><div style="font-size:12px;color:' + color + ';font-weight:bold;text-transform:uppercase">✍️ Borrador de respuesta</div>' +
    '<div style="margin-top:8px;white-space:pre-wrap">' + a.borrador + '</div></div>' +
    acciones +
    (a.accion_interna && String(a.accion_interna).toLowerCase() !== 'ninguna'
      ? '<div style="background:#fff8e1;border-radius:8px;padding:12px 16px;margin-bottom:16px"><b>🛠️ Acción interna:</b> ' + a.accion_interna + '</div>' : '') +
    '<p style="color:#777;font-size:11px;margin-top:8px">Nota: "Reportar a Google" abre la gestión de reseñas para marcarla como inapropiada; Google decide (no se pueden borrar reseñas de clientes).<br>Automatización gratuita · Durán Carasso Reputation Agent</p></div></body></html>';

  MailApp.sendEmail({ to: CONFIG.EMAIL_DESTINO, subject: asunto, htmlBody: html });
}

function reenviarBorrador_(id, token, meta, nuevoBorrador) {
  const a2 = Object.assign({}, meta.analisis, { borrador: nuevoBorrador });
  enviarEmail_(id, token, meta.ubicacion, meta.autor, meta.estrellas, meta.texto, a2);
}

// ─────────────────────────────────────────────────────────────────────────
//  9) REGISTRO (Sheet)
// ─────────────────────────────────────────────────────────────────────────
function getLogSheet_() {
  const files = DriveApp.getFilesByName(CONFIG.NOMBRE_HOJA);
  let ss;
  if (files.hasNext()) { ss = SpreadsheetApp.open(files.next()); }
  else {
    ss = SpreadsheetApp.create(CONFIG.NOMBRE_HOJA);
    ss.getActiveSheet().appendRow(['Fecha','ReviewID','Ubicación','Autor','Estrellas','Sentimiento','Tema','Urgencia']);
  }
  return ss.getActiveSheet();
}
function getReviewIdsVistos_(sheet) {
  const v = {}; const last = sheet.getLastRow();
  if (last < 2) return v;
  sheet.getRange(2, 2, last - 1, 1).getValues().forEach(function (r) { if (r[0]) v[r[0]] = true; });
  return v;
}
function registrar_(sheet, id, ubicacion, autor, estrellas, a) {
  sheet.appendRow([new Date(), id, ubicacion, autor, estrellas, a.sentimiento, a.tema, a.urgencia]);
}

// ─────────────────────────────────────────────────────────────────────────
//  10) UTILIDADES
// ─────────────────────────────────────────────────────────────────────────
function fetchJson_(url, token) {
  const res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (res.getResponseCode() >= 400) { Logger.log('Error ' + res.getResponseCode() + ' ' + url + ' -> ' + res.getContentText()); return null; }
  return JSON.parse(res.getContentText());
}
function starRatingToNum_(sr) { return { ONE:1, TWO:2, THREE:3, FOUR:4, FIVE:5 }[sr] || 0; }

function instalarTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'revisarReseñas') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('revisarReseñas').timeBased().everyHours(1).create();
  Logger.log('✅ Trigger instalado: revisión cada hora.');
}
function testUbicaciones() {
  getUbicaciones_().forEach(function (l) { Logger.log(l.title + ' -> ' + l.account + '/' + l.location); });
}

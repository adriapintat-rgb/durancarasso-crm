/**
 * ═══════════════════════════════════════════════════════════════════════
 *  DURÁN CARASSO · Reputation Agent
 *  Motor gratuito (Google Apps Script) para monitorizar reseñas de Google,
 *  clasificarlas (buena/mala + tema) y enviarte un email con un BORRADOR
 *  de respuesta listo para revisar y publicar.
 *
 *  Ubicaciones cubiertas: Barcelona · Andorra · Sitges · La Cerdanya
 *  (se detectan automáticamente todas las fichas de tu cuenta GBP)
 *
 *  Coste: 0 €. Corre en la infraestructura de Google.
 * ═══════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────
//  1) CONFIGURACIÓN  ·  Rellena solo estos 2 campos
// ─────────────────────────────────────────────────────────────────────────
const CONFIG = {
  // Email donde quieres recibir los avisos + borradores
  EMAIL_DESTINO: 'adriap@durancarasso.com, aselles@durancarasso.com',

  // API key gratuita de Google AI Studio (Gemini) -> https://aistudio.google.com/apikey
  // Se usa para clasificar la reseña y redactar la respuesta.
  GEMINI_API_KEY: 'PEGA_AQUI_TU_API_KEY',

  // Nombre de la marca y tono (ajústalo a tu voz de marca)
  MARCA: 'Durán Carasso',
  TONO: 'Cercano, profesional, elegante. Trato de usted. Firma como "El equipo de Durán Carasso".',

  // Modelo Gemini (flash = rápido y gratis)
  GEMINI_MODEL: 'gemini-1.5-flash',

  // Nombre de la hoja de cálculo interna (registro + anti-duplicados)
  NOMBRE_HOJA: 'DuranCarasso_Reseñas_Log',
};

// ─────────────────────────────────────────────────────────────────────────
//  2) FUNCIÓN PRINCIPAL  ·  Se ejecuta con el trigger horario
// ─────────────────────────────────────────────────────────────────────────
function revisarReseñas() {
  const sheet = getLogSheet_();
  const vistos = getReviewIdsVistos_(sheet);
  const ubicaciones = getUbicaciones_();

  if (!ubicaciones.length) {
    Logger.log('No se encontraron ubicaciones. Revisa el acceso a Business Profile.');
    return;
  }

  let nuevasTotal = 0;

  ubicaciones.forEach(function (loc) {
    const reseñas = getReseñas_(loc.account, loc.location);
    reseñas.forEach(function (r) {
      const id = r.reviewId || r.name;
      if (!id || vistos[id]) return; // ya procesada

      const estrellas = starRatingToNum_(r.starRating);
      const texto = (r.comment || '').trim();
      const autor = (r.reviewer && r.reviewer.displayName) || 'Cliente';

      // IA: clasifica + redacta borrador
      const analisis = analizarConIA_({
        ubicacion: loc.title,
        estrellas: estrellas,
        texto: texto,
        autor: autor,
      });

      enviarEmail_(loc.title, autor, estrellas, texto, analisis, r);
      registrar_(sheet, id, loc.title, autor, estrellas, analisis);
      vistos[id] = true;
      nuevasTotal++;
    });
  });

  Logger.log('Reseñas nuevas procesadas: ' + nuevasTotal);
}

// ─────────────────────────────────────────────────────────────────────────
//  3) GOOGLE BUSINESS PROFILE  ·  Ubicaciones y reseñas
// ─────────────────────────────────────────────────────────────────────────
function getUbicaciones_() {
  const token = ScriptApp.getOAuthToken();
  const out = [];

  // a) Cuentas
  const accRes = fetchJson_(
    'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
    token
  );
  const accounts = (accRes && accRes.accounts) || [];

  // b) Ubicaciones por cuenta
  accounts.forEach(function (acc) {
    let pageToken = '';
    do {
      const url =
        'https://mybusinessbusinessinformation.googleapis.com/v1/' +
        acc.name +
        '/locations?readMask=name,title&pageSize=100' +
        (pageToken ? '&pageToken=' + pageToken : '');
      const locRes = fetchJson_(url, token);
      const locs = (locRes && locRes.locations) || [];
      locs.forEach(function (l) {
        out.push({
          account: acc.name,        // "accounts/123"
          location: l.name,         // "locations/456"
          title: l.title || l.name, // nombre de la ficha
        });
      });
      pageToken = (locRes && locRes.nextPageToken) || '';
    } while (pageToken);
  });

  return out;
}

function getReseñas_(accountName, locationName) {
  const token = ScriptApp.getOAuthToken();
  const out = [];
  let pageToken = '';

  // La API de reviews vive en v4: accounts/{id}/locations/{id}/reviews
  const base =
    'https://mybusiness.googleapis.com/v4/' +
    accountName + '/' + locationName + '/reviews?pageSize=50&orderBy=updateTime desc';

  do {
    const url = base + (pageToken ? '&pageToken=' + pageToken : '');
    const res = fetchJson_(url, token);
    const revs = (res && res.reviews) || [];
    revs.forEach(function (r) { out.push(r); });
    pageToken = (res && res.nextPageToken) || '';
    // Solo primera página para no procesar histórico entero cada vez
    break;
  } while (pageToken);

  return out;
}

// ─────────────────────────────────────────────────────────────────────────
//  4) IA  ·  Clasificación + borrador de respuesta (Gemini)
// ─────────────────────────────────────────────────────────────────────────
function analizarConIA_(d) {
  const prompt =
    'Eres el responsable de reputación online de ' + CONFIG.MARCA +
    ', una inmobiliaria de lujo. Tono: ' + CONFIG.TONO + '\n\n' +
    'Analiza esta reseña de Google y responde SOLO con un JSON válido.\n\n' +
    'Ubicación: ' + d.ubicacion + '\n' +
    'Autor: ' + d.autor + '\n' +
    'Estrellas: ' + d.estrellas + '/5\n' +
    'Texto: "' + (d.texto || '(sin texto, solo estrellas)') + '"\n\n' +
    'Devuelve este JSON exacto:\n' +
    '{\n' +
    '  "sentimiento": "positiva" | "neutra" | "negativa",\n' +
    '  "tema": "resume el tema principal en 2-4 palabras (ej: trato del agente, proceso de compra, precio)",\n' +
    '  "urgencia": "alta" | "media" | "baja",\n' +
    '  "borrador": "respuesta pública lista para publicar en Google, en el MISMO idioma de la reseña, personalizada con el nombre del autor, empática si es negativa, agradecida si es positiva. Sin markdown.",\n' +
    '  "accion_interna": "1 recomendación concreta para el equipo (solo si es negativa/neutra; si es positiva pon: ninguna)"\n' +
    '}';

  try {
    const res = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' +
        CONFIG.GEMINI_MODEL + ':generateContent?key=' + CONFIG.GEMINI_API_KEY,
      {
        method: 'post',
        contentType: 'application/json',
        muteHttpExceptions: true,
        payload: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, responseMimeType: 'application/json' },
        }),
      }
    );
    const json = JSON.parse(res.getContentText());
    const txt = json.candidates[0].content.parts[0].text;
    return JSON.parse(txt);
  } catch (e) {
    // Fallback sin IA: borrador básico por estrellas
    return fallbackAnalisis_(d);
  }
}

function fallbackAnalisis_(d) {
  const neg = d.estrellas <= 3;
  return {
    sentimiento: d.estrellas >= 4 ? 'positiva' : d.estrellas === 3 ? 'neutra' : 'negativa',
    tema: 'sin clasificar (IA no disponible)',
    urgencia: neg ? 'alta' : 'baja',
    borrador: neg
      ? 'Estimado/a ' + d.autor + ', lamentamos que su experiencia no haya sido la esperada. ' +
        'Nos gustaría conocer los detalles y ayudarle. Le atenderemos personalmente. Un cordial saludo, el equipo de ' + CONFIG.MARCA + '.'
      : 'Estimado/a ' + d.autor + ', muchas gracias por su valoración y por confiar en ' + CONFIG.MARCA +
        '. Ha sido un placer. Un cordial saludo.',
    accion_interna: neg ? 'Contactar al cliente por privado y ofrecer seguimiento del director de zona.' : 'ninguna',
  };
}

// ─────────────────────────────────────────────────────────────────────────
//  5) EMAIL  ·  Aviso con borrador
// ─────────────────────────────────────────────────────────────────────────
function enviarEmail_(ubicacion, autor, estrellas, texto, a, reviewRaw) {
  const color = a.sentimiento === 'positiva' ? '#1a7f37'
    : a.sentimiento === 'negativa' ? '#cf222e' : '#9a6700';
  const emoji = a.sentimiento === 'positiva' ? '🟢'
    : a.sentimiento === 'negativa' ? '🔴' : '🟡';
  const stars = '★'.repeat(estrellas) + '☆'.repeat(5 - estrellas);

  const asunto = emoji + ' ' + a.sentimiento.toUpperCase() + ' · ' + ubicacion +
    ' · ' + estrellas + '★ · ' + CONFIG.MARCA;

  const html =
    '<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#1c1c1c">' +
      '<div style="border-left:5px solid ' + color + ';padding:8px 16px;margin-bottom:16px">' +
        '<h2 style="margin:0 0 4px">' + emoji + ' Nueva reseña · ' + ubicacion + '</h2>' +
        '<div style="color:#e3b341;font-size:20px">' + stars + '</div>' +
        '<div style="color:#666;font-size:13px">Autor: <b>' + autor + '</b> · Tema: ' + a.tema +
        ' · Urgencia: <b>' + a.urgencia + '</b></div>' +
      '</div>' +

      '<div style="background:#f6f8fa;border-radius:8px;padding:12px 16px;margin-bottom:16px">' +
        '<div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:.5px">Reseña original</div>' +
        '<div style="margin-top:6px;font-style:italic">' + (texto || '(sin texto, solo puntuación)') + '</div>' +
      '</div>' +

      '<div style="border:1px solid ' + color + ';border-radius:8px;padding:12px 16px;margin-bottom:16px">' +
        '<div style="font-size:12px;color:' + color + ';font-weight:bold;text-transform:uppercase">✍️ Borrador de respuesta (revisa y publica)</div>' +
        '<div style="margin-top:8px;white-space:pre-wrap">' + a.borrador + '</div>' +
      '</div>' +

      (a.accion_interna && a.accion_interna.toLowerCase() !== 'ninguna'
        ? '<div style="background:#fff8e1;border-radius:8px;padding:12px 16px;margin-bottom:16px">' +
            '<b>🛠️ Acción recomendada (interna):</b> ' + a.accion_interna +
          '</div>'
        : '') +

      '<a href="https://business.google.com/reviews" ' +
        'style="display:inline-block;background:' + color + ';color:#fff;text-decoration:none;' +
        'padding:10px 20px;border-radius:6px;font-weight:bold">Responder en Google →</a>' +

      '<p style="color:#999;font-size:11px;margin-top:24px">Automatización gratuita · Durán Carasso Reputation Agent</p>' +
    '</div>';

  MailApp.sendEmail({
    to: CONFIG.EMAIL_DESTINO,
    subject: asunto,
    htmlBody: html,
  });
}

// ─────────────────────────────────────────────────────────────────────────
//  6) REGISTRO  ·  Google Sheet (log + anti-duplicados)
// ─────────────────────────────────────────────────────────────────────────
function getLogSheet_() {
  const files = DriveApp.getFilesByName(CONFIG.NOMBRE_HOJA);
  let ss;
  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
  } else {
    ss = SpreadsheetApp.create(CONFIG.NOMBRE_HOJA);
    const s = ss.getActiveSheet();
    s.appendRow(['Fecha', 'ReviewID', 'Ubicación', 'Autor', 'Estrellas', 'Sentimiento', 'Tema', 'Urgencia']);
  }
  return ss.getActiveSheet();
}

function getReviewIdsVistos_(sheet) {
  const vistos = {};
  const last = sheet.getLastRow();
  if (last < 2) return vistos;
  const ids = sheet.getRange(2, 2, last - 1, 1).getValues();
  ids.forEach(function (row) { if (row[0]) vistos[row[0]] = true; });
  return vistos;
}

function registrar_(sheet, id, ubicacion, autor, estrellas, a) {
  sheet.appendRow([
    new Date(), id, ubicacion, autor, estrellas,
    a.sentimiento, a.tema, a.urgencia,
  ]);
}

// ─────────────────────────────────────────────────────────────────────────
//  7) UTILIDADES
// ─────────────────────────────────────────────────────────────────────────
function fetchJson_(url, token) {
  const res = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code >= 400) {
    Logger.log('Error ' + code + ' en ' + url + ' -> ' + res.getContentText());
    return null;
  }
  return JSON.parse(res.getContentText());
}

function starRatingToNum_(sr) {
  const map = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  return map[sr] || 0;
}

// ─────────────────────────────────────────────────────────────────────────
//  8) INSTALACIÓN  ·  Ejecuta UNA vez para crear el trigger horario
// ─────────────────────────────────────────────────────────────────────────
function instalarTrigger() {
  // Limpia triggers previos
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'revisarReseñas') ScriptApp.deleteTrigger(t);
  });
  // Cada 1 hora
  ScriptApp.newTrigger('revisarReseñas').timeBased().everyHours(1).create();
  Logger.log('✅ Trigger instalado: se revisará cada hora.');
}

// Útil para probar acceso: lista tus fichas en el log
function testUbicaciones() {
  getUbicaciones_().forEach(function (l) { Logger.log(l.title + ' -> ' + l.account + '/' + l.location); });
}

// Prueba de extremo a extremo con Google, Gemini y la hoja simulados: node agente-gbp/test/probar.js
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');

// ── Simulación de Apps Script
const props = {};
global.PropertiesService = { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) };
global.Logger = { log: m => logs.push(String(m)) }; const logs = [];
global.Utilities = { sleep() {}, getUuid: () => crypto.randomUUID(), formatDate: (d, tz, f) => new Date(d).toISOString().slice(0, 10) };
const triggers = [];
global.ScriptApp = {
  getProjectTriggers: () => triggers.slice(), deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1),
  WeekDay: { MONDAY: 'MON' }, getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/DEMO/exec' }),
  newTrigger: fn => { const t = { fn, getHandlerFunction: () => fn }, o = { timeBased: () => o, onWeekDay: d => (t.dia = d, o), atHour: h => (t.hora = h, o),
    inTimezone: () => o, after: ms => (t.after = ms, o), create: () => triggers.push(t) }; return o; } };
const mails = []; global.MailApp = { sendEmail: m => mails.push(m) };
global.HtmlService = { createHtmlOutput: h => ({ setTitle() { return this; }, html: h }) };
function mkSheet() {
  const rows = [], sh = { rows, setName() { return sh; }, appendRow: r => rows.push(r.slice()), getLastRow: () => rows.length,
    clearContents: () => { rows.length = 0; },
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
    getRange: (r, c) => ({ getValue: () => (rows[r - 1] || [])[c - 1] || '', setValue: v => { rows[r - 1][c - 1] = v; },
      setValues: m => m[0].forEach((v, i) => { rows[r - 1][c - 1 + i] = v; }) }) };
  return sh;
}
const libro = { sheets: { Hoja1: mkSheet() } };
libro.getSheets = () => [libro.sheets.Hoja1];
libro.getSheetByName = n => n === 'Propuestas' ? libro.sheets.Hoja1 : libro.sheets[n] || null;
libro.insertSheet = n => (libro.sheets[n] = mkSheet());
let creado = false;
global.DriveApp = { getFilesByName: () => ({ hasNext: () => creado, next: () => ({}) }) };
global.SpreadsheetApp = { create: () => (creado = true, libro), open: () => libro };

// ── Google y Gemini simulados (fichas reales, competencia simulada)
const FICHAS = { BCN: [4.7, 62], STG: [4.8, 193], CRD: [5.0, 15], AND: [4.6, 5] };
let geminiCaido = false, geminiLlamadas = [], jsonRoto = 0;
global.UrlFetchApp = { fetch: (url, o = {}) => {
  const R = (x, c = 200) => ({ getResponseCode: () => c, getContentText: () => typeof x === 'string' ? x : JSON.stringify(x) });
  const body = o.payload ? JSON.parse(o.payload) : {};
  if (url.includes('places:searchText')) {
    const code = ['BCN', 'STG', 'CRD', 'AND'].find(c => body.textQuery.toLowerCase().includes({ BCN: 'barcelona', STG: 'sitges', CRD: 'puigcerd', AND: 'andorra' }[c]) || body.textQuery.includes({ BCN: 'Muntaner', STG: 'Capellans', CRD: 'Espanya', AND: 'Escaldes' }[c]));
    if (/Durán Carasso/.test(body.textQuery)) return R({ places: [{ id: 'x', displayName: { text: 'Otra' } }, { id: 'id_' + code, displayName: { text: 'Durán Carasso | Inmobiliaria' } }] });
    return R({ places: [{ id: 'id_' + code, displayName: { text: 'Durán Carasso' } }].concat([180, 95, 41, 22].map((n, i) => ({ id: 'c' + i, displayName: { text: 'Competidor ' + i }, rating: 4.5, userRatingCount: n }))) });
  }
  const m = url.match(/places\/id_(\w+)/);
  if (m) return R({ id: 'id_' + m[1], displayName: { text: 'Durán Carasso | Inmobiliaria en ' + m[1] }, formattedAddress: 'Dirección ' + m[1], nationalPhoneNumber: '931 59 51 25',
    websiteUri: 'https://www.durancarasso.es/', businessStatus: 'OPERATIONAL', rating: FICHAS[m[1]][0], userRatingCount: FICHAS[m[1]][1], photos: Array(6), regularOpeningHours: {} });
  if (url.includes('pagespeedonline')) return R({ lighthouseResult: { categories: { seo: { score: 0.85 }, performance: { score: 0.4 } } } });
  if (url.endsWith('/robots.txt')) return R('User-agent: GPTBot\nDisallow: /\n');
  if (url.endsWith('/llms.txt')) return R('', 404);
  if (url.startsWith('https://www.durancarasso.es')) return R('<title>DC</title><h1>x</h1><p>931 59 51 25</p>');
  if (url.includes('generativelanguage')) {
    geminiLlamadas.push(body);
    if (geminiCaido) return R('{"error":"quota"}', 429);
    const txt = body.contents[0].parts[0].text;
    if (jsonRoto && body.generationConfig.responseMimeType) { jsonRoto--; return R({ candidates: [{ content: { parts: [{ text: '{"titular":"a" "b"}' }] } }] }); }
    const out = /Esta tarea no convenció/.test(txt)
      ? JSON.stringify({ que: 'Pedir reseñas por email', porque: 'Otro canal', pasos: ['Abre Gmail', 'Envía la plantilla'], cuando: 'Lunes', texto: 'Hola' })
      : body.generationConfig.responseMimeType
      ? JSON.stringify({ resumen: 'Resumen ok', tareas: [{ prioridad: 'ALTA', sedes: ['BCN', 'STG', 'CRD', 'AND', 'XXX'], que: 'Quitar palabras clave del nombre',
          porque: 'Riesgo', pasos: ['business.google.com → Editar perfil → Nombre'], cuando: 'Esta semana', texto: '' }],
          posts: { BCN: 'Otoño en la zona. Llámanos al 931 59 51 25.', STG: 'Post Sitges.', CRD: 'Post Cerdanya.', AND: 'Post Andorra.' }, descripciones: { CRD: 'Descripció nova.' } })
      : /Responde solo: OK/.test(txt) ? 'OK' : 'Alternativa distinta del texto.';
    return R({ candidates: [{ content: { parts: [{ text: out }] } }] });
  }
  throw new Error('URL no simulada: ' + url);
} };

// ── Carga el código con claves de prueba
eval(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8').replace(/const (\w+) = /g, 'var $1 = '));
CONFIG.GEMINI_API_KEY = 'k'; CONFIG.GOOGLE_API_KEY = 'g';
let fallos = 0; const gemCount = () => geminiLlamadas.length;
const check = (c, t) => { console.log((c ? '✅ ' : '❌ ') + t); if (!c) fallos++; };
const propuestas = () => libro.sheets.Hoja1.rows.slice(1);

testFichas();
check(logs.filter(l => l.startsWith('✅')).length === 5, 'testFichas: 4 fichas + Gemini OK');
instalarTrigger();
check(triggers.length === 1 && triggers[0].dia === 'MON' && triggers[0].hora === 8, 'trigger lunes 8:00');
enviarInformeAhora();
const m = mails.at(-1);
fs.writeFileSync(os.tmpdir() + '/agente-google.html', m.htmlBody);
check(m && /urgentes/.test(m.subject), 'email enviado: ' + (m && m.subject));
check(propuestas().length === 6, propuestas().length + ' propuestas guardadas (1 tarea para las 4 sedes + 4 posts + 1 descripción)');
check(propuestas()[0][3] === 'BCN,STG,CRD,AND' && /Las 4 sedes/.test(m.htmlBody) && /1\. business\.google\.com/.test(m.htmlBody), 'la tarea común sale una sola vez, con pasos');
check(gemCount() === 3, '2 llamadas a la IA para las 4 sedes: tareas y textos (+ testFichas)');
check((m.htmlBody.match(/a=hecho/g) || []).length === 6 && /a=otra/.test(m.htmlBody) && /a=no/.test(m.htmlBody), 'cada propuesta con ✅ 🔄 ❌');
check(/GPTBot/.test(m.htmlBody) && /llms\.txt/.test(m.htmlBody), 'incluye los problemas de la web');
check(!/931 59 51 25/.test(propuestas().find(r => r[4] === 'POST')[8]), 'post sin teléfono (Google lo rechazaría)');
check(!triggers.some(t => t.fn === 'continuarInforme') && libro.sheets.Trabajo.rows.length === 0, 'limpia el trabajo al terminar');

const [p1, p2, p3] = propuestas();
const get = (p, a, t) => doGet({ parameter: { id: p[1], t: t || p[2], a } }).html;
check(/no autorizado/.test(get(p1, 'hecho', 'malo')), 'token falso rechazado');
check(/hecho/.test(get(p1, 'hecho')) && propuestas()[0][9] === 'HECHO', '✅ Hecho');
check(/Descartado/.test(get(p2, 'no')) && propuestas()[1][9] === 'DESCARTADO', '❌ No me sirve');
const n = mails.length;
check(/Alternativa distinta del texto/.test(get(p3, 'otra')) && mails.length === n && propuestas()[2][8] === 'Alternativa distinta del texto.', '🔄 Dame otra → nueva versión en la misma página, sin email');
check(/Pedir reseñas por email/.test(get(propuestas()[0], 'otra')) && propuestas()[0][6] === 'Pedir reseñas por email' && /1\. Abre Gmail/.test(propuestas()[0][7]), '🔄 en una tarea → tarea nueva con pasos');
check(memoria_().length === 2, 'memoria: recuerda lo hecho y descartado');
enviarInformeAhora();
check(geminiLlamadas.some(b => /YA HIZO O DESCARTÓ/.test(b.contents[0].parts[0].text)), 'la semana siguiente la IA recibe lo descartado/hecho');
check(/Ficha completa/.test(mails.at(-1).htmlBody) && propuestas().filter(r => r[4] === 'DESCRIPCION').length === 1, 'tabla de sedes y no repite la descripción en 4 semanas');

geminiCaido = true; const n2 = mails.length, antes429 = geminiLlamadas.length; enviarInformeAhora();
check(mails.length === n2 + 1 && /La IA \(Gemini\) no respondió/.test(mails.at(-1).htmlBody), 'si Gemini falla, el informe llega igual (con las reglas)');
check(geminiLlamadas.length - antes429 === 6, 'sin cuota (429): prueba cada modelo una vez, sin reintentar el mismo');
geminiCaido = false;

jsonRoto = 1; const n4 = mails.length; enviarInformeAhora();
check(mails.length === n4 + 1 && !/no respondió/.test(mails.at(-1).htmlBody), 'si Gemini devuelve un JSON roto, reintenta y sale bien');
jsonRoto = 0;

const lento = Date.now; let t = 0; Date.now = () => (t += 100000);
libro.sheets.Trabajo.rows.length = 0; const n3 = mails.length; enviarInformeAhora();
check(triggers.some(x => x.fn === 'continuarInforme') && mails.length === n3, 'si se acerca el límite de 6 min, sigue solo');
Date.now = () => 0; continuarInforme(); Date.now = lento;
check(mails.length === n3 + 1, 'la continuación termina y envía el informe');

console.log(fallos ? '\n❌ ' + fallos + ' fallos' : '\n✅ Todo OK');
process.exitCode = fallos ? 1 : 0;

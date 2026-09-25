// Prueba de extremo a extremo con Google, Claude y la hoja simulados: node agente-gbp/test/probar.js
const fs = require('fs'), os = require('os'), M = require('./mocks.js');
const OUT = os.tmpdir() + '/';

// ── Datos (Barcelona, Sitges, Cerdanya y Andorra: reales de las fichas; competencia SIMULADA)
const FICHAS = {
  BCN: { rating: 4.7, n: 62, fotos: 10, tel: '931 59 51 25', dir: 'Carrer de Muntaner, 259, 08021 Barcelona' },
  STG: { rating: 4.8, n: 193, fotos: 10, tel: '935 17 80 67', dir: 'Av. Camí dels Capellans, 73, 08870 Sitges' },
  CRD: { rating: 5.0, n: 15, fotos: 6, tel: '972 47 56 77', dir: "Carrer d'Espanya, 16, 17520 Puigcerdà" },
  AND: { rating: 4.6, n: 5, fotos: 3, tel: '+376 841 800', dir: 'Carrer de la Unió, 9, AD700 Escaldes-Engordany' } };
const CIUDAD = { BCN: 'muntaner', STG: 'sitges', CRD: 'puigcerd', AND: 'escaldes' };
let revs = { BCN: [{ name: 'places/BCN/reviews/1', rating: 5, text: { text: 'Trato excelente.' }, authorAttribution: { displayName: 'Laura M.' }, publishTime: '2026-09-10T10:00:00Z' }] };
let claudeCalls = [], lotes = {}, loteListo = true;

global.UrlFetchApp = { fetch: (url, o = {}) => {
  const R = (obj, code = 200) => ({ getResponseCode: () => code, getContentText: () => typeof obj === 'string' ? obj : JSON.stringify(obj) });
  const body = o.payload ? JSON.parse(o.payload) : {};
  if (url.includes('places:searchText')) {
    const q = body.textQuery.toLowerCase();
    const code = Object.keys(CIUDAD).find(c => q.includes(CIUDAD[c])) || Object.keys(CIUDAD).find(c => q.includes({ BCN: 'barcelona', STG: 'sitges', CRD: 'cerdanya', AND: 'andorra' }[c]));
    if (/durán carasso/.test(q)) return R({ places: [{ id: 'otro', displayName: { text: 'Otra inmobiliaria' } }, { id: 'id_' + code, displayName: { text: 'Durán Carasso | Inmobiliaria' } }] });
    return R({ places: [{ id: 'id_' + code, displayName: { text: 'Durán Carasso' } }].concat([180, 95, 41, 22, 12].map((n, i) => ({
      id: 'c' + i, displayName: { text: 'Competidor ' + 'ABCDE'[i] + ' (simulado)' }, rating: [4.8, 4.5, 4.9, 4.3, 4.7][i], userRatingCount: n, photos: Array(10) }))) });
  }
  const m = url.match(/places\/id_(\w+)\?/);
  if (m) { const f = FICHAS[m[1]]; return R({ displayName: { text: 'Durán Carasso | Inmobiliaria en ' + m[1] }, formattedAddress: f.dir, nationalPhoneNumber: f.tel,
    websiteUri: 'https://www.durancarasso.es/', businessStatus: 'OPERATIONAL', rating: f.rating, userRatingCount: f.n, photos: Array(f.fotos),
    regularOpeningHours: { weekdayDescriptions: ['lunes: 9:30–13:30, 16:00–19:00'] }, reviews: revs[m[1]] || [], googleMapsUri: 'https://maps.google.com/?cid=' + m[1] }); }
  if (url.includes('pagespeedonline')) return R({ lighthouseResult: { categories: { seo: { score: 0.85 }, performance: { score: 0.42 } }, audits: { 'largest-contentful-paint': { displayValue: '5,1 s' } } } });
  if (url === 'https://www.durancarasso.es/robots.txt') return R('User-agent: *\nDisallow: /admin\n\nUser-agent: GPTBot\nDisallow: /\n');
  if (url === 'https://www.durancarasso.es/sitemap.xml') return R('<urlset/>');
  if (url === 'https://www.durancarasso.es/llms.txt') return R('', 404);
  if (url.startsWith('https://www.durancarasso.es')) return R('<html><title>Durán Carasso</title><link rel="alternate" hreflang="es"><link hreflang="ca"><link hreflang="en"><h1>A</h1><h1>B</h1><p>931 59 51 25</p></html>');
  if (url.includes('/v1/models')) return R({ data: [] });
  if (url.endsWith('/v1/messages/batches')) { const id = 'lote_' + (Object.keys(lotes).length + 1); lotes[id] = body.requests; return R({ id }); }
  const lb = url.match(/batches\/(lote_\d+)$/);
  if (lb) return R({ processing_status: loteListo ? 'ended' : 'in_progress', results_url: 'https://api.anthropic.com/results/' + lb[1] });
  const lr = url.match(/results\/(lote_\d+)$/);
  if (lr) return R(lotes[lr[1]].map(q => { claudeCalls.push(q.params); return JSON.stringify({ custom_id: q.custom_id, result: { type: 'succeeded', message: fakeClaude(q.params) } }); }).join('\n'));
  if (url.endsWith('/v1/messages')) { claudeCalls.push(body); return R(fakeClaude(body)); }
  throw new Error('URL no simulada: ' + url);
} };

function msg(text) { return { stop_reason: 'end_turn', content: [{ type: 'text', text }] }; }
function fakeClaude(b) {
  if (b.tools) return msg('• La web oficial sale 1ª para "Durán Carasso".\n• (simulado) Un directorio muestra un teléfono antiguo.');
  if (!b.output_config || !b.output_config.format) return msg('Hola Marc, lamentamos mucho tu experiencia. ¿Podemos llamarte para entender qué pasó? — Equipo Durán Carasso');
  const inp = JSON.parse(b.messages[0].content), s = inp.sede;
  return msg(JSON.stringify({ titular: 'Ficha al ' + s.completitud.porcentaje + '% y puesto ' + s.posicion.porResenas + ' en reseñas.',
    estado: s.ficha.numResenas + ' reseñas, ' + s.ficha.rating + '★.', vsCompetencia: 'El líder tiene ' + s.posicion.lider.resenas + ' reseñas.',
    acciones: [{ prioridad: 'ALTA', accion: 'Quitar palabras clave del nombre de la ficha', motivo: 'Riesgo de suspensión', opciones: ['Durán Carasso', 'Durán Carasso ' + s.nombre],
      recomendada: 'Durán Carasso', cuando: 'Esta semana, tras OK de dirección', contenido: '' }].concat(inp.web_global ? [{ prioridad: 'MEDIA', accion: 'Desbloquear GPTBot en robots.txt', motivo: 'web_global',
      opciones: ['Permitir'], recomendada: 'Permitir', cuando: 'Este mes', contenido: 'User-agent: GPTBot\nAllow: /' }] : []),
    post: 'Otoño en ' + s.nombre + ': valoración gratuita y discreta. Llámanos al 931 59 51 25 o visita https://www.durancarasso.es',
    descripcion: s.sede === 'CRD' ? 'Durán Carasso és una immobiliària premium a la Cerdanya.' : '', respuestas: [] }));
}

eval(M.load());
Object.assign(global, { reglas_, tarjetaPropuesta_, locId_, accId_, diagnostico, activarDesdeMenu, desactivar, enviarAhora_, avanzarSemanal, ejecutarSemanal, vigilarUrgente, doGet, accionWeb, token_, memoria_, estado_ });
const enviarAhora = enviarAhora_;
const evento = fn => ({ triggerUid: (__triggers.find(t => t.fn === fn) || {}).uid });
let fallos = 0;
function check(cond, txt) { console.log((cond ? '✅ ' : '❌ ') + txt); if (!cond) fallos++; }
function disparar() { const t = __triggers.find(x => x.fn === 'avanzarSemanal'); if (t) { const ev = { triggerUid: t.uid }; ScriptApp.deleteTrigger(__triggers.find(x => x === t)); __triggers.push(t); avanzarSemanal(ev); ScriptApp.deleteTrigger(t); } return !!t; }
const props = () => __sheets.GBP_Propuestas.rows.slice(1);

console.log('\n0) Menú y diagnóstico');
const diag = diagnostico();
check(diag.filter(x => !x.ok && !x.opcional).map(x => x.nombre).join() === 'Agente activado', 'diagnóstico: claves, 4 fichas, PageSpeed y app web OK');
check(diag.filter(x => /^Ficha/.test(x.nombre)).every(x => /Durán Carasso/.test(x.detalle)), 'elige la ficha de Durán Carasso aunque no sea el primer resultado');
check(__store.SHEET_ID === 'SHEET_DEMO', 'fija la hoja del agente');
delete __store.GOOGLE_API_KEY; activarDesdeMenu();
check(/Falta/.test(__alerts.at(-1)) && !__triggers.length, 'no deja activar si falta una clave'); __store.GOOGLE_API_KEY = 'g';

console.log('\n1) Activar');
activarDesdeMenu();
check(__triggers.some(t => t.fn === 'ejecutarSemanal' && t.dia === 'SUN' && t.hora === 20) && __triggers.some(t => t.fn === 'vigilarUrgente' && t.cadaHoras === 3), 'triggers: domingo 20:00 + cada 3 h');
check(__sheets.GBP_Estado && __sheets.GBP_Estado.oculta, 'hoja interna GBP_Estado oculta');

console.log('\n2) Informe "ahora" por fases (lotes)');
enviarAhora();
check(estado_().fase === 'BUSQUEDA' && Object.keys(lotes).length === 1 && lotes.lote_1.length === 4, 'fase DATOS → lote de 4 búsquedas de marca');
check(__triggers.filter(t => t.fn === 'avanzarSemanal').length === 1, 'un único trigger de continuación');
loteListo = false; disparar();
check(estado_().fase === 'BUSQUEDA' && estado_().esperas === 1, 'si el lote no está listo, espera y se reprograma');
loteListo = true; disparar();
check(estado_().fase === 'PLAN' && lotes.lote_2.length === 4, 'fase BÚSQUEDA → lote de 4 planes (uno por sede)');
const planBCN = lotes.lote_2.find(q => q.custom_id === 'plan-BCN').params;
check(!planBCN.fallbacks && JSON.parse(planBCN.messages[0].content).web_global, 'el lote no usa fallbacks (no admitido) y la 1ª sede recibe la auditoría web');
check(/Durán Carasso: '?|web oficial/.test(JSON.parse(planBCN.messages[0].content).sede.busquedaMarca), 'la búsqueda de marca llega al plan');
const n0 = sent.length; disparar();
const e1 = sent.at(-1); fs.writeFileSync(OUT + 'email-semanal.html', e1.html);
check(sent.length === n0 + 1 && estado_().fase === 'FIN', 'fase PLAN → ENVÍO inmediato: ' + e1.subject);
check(e1.html.length < 95000, 'email de ' + Math.round(e1.html.length / 1024) + ' KB (Gmail recorta a partir de 102 KB)');
check(/GPTBot/.test(e1.html) && /llms\.txt/.test(e1.html), 'email incluye los problemas de la web global (robots.txt, llms.txt)');
check(!/<details/.test(e1.html), 'sin <details> (Gmail no lo muestra)');
const post = props().find(r => r[3] === 'POST');
check(!/\d{3} \d{2} \d{2}|https?:/.test(post[7]), 'post sin teléfonos ni URLs (Google los rechaza): "' + post[7] + '"');
check((e1.html.match(/a=publicar/g) || []).length === props().length, 'cada propuesta tiene su botón ✅ (' + props().length + ')');

console.log('\n3) Informe del domingo → espera al lunes 8:30');
ejecutarSemanal(evento('ejecutarSemanal')); disparar(); disparar();
const tLunes = __triggers.find(t => t.fn === 'avanzarSemanal');
check(estado_().fase === 'ENVIO' && tLunes && tLunes.at && Utilities.formatDate(tLunes.at, '', 'u HH:mm') === '1 08:30', 'programa el envío para el lunes 8:30 (' + (tLunes && tLunes.at.toISOString()) + ')');
const e = estado_(); e.inicio -= 7 * 864e5; __store.ESTADO_SEMANAL = JSON.stringify(e);
const n1 = sent.length; disparar();
check(sent.length === n1 + 1, 'el lunes envía el informe');

console.log('\n4) Botones y decisiones');
const [pp, tarea, desc] = ['POST', 'TAREA', 'DESCRIPCION'].map(t => props().find(r => r[3] === t && r[9] === 'PENDIENTE'));
check(doGet({ parameter: { id: pp[0], t: token_(pp[0]), a: 'editar' } }).getContent().includes(pp[0]), 'la página de edición carga la propuesta');
check(doGet({ parameter: { id: pp[0], t: 'x', a: 'publicar' } }).getContent().includes('Enlace no válido'), 'token falso rechazado');
let r = accionWeb(pp[0], token_(pp[0]), 'publicar', 'Otoño en Barcelona: valoración gratuita.', '');
check(r.estado === 'APROBADO_MANUAL' && r.manual, 'aprobar sin Nivel 2 → copiar y pegar');
check(!accionWeb(pp[0], token_(pp[0]), 'publicar', 'x', '').ok, 'no se puede publicar dos veces');
check(accionWeb(desc[0], token_(desc[0]), 'descartar', '', 'No trabajamos Alp').estado === 'DESCARTADO', 'descartar con motivo');
check(accionWeb(tarea[0], token_(tarea[0]), 'publicar', '', '').estado === 'HECHO', 'tarea marcada como hecha');
check(!accionWeb(tarea[0], token_(tarea[0]), 'borrar', '', '').ok, 'acción desconocida rechazada');
const mem = memoria_();
check(mem.some(m => m.decision === 'EDITADA') && mem.some(m => m.motivo === 'No trabajamos Alp'), 'memoria: recuerda la edición y el descarte');
enviarAhora(); disparar();
const inCRD = JSON.parse(Object.values(lotes).at(-1).find(q => q.custom_id === 'plan-CRD').params.messages[0].content);
check(inCRD.decisiones_del_equipo.some(m => m.motivo === 'No trabajamos Alp'), 'la semana siguiente Cerdanya recibe el descarte');
disparar();

console.log('\n5) Vigilancia de reseñas');
revs.BCN = revs.BCN.concat([{ name: 'places/BCN/reviews/2', rating: 2, text: { text: 'No me devolvieron las llamadas.' }, authorAttribution: { displayName: 'Marc P.' }, publishTime: '2026-09-23T09:00:00Z' }]);
let n2 = sent.length; vigilarUrgente(evento('vigilarUrgente'));
const e2 = sent.at(-1); fs.writeFileSync(OUT + 'email-urgente.html', e2.html);
check(sent.length === n2 + 1 && /Barcelona/.test(e2.subject), 'reseña negativa visible → alerta con respuesta: ' + e2.subject);
n2 = sent.length; vigilarUrgente(evento('vigilarUrgente')); check(sent.length === n2, 'no repite la alerta');
FICHAS.AND.n = 6; FICHAS.AND.rating = 4.2; n2 = sent.length; vigilarUrgente(evento('vigilarUrgente'));
check(sent.length === n2 + 1 && /Andorra/.test(sent.at(-1).text), 'reseña negativa NO visible por API → aviso por cambio de nota');

console.log('\n6) Errores');
const guardaKey = __store.ANTHROPIC_API_KEY; __store.ANTHROPIC_API_KEY = '';
n2 = sent.length; enviarAhora();
check(sent.length === n2 + 1 && /error/i.test(sent.at(-1).subject) && estado_().error, 'si falla, avisa por email y deja el error en el diagnóstico');
__store.ANTHROPIC_API_KEY = guardaKey;

console.log('\n8) Casos límite (revisión de código)');
check(props().every(r => /^p[0-9a-f]{10}$/.test(r[0])), 'IDs con prefijo: Sheets no los convierte en números');
check(!__triggers.some(t => t.fn === 'avanzarSemanal'), 'al terminar no quedan triggers de continuación colgados');
check(reglas_({ ficha: { estado: 'OPERATIONAL', tieneHorario: 1, telefono: 1, web: 1, fotos: 10, rating: 4.7, numResenas: 5 }, anterior: { rating: 4.8, numResenas: 4 },
  resenasRecientes: [], ultimoPostDias: null, web: null, pagespeed: null, posicion: null }).some(p => /nota baja/.test(p.texto)), 'detecta una bajada de 4,8 a 4,7 (sin error de decimales)');
check(props().filter(r => r[3] === 'POST' && r[9] === 'CADUCADO').length > 0, 'los posts de semanas anteriores sin decidir se marcan CADUCADO');
FICHAS.STG.n += 2; FICHAS.STG.rating = 4.7;
revs.STG = [{ name: 'places/STG/reviews/9', rating: 5, text: { text: 'Genial' }, authorAttribution: { displayName: 'Ana' }, publishTime: '2026-09-25T09:00:00Z' }];
n2 = sent.length; vigilarUrgente(evento('vigilarUrgente'));
check(sent.slice(n2).some(m => /Sitges: 1 reseña/.test(m.text)), 'reseña positiva visible + negativa oculta → avisa de la oculta');
const urg = { id: 'pX', sede: 'BCN', tipo: 'RESPUESTA', prioridad: 'ALTA', titulo: 't', contexto: '2★ · A: x', propuesta: 'y'.repeat(400) };
check(tarjetaPropuesta_(urg, false).includes('y'.repeat(400)), 'alerta urgente muestra el borrador completo');
__store.GBP_ACCOUNT_ID = 'accounts/123';
check(locId_({ gbpLocationId: 'locations/456' }) === '456' && accId_() === '123', 'acepta IDs de Google con o sin prefijo');
delete __store.GBP_ACCOUNT_ID;
const guarda = global.UrlFetchApp.fetch; revs.CRD = [{ name: 'places/CRD/reviews/1', rating: 1, text: { text: 'Mal' }, authorAttribution: { displayName: 'Pau' }, publishTime: '2026-09-26T09:00:00Z' }];
vigilarUrgente(evento('vigilarUrgente'));   // fija referencia de CRD
revs.CRD.push({ name: 'places/CRD/reviews/2', rating: 1, text: { text: 'Fatal' }, authorAttribution: { displayName: 'Jordi' }, publishTime: '2026-09-27T09:00:00Z' });
global.UrlFetchApp = { fetch: (u, o) => { if (u.endsWith('/v1/messages')) return { getResponseCode: () => 529, getContentText: () => '{"error":"overloaded"}' }; return guarda(u, o); } };
n2 = sent.length; vigilarUrgente(evento('vigilarUrgente')); global.UrlFetchApp = { fetch: guarda };
check(sent.slice(n2).some(m => /Cerdanya/.test(m.subject)), 'si la IA falla, la alerta de reseña negativa llega igual');

const gs = ScriptApp.getService; ScriptApp.getService = () => ({ getUrl: () => null });
const sinBotones = tarjetaPropuesta_(urg, false); ScriptApp.getService = gs;
check(!/a=publicar/.test(sinBotones) && /GBP_Propuestas/.test(sinBotones), 'sin app web publicada el email funciona igual (sin botones)');

console.log('\n7) Seguridad (llamadas desde la app web pública)');
const nTrig = __triggers.length, nLotes = Object.keys(lotes).length;
ejecutarSemanal({}); ejecutarSemanal({ triggerUid: 'inventado' }); avanzarSemanal({ triggerUid: 'inventado' }); vigilarUrgente();
check(Object.keys(lotes).length === nLotes, 'triggers falsos no lanzan informes ni gastan IA');
__web = true; let bloqueado = 0;
[activarDesdeMenu, desactivar, diagnostico].forEach(f => { try { f(); } catch (e) { bloqueado++; } });
__web = false;
check(bloqueado === 3 && __triggers.length === nTrig, 'las funciones del menú no se pueden usar desde la web');

console.log(fallos ? '\n❌ ' + fallos + ' fallos' : '\n✅ Todo OK');
process.exitCode = fallos ? 1 : 0;

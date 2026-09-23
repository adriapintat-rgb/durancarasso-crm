// Prueba de extremo a extremo con Google, Claude y la hoja simulados: node agente-gbp/test/probar.js
const fs = require('fs'); const M = require('./mocks.js');
// ── Datos simulados (BCN real según la captura; resto y competencia SIMULADOS)
const FICHAS = {
  BCN: { rating: 4.7, n: 62, fotos: 10, tel: '931 59 51 25', dir: 'Carrer de Muntaner, 259, 08021 Barcelona' },
  STG: { rating: 4.9, n: 18, fotos: 6, tel: '938 11 22 33', dir: 'Sitges (simulado)' },
  CRD: { rating: 4.6, n: 9, fotos: 4, tel: '972 88 77 66', dir: 'Puigcerdà (simulado)' },
  AND: { rating: 5.0, n: 7, fotos: 3, tel: '+376 800 000', dir: 'Andorra la Vella (simulado)' } };
let revs = { BCN: [{ name: 'places/BCN/reviews/1', rating: 5, text: { text: 'Trato excelente, nos ayudaron en todo.' }, authorAttribution: { displayName: 'Laura M.' }, publishTime: '2026-09-10T10:00:00Z' }] };
let claudeCalls = [];
global.UrlFetchApp = { fetch: (url, o = {}) => {
  const R = (obj, code = 200) => ({ getResponseCode: () => code, getContentText: () => typeof obj === 'string' ? obj : JSON.stringify(obj) });
  const body = o.payload ? JSON.parse(o.payload) : {};
  if (url.includes('places:searchText')) {
    const q = body.textQuery; const code = ['BCN', 'STG', 'CRD', 'AND'].find(c => q.toLowerCase().includes({ BCN: 'barcelona', STG: 'sitges', CRD: 'cerdanya', AND: 'andorra' }[c]));
    if (/Durán Carasso/.test(q)) return R({ places: [{ id: 'id_' + code }] });
    return R({ places: [{ id: 'id_' + code, displayName: { text: 'Durán Carasso' } }].concat([180, 95, 41, 22, 12].map((n, i) => ({ id: 'c' + i, displayName: { text: 'Competidor ' + 'ABCDE'[i] + ' (simulado)' }, rating: [4.8, 4.5, 4.9, 4.3, 4.7][i], userRatingCount: n, photos: Array(10) }))) });
  }
  const m = url.match(/places\/id_(\w+)\?/);
  if (m) { const f = FICHAS[m[1]]; return R({ displayName: { text: 'Durán Carasso' }, formattedAddress: f.dir, nationalPhoneNumber: f.tel, websiteUri: 'https://www.durancarasso.com/', businessStatus: 'OPERATIONAL', rating: f.rating, userRatingCount: f.n, photos: Array(f.fotos), regularOpeningHours: { weekdayDescriptions: ['lunes: 9:30–14:00, 16:00–19:00'] }, reviews: revs[m[1]] || [] }); }
  if (url.includes('pagespeedonline')) return R({ lighthouseResult: { categories: { seo: { score: 0.85 }, performance: { score: 0.42 } }, audits: { 'largest-contentful-paint': { displayValue: '5,1 s' } } } });
  if (url.startsWith('https://www.durancarasso.com')) return R('<html><title>Durán Carasso</title><h1>A</h1><h1>B</h1><p>931 59 51 25</p></html>');
  if (url.includes('api.anthropic.com')) { claudeCalls.push(body); return R(fakeClaude(body)); }
  throw new Error('URL no simulada: ' + url);
} };
function msg(text) { return { stop_reason: 'end_turn', content: [{ type: 'text', text }] }; }
function fakeClaude(b) {
  if (b.tools) return msg('• La web oficial sale 1ª para "Durán Carasso".\n• (simulado) Un directorio muestra un teléfono antiguo.\n• Los competidores publican cada semana y tienen >90 reseñas.');
  if (!b.output_config || !b.output_config.format) return msg('Hola Marc, lamentamos mucho tu experiencia. Nos gustaría entender qué pasó y ponerle solución: ¿podemos llamarte? Escríbenos a info@durancarasso.com. — Equipo Durán Carasso');
  const inp = JSON.parse(b.messages[0].content);
  return msg(JSON.stringify({ resumen: '(SIMULADO) Barcelona lidera en nota pero está 3ª en reseñas frente a la competencia. Sitges, Cerdanya y Andorra tienen fichas pobres en fotos y reseñas: es la palanca más rápida. La web necesita schema y un solo H1.',
    sedes: inp.sedes.map(s => ({ sede: s.sede, estado: 'Ficha al ' + s.completitud.porcentaje + '%. ' + s.ficha.numResenas + ' reseñas, ' + s.ficha.rating + '★.',
      vsCompetencia: 'El líder tiene ' + s.posicion.lider.resenas + ' reseñas frente a tus ' + s.ficha.numResenas + '.',
      acciones: [
        { prioridad: 'ALTA', accion: 'Pedir reseña a los últimos 10 clientes', motivo: 'Puesto ' + s.posicion.porResenas + ' de ' + s.posicion.total + ' en reseñas', opciones: ['WhatsApp personal del agente', 'Email automático tras firma', 'Tarjeta QR en la entrega de llaves'], recomendada: 'WhatsApp personal del agente: la tasa de respuesta es mucho mayor', cuando: 'Esta semana, martes o miércoles 18:00-20:00', contenido: 'Hola {nombre}, soy {agente} de Durán Carasso. ¿Nos dejarías tu opinión en Google? Nos ayuda muchísimo: {enlace}' },
        { prioridad: 'MEDIA', accion: 'Subir 10 fotos (fachada, oficina, equipo)', motivo: 'Solo ' + s.ficha.fotos + ' fotos', opciones: ['Sesión profesional', 'Fotos del equipo con móvil'], recomendada: 'Sesión profesional de 1 h para las 4 sedes', cuando: 'Antes del 15 de octubre', contenido: '' }],
      post: 'Otoño en ' + ({ BCN: 'Barcelona', STG: 'Sitges', CRD: 'la Cerdanya', AND: 'Andorra' })[s.sede] + ': buen momento para vender con discreción. Te ayudamos con una valoración gratuita. (SIMULADO)',
      descripcion: s.sede === 'CRD' ? 'Durán Carasso Cerdanya: inmobiliaria especializada en casas y chalets de montaña en Puigcerdà, Alp y La Molina… (SIMULADO)' : '',
      respuestas: [] })) }));
}
eval(M.load());
Object.assign(global, { ejecutarSemanal, vigilarUrgente, instalar, doGet, accionWeb, token_, memoria_, decidir_, enlace_ });
const OUT = require('os').tmpdir() + '/';
function check(cond, txt) { console.log((cond ? '✅ ' : '❌ ') + txt); if (!cond) process.exitCode = 1; }

console.log('\n1) instalar()'); instalar();
check(__triggers.join() === 'ejecutarSemanal,vigilarUrgente', 'triggers: lunes + cada 3h');
check(['GBP_Propuestas', 'GBP_Historico', 'GBP_Competencia'].every(n => __sheets[n]), 'hojas creadas');

console.log('\n2) ejecutarSemanal()'); ejecutarSemanal();
const e1 = sent.at(-1); fs.writeFileSync(OUT + 'email-semanal.html', e1.html);
const props = __sheets.GBP_Propuestas.rows.slice(1);
check(e1.to === 'adriap@durancarasso.com', 'email a ' + e1.to + ' · asunto: ' + e1.subject);
check(props.length === 4 * 3 + 1, props.length + ' propuestas guardadas (2 tareas + 1 post por sede + 1 descripción)');
check(__sheets.GBP_Competencia.rows.length - 1 === 20, 'competencia guardada: ' + (__sheets.GBP_Competencia.rows.length - 1) + ' filas');
check((e1.html.match(/a=publicar/g) || []).length === props.length, 'cada propuesta tiene botón ✅');
check(!/durán carasso.*simulado/i.test(__sheets.GBP_Competencia.rows.map(r => r[2]).join()), 'Durán Carasso excluida de la competencia');
const plan = claudeCalls.find(c => c.output_config && c.output_config.format);
check(plan.model === 'claude-opus-5' && plan.fallbacks === 'default', 'Claude: modelo + fallback');

console.log('\n3) Botones del email → página');
const post = props.find(r => r[3] === 'POST'), tarea = props.find(r => r[3] === 'TAREA'), desc = props.find(r => r[3] === 'DESCRIPCION');
const page = doGet({ parameter: { id: post[0], t: token_(post[0]), a: 'editar' } }).getContent();
fs.writeFileSync(OUT + 'pagina-editar.html', page);
check(page.includes(post[0]) && page.includes('Otoño'), 'página de edición carga la propuesta');
check(doGet({ parameter: { id: post[0], t: 'falso', a: 'publicar' } }).getContent().includes('Enlace no válido'), 'token falso rechazado');
check(__sheets.GBP_Propuestas.rows.find(r => r[0] === post[0])[9] === 'PENDIENTE', 'abrir el enlace NO publica nada (seguro ante antivirus)');

console.log('\n4) Decisiones');
let r = accionWeb(post[0], token_(post[0]), 'publicar', 'Otoño en Barcelona: valoración gratuita y discreta. Llámanos.', '');
check(r.estado === 'APROBADO_MANUAL' && r.manual, 'publicar sin Nivel 2 → aprobado + copiar/pegar: ' + r.mensaje);
r = accionWeb(post[0], token_(post[0]), 'publicar', 'x', '');
check(!r.ok, 'no se puede publicar dos veces: ' + r.mensaje);
r = accionWeb(desc[0], token_(desc[0]), 'descartar', '', 'No trabajamos Alp');
check(r.estado === 'DESCARTADO', 'descartar con motivo');
r = accionWeb(tarea[0], token_(tarea[0]), 'publicar', '', '');
check(r.estado === 'HECHO', 'tarea marcada como hecha');
check(accionWeb(tarea[0], token_(tarea[0]), 'borrar', '', '').ok === false, 'acción desconocida rechazada');

console.log('\n5) Memoria (aprende de ti)');
const mem = memoria_(); console.log('  ', JSON.stringify(mem));
check(mem.some(m => m.decision === 'EDITADA') && mem.some(m => m.motivo === 'No trabajamos Alp'), 'recuerda la edición y el descarte');
ejecutarSemanal();
const plan2 = JSON.parse(claudeCalls.filter(c => c.output_config && c.output_config.format).at(-1).messages[0].content);
check(plan2.decisiones_del_equipo.length === 2, 'la 2ª semana Claude recibe tus 2 decisiones');

console.log('\n6) Reseña negativa nueva (vigilancia cada 3 h)');
revs.BCN = revs.BCN.concat([{ name: 'places/BCN/reviews/2', rating: 2, text: { text: 'No me devolvieron las llamadas.' }, authorAttribution: { displayName: 'Marc P.' }, publishTime: '2026-09-23T09:00:00Z' }]);
const n = sent.length; vigilarUrgente();
const e2 = sent.at(-1); fs.writeFileSync(OUT + 'email-urgente.html', e2.html);
check(sent.length === n + 1 && e2.subject.includes('Barcelona'), 'alerta enviada: ' + e2.subject);
vigilarUrgente(); check(sent.length === n + 1, 'no repite la alerta');

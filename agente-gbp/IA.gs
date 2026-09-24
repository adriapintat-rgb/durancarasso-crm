// ── CLAUDE ───────────────────────────────────────────────────────────────────
// El informe semanal usa la Batches API: sin límite de tiempo de Apps Script y un 50 % más barata.
// Solo la respuesta urgente a una reseña negativa usa una llamada directa (corta y rápida).

var ANTHROPIC = 'https://api.anthropic.com/v1/messages';

var SCHEMA_SEDE = {
  type: 'object', additionalProperties: false,
  required: ['titular', 'estado', 'vsCompetencia', 'acciones', 'post', 'descripcion', 'respuestas'],
  properties: {
    titular: { type: 'string' },
    estado: { type: 'string' },
    vsCompetencia: { type: 'string' },
    acciones: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['prioridad', 'accion', 'motivo', 'opciones', 'recomendada', 'cuando', 'contenido'],
      properties: {
        prioridad: { type: 'string', enum: ['ALTA', 'MEDIA', 'BAJA'] },
        accion: { type: 'string' }, motivo: { type: 'string' },
        opciones: { type: 'array', items: { type: 'string' } },
        recomendada: { type: 'string' }, cuando: { type: 'string' },
        contenido: { type: 'string' }
      }
    } },
    post: { type: 'string' },
    descripcion: { type: 'string' },
    respuestas: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['id', 'texto'],
      properties: { id: { type: 'string' }, texto: { type: 'string' } }
    } }
  }
};

var SYSTEM_PROMPT = [
  'Eres el gestor de SEO local y de las fichas de Google (Perfil de Empresa) de Durán Carasso, inmobiliaria premium.',
  'Trabajas para el equipo de marketing. Cada semana analizas UNA sede y propones qué hacer.',
  'Objetivo: que quien busque "Durán Carasso" o "inmobiliaria + zona" encuentre una ficha completa, activa, coherente',
  'con la web y mejor que la de la competencia, y que eso se traduzca en más llamadas, visitas y clics.',
  '',
  'Recibes: empresa, perfil_sede (dirección y teléfono oficiales, zonas, idiomas, competidores de referencia),',
  'datos de la ficha, web, PageSpeed, completitud, competencia (top 5 en Google Maps), posición, métricas si hay,',
  'búsqueda de marca, problemas detectados, a veces "web_global" (auditoría del dominio común a todas las sedes) y',
  '"decisiones_del_equipo": propuestas anteriores que el equipo editó o descartó. Aprende de ellas: imita sus',
  'correcciones de tono, longitud y contenido y no repitas lo descartado salvo que haya cambiado algo importante.',
  '',
  'Devuelve:',
  '- titular: una frase para dirección con lo más importante de la sede esta semana.',
  '- estado: 1-2 frases sobre cómo está la ficha y qué ha cambiado respecto a "anterior".',
  '- vsCompetencia: 1-3 frases con cifras (nota, reseñas) frente a la competencia y qué hacen mejor.',
  '- acciones: máximo 4, por impacto, concretas (qué tocar y dónde exactamente). Para cada una: 2-3 opciones cortas,',
  '  la recomendada y por qué, cuándo (fecha o franja concreta según urgencia, temporada de la zona — Cerdanya/Andorra:',
  '  esquí dic-mar y verano; Sitges: primavera-verano; Barcelona: todo el año — y festivos próximos de Cataluña/Andorra;',
  '  recuerda el horario especial una semana antes), y contenido: texto o código listo para copiar (JSON-LD, meta',
  '  description, mensaje de WhatsApp para pedir reseñas…) o cadena vacía. No metas aquí el post, la descripción ni',
  '  las respuestas a reseñas.',
  '- post: publicación semanal para la ficha, en el primer idioma de la sede, máx. 1.200 caracteres, tono premium y',
  '  cercano, palabras clave locales. PROHIBIDO incluir teléfonos, emails o URLs (Google rechaza esos posts) y',
  '  inventar inmuebles, precios o cifras. Cadena vacía si publicaron hace menos de 4 días.',
  '- descripcion: nueva descripción de negocio (650-750 caracteres, en el primer idioma de la sede, sin URLs ni',
  '  teléfonos, con zonas y servicios reales) solo si la actual falta, es corta o claramente mejorable; si no, "".',
  '- respuestas: borrador solo para reseñas con respondida=false (usa su id exacto), en el idioma de la reseña,',
  '  personalizada; en negativas: empatía, sin excusas ni datos personales, invitación a hablar por teléfono.',
  '',
  'Reglas: propón solo servicios que la empresa ofrece y usa las zonas reales de la sede. Si la dirección o el',
  'teléfono de la ficha no coinciden con perfil_sede, crea una acción ALTA. Si el nombre de la ficha añade palabras',
  'clave al nombre real (p. ej. "Durán Carasso | Inmobiliaria en …"), avisa de que incumple las normas de Google y',
  'puede provocar una suspensión (decisión de dirección). Si hay web_global con problemas, inclúyelos como acciones.',
  'No inventes datos que no estén en el JSON. Nada de promesas de rentabilidad.'
].join('\n');

/** Petición de plan para una sede (se envía en lote). */
function peticionPlan_(snap, extra) {
  var input = { fecha: fecha_(), empresa: PERFIL_EMPRESA, perfil_sede: PERFIL_SEDES[snap.sede] || {}, sede: snap,
                decisiones_del_equipo: memoria_().filter(function (m) { return m.sede === snap.sede || m.tipo === 'TAREA'; }) };
  for (var k in extra || {}) input[k] = extra[k];
  return {
    custom_id: 'plan-' + snap.sede,
    params: {
      model: CLAUDE_MODEL, max_tokens: 16000, system: SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: SCHEMA_SEDE } },
      messages: [{ role: 'user', content: JSON.stringify(input) }]
    }
  };
}

/** Petición de búsqueda de marca para una sede (web search, se envía en lote). */
function peticionBusqueda_(snap) {
  var f = snap.ficha || {}, ps = PERFIL_SEDES[snap.sede] || {}, s = sede_(snap.sede);
  return {
    custom_id: 'busq-' + snap.sede,
    params: {
      model: CLAUDE_MODEL, max_tokens: 8000,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6,
                user_location: { type: 'approximate', country: snap.sede === 'AND' ? 'AD' : 'ES' } }],
      messages: [{ role: 'user', content:
        'Busca como lo haría un cliente: "Durán Carasso ' + snap.nombre + '", "' + s.mercado + '" y "mejor inmobiliaria ' + snap.nombre + '".\n' +
        'Datos oficiales: ' + JSON.stringify({ direccion: ps.direccion || f.direccion || '', telefono: ps.telefono || f.telefono || '', web: f.web || '' }) + '\n' +
        'Responde en español, máx. 1.000 caracteres, en viñetas: 1) qué aparece de la marca y si la web oficial sale primero;' +
        ' 2) datos incoherentes en otros sitios (dirección, teléfono, horario; con URL); 3) qué tienen los competidores (' +
        (ps.competidores || 'los que salgan') + ') que a nosotros nos falta; 4) si Durán Carasso aparece recomendada en las' +
        ' respuestas o rankings de "mejor inmobiliaria ' + snap.nombre + '". Solo hechos encontrados.' }]
    }
  };
}

/** Borrador inmediato para una reseña negativa (fuera del ciclo semanal, llamada directa). */
function respuestaUrgente_(s, r) {
  return textoClaude_(claude_({
    model: CLAUDE_MODEL, max_tokens: 4000, system: SYSTEM_PROMPT,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content:
      'Redacta solo la respuesta pública (sin comillas ni explicaciones) a esta reseña de la sede ' + s.nombre +
      ', en el idioma de la reseña.\n' +
      JSON.stringify({ estrellas: r.estrellas, autor: r.autor, texto: r.texto, perfil_sede: PERFIL_SEDES[s.code] || {},
                       decisiones_del_equipo: memoria_().filter(function (m) { return m.tipo === 'RESPUESTA'; }) }) }]
  })).trim();
}

// ── API: LLAMADA DIRECTA ─────────────────────────────────────────────────────
function cabeceras_(beta) {
  var h = { 'x-api-key': prop_('ANTHROPIC_API_KEY', true), 'anthropic-version': '2023-06-01' };
  if (beta) h['anthropic-beta'] = beta;
  return h;
}

/** POST /v1/messages con fallback de servidor ante rechazos. */
function claude_(body) {
  body.fallbacks = 'default';
  var res = UrlFetchApp.fetch(ANTHROPIC, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: cabeceras_('server-side-fallback-2026-07-01'), payload: JSON.stringify(body) });
  var code = res.getResponseCode(), j = JSON.parse(res.getContentText());
  if (code !== 200) throw new Error('Claude API ' + code + ': ' + res.getContentText().slice(0, 500));
  validarMensaje_(j);
  return j;
}

function validarMensaje_(j) {
  if (j.stop_reason === 'refusal') throw new Error('Claude rechazó la petición: ' + JSON.stringify(j.stop_details));
  if (j.stop_reason === 'max_tokens') throw new Error('Respuesta de Claude truncada (max_tokens)');
}

function textoClaude_(j) {
  return (j.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
}

// ── API: LOTES (Batches) ─────────────────────────────────────────────────────
function crearLote_(peticiones) {
  var res = UrlFetchApp.fetch(ANTHROPIC + '/batches', { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: cabeceras_(), payload: JSON.stringify({ requests: peticiones }) });
  if (res.getResponseCode() !== 200) throw new Error('Claude Batches ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 500));
  return JSON.parse(res.getContentText()).id;
}

/** Devuelve null si el lote no ha terminado; si terminó, { custom_id: {ok, mensaje|error} }. */
function resultadosLote_(id) {
  var res = UrlFetchApp.fetch(ANTHROPIC + '/batches/' + id, { muteHttpExceptions: true, headers: cabeceras_() });
  if (res.getResponseCode() !== 200) throw new Error('Claude Batches ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  var lote = JSON.parse(res.getContentText());
  if (lote.processing_status !== 'ended') return null;
  var out = {}, r = UrlFetchApp.fetch(lote.results_url, { muteHttpExceptions: true, headers: cabeceras_() });
  r.getContentText().split('\n').forEach(function (linea) {
    if (!linea.trim()) return;
    var x = JSON.parse(linea), rr = x.result || {};
    if (rr.type !== 'succeeded') { out[x.custom_id] = { ok: false, error: rr.type + ' ' + JSON.stringify(rr.error || '') }; return; }
    try { validarMensaje_(rr.message); out[x.custom_id] = { ok: true, mensaje: rr.message }; }
    catch (e) { out[x.custom_id] = { ok: false, error: String(e) }; }
  });
  return out;
}

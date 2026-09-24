// ── CLAUDE: PLAN SEMANAL ─────────────────────────────────────────────────────
var SCHEMA_PLAN = {
  type: 'object', additionalProperties: false, required: ['resumen', 'sedes'],
  properties: {
    resumen: { type: 'string' },
    sedes: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['sede', 'estado', 'vsCompetencia', 'acciones', 'post', 'descripcion', 'respuestas'],
      properties: {
        sede: { type: 'string', enum: SEDES.map(function (s) { return s.code; }) },
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
    } }
  }
};

var SYSTEM_PROMPT = [
  'Eres el gestor de SEO local y de las fichas de Google (Perfil de Empresa) de Durán Carasso, inmobiliaria de lujo',
  'con sedes en Barcelona (BCN), Sitges (STG), Cerdanya (CRD) y Andorra (AND). Trabajas para el equipo de marketing.',
  'Objetivo: que quien busque "Durán Carasso" o "inmobiliaria de lujo + ciudad" encuentre una ficha completa, activa,',
  'coherente con la web y mejor que la de la competencia, y que eso se traduzca en más llamadas, visitas y clics.',
  '',
  'Recibes el estado semanal de cada sede: ficha, web, PageSpeed, completitud, competencia (top 5 en Google Maps),',
  'posición, métricas (si hay), búsqueda de marca y problemas detectados. También recibes "decisiones_del_equipo":',
  'propuestas tuyas anteriores que el equipo editó o descartó. Aprende de ellas: imita sus correcciones de tono,',
  'longitud y contenido y no repitas lo que descartaron salvo que haya cambiado algo importante.',
  '',
  'Devuelve para cada sede:',
  '- estado: 1-2 frases sobre cómo está la ficha y qué ha cambiado desde la semana pasada.',
  '- vsCompetencia: 1-3 frases comparando con la competencia con cifras (nota, reseñas, fotos) y qué hacen mejor.',
  '- acciones: máximo 4, por impacto, concretas (qué tocar y dónde exactamente). Por acción: 2-3 opciones cortas,',
  '  la recomendada y por qué, cuándo (fecha o franja concreta según urgencia, temporada de la zona — Cerdanya/Andorra:',
  '  esquí dic-mar y verano; Sitges: primavera-verano; Barcelona: todo el año — y festivos próximos de Cataluña/Andorra),',
  '  y contenido: el texto o código listo para copiar y pegar si aplica (JSON-LD, meta description, mensaje de WhatsApp',
  '  para pedir reseñas…) o cadena vacía. No incluyas aquí el post, la descripción ni las respuestas a reseñas.',
  '- post: publicación semanal para la ficha (máx. 1.200 caracteres, tono premium y cercano, palabras clave locales,',
  '  sin inventar inmuebles ni precios). Cadena vacía si publicaron hace menos de 4 días.',
  '- descripcion: nueva descripción de negocio (650-750 caracteres, sin URLs ni teléfonos, keywords locales) solo si la',
  '  actual falta, es corta o claramente mejorable; si no, cadena vacía.',
  '- respuestas: borrador solo para reseñas con respondida=false (usa su id exacto), en el idioma de la reseña,',
  '  personalizada; en negativas: empatía, sin excusas, invitación a hablar por teléfono.',
  'resumen: 3-4 frases para dirección con lo más importante de la semana.',
  'Usa "empresa" y "perfil_sedes": propón solo servicios que la empresa ofrece, usa las zonas reales de cada sede,',
  'escribe posts y descripción en el primer idioma de la sede (y respuestas en el idioma de la reseña), y compara',
  'también con los competidores de referencia si aparecen en los datos. Si la dirección o el teléfono de la ficha no',
  'coinciden con perfil_sedes, avísalo como acción ALTA.',
  'No inventes datos que no estén en el JSON.'
].join('\n');

function pedirPlanClaude_(snaps) {
  var input = { fecha: fecha_(), empresa: PERFIL_EMPRESA, perfil_sedes: PERFIL_SEDES, sedes: snaps, decisiones_del_equipo: memoria_() };
  return JSON.parse(textoClaude_(claude_({
    model: CLAUDE_MODEL, max_tokens: 20000, system: SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: SCHEMA_PLAN } },
    messages: [{ role: 'user', content: JSON.stringify(input) }]
  })));
}

/** Borrador inmediato para una reseña negativa (fuera del ciclo semanal). */
function respuestaUrgente_(s, r) {
  return textoClaude_(claude_({
    model: CLAUDE_MODEL, max_tokens: 4000, system: SYSTEM_PROMPT,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content:
      'Redacta solo la respuesta pública (sin comillas ni explicaciones) a esta reseña de la sede ' + s.nombre + '.\n' +
      JSON.stringify({ estrellas: r.estrellas, autor: r.autor, texto: r.texto, decisiones_del_equipo: memoria_() }) }]
  })).trim();
}

/** Qué ve un cliente al buscar la marca (web search). Se recalcula cada semana. */
function auditarBusqueda_(s, f) {
  var k = 'BUSQ_' + s.code, prev = JSON.parse(P.getProperty(k) || 'null');
  if (prev && Date.now() - prev.ts < 6 * 864e5) return prev.texto;
  try {
    var texto = textoClaude_(claude_({
      model: CLAUDE_MODEL, max_tokens: 8000,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6,
                user_location: { type: 'approximate', country: s.code === 'AND' ? 'AD' : 'ES' } }],
      messages: [{ role: 'user', content:
        'Busca como lo haría un cliente: "Durán Carasso ' + s.nombre + '" y "' + s.mercado + '".\n' +
        'Datos oficiales: ' + JSON.stringify({ direccion: f.formattedAddress || '', telefono: f.nationalPhoneNumber || '', web: f.websiteUri || '' }) + '\n' +
        'Responde en español, máx. 1.000 caracteres, en viñetas: 1) qué aparece de la marca y si la web oficial sale primero;' +
        ' 2) datos incoherentes en otros sitios (con URL); 3) qué tienen los competidores (' + ((PERFIL_SEDES[s.code] || {}).competidores || 'los que salgan') + ') que a nosotros nos falta.' +
        ' Solo hechos encontrados.' }]
    }));
    P.setProperty(k, JSON.stringify({ ts: Date.now(), texto: texto }));
    return texto;
  } catch (e) { return prev ? prev.texto : ''; }
}

// ── LLAMADA A LA API ─────────────────────────────────────────────────────────
/** POST /v1/messages con fallback de servidor; continúa si la búsqueda web devuelve pause_turn. */
function claude_(body) {
  body.fallbacks = 'default';
  for (var i = 0; i < 4; i++) {
    var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: {
        'x-api-key': prop_('ANTHROPIC_API_KEY', true),
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-07-01'
      },
      payload: JSON.stringify(body)
    });
    var code = res.getResponseCode(), j = JSON.parse(res.getContentText());
    if (code !== 200) throw new Error('Claude API ' + code + ': ' + res.getContentText().slice(0, 500));
    if (j.stop_reason === 'refusal') throw new Error('Claude rechazó la petición: ' + JSON.stringify(j.stop_details));
    if (j.stop_reason === 'max_tokens') throw new Error('Respuesta de Claude truncada (max_tokens)');
    if (j.stop_reason !== 'pause_turn') return j;
    body.messages = body.messages.concat([{ role: 'assistant', content: j.content }]);
  }
  throw new Error('Claude no terminó tras varios pause_turn');
}

function textoClaude_(j) {
  return j.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
}

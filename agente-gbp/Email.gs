// ── EMAILS ───────────────────────────────────────────────────────────────────
var COL = { navy: '#0D3550', gold: '#B8922A', bg: '#F5F4F1', sub: '#6B6B6B', border: '#E2E0DB', green: '#1E6B3A', red: '#B03020', orange: '#C45E0A' };
var NOMBRE_TIPO = { POST: 'Publicación', DESCRIPCION: 'Descripción', RESPUESTA: 'Respuesta a reseña', TAREA: 'Tarea' };

function btn_(txt, url, color, fondo) {
  return '<a href="' + esc_(url) + '" style="display:inline-block;padding:9px 14px;margin:4px 6px 0 0;border-radius:8px;font-size:13px;' +
    'font-weight:600;text-decoration:none;color:' + color + ';background:' + fondo + ';border:1px solid ' + (fondo === '#ffffff' ? COL.border : fondo) + '">' + txt + '</a>';
}
function color_(prio) { return prio === 'ALTA' ? COL.red : prio === 'MEDIA' ? COL.orange : COL.sub; }
function flecha_(a, b, invertir) {
  if (a === '' || b === '' || a == null || b == null || a === b) return '';
  var mejor = invertir ? b < a : b > a;
  return ' <span style="color:' + (mejor ? COL.green : COL.red) + '">' + (b > a ? '▲' : '▼') + '</span>';
}

function tarjetaPropuesta_(p, compacto) {
  var publicable = publicable_(p.tipo), s = sede_(p.sede);
  var html = '<div style="border:1px solid ' + COL.border + ';border-left:4px solid ' + color_(p.prioridad) + ';border-radius:10px;padding:12px 14px;margin:10px 0;background:#fff">' +
    '<div style="font-size:11px;font-weight:700;letter-spacing:.5px;color:' + color_(p.prioridad) + '">' + esc_(p.prioridad) + ' · ' + NOMBRE_TIPO[p.tipo].toUpperCase() + '</div>' +
    '<div style="font-weight:600;margin:4px 0">' + esc_(p.titulo) + '</div>';
  if (p._accion) {
    html += '<div style="font-size:13px;color:' + COL.sub + '">' + esc_(p._accion.motivo) + '</div>' +
      '<div style="font-size:13px;margin-top:6px">✅ <b>Mejor opción:</b> ' + esc_(p._accion.recomendada) + '</div>' +
      '<div style="font-size:13px">🗓️ <b>Cuándo:</b> ' + esc_(p._accion.cuando) + '</div>' +
      (p._accion.opciones.length > 1 ? '<div style="font-size:12px;color:' + COL.sub + ';margin-top:4px">Alternativas: ' + esc_(p._accion.opciones.join(' · ')) + '</div>' : '');
  } else if (p.tipo === 'RESPUESTA') {
    html += '<div style="font-size:13px;color:' + COL.sub + ';font-style:italic">"' + esc_(recorta_(p.contexto.replace(/^.*?: /, ''), 220)) + '"</div>';
  }
  if (publicable || (p._accion && p._accion.contenido)) {
    html += '<div style="font-size:13px;white-space:pre-wrap;background:' + COL.bg + ';border-radius:8px;padding:10px;margin-top:8px">' +
      esc_(recorta_(p.propuesta, compacto ? 160 : 420)) + '</div>';
  }
  if (!webappUrl_()) return html + '<div style="font-size:12px;color:' + COL.sub + ';margin-top:6px">Texto completo en la pestaña <b>GBP_Propuestas</b> de la hoja del agente (ID ' + esc_(p.id) + '). Los botones ✅ ✏️ ❌ se activan al publicar la app web.</div></div>';
  html += '<div style="margin-top:6px">';
  if (publicable) {
    html += btn_(nivel2_(s) ? '✅ Publicar' : '✅ Aprobar', enlace_(p.id, 'publicar'), '#ffffff', COL.green) +
            btn_('✏️ Editar', enlace_(p.id, 'editar'), COL.navy, '#ffffff');
  } else {
    html += btn_('✅ Hecho', enlace_(p.id, 'publicar'), '#ffffff', COL.green) +
            btn_(p._accion && p._accion.contenido ? '📋 Ver contenido' : '👁️ Ver', enlace_(p.id, 'editar'), COL.navy, '#ffffff');
  }
  return html + btn_('❌ Descartar', enlace_(p.id, 'descartar'), COL.red, '#ffffff') + '</div></div>';
}

function tablaCompetencia_(s) {
  if (!s.competencia || !s.competencia.length) return '';
  var filas = [{ nombre: 'Durán Carasso', rating: s.ficha.rating, resenas: s.ficha.numResenas, fotos: s.ficha.fotos, yo: true }]
    .concat(s.competencia.slice(0, 4))
    .sort(function (a, b) { return b.resenas - a.resenas; });
  var td = 'padding:6px 8px;border-bottom:1px solid ' + COL.border + ';font-size:12px';
  return '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:8px 0;background:#fff;border-radius:8px">' +
    '<tr style="color:' + COL.sub + '"><td style="' + td + '">Inmobiliaria</td><td style="' + td + ';text-align:right">Nota</td><td style="' + td + ';text-align:right">Reseñas</td></tr>' +
    filas.map(function (c) {
      var st = c.yo ? 'font-weight:700;color:' + COL.navy + ';background:#FBF6EA' : '';
      return '<tr style="' + st + '"><td style="' + td + '">' + esc_(c.nombre) + '</td><td style="' + td + ';text-align:right">' + (c.rating || '–') +
        '★</td><td style="' + td + ';text-align:right">' + c.resenas + '</td></tr>';
    }).join('') + '</table>';
}

function enviarSemanal_(snaps, plan, props) {
  var html = htmlSemanal_(snaps, plan, props, false);
  if (html.length > 95000) html = htmlSemanal_(snaps, plan, props, true);   // Gmail recorta los emails de más de 102 KB
  var urg = props.filter(function (p) { return p.prioridad === 'ALTA'; }).length;
  var txt = plan.resumen + '\n\n' + props.map(function (p) { return '[' + p.sede + '][' + p.prioridad + '] ' + NOMBRE_TIPO[p.tipo] + ': ' + p.titulo; }).join('\n');
  enviar_('Agente Google · ' + (urg ? urg + ' urgentes · ' : '') + props.length + ' propuestas · ' + fecha_(), txt, html);
}

function htmlSemanal_(snaps, plan, props, compacto) {
  var mes = new Date().getDate() <= 7 ? resultadosMes_() : null;
  var urg = props.filter(function (p) { return p.prioridad === 'ALTA'; }).length;
  var pend = pendientesAnteriores_();
  var h = '<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:640px;margin:0 auto;background:' + COL.bg + ';padding:0 0 20px;color:#111">' +
    '<div style="background:' + COL.navy + ';color:#fff;padding:20px 18px"><div style="font-size:10px;letter-spacing:3px;opacity:.5;text-transform:uppercase">Agente Google · Durán Carasso</div>' +
    '<div style="font-size:20px;font-weight:600;margin-top:4px">Informe semanal · ' + fecha_() + '</div></div>' +
    '<div style="padding:16px 18px"><p style="background:#fff;border-radius:10px;padding:14px;margin:0;line-height:1.5;border:1px solid ' + COL.border + '">' +
      String(plan.resumen).split('\n').map(function (l) { var i = l.indexOf(': '); return i > 0 ? '<b>' + esc_(l.slice(0, i)) + '</b>: ' + esc_(l.slice(i + 2)) : esc_(l); }).join('<br>') + '</p>' +
    '<p style="font-size:13px;color:' + COL.sub + ';margin:10px 0 0">' + props.length + ' propuestas nuevas' + (urg ? ' · <b style="color:' + COL.red + '">' + urg + ' urgentes</b>' : '') +
    (pend ? ' · ' + pend + ' pendientes de semanas anteriores' : '') + '. Pulsa ✅ para aprobar, ✏️ para editar o ❌ para descartar.</p>';

  if (plan.dominio && plan.dominio.problemas && plan.dominio.problemas.length) {
    h += '<div style="background:#fff;border:1px solid ' + COL.border + ';border-radius:10px;padding:12px 14px;margin-top:14px;font-size:13px">' +
      '<b style="color:' + COL.navy + '">🌐 Web (común a las 4 sedes)</b><br>' + plan.dominio.problemas.map(function (x) { return '· ' + esc_(x); }).join('<br>') + '</div>';
  }
  if (mes && Object.keys(mes).length) {
    h += '<h3 style="color:' + COL.navy + ';margin:22px 0 6px">📈 Resultados del último mes</h3><table style="width:100%;border-collapse:collapse;background:#fff;font-size:12px">' +
      '<tr style="color:' + COL.sub + '"><td style="padding:6px">Sede</td><td>Nota</td><td>Reseñas</td><td>Ficha</td><td>Puesto</td><td>Llamadas</td><td>Rutas</td><td>Clics web</td></tr>';
    SEDES.forEach(function (s) {
      var m = mes[s.code]; if (!m) return;
      h += '<tr style="border-top:1px solid ' + COL.border + '"><td style="padding:6px;font-weight:600">' + s.nombre + '</td>' +
        '<td>' + m.nota[1] + flecha_(m.nota[0], m.nota[1]) + '</td><td>' + m.resenas[1] + flecha_(m.resenas[0], m.resenas[1]) + '</td>' +
        '<td>' + m.ficha[1] + '%' + flecha_(m.ficha[0], m.ficha[1]) + '</td><td>' + (m.puesto[1] || '–') + flecha_(m.puesto[0], m.puesto[1], true) + '</td>' +
        '<td>' + (m.llamadas || '–') + '</td><td>' + (m.rutas || '–') + '</td><td>' + (m.clics || '–') + '</td></tr>';
    });
    h += '</table>';
  }

  snaps.forEach(function (s) {
    h += '<h2 style="color:' + COL.navy + ';font-size:18px;border-bottom:2px solid ' + COL.gold + ';padding-bottom:6px;margin:28px 0 8px">' + esc_(s.nombre) + '</h2>';
    if (s.error) { h += '<p style="color:' + COL.red + '">No se pudo analizar: ' + esc_(s.error) + '</p>'; return; }
    var ps = plan.sedes.filter(function (x) { return x.sede === s.sede; })[0] || {};
    var pc = s.completitud.porcentaje, cc = pc >= 90 ? COL.green : pc >= 70 ? COL.orange : COL.red;
    var ant = s.anterior || {};
    h += '<table style="width:100%;border-collapse:collapse;text-align:center;background:#fff;border-radius:10px;border:1px solid ' + COL.border + '"><tr>' +
      '<td style="padding:10px"><div style="font-size:22px;font-weight:700;color:' + cc + '">' + pc + '%' + flecha_(ant.completitud, pc) + '</div><div style="font-size:11px;color:' + COL.sub + '">Ficha completa</div></td>' +
      '<td><div style="font-size:22px;font-weight:700">' + s.ficha.rating + '★' + flecha_(ant.rating, s.ficha.rating) + '</div><div style="font-size:11px;color:' + COL.sub + '">Nota</div></td>' +
      '<td><div style="font-size:22px;font-weight:700">' + s.ficha.numResenas + flecha_(ant.numResenas, s.ficha.numResenas) + '</div><div style="font-size:11px;color:' + COL.sub + '">Reseñas</div></td>' +
      (s.posicion ? '<td><div style="font-size:22px;font-weight:700">' + s.posicion.porResenas + 'º</div><div style="font-size:11px;color:' + COL.sub + '">de ' + s.posicion.total + ' en reseñas</div></td>' : '') +
      '</tr></table>';
    if (s.completitud.falta.length) h += '<p style="font-size:12px;color:' + COL.sub + ';margin:6px 0">Falta: ' + esc_(s.completitud.falta.join(' · ')) + '</p>';
    if (ps.estado) h += '<p style="margin:10px 0">' + esc_(ps.estado) + '</p>';
    if (ps.vsCompetencia) h += '<p style="margin:10px 0"><b>Vs. competencia:</b> ' + esc_(ps.vsCompetencia) + '</p>';
    if (!compacto) h += tablaCompetencia_(s);
    props.filter(function (p) { return p.sede === s.sede; })
      .sort(function (a, b) { return ['ALTA', 'MEDIA', 'BAJA'].indexOf(a.prioridad) - ['ALTA', 'MEDIA', 'BAJA'].indexOf(b.prioridad); })
      .forEach(function (p) { h += tarjetaPropuesta_(p, compacto); });
    if (s.busquedaMarca && !compacto) h += '<div style="margin-top:12px;background:#fff;border:1px dashed ' + COL.border + ';border-radius:10px;padding:10px 12px">' +
      '<div style="font-size:12px;font-weight:700;color:' + COL.navy + '">🔎 Qué ve un cliente al buscar la marca</div>' +
      '<div style="white-space:pre-wrap;font-size:12px;color:#333;margin-top:4px">' + esc_(recorta_(s.busquedaMarca, 1200)) + '</div></div>';
  });
  h += '<p style="font-size:11px;color:' + COL.sub + ';margin-top:28px">Todas las propuestas quedan en la hoja GBP_Propuestas. Lo que editas o descartas, el agente lo aprende para la semana siguiente.</p></div></div>';
  return h;
}

function enviarUrgente_(props) {
  var h = '<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:640px;margin:0 auto">' +
    '<div style="background:' + COL.red + ';color:#fff;padding:16px 18px;border-radius:10px 10px 0 0;font-weight:600">🔴 Reseña negativa nueva · respuesta preparada</div>' +
    '<div style="padding:8px 4px">' + props.map(function (p) { return tarjetaPropuesta_(p, false); }).join('') +
    '<p style="font-size:12px;color:' + COL.sub + '">Consejo: llama al cliente antes de responder en público si es posible.</p></div></div>';
  enviar_('🔴 Reseña negativa en ' + props.map(function (p) { return sede_(p.sede).nombre; }).join(', '),
    props.map(function (p) { return p.contexto + '\n→ ' + p.propuesta; }).join('\n\n'), h);
}

function enviar_(asunto, texto, html) {
  (prop_('NOTIFY_EMAILS') || DEFAULT_EMAILS).split(',').forEach(function (to) {
    MailApp.sendEmail(to.trim(), asunto, texto, { htmlBody: html, name: 'Agente Google DC' });
  });
}

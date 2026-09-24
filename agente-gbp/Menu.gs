// ── MENÚ EN LA HOJA DEL CRM ──────────────────────────────────────────────────
// Si el script está dentro de la hoja (Extensiones → Apps Script), aparece el menú
// "🤖 Agente Google" y todo se configura con clics, sin tocar código.

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🤖 Agente Google')
    .addItem('1 · Configurar claves', 'configurarClaves')
    .addItem('2 · Comprobar que todo funciona', 'diagnostico')
    .addItem('3 · Activar agente (lunes 8:30 + alertas)', 'activarDesdeMenu')
    .addItem('4 · Enviar informe ahora', 'enviarAhoraDesdeMenu')
    .addSeparator()
    .addItem('Desactivar agente', 'desactivar')
    .addToUi();
}

function configurarClaves() {
  var ui = SpreadsheetApp.getUi();
  var campos = [
    ['ANTHROPIC_API_KEY', 'Clave de Anthropic (empieza por sk-ant-)', true],
    ['GOOGLE_API_KEY', 'Clave de Google Cloud (empieza por AIza)', true],
    ['NOTIFY_EMAILS', 'Emails que reciben el informe, separados por coma.\nDéjalo vacío para usar ' + DEFAULT_EMAILS, false]
  ];
  for (var i = 0; i < campos.length; i++) {
    var c = campos[i], actual = prop_(c[0]);
    var r = ui.prompt('Agente Google · ' + (i + 1) + '/' + campos.length,
      c[1] + (actual ? '\n\n(Ya configurada. Déjalo vacío para mantenerla.)' : ''), ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    var v = r.getResponseText().trim();
    if (v) P.setProperty(c[0], v);
    else if (c[2] && !actual) { ui.alert('Esta clave es obligatoria. Vuelve a empezar cuando la tengas.'); return; }
  }
  diagnostico();
}

/** Revisa cada pieza y dice exactamente qué falta y cómo arreglarlo. */
function diagnostico() {
  var r = comprobaciones_();
  var txt = r.map(function (x) { return (x.ok ? '✅ ' : x.opcional ? '⚪ ' : '❌ ') + x.nombre + (x.detalle ? '\n     ' + x.detalle : ''); }).join('\n\n');
  var listo = r.every(function (x) { return x.ok || x.opcional; });
  mostrar_('Agente Google · ' + (listo ? 'listo ✅' : 'falta algo'), txt + (listo ? '\n\nTodo correcto. Siguiente: menú → 3 · Activar agente.' : ''));
  return r;
}

function comprobaciones_() {
  var out = [];
  function add(nombre, ok, detalle, opcional) { out.push({ nombre: nombre, ok: ok, detalle: detalle || '', opcional: !!opcional }); }

  var ak = prop_('ANTHROPIC_API_KEY');
  if (!ak) add('Clave de Anthropic', false, 'Menú → 1 · Configurar claves');
  else {
    var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/models?limit=1', { muteHttpExceptions: true,
      headers: { 'x-api-key': ak, 'anthropic-version': '2023-06-01' } });
    add('Clave de Anthropic', res.getResponseCode() === 200,
      res.getResponseCode() === 200 ? '' : 'Anthropic responde ' + res.getResponseCode() + ': revisa la clave o que la cuenta tenga saldo');
  }

  if (!prop_('GOOGLE_API_KEY')) add('Clave de Google', false, 'Menú → 1 · Configurar claves');
  else {
    SEDES.forEach(function (s) {
      try {
        var f = fichaPlaces_(placeId_(s));
        add('Ficha ' + s.nombre, true, (f.displayName || {}).text + ' · ' + (f.formattedAddress || '') + ' · ' + (f.rating || '–') + '★ (' + (f.userRatingCount || 0) + ')');
      } catch (e) {
        var m = String(e);
        add('Ficha ' + s.nombre, false, /403|PERMISSION|not been used|disabled/i.test(m)
          ? 'Activa "Places API (New)" en Google Cloud para esta clave' : m.slice(0, 200));
      }
    });
    try { pageSpeed_('https://www.google.com').error ? add('PageSpeed Insights API', false, 'Actívala en Google Cloud (misma clave)') : add('PageSpeed Insights API', true); }
    catch (e) { add('PageSpeed Insights API', false, String(e).slice(0, 200)); }
  }

  var url = webappUrl_();
  if (/\/dev$/.test(url)) add('Botones del email (app web)', false, 'Usa la URL que termina en /exec: guárdala en Propiedades del script como WEBAPP_URL');
  else add('Botones del email (app web)', !!url, url ? '' :
    'Implementar → Nueva implementación → tipo "Aplicación web" → Ejecutar como: yo · Acceso: cualquier usuario → Implementar');

  var triggers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  add('Agente activado', triggers.indexOf('ejecutarSemanal') !== -1, 'Menú → 3 · Activar agente');

  add('Nivel 2: publicar solo en Google', !!prop_('GBP_ACCOUNT_ID') && SEDES.some(function (s) { return s.gbpLocationId; }),
    'Opcional. Sin esto, al aprobar te da el texto para pegarlo en Google (ver README)', true);
  return out;
}

function activarDesdeMenu() {
  var faltan = comprobaciones_().filter(function (x) { return !x.ok && !x.opcional && x.nombre !== 'Agente activado'; });
  if (faltan.length) return mostrar_('Antes de activar', 'Falta:\n\n' + faltan.map(function (x) { return '❌ ' + x.nombre + '\n     ' + x.detalle; }).join('\n\n'));
  instalar();
  mostrar_('Agente activado ✅', 'Cada lunes a las 8:30 recibirás el informe en ' + (prop_('NOTIFY_EMAILS') || DEFAULT_EMAILS) +
    '.\nCada 3 h vigila reseñas negativas.\n\nSi quieres el primer informe ya: menú → 4 · Enviar informe ahora (tarda 2-4 min).');
}

function enviarAhoraDesdeMenu() {
  SpreadsheetApp.getActive().toast('Analizando las 4 sedes… tarda 2-4 minutos.', 'Agente Google', 240);
  try {
    ejecutarSemanal();
    mostrar_('Informe enviado ✅', 'Revisa ' + (prop_('NOTIFY_EMAILS') || DEFAULT_EMAILS) + '. Las propuestas también están en la pestaña GBP_Propuestas.');
  } catch (e) { mostrar_('Error', String(e) + '\n\nEjecuta "2 · Comprobar que todo funciona" para ver qué falta.'); }
}

function desactivar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  mostrar_('Agente desactivado', 'No se enviarán más informes ni alertas hasta que lo vuelvas a activar.');
}

function mostrar_(titulo, texto) {
  try { SpreadsheetApp.getUi().alert(titulo, texto, SpreadsheetApp.getUi().ButtonSet.OK); }
  catch (e) { Logger.log(titulo + '\n' + texto); }
}

function webappUrl_() {
  if (prop_('WEBAPP_URL')) return prop_('WEBAPP_URL');
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}

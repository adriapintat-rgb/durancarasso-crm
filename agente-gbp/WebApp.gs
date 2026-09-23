// ── APP WEB: página que abren los botones del email ──────────────────────────
// Los enlaces del email solo ABREN esta página (GET no cambia nada: los antivirus
// de correo que pre-abren enlaces no pueden publicar). La acción se confirma con un botón.

function doGet(e) {
  var id = (e.parameter || {}).id || '', t = (e.parameter || {}).t || '', a = (e.parameter || {}).a || 'editar';
  var tpl = HtmlService.createTemplateFromFile('Pagina');
  tpl.error = '';
  tpl.d = null;
  if (!id || t !== token_(id)) tpl.error = 'Enlace no válido o caducado.';
  else {
    var p = buscarPropuesta_(id);
    if (!p) tpl.error = 'Esta propuesta ya no existe.';
    else {
      var r = p.row, s = sede_(r[C.SEDE]);
      tpl.d = {
        id: id, t: t, accion: a, sede: s ? s.nombre : r[C.SEDE], tipo: r[C.TIPO], titulo: r[C.TITULO],
        contexto: r[C.CTX], texto: r[C.FINAL] || r[C.PROP], estado: r[C.ESTADO],
        publicable: publicable_(r[C.TIPO]), nivel2: nivel2_(s), panel: GBP_PANEL_URL
      };
    }
  }
  return tpl.evaluate().setTitle('Agente Google · Durán Carasso')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Llamado desde la página con google.script.run. */
function accionWeb(id, t, accion, texto, feedback) {
  if (t !== token_(id)) return { ok: false, mensaje: 'Enlace no válido.' };
  if (['publicar', 'hecho', 'descartar'].indexOf(accion) === -1) return { ok: false, mensaje: 'Acción no válida.' };
  return decidir_(id, accion, texto, feedback);
}

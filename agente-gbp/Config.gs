/**
 * AGENTE GOOGLE · Durán Carasso
 * Gestor semanal de las fichas de Google + SEO de las 4 sedes.
 * Analiza, compara con la competencia, propone cambios que se aprueban o editan
 * desde el propio email, y aprende de lo que el equipo aprueba, edita o descarta.
 *
 * Script Properties (Configuración del proyecto → Propiedades del script):
 *   ANTHROPIC_API_KEY   obligatorio
 *   GOOGLE_API_KEY      obligatorio (Places API (New) + PageSpeed Insights API)
 *   WEBAPP_URL          opcional: URL /exec de la app web (se detecta sola al implementarla)
 *   NOTIFY_EMAILS       opcional (por defecto DEFAULT_EMAILS)
 *   GBP_ACCOUNT_ID      opcional → Nivel 2: publicar, reseñas sin responder, métricas
 *   SHEET_ID            opcional (por defecto la hoja del CRM)
 *   AUTOPILOTO          opcional, JSON (ver AUTOPILOTO_DEFECTO)
 */

var SEDES = [
  { code: 'BCN', nombre: 'Barcelona', query: 'Durán Carasso Inmobiliaria Carrer de Muntaner 259 Barcelona', mercado: 'inmobiliaria de lujo en Barcelona', web: '', gbpLocationId: '' },
  { code: 'STG', nombre: 'Sitges',    query: 'Durán Carasso Camí dels Capellans 73 Sitges', mercado: 'inmobiliaria de lujo en Sitges', web: '', gbpLocationId: '' },
  { code: 'CRD', nombre: 'Cerdanya',  query: 'Durán Carasso Puigcerdà Cerdanya', mercado: 'inmobiliaria en Puigcerdà Cerdanya', web: '', gbpLocationId: '' },
  { code: 'AND', nombre: 'Andorra',   query: 'Durán Carasso Escaldes-Engordany Andorra', mercado: 'inmobiliaria de lujo en Andorra', web: '', gbpLocationId: '' }
];
// web vacío → se usa la web que tenga la ficha de Google.
// gbpLocationId → Nivel 2 (ver listarUbicacionesGBP()).

var UMBRAL = {
  fotosMin: 10,      // Places API devuelve máx. 10 fotos: <10 = ficha pobre
  diasSinPost: 7,
  seoMin: 90,
  perfMin: 50,
  caidaRating: 0.1,
  numCompetidores: 5
};

// Qué puede hacer el agente sin preguntar. Todo en false = todo pasa por aprobación.
var AUTOPILOTO_DEFECTO = {
  responder5estrellas: false,  // publica solo las respuestas a reseñas de 5★
  postSiNoRespondes48h: false  // publica el post semanal si nadie lo descarta en 48 h
};

var CLAUDE_MODEL = 'claude-opus-5';
var DEFAULT_EMAILS = 'adriap@durancarasso.com';
var DEFAULT_SHEET_ID = '1QtAQ_RbGwsJ18jZeTinkKJfAHl7oYodusJ7xjHKXTa0';
var GBP_PANEL_URL = 'https://business.google.com/locations';

var P = PropertiesService.getScriptProperties();
function prop_(k, req) {
  var v = P.getProperty(k);
  if (req && !v) throw new Error('Falta la propiedad del script: ' + k);
  return v || '';
}
function autopiloto_() {
  var a = JSON.parse(prop_('AUTOPILOTO') || '{}'), r = {};
  for (var k in AUTOPILOTO_DEFECTO) r[k] = k in a ? !!a[k] : AUTOPILOTO_DEFECTO[k];
  return r;
}
function nivel2_(s) { return !!(prop_('GBP_ACCOUNT_ID') && s && s.gbpLocationId); }
function sede_(code) { return SEDES.filter(function (s) { return s.code === code; })[0]; }

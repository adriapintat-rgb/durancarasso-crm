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
 *   SHEET_ID            se guarda sola al instalar (hoja donde vive el agente)
 *   AUTOPILOTO          opcional, JSON (ver AUTOPILOTO_DEFECTO)
 */

var SEDES = [
  { code: 'BCN', nombre: 'Barcelona', query: 'Durán Carasso Inmobiliaria Carrer de Muntaner 259 Barcelona', mercado: 'inmobiliaria de lujo en Barcelona', web: '', gbpLocationId: '' },
  { code: 'STG', nombre: 'Sitges',    query: 'Durán Carasso Camí dels Capellans 73 Sitges', mercado: 'inmobiliaria de lujo en Sitges', web: '', gbpLocationId: '' },
  { code: 'CRD', nombre: 'Cerdanya',  query: "Durán Carasso Carrer d'Espanya 16 Puigcerdà", mercado: 'inmobiliaria en Puigcerdà Cerdanya', web: '', gbpLocationId: '' },
  { code: 'AND', nombre: 'Andorra',   query: 'Durán Carasso Carrer de la Unió 9 Escaldes-Engordany Andorra', mercado: 'inmobiliaria de lujo en Andorra', web: '', gbpLocationId: '' }
];

// Contexto para la IA (fuente: durancarasso.es y prensa, sept. 2026). Editable.
var PERFIL_EMPRESA = {
  marca: 'Durán Carasso (DC group), inmobiliaria premium fundada por Carlos Durán y Mónica Abad, ~50 personas',
  web: 'https://www.durancarasso.es (es, ca, en)',
  servicios: ['Compra y venta', 'Alquiler', 'Valoración gratuita y sin compromiso',
    'Obra nueva: más de 20 promociones y 1.800 viviendas comercializadas en 6 años',
    'Inversiones: cartera de más de 350 activos (edificios, oficinas, locales, logístico, suelo)'],
  otrasZonas: 'También opera en Vilanova i la Geltrú e Ibiza (fuera de este agente)',
  estilo: 'Tono premium, cercano y discreto. Sin exageraciones ni emojis en exceso. No inventar inmuebles ni precios.'
};
var PERFIL_SEDES = {
  BCN: { direccion: 'Carrer de Muntaner 259, 08021 Barcelona', telefono: '931 59 51 25',
         zonas: 'Sarrià-Sant Gervasi, Tres Torres, Pedralbes, Eixample y Barcelona ciudad', idiomas: 'es, ca, en',
         competidores: 'Engel & Völkers, Lucas Fox, Bcn Advisors, Selekta Properties, Valords' },
  STG: { direccion: 'Av. Camí dels Capellans 73, 08870 Sitges (sede central)', telefono: '935 17 80 67',
         zonas: 'Sitges, Garraf, Vilanova i la Geltrú, Cunit', idiomas: 'es, ca, en',
         competidores: 'Happy Houses, Envy Realty, Premium Houses, Selekta Properties' },
  CRD: { direccion: "Carrer d'Espanya 16, 17520 Puigcerdà (Girona)", telefono: '972 47 56 77',
         zonas: 'Puigcerdà, Alp, Llívia, Bellver de Cerdanya, Fontanals, Urtx, Isòvol', idiomas: 'ca, es, fr',
         competidores: 'Coldwell Banker Glollar, Ladosada, Alex Ros, Vincle Cerdanya' },
  AND: { direccion: "Carrer de la Unió 9, AD700 Escaldes-Engordany (la web y otros sitios dicen Av. 8 d'Agost 9, local 1C: unificar)", telefono: '+376 841 800',
         zonas: 'Escaldes-Engordany, Andorra la Vella, Ordino, Els Vilars d’Engordany', idiomas: 'ca, es, fr, en',
         competidores: "Lucas Fox Andorra, Andorra Sotheby's, Windsor & Meyers, Colonial Real Estate, Immobiliària Dúplex" }
};
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
function idioma_(code) { return String((PERFIL_SEDES[code] || {}).idiomas || 'es').split(',')[0].trim(); }

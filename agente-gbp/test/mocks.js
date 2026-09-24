// Simulación mínima de los servicios de Google Apps Script para probar el agente en Node.
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..');

const store = { GOOGLE_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' };
global.PropertiesService = { getScriptProperties: () => ({
  getProperty: k => (k in store ? store[k] : null),
  setProperty: (k, v) => { if (String(v).length > 9000) throw new Error('Propiedad demasiado grande: ' + k); store[k] = String(v); } }) };
global.Logger = { log: m => { if (process.env.DEBUG) console.log('  [log]', m); } };
global.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) };

// Fecha en Europe/Madrid (UTC+2 en verano, suficiente para la prueba)
function madrid(d) { return new Date(new Date(d).getTime() + 2 * 36e5); }
global.Utilities = {
  formatDate: (d, tz, fmt) => {
    const m = madrid(d), p = n => String(n).padStart(2, '0');
    return fmt.replace(/'([^']*)'/g, '\u0001$1\u0001').replace(/yyyy|MM|dd|HH|mm|ss|XXX|u/g, t => ({
      yyyy: m.getUTCFullYear(), MM: p(m.getUTCMonth() + 1), dd: p(m.getUTCDate()), HH: p(m.getUTCHours()),
      mm: p(m.getUTCMinutes()), ss: p(m.getUTCSeconds()), XXX: '+02:00', u: String(m.getUTCDay() || 7) }[t])).replace(/\u0001/g, '');
  },
  getUuid: () => crypto.randomUUID(),
  computeHmacSha256Signature: (v, k) => [...crypto.createHmac('sha256', k).update(v).digest()],
  base64EncodeWebSafe: b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
};

// Triggers
const triggers = [];
function builder(fn) {
  const t = { fn, uid: 'uid' + Math.random(), getHandlerFunction: () => fn, getUniqueId: () => t.uid }, o = {
    timeBased: () => o, onWeekDay: d => (t.dia = d, o), atHour: h => (t.hora = h, o), nearMinute: () => o, inTimezone: () => o,
    everyHours: h => (t.cadaHoras = h, o), after: ms => (t.after = ms, o), at: d => (t.at = d, o), create: () => (triggers.push(t), t) };
  return o;
}
global.ScriptApp = {
  getProjectTriggers: () => triggers.slice(), deleteTrigger: t => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
  newTrigger: builder, WeekDay: { MONDAY: 'MON', SUNDAY: 'SUN' }, getOAuthToken: () => 'tok',
  getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/DEMO/exec' }) };

global.sent = [];
global.GmailApp = { sendEmail: (to, subject, text, o) => sent.push({ to, subject, text, html: o.htmlBody }) };

// Hoja en memoria
const sheets = {};
function mkSheet(name) {
  const rows = [];
  return sheets[name] = { rows, oculta: false,
    appendRow: r => rows.push(r.slice()), setFrozenRows() {}, hideSheet() { this.oculta = true; }, getLastRow: () => rows.length,
    getRange: (r, c, nr = 1, nc = 1) => ({
      setValues: v => v.forEach((row, i) => { rows[r - 1 + i] = rows[r - 1 + i] || []; row.forEach((x, j) => rows[r - 1 + i][c - 1 + j] = x); }),
      setValue: v => { rows[r - 1] = rows[r - 1] || []; rows[r - 1][c - 1] = v; },
      clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (rows[r - 1 + i]) rows[r - 1 + i][c - 1 + j] = ''; } }),
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }) };
}
const SS = { getId: () => 'SHEET_DEMO', getSheetByName: n => sheets[n] || null, insertSheet: mkSheet, toast() {} };
global.__alerts = [];
global.__web = false;
global.SpreadsheetApp = { openById: () => SS, getActive: () => SS,
  getUi: () => { if (__web) throw new Error('Cannot call SpreadsheetApp.getUi() from this context'); return ({ alert: (t, m) => __alerts.push(t + '\n' + m), ButtonSet: {} }); } };
global.__sheets = sheets; global.__store = store; global.__triggers = triggers;

// Plantilla HTML (<?!= ?>)
global.HtmlService = { createTemplateFromFile: f => {
  const src = fs.readFileSync(path.join(DIR, f + '.html'), 'utf8'), t = {};
  t.evaluate = () => { const html = src.replace(/<\?!=([\s\S]*?)\?>/g, (_, e) => new Function('error', 'd', 'return ' + e)(t.error, t.d));
    const o = { setTitle: () => o, addMetaTag: () => o, getContent: () => html }; return o; };
  return t; } };

const ORDEN = ['Config', 'Datos', 'IA', 'Propuestas', 'WebApp', 'Email', 'Agente', 'Menu'];
module.exports = { load: () => ORDEN.map(f => fs.readFileSync(path.join(DIR, f + '.gs'), 'utf8')).join('\n') };

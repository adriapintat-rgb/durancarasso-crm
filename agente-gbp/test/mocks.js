const crypto = require('crypto'), fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..');
const store = { GOOGLE_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' };
global.PropertiesService = { getScriptProperties: () => ({ getProperty: k => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = String(v); } }) };
global.Logger = { log: m => console.log('  [log]', m) };
global.Utilities = {
  formatDate: (d) => new Date(d).toISOString().slice(0, 10),
  getUuid: () => crypto.randomUUID(),
  computeHmacSha256Signature: (v, k) => [...crypto.createHmac('sha256', k).update(v).digest()],
  base64EncodeWebSafe: b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
};
const triggers = [];
const chain = n => { const o = { timeBased: () => o, onWeekDay: () => o, atHour: () => o, nearMinute: () => o, inTimezone: () => o, everyHours: () => o, create: () => triggers.push(n) }; return o; };
global.ScriptApp = { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: chain, WeekDay: { MONDAY: 'MON' }, getOAuthToken: () => 'tok', getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/DEMO/exec' }) };
global.sent = [];
global.GmailApp = { sendEmail: (to, subject, text, o) => sent.push({ to, subject, text, html: o.htmlBody }) };
// ── Hoja en memoria
const sheets = {};
function mkSheet(name) {
  const rows = [];
  return sheets[name] = { rows,
    appendRow: r => rows.push(r.slice()), setFrozenRows() {}, getLastRow: () => rows.length,
    getRange: (r, c, nr = 1, nc = 1) => ({
      setValues: v => v.forEach((row, i) => { rows[r - 1 + i] = rows[r - 1 + i] || []; row.forEach((x, j) => rows[r - 1 + i][c - 1 + j] = x); }),
      setValue: v => { rows[r - 1][c - 1] = v; } }),
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }) };
}
const SS = { getSheetByName: n => sheets[n] || null, insertSheet: mkSheet, toast() {} };
global.__alerts = [];
global.SpreadsheetApp = { openById: () => SS, getActive: () => SS, getUi: () => ({ alert: (t, m) => __alerts.push(t + '\n' + m), ButtonSet: {} }) };
global.__sheets = sheets; global.__store = store; global.__triggers = triggers;
// ── Template HTML (<?!= ?>)
global.HtmlService = { createTemplateFromFile: f => {
  const src = fs.readFileSync(path.join(DIR, f + '.html'), 'utf8'), t = {};
  t.evaluate = () => { const html = src.replace(/<\?!=([\s\S]*?)\?>/g, (_, e) => new Function('error', 'd', 'return ' + e)(t.error, t.d));
    const o = { setTitle: () => o, addMetaTag: () => o, getContent: () => html }; return o; };
  return t; } };
module.exports = { load: () => { let code = ''; for (const f of ['Config', 'Datos', 'IA', 'Propuestas', 'WebApp', 'Email', 'Agente', 'Menu']) code += fs.readFileSync(path.join(DIR, f + '.gs'), 'utf8') + '\n'; return code; } };

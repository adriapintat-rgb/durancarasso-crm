/**
 * DC · Personas — Pruebas de extremo a extremo
 *
 *   node test/e2e.mjs
 *
 * Arranca la app en modo demo sobre Chromium y recorre los flujos reales.
 * Sale con código 1 si algo falla, para poder engancharlo a CI.
 */
// Playwright se resuelve desde la instalación global si no está en node_modules
const { chromium } = await import('playwright').catch(
  () => import('/opt/node22/lib/node_modules/playwright/index.mjs'));
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = 'file://' + resolve(RAIZ, 'personas.html');

const fallos = [];
const comprobar = (condicion, descripcion) => {
  if (condicion) console.log('  ✓ ' + descripcion);
  else { console.log('  ✗ ' + descripcion); fallos.push(descripcion); }
};

const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: 1340, height: 940 } });
pagina.on('dialog', d => d.accept());
pagina.on('pageerror', e => fallos.push('Error de JS: ' + e.message));
pagina.on('console', m => {
  if (m.type() === 'error' && !m.text().includes('ERR_')) fallos.push('Consola: ' + m.text());
});

// ── Acceso ────────────────────────────────────────────────────────────────
console.log('\nAcceso');
await pagina.goto(APP);
await pagina.evaluate(() => localStorage.clear());
await pagina.reload();
await pagina.waitForTimeout(900);

await pagina.click('#sel_trig');
await pagina.waitForTimeout(250);
await pagina.click('.sel-item:first-child');
await pagina.waitForTimeout(250);
comprobar((await pagina.textContent('#pin_name')) === 'Admin de pruebas', 'el selector abre la ficha correcta');

for (const tecla of ['0', '0', '0', '0']) await pagina.click(`#pad button:has-text("${tecla}")`);
await pagina.waitForTimeout(1600);
comprobar(await pagina.isVisible('#app'), 'el PIN da acceso a la aplicación');

// PIN incorrecto
const otra = await navegador.newPage();
await otra.goto(APP);
await otra.waitForTimeout(700);
await otra.click('#sel_trig'); await otra.waitForTimeout(250);
await otra.click('.sel-item:first-child'); await otra.waitForTimeout(250);
for (const t of ['9', '9', '9', '9']) await otra.click(`#pad button:has-text("${t}")`);
await otra.waitForTimeout(900);
comprobar(/incorrecto/i.test(await otra.textContent('#pin_err')), 'un PIN erróneo se rechaza');
await otra.close();

// ── Todas las secciones cargan ────────────────────────────────────────────
console.log('\nSecciones');
const menu = await pagina.$$eval('.side .nav-i', ns => ns.map(n => n.textContent.trim()));
for (let i = 0; i < menu.length; i++) {
  await pagina.locator('.side .nav-i').nth(i).click();
  await pagina.waitForTimeout(650);
  const largo = await pagina.$eval('#main', el => el.textContent.trim().length);
  if (largo < 40) fallos.push('Vista vacía: ' + menu[i]);
}
comprobar(menu.length >= 30, `${menu.length} secciones, todas con contenido`);

const ir = async fragmento => {
  const i = menu.findIndex(t => t.includes(fragmento));
  if (i < 0) throw new Error('Sección no encontrada: ' + fragmento);
  await pagina.locator('.side .nav-i').nth(i).click();
  await pagina.waitForTimeout(800);
};

// ── Fichaje ───────────────────────────────────────────────────────────────
console.log('\nFichaje');
await ir('Portal');
await pagina.click('#btn_in'); await pagina.waitForTimeout(900);
comprobar((await pagina.textContent('#portal_estado')).includes('trabajando'), 'la entrada cambia el estado');

await pagina.click('#btn_pause'); await pagina.waitForTimeout(700);
comprobar((await pagina.textContent('#btn_pause')) === 'Reanudar', 'la pausa se registra');
await pagina.click('#btn_pause'); await pagina.waitForTimeout(700);

await ir('Mis fichajes');
const t1 = await pagina.textContent('#fi_hoy');
await pagina.waitForTimeout(2200);
const t2 = await pagina.textContent('#fi_hoy');
comprobar(t1 !== t2, 'el contador del día avanza en vivo');

// ── Ausencias ─────────────────────────────────────────────────────────────
console.log('\nAusencias');
await ir('Mis ausencias');
await pagina.click('button:has-text("+ Solicitar ausencia")');
await pagina.waitForTimeout(500);
const tipos = await pagina.$$eval('#au_tipo option', os => os.map(o => o.textContent));
comprobar(!tipos.some(t => /Baja IT/i.test(t)), 'Baja IT ya no aparece');
comprobar(tipos.some(t => /cumplea/i.test(t)), 'existe la tarde de cumpleaños');
comprobar(await pagina.isVisible('#au_file'), 'se puede adjuntar justificante');

await pagina.selectOption('#au_tipo', 'Asuntos propios');
await pagina.fill('#au_d', '2026-10-05'); await pagina.fill('#au_h', '2026-10-16');
await pagina.click('#au_send'); await pagina.waitForTimeout(1300);
comprobar(/días/i.test(await pagina.textContent('#toast')), 'pedir más días de los del cupo se bloquea');

await pagina.click('button:has-text("+ Solicitar ausencia")');
await pagina.waitForTimeout(500);
await pagina.selectOption('#au_tipo', 'Vacaciones');
await pagina.fill('#au_d', '2026-10-05'); await pagina.fill('#au_h', '2026-10-09');
await pagina.click('#au_send'); await pagina.waitForTimeout(1500);
comprobar((await pagina.textContent('#main')).includes('PENDIENTE'), 'la solicitud válida se registra');

// Arrastre de un año al siguiente
const arrastre = await pagina.evaluate(() => {
  const db = dbGet();
  db.ausencias = [{ id: 'T1', trabajador: 'Empleado de pruebas', tipo: 'Vacaciones',
                    desde: '2026-07-01', hasta: '2026-07-28', dias: 20,
                    estado: 'APROBADA', diasArrastre: 0 }];
  dbSet(db);
  const yo = db.empleados.find(e => e.nombre === 'Empleado de pruebas');
  const s26 = demoSaldos(db, yo, 2026).find(x => x.tipo === 'Vacaciones');
  const s27 = demoSaldos(db, yo, 2027).find(x => x.tipo === 'Vacaciones');
  return { restan26: s26.disponibles, arrastre27: s27.arrastre, total27: s27.disponibles };
});
comprobar(arrastre.restan26 === 3 && arrastre.arrastre27 === 3 && arrastre.total27 === 26,
  'los días sobrantes de un año se arrastran al siguiente');

// ── Validación por dirección ──────────────────────────────────────────────
console.log('\nDirección');
await ir('Validaciones');
comprobar((await pagina.textContent('#main')).includes('Pendientes'), 'las solicitudes llegan a validación');

// ── Documentos ────────────────────────────────────────────────────────────
console.log('\nDocumentos');
await ir('Mis documentos');
const bloqueado = await pagina.$eval('button:has-text("Firmar")', el => el.disabled).catch(() => null);
comprobar(bloqueado === true, 'no se puede firmar sin abrir el documento');
await pagina.click('button:has-text("Ver")'); await pagina.waitForTimeout(600);
await pagina.click('#mbox button.b-pri'); await pagina.waitForTimeout(1200);
comprobar((await pagina.textContent('#main')).includes('Firmado'), 'la firma queda registrada');

// ── Auditoría e integridad ────────────────────────────────────────────────
console.log('\nAuditoría');
await ir('Auditoría');
comprobar((await pagina.$eval('#main', el => el.textContent.length)) > 300, 'la auditoría registra los movimientos');

// ── Administración ────────────────────────────────────────────────────────
console.log('\nAdministración');
await ir('Plantilla');
await pagina.click('button:has-text("Editar")'); await pagina.waitForTimeout(500);
await pagina.fill('#ed_d', 'Dirección General');
await pagina.click('#mbox button.b-gold'); await pagina.waitForTimeout(1300);
comprobar((await pagina.textContent('#main')).includes('Dirección General'), 'se puede editar la ficha de una persona');

await pagina.click('button:has-text("PIN")'); await pagina.waitForTimeout(500);
await pagina.fill('#rp_p', '7788');
await pagina.click('#mbox button.b-pri'); await pagina.waitForTimeout(1100);
comprobar(/actualizado/i.test(await pagina.textContent('#toast')), 'se puede resetear un PIN');

// ── Móvil ─────────────────────────────────────────────────────────────────
console.log('\nMóvil');
const movil = await navegador.newPage({ viewport: { width: 390, height: 844 } });
movil.on('pageerror', e => fallos.push('Móvil · error de JS: ' + e.message));
await movil.goto(APP); await movil.waitForTimeout(900);
comprobar(await movil.isVisible('#sel_trig'), 'el acceso se ve bien en móvil');
await movil.click('#sel_trig'); await movil.waitForTimeout(250);
await movil.click('.sel-item:nth-child(2)'); await movil.waitForTimeout(250);
for (const t of ['1', '2', '3', '4']) await movil.click(`#pad button:has-text("${t}")`);
await movil.waitForTimeout(1500);
comprobar(await movil.isVisible('.bottomnav'), 'la navegación inferior aparece en móvil');
await movil.close();

// ── Resultado ─────────────────────────────────────────────────────────────
await navegador.close();
console.log('\n' + '─'.repeat(52));
if (fallos.length) {
  console.log(`FALLOS (${fallos.length}):`);
  fallos.forEach(f => console.log('  · ' + f));
  process.exit(1);
}
console.log('Todo correcto.');

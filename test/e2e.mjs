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

// ── Espacios y secciones ──────────────────────────────────────────────────
console.log('\nEspacios y secciones');
comprobar(await pagina.isVisible('#sw_espacio'), 'el administrador ve el conmutador de espacios');

const ir = async (espacio, fragmento) => {
  await pagina.click('#sw_' + espacio);
  await pagina.waitForTimeout(600);
  const menu = await pagina.$$eval('.side .nav-i', ns => ns.map(n => n.textContent.trim()));
  const i = menu.findIndex(t => t.includes(fragmento));
  if (i < 0) throw new Error('Sección no encontrada: ' + fragmento + ' · ' + menu.join(' | '));
  await pagina.locator('.side .nav-i').nth(i).click();
  await pagina.waitForTimeout(850);
};

let total = 0;
for (const espacio of ['mi', 'gestion']) {
  await pagina.click('#sw_' + espacio);
  await pagina.waitForTimeout(600);
  const menu = await pagina.$$eval('.side .nav-i', ns => ns.map(n => n.textContent.trim()));
  total += menu.length;
  for (let i = 0; i < menu.length; i++) {
    await pagina.locator('.side .nav-i').nth(i).click();
    await pagina.waitForTimeout(650);
    const largo = await pagina.$eval('#main', el => el.textContent.trim().length);
    if (largo < 40) fallos.push('Vista vacía: ' + menu[i]);
  }
}
comprobar(total >= 16, `${total} secciones entre los dos espacios, todas con contenido`);

// Los módulos retirados ya no existen
const todas = [];
for (const espacio of ['mi', 'gestion']) {
  await pagina.click('#sw_' + espacio); await pagina.waitForTimeout(400);
  todas.push(...await pagina.$$eval('.side .nav-i', ns => ns.map(n => n.textContent)));
}
const retirados = ['objetivo', 'evaluación', 'encuesta', 'checklist', 'documento', 'bolsa', 'onboarding', 'reclutamiento'];
const sobran = retirados.filter(r => todas.some(t => t.toLowerCase().includes(r)));
comprobar(sobran.length === 0, 'los módulos retirados ya no aparecen' + (sobran.length ? ' (quedan: ' + sobran + ')' : ''));

// ── Fichaje ───────────────────────────────────────────────────────────────
console.log('\nFichaje');
await ir('mi','Portal');
await pagina.click('#btn_in'); await pagina.waitForTimeout(900);
comprobar((await pagina.textContent('#portal_estado')).includes('trabajando'), 'la entrada cambia el estado');

await pagina.click('#btn_pause'); await pagina.waitForTimeout(600);
comprobar((await pagina.textContent('#mbox')).includes('Comida'), 'la pausa pregunta el tipo de descanso');
await pagina.click('#mbox button:has-text("Comida")'); await pagina.waitForTimeout(900);
comprobar((await pagina.textContent('#btn_pause')) === 'Reanudar', 'la pausa de comida se registra');
await pagina.click('#btn_pause'); await pagina.waitForTimeout(800);

await ir('mi','Mis fichajes');
const t1 = await pagina.textContent('#fi_hoy');
await pagina.waitForTimeout(2200);
const t2 = await pagina.textContent('#fi_hoy');
comprobar(t1 !== t2, 'el contador del día avanza en vivo');

// ── Ausencias ─────────────────────────────────────────────────────────────
console.log('\nAusencias');
await ir('mi','Mis ausencias');
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
await ir('gestion','Validaciones');
comprobar((await pagina.textContent('#main')).includes('Pendientes'), 'las solicitudes llegan a validación');

// ── Auditoría e integridad ────────────────────────────────────────────────
console.log('\nAuditoría');
await ir('gestion','Auditoría');
comprobar((await pagina.$eval('#main', el => el.textContent.length)) > 300, 'la auditoría registra los movimientos');

// ── Administración ────────────────────────────────────────────────────────
console.log('\nAdministración');
await ir('gestion','Plantilla');
await pagina.click('button:has-text("Editar")'); await pagina.waitForTimeout(500);
await pagina.fill('#ed_d', 'Dirección General');
await pagina.click('#mbox button.b-gold'); await pagina.waitForTimeout(1300);
comprobar((await pagina.textContent('#main')).includes('Dirección General'), 'se puede editar la ficha de una persona');

await pagina.click('table button:has-text("PIN")'); await pagina.waitForTimeout(500);
await pagina.fill('#rp_p', '7788');
await pagina.click('#mbox button.b-pri'); await pagina.waitForTimeout(1100);
comprobar(/actualizado/i.test(await pagina.textContent('#toast')), 'se puede resetear un PIN');

await pagina.waitForTimeout(600);
const personasAntes = await pagina.$$eval('#main table tr', f => f.length);
// La primera fila es el propio administrador: el sistema debe impedirlo
await pagina.$$('#main button.b-del').then(b => b[0].click());
await pagina.waitForTimeout(500);
await pagina.click('#mbox button.b-no'); await pagina.waitForTimeout(1400);
comprobar(/ti mismo/i.test(await pagina.textContent('#toast')), 'nadie puede darse de baja a sí mismo');

await pagina.$$('#main button.b-del').then(b => b[1].click());
await pagina.waitForTimeout(500);
await pagina.click('#mbox button.b-no'); await pagina.waitForTimeout(1700);
const personasDespues = await pagina.$$eval('#main table tr', f => f.length);
comprobar(personasDespues === personasAntes - 1, 'se puede dar de baja a otra persona');

// ── Configuración ─────────────────────────────────────────────────────────
console.log('\nConfiguración');
await ir('gestion', 'Configuración');
comprobar((await pagina.textContent('#main')).includes('Datos de la empresa'), 'la configuración abre en Empresa');

for (const seccion of ['Centros', 'Roles y accesos', 'Horarios', 'Descansos', 'Festivos', 'Vacaciones', 'Ausencias']) {
  await pagina.click(`.conf-i:has-text("${seccion}")`);
  await pagina.waitForTimeout(500);
  const largo = await pagina.$eval('.conf-panel', el => el.textContent.trim().length);
  if (largo < 60) fallos.push('Sección de configuración vacía: ' + seccion);
}
comprobar(true, 'las siete secciones de configuración tienen contenido');

await pagina.click('.conf-i:has-text("Festivos")'); await pagina.waitForTimeout(500);
const antes = await pagina.$$eval('.conf-panel tbody tr, .conf-panel table tr', f => f.length);
await pagina.click('button:has-text("Importar festivos")'); await pagina.waitForTimeout(1600);
const despues = await pagina.$$eval('.conf-panel table tr', f => f.length);
comprobar(despues > antes, 'la importación de festivos oficiales añade días');

await pagina.click('.conf-i:has-text("Descansos")'); await pagina.waitForTimeout(600);
comprobar((await pagina.textContent('.conf-panel')).includes('Comida'), 'existe la pausa de comida configurada');
const filasAntes = await pagina.$$eval('.conf-panel table tr', f => f.length);
await pagina.click('.conf-panel button:has-text("Eliminar")'); await pagina.waitForTimeout(500);
await pagina.click('#mbox button.b-no'); await pagina.waitForTimeout(1400);
const filasDespues = await pagina.$$eval('.conf-panel table tr', f => f.length);
comprobar(filasDespues === filasAntes - 1, 'se puede eliminar una fila de configuración');

await pagina.click('.conf-i:has-text("Centros")'); await pagina.waitForTimeout(600);
await pagina.click('.conf-panel button:has-text("Editar")'); await pagina.waitForTimeout(600);
comprobar(await pagina.isVisible('#ce_loc'), 'los centros se pueden editar');
await pagina.click('#mbox button.b-ghost'); await pagina.waitForTimeout(400);

// ── Permisos por rol ──────────────────────────────────────────────────────
console.log('\nPermisos');
const empleado = await navegador.newPage({ viewport: { width: 1200, height: 900 } });
empleado.on('dialog', d => d.accept());
await empleado.goto(APP); await empleado.waitForTimeout(800);
await empleado.click('#sel_trig'); await empleado.waitForTimeout(250);
await empleado.click('.sel-item:nth-child(3)'); await empleado.waitForTimeout(250);
comprobar((await empleado.textContent('#pin_name')) === 'Empleado de pruebas', 'se puede entrar como empleado');
for (const t of ['1', '2', '3', '4']) await empleado.click(`#pad button:has-text("${t}")`);
await empleado.waitForTimeout(1500);
const verGestion = await empleado.isVisible('#sw_espacio');
comprobar(verGestion === false, 'el empleado no ve el espacio de Gestión');
const menuEmpleado = await empleado.$$eval('.side .nav-i', ns => ns.map(n => n.textContent));
comprobar(!menuEmpleado.some(t => /Plantilla|Configuración|Auditor/.test(t)),
  'el empleado no ve plantilla, configuración ni auditoría');
await empleado.close();

const manager = await navegador.newPage({ viewport: { width: 1200, height: 900 } });
manager.on('dialog', d => d.accept());
await manager.goto(APP); await manager.waitForTimeout(800);
await manager.click('#sel_trig'); await manager.waitForTimeout(250);
await manager.click('.sel-item:nth-child(2)'); await manager.waitForTimeout(250);
for (const t of ['2', '2', '2', '2']) await manager.click(`#pad button:has-text("${t}")`);
await manager.waitForTimeout(1500);
comprobar(await manager.isVisible('#sw_espacio'), 'el manager sí ve el espacio de Gestión');
await manager.click('#sw_gestion'); await manager.waitForTimeout(700);
const menuManager = await manager.$$eval('.side .nav-i', ns => ns.map(n => n.textContent));
comprobar(menuManager.some(t => /Validaciones/.test(t)), 'el manager puede validar');
comprobar(!menuManager.some(t => /Configuración|Auditor/.test(t)),
  'el manager no ve configuración ni auditoría');

// El ámbito de datos, no solo el menú: un manager solo ve a los suyos
const suyos = await manager.evaluate(() => miEquipo().map(e => e.nombre));
comprobar(suyos.length < 8 && suyos.includes('Empleado de pruebas') && suyos.includes('Manager de pruebas'),
  'el manager solo gestiona a quien le reporta (' + suyos.length + ' personas)');

const ajenas = await manager.evaluate(async () => {
  const r = await api('ausenciasEquipo', { year: new Date().getFullYear() });
  const equipo = miEquipo().map(e => e.nombre);
  return (r.ausencias || []).filter(a => !equipo.includes(a.trabajador)).length;
});
comprobar(ajenas === 0, 'el manager no recibe ausencias de fuera de su equipo');
await manager.close();

const admin = await navegador.newPage({ viewport: { width: 1200, height: 900 } });
admin.on('dialog', d => d.accept());
await admin.goto(APP); await admin.waitForTimeout(800);
await admin.click('#sel_trig'); await admin.waitForTimeout(250);
await admin.click('.sel-item:first-child'); await admin.waitForTimeout(250);
for (const t of ['0', '0', '0', '0']) await admin.click(`#pad button:has-text("${t}")`);
await admin.waitForTimeout(1500);
const todosAdmin = await admin.evaluate(() => miEquipo().length);
comprobar(todosAdmin >= 7, 'el administrador sí ve a toda la plantilla (' + todosAdmin + ')');
await admin.close();

// ── Móvil ─────────────────────────────────────────────────────────────────
console.log('\nMóvil');
const movil = await navegador.newPage({ viewport: { width: 390, height: 844 } });
movil.on('pageerror', e => fallos.push('Móvil · error de JS: ' + e.message));
await movil.goto(APP); await movil.waitForTimeout(900);
comprobar(await movil.isVisible('#sel_trig'), 'el acceso se ve bien en móvil');
await movil.click('#sel_trig'); await movil.waitForTimeout(250);
await movil.click('.sel-item:nth-child(3)'); await movil.waitForTimeout(250);
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

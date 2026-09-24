// Junta todos los .gs en un solo archivo para instalar con un copia-pega: node agente-gbp/test/empaquetar.js
const fs = require('fs'), path = require('path'), D = path.join(__dirname, '..'), OUT = path.join(D, 'instalar');
fs.mkdirSync(OUT, { recursive: true });
const orden = ['Config', 'Menu', 'Agente', 'Datos', 'IA', 'Propuestas', 'Email', 'WebApp'];
fs.writeFileSync(path.join(OUT, 'Codigo.gs'), '// ARCHIVO GENERADO: no editar aquí; los fuentes están en agente-gbp/*.gs\n\n' +
  orden.map(f => '// ═══ ' + f + '.gs ═══\n' + fs.readFileSync(path.join(D, f + '.gs'), 'utf8')).join('\n'));
fs.copyFileSync(path.join(D, 'Pagina.html'), path.join(OUT, 'Pagina.html'));
fs.copyFileSync(path.join(D, 'appsscript.json'), path.join(OUT, 'appsscript.json'));
console.log('OK → instalar/Codigo.gs, Pagina.html, appsscript.json');

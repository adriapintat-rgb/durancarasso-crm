/**
 * DC · Personas — Service worker
 *
 * Estrategia deliberada:
 *  - El HTML se sirve de red primero. Así una versión nueva llega el mismo día
 *    y nadie se queda con una app vieja en caché.
 *  - Las fuentes y librerías externas se sirven de caché primero: no cambian.
 *  - Las llamadas al Apps Script NUNCA se cachean: un fichaje es dato vivo, y
 *    servir una respuesta antigua sería peor que fallar.
 */
var VERSION = 'dc-personas-v3';
var ESENCIALES = ['./personas.html', './manifest.json'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(ESENCIALES); })
    .then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (claves) {
    return Promise.all(claves.filter(function (k) { return k !== VERSION; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var url = e.request.url;

  // Datos en vivo: siempre a la red. La app ya tiene su propia cola offline.
  if (url.indexOf('script.google.com') >= 0 || e.request.method !== 'GET') return;

  // Recursos externos estables: caché primero
  if (url.indexOf('fonts.g') >= 0 || url.indexOf('cdnjs') >= 0) {
    e.respondWith(caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (res) {
        var copia = res.clone();
        caches.open(VERSION).then(function (c) { c.put(e.request, copia); });
        return res;
      });
    }));
    return;
  }

  // La app: red primero, caché como red de seguridad si no hay cobertura
  e.respondWith(
    fetch(e.request).then(function (res) {
      var copia = res.clone();
      caches.open(VERSION).then(function (c) { c.put(e.request, copia); });
      return res;
    }).catch(function () { return caches.match(e.request); })
  );
});

# Máquina de Carruseles — Durán Carasso

Apuntes del sistema que hemos construido. Documento interno para presentar y operar.

---

## 1. Qué es

Un estudio propio para crear **carruseles de Instagram** (5 slides) con el estilo Durán Carasso:
foto → post listo con **copy + hashtags + diseño**, y **calendario** para dejarlos programados.

- **Es vuestro**, no vive en Claude. Corre en vuestro GitHub + un backend gratis (Cloudflare).
- **Coste**: 0 € de infraestructura. Solo se paga por uso de la IA (céntimos por post).

**Enlaces:**
- App: `https://adriapintat-rgb.github.io/durancarasso-crm/carrusel-dc.html`
- Backend (Worker): `https://dc-publicador.adriapintat.workers.dev`

---

## 2. Las 3 formas de crear un carrusel

Se detecta solo lo que le das:

1. **Fotos** — subes/arrastras/pegas 4–8 fotos → genera el carrusel.
2. **Link de la web** — pegas la URL del inmueble → el backend **coge fotos + info** y genera.
3. **Contexto** — escribes 2 líneas del inmueble → la IA redacta el copy y monta el post.

En los tres casos devuelve: **5 slides + descripción (caption) + hashtags**.

---

## 2b. Coste (rentabilidad)

- **~0,02–0,03 € por carrusel** (modelo Sonnet 5) · ~0,013 € (Haiku) · máxima calidad con Opus bajo demanda.
- La app **muestra el coste real** de cada post generado.
- Se logró reduciendo las imágenes antes de enviarlas a la IA (la visión solo necesita "verlas") y usando el modelo por precio/calidad. El carrusel final se sigue renderizando en alta.
- Cambiar modelo: Cloudflare → Worker → Variables → `AI_MODEL` = `claude-sonnet-5` (o `claude-haiku-4-5`).

## 3. Qué hace bien hoy

- **Copy y hashtags** en tono Durán Carasso (lujo, sobrio, sin postureo).
- **Diseño cinematográfico**: texto abajo sobre degradado, logo *Durán/Carasso*, dots de progreso — legible y elegante.
- **Curación de fotos con IA (visión)**: mira las fotos, elige las mejores por slide y ajusta el encuadre.
- **Calendario**: preparas el carrusel, lo dejas en un día y queda listo para publicarse ese día.
- **Aprende (afilar el cuchillo)**: cada post aprobado (👍) se guarda como modelo y mejora los siguientes.
- **Modelo = tu Instagram real**: aprende de tu propia cuenta (Graph API) y coge de tu feed los ejemplos exactos del tipo que pides (texto + referencia visual).
- **Análisis del feed** (pestaña 📊): tus posts reales → qué tipo rinde más, mejor día, ganchos ganadores, longitud y nº de slides ideales. 0 € de IA.
- **Pulir con Opus (premium)**: generas barato y, si te gusta, un botón eleva el copy con el mejor modelo. Pagas calidad solo cuando la quieres.
- **UI**: plano blanco, azul marino, oro sutil, logo Durán. Limpio, no robótico.

---

## 4. Cómo se usa (flujo diario)

1. Abrir la app (enlace de arriba).
2. **Crear**: pegar link / subir fotos / escribir contexto → **Generar**.
3. Revisar los 5 slides (clic para ampliar), ajustar si hace falta.
4. 👍 si está bien (así aprende) → **Descargar** o mandar al **Calendario**.
5. En el calendario: elegir día y hora → queda programado.

---

## 5. Lo que se mejoró en la última fase

- **Composición**: texto ya no cae en medio de la foto; va anclado abajo con scrim para que siempre se lea.
- **Selección y encuadre por foto** con IA de visión (antes era el mismo montaje para todo).
- **Playbook de marca** reforzado en el prompt (voz, mercados, do/don't) para que suene a Durán Carasso.

---

## 6. Pendiente (siguiente fase)

| Tema | Estado | Qué falta |
|---|---|---|
| **Publicar solo en Instagram** | Listo el código | Falta el **token de Meta** (IG_TOKEN) + IG_USER_ID en Cloudflare |
| **Resolución de imágenes** | Coge tamaño medio | Mejorar el scraper para fotos en alta (1 cambio en el Worker) |
| **Seed de captions reales** | Pendiente | Pegar 3–5 captions vuestros reales para clonar el tono desde el día 1 |
| **Vídeo / Reels** | Explorado | Opción gratis (Ken Burns) o premium con Higgsfield/Runway (API de pago) |
| **Aprender del feed real** | Bloqueado | Instagram no deja leerlo por API sin login; se suple con playbook + 👍 |

---

## 7. Cuentas y piezas

- **GitHub** (`adriapintat-rgb/durancarasso-crm`) → aloja la app (GitHub Pages, gratis).
- **Cloudflare Worker** (`dc-publicador`) → scrape de links, IA, hosting de imágenes, publicación y cron.
- **Anthropic** (console.anthropic.com) → la IA que genera copy/diseño. Se paga por uso.
- **Meta/Instagram** (developers.facebook.com) → token para autopublicar (pendiente).

**Secretos (solo en Cloudflare, nunca en el chat):** `ANTHROPIC_KEY`, `APP_SECRET`, `IG_TOKEN`.

---

## 8. Seguridad

- Una clave de Anthropic quedó expuesta en chat → **rotarla** (crearla de nuevo) y usar clave **Workspace**, no Organización.
- Las claves van **solo** en Cloudflare (Settings → Variables/Secrets). Nunca en el navegador, chat ni GitHub.

---

## 9. Resumen de una línea

Tenemos una **máquina propia de carruseles Durán Carasso**: link/foto/contexto → post + copy + hashtags + diseño, con calendario y aprendizaje, gratis de infraestructura. Falta enchufar el token de Instagram para que publique solo.

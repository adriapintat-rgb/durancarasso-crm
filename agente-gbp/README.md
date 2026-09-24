# Agente Google · Durán Carasso

Gestor semanal de las fichas de Google y del SEO de las 4 sedes (Barcelona, Sitges, Cerdanya y Andorra).
Analiza, se compara con la competencia, te propone cambios que apruebas o editas **desde el propio email** y aprende de lo que decides.

## Cómo funciona
| Cuándo | Qué hace |
|---|---|
| **Domingo 20:00 → lunes 8:30** | Analiza ficha, web, SEO, competencia (top 5 en Google Maps), web global (robots.txt, llms.txt, hreflang, schema) y búsqueda de marca → Claude prepara el plan de cada sede → **email con botones el lunes a las 8:30** |
| **Cada 3 h** | Si entra una reseña de 3★ o menos: prepara la respuesta y te avisa. Si Google no deja ver la reseña (Nivel 1) pero sube el número de reseñas y baja la nota, avisa igualmente. Aplica el piloto automático si está activado |
| **1er lunes de mes** | Añade al email los resultados del mes: nota, reseñas, % de ficha, puesto frente a la competencia, llamadas, rutas y clics |

**En el email, cada propuesta tiene:** ✅ Aprobar/Publicar · ✏️ Editar · ❌ Descartar.
- Los botones abren una página donde editas el texto y confirmas. Abrir el enlace no publica nada.
- **Nivel 1:** al aprobar te da el texto para copiarlo y pegarlo en Google.
- **Nivel 2:** lo publica él directamente.
- **Aprende de ti:** lo que editas o descartas, con el motivo, se lo pasa a Claude la semana siguiente.

**Tipos de propuesta:** publicación semanal, respuesta a reseña, nueva descripción de la ficha (el agente puede hacerlas), y tareas con la mejor opción, cuándo hacerla y el contenido listo para pegar (las hace el equipo).

## Cómo está hecho
- **Por fases (datos → búsquedas → planes → envío):** cada fase se retoma sola. Así nunca choca con el límite de 6 min de Apps Script.
- **Batches API de Claude:** se usa para el informe semanal (sin límite de tiempo y un 50 % más barato). Solo la respuesta urgente a una reseña negativa usa una llamada directa.
- **Seguridad:** los enlaces del email van firmados (HMAC). Abrirlos no publica nada. Las funciones internas no se pueden llamar desde la app web pública, los triggers se verifican y hay un bloqueo contra la doble publicación.
- **Red de seguridad:** los posts se limpian de teléfonos, URLs y emails (Google los rechaza). Si algo falla, llega un email de error y el diagnóstico lo muestra.

## Archivos
`Config.gs` (sedes, umbrales, piloto automático) · `Agente.gs` (flujo) · `Datos.gs` (Google, web, competencia) · `IA.gs` (Claude) · `Propuestas.gs` (hoja, publicar, memoria) · `Email.gs` · `Menu.gs` (menú de la hoja) · `WebApp.gs` + `Pagina.html` (página de los botones) · `instalar/` (paquete de 1 archivo) · `test/` (prueba local, no se sube a Apps Script).

## Instalación
Guía paso a paso sin programar en **[INSTALAR.md](INSTALAR.md)**. Resumen: se pega `instalar/Codigo.gs` en una hoja propia (no la del CRM) y se configura desde el menú **🤖 Agente Google**.

- **Menú de la hoja:** configurar claves, comprobar que todo funciona (dice exactamente qué falta), activar y enviar el informe ahora.
- **Si cambias algún `.gs`:** regenera el paquete con `node agente-gbp/test/empaquetar.js`. Para probarlo con Google y Claude simulados, usa `node agente-gbp/test/probar.js`.

Los emails van a `adriap@durancarasso.com`. Para cambiarlo, usa la propiedad `NOTIFY_EMAILS`.

## Nivel 2: publicación automática y métricas
1. El propietario del Perfil de Empresa solicita acceso a la **Business Profile API** (formulario de Google, tarda unos días).
2. Vincula el script al proyecto de GCP y activa **My Business Account Management**, **Business Information**, **Google My Business API** y **Business Profile Performance API**.
3. Añade la propiedad `GBP_ACCOUNT_ID`, ejecuta `listarUbicacionesGBP()` y copia cada ID en `gbpLocationId` de `SEDES`.

## Piloto automático (cuando confíes en él)
Propiedad `AUTOPILOTO`, por ejemplo: `{"responder5estrellas": true, "postSiNoRespondes48h": true}`. Solo funciona en Nivel 2. Las reseñas negativas y las tareas siempre pasan por ti.

## Coste
- **Claude:** unos 2–4 €/mes (4 planes y 4 búsquedas a la semana en lote, al 50 %, más las respuestas urgentes).
- **Google:** dentro del crédito gratuito.

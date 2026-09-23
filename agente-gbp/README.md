# Agente Google · Durán Carasso

Gestor semanal de las fichas de Google y del SEO de las 4 sedes (Barcelona, Sitges, Cerdanya y Andorra).
Analiza, se compara con la competencia, te propone cambios que apruebas o editas **desde el propio email** y aprende de lo que decides.

## Cómo funciona
| Cuándo | Qué hace |
|---|---|
| **Lunes 8:30** | Analiza ficha, web, SEO, competencia (top 5 en Google Maps) y búsqueda de marca → Claude prepara el plan → **email con botones** |
| **Cada 3 h** | Si entra una reseña de 3★ o menos: prepara la respuesta y te avisa al momento. Aplica el piloto automático si está activado |
| **1er lunes de mes** | Añade al email los resultados del mes: nota, reseñas, % de ficha, puesto frente a la competencia, llamadas, rutas y clics |

**En el email, cada propuesta tiene:** ✅ Aprobar/Publicar · ✏️ Editar · ❌ Descartar.
- Los botones abren una página donde editas el texto y confirmas. Abrir el enlace no publica nada.
- **Nivel 1:** al aprobar te da el texto para copiarlo y pegarlo en Google.
- **Nivel 2:** lo publica él directamente.
- **Aprende de ti:** lo que editas o descartas, con el motivo, se lo pasa a Claude la semana siguiente.

**Tipos de propuesta:** publicación semanal, respuesta a reseña, nueva descripción de la ficha (el agente puede hacerlas), y tareas con la mejor opción, cuándo hacerla y el contenido listo para pegar (las hace el equipo).

## Archivos
`Config.gs` (sedes, umbrales, piloto automático) · `Agente.gs` (flujo) · `Datos.gs` (Google, web, competencia) · `IA.gs` (Claude) · `Propuestas.gs` (hoja, publicar, memoria) · `Email.gs` · `WebApp.gs` + `Pagina.html` (página de los botones) · `test/` (prueba local, no se sube a Apps Script).

## Instalación (20 min)
1. **Google Cloud:** activa **Places API (New)** y **PageSpeed Insights API** y crea una API key.
2. **Anthropic:** crea una API key en console.anthropic.com.
3. En script.google.com crea un nuevo proyecto y un archivo por cada `.gs` y `Pagina.html` (mismo nombre).
   - En Configuración, marca "Mostrar appsscript.json" y pega `appsscript.json`.
4. En Propiedades del script añade `ANTHROPIC_API_KEY` y `GOOGLE_API_KEY`.
5. Pulsa **Implementar → Nueva implementación → Aplicación web**, con "Ejecutar como: yo" y "Acceso: cualquier usuario".
   - Copia la URL `/exec` en la propiedad `WEBAPP_URL`.
6. Ejecuta `instalar()` y acepta los permisos. Comprueba en el registro que las 4 sedes son las fichas correctas.
7. Ejecuta `probarAhora()` y te llegará el primer informe.

Los emails van a `adriap@durancarasso.com`. Para cambiarlo, usa la propiedad `NOTIFY_EMAILS`.

## Nivel 2: publicación automática y métricas
1. El propietario del Perfil de Empresa solicita acceso a la **Business Profile API** (formulario de Google, tarda unos días).
2. Vincula el script al proyecto de GCP y activa **My Business Account Management**, **Business Information**, **Google My Business API** y **Business Profile Performance API**.
3. Añade la propiedad `GBP_ACCOUNT_ID`, ejecuta `listarUbicacionesGBP()` y copia cada ID en `gbpLocationId` de `SEDES`.

## Piloto automático (cuando confíes en él)
Propiedad `AUTOPILOTO`, por ejemplo: `{"responder5estrellas": true, "postSiNoRespondes48h": true}`. Solo funciona en Nivel 2. Las reseñas negativas y las tareas siempre pasan por ti.

## Coste
- **Claude:** unos 3–5 €/mes (1 plan semanal, 4 búsquedas de marca y las respuestas urgentes).
- **Google:** dentro del crédito gratuito.

# Agente Google · Durán Carasso

Vigila cada día la ficha de Google de las 4 sedes (BCN, AND, CRD, STG), junto con su web y su SEO. Te avisa por email de lo que falta y te deja preparados los borradores de posts y de respuestas a reseñas.

## Qué hace

| Cuándo | Qué |
|---|---|
| Cada día a las 8:30 | Revisa la ficha (nota, reseñas, fotos, horario, teléfono, web, estado) y la web (title, meta, H1, schema, NAP, canonical), además del SEO y el rendimiento con PageSpeed. Aplica las reglas, **Claude** prioriza las acciones y redacta los borradores, lo guarda en la hoja y te envía el email |
| Cada 3 h | Aviso de cada reseña nueva (🔴 si tiene 3★ o menos). No gasta IA |
| Manual | `publicarAprobados()` publica en Google los borradores marcados como `APROBADO` |

Crea estas pestañas en la hoja del CRM: `GBP_Historico` (evolución), `GBP_Tareas` (qué hacer) y `GBP_Borradores` (posts y respuestas para aprobar).

## Instalación (15 min)

1. **Google Cloud** → activa **Places API (New)** y **PageSpeed Insights API** → crea una API key.
2. **Anthropic** → crea una API key en console.anthropic.com.
3. Ve a script.google.com → Nuevo proyecto → pega `Code.gs`. En Configuración, marca "Mostrar appsscript.json" y pega `appsscript.json`.
4. En Configuración → Propiedades del script, añade:
   - `ANTHROPIC_API_KEY`
   - `GOOGLE_API_KEY`
   - `NOTIFY_EMAILS` (ej.: `marketing@…,direccion@…`)
   - `CHAT_WEBHOOK` (opcional, para Google Chat)
5. Ejecuta `instalar()` y acepta los permisos. En el registro, comprueba que los 4 placeId son las sedes correctas. Si alguno no lo es, ajusta `query` en `SEDES`, borra la propiedad `PLACE_XXX` y vuelve a ejecutar.
6. Ejecuta `ejecutarDiario()` una vez para ver el primer informe.

## Nivel 2: publicar y ver las reseñas sin responder (opcional)

Places API solo muestra lo público. Para ver qué reseñas faltan por responder, cuándo fue el último post, y para **publicar** en la ficha:

1. Solicita acceso a la Business Profile API (formulario de Google, tarda unos días).
2. Vincula el script a ese proyecto de GCP (Configuración → Proyecto de GCP) y activa **My Business Account Management**, **Business Information** y **Google My Business API**.
3. Añade `GBP_ACCOUNT_ID`, ejecuta `listarUbicacionesGBP()` y copia cada ID en `gbpLocationId` de `SEDES`.

## Coste aproximado
- Claude: 1 llamada al día, unos 4–5 € al mes.
- Places y PageSpeed: dentro del crédito gratuito de Google.

## Ajustes
Los umbrales (fotos mínimas, días sin post, SEO mínimo…) están en `UMBRAL`, al principio de `Code.gs`.

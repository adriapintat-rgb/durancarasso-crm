# 🤝 HANDOFF · Robot de Reseñas Durán Carasso
*(Pásale este documento a otro Claude/persona para que continúe el proyecto)*

## 0. Contexto en 3 líneas
Robot gratuito que vigila las reseñas de Google de las 4 fichas de Durán
Carasso, las clasifica con IA (Gemini) y envía un email con un borrador de
respuesta + botones de acción (publicar / regenerar / reportar). Vive en
Google Apps Script. Coste 0 €.

## 1. Dónde vive cada cosa
| Pieza | Ubicación exacta |
|---|---|
| Código fuente (respaldo) | Repo GitHub `adriapintat-rgb/durancarasso-crm`, carpeta `reputation-agent/`, rama `claude/clever-dirac-odjlec` |
| Robot en producción | Google Apps Script, proyecto "Durán Carasso · Reseñas" |
| Cuenta Google (todo) | `grupodurancarasso@gmail.com` (gestiona las 4 fichas) |
| Proyecto Google Cloud | ID `duran-carasso-resenas` · Nº `360704400683` |
| Histórico de reseñas | Google Sheet `DuranCarasso_Reseñas_Log` (Drive) |
| Emails de aviso | `adriap@durancarasso.com`, `aselles@durancarasso.com` |
| IA | Gemini `gemini-1.5-flash` (clave en Apps Script, NO en el repo) |

## 2. Cómo funciona (flujo)
1. Trigger horario ejecuta `revisarReseñas()`.
2. `getUbicaciones_()` lista las 4 fichas (APIs Account Mgmt + Business Info).
3. `getReseñas_()` lee reseñas nuevas (API v4 Google My Business).
4. `analizarConIA_()` → Gemini devuelve JSON {sentimiento, tema, urgencia, borrador, accion_interna}.
5. `guardarPendiente_()` guarda borrador+token en ScriptProperties (para los botones).
6. `enviarEmail_()` manda el aviso con botones.
7. Botones → `doGet(e)` (web app): publish = `publicarRespuesta_()` (PUT reply v4), regen = nueva versión IA + reenvía, report = link a Google.
8. `registrar_()` guarda fila en la Sheet (anti-duplicados por ReviewID).

## 3. Cómo se montó (pasos ya hechos)
1. Creado proyecto Apps Script + pegado `Code.gs` y `appsscript.json`.
2. Clave Gemini de https://aistudio.google.com/apikey puesta en CONFIG.
3. Proyecto Cloud `duran-carasso-resenas` creado.
4. APIs habilitadas en Cloud: My Business Account Management, My Business
   Business Information, Drive, Sheets, Gmail. (La de reseñas — "Google My
   Business API" v4 — NO es pública: requiere solicitud de acceso.)
5. Pantalla de consentimiento OAuth configurada (Externo) + `grupodurancarasso@gmail.com` como usuario de prueba.
6. Proyecto Cloud vinculado en Apps Script (Configuración → Cambiar proyecto → 360704400683).
7. Solicitud de acceso a la API de reseñas enviada → caso `7-6359000041501` (7-10 días hábiles).
8. Trigger horario instalado (`instalarTrigger`).
9. (Pendiente de confirmar por el usuario) Desplegar como Web App para activar los botones.

## 4. ESTADO ACTUAL (lo único que falta)
⏳ **Esperando aprobación de Google** del caso `7-6359000041501`. Enviado el
18/09/2026. Hasta que aprueben, las APIs de Business Profile tienen cuota 0 y
`revisarReseñas()` registra "Sin ubicaciones" (es lo esperado, NO es un bug).

## 5. Qué hacer cuando llegue la aprobación (email a grupodurancarasso@gmail.com)
1. Apps Script → ejecutar `testUbicaciones` → deben salir las 4 fichas.
2. Ejecutar `revisarReseñas` a mano para ver el primer email al instante
   (si no, llega en la próxima pasada horaria).
3. Confirmar que la Web App está desplegada (Implementar → Administrar
   implementaciones) para que los botones funcionen. Si se cambió el código,
   desplegar NUEVA VERSIÓN.

## 6. Gotchas / avisos
- La clave de Gemini NO debe subirse al repo (el repo lleva `PEGA_AQUI_TU_API_KEY`).
  Está solo en el Apps Script. Pendiente rotarla por seguridad (se compartió en chat).
- Si se edita `Code.gs`, hay que re-desplegar la Web App para que los botones
  usen el código nuevo.
- Botones en Outlook modo oscuro: usar `bgcolor` en celdas de tabla (ya aplicado).
- "Eliminar reseña" NO existe vía API: solo se puede reportar; Google decide.
- Con proyecto Cloud propio, las APIs internas (Drive/Sheets/Gmail) se activan
  a mano en Cloud, no se auto-activan.

## 7. Archivos del repo (reputation-agent/)
- `Code.gs` — robot completo (fuente de verdad; clave con placeholder).
- `appsscript.json` — scopes OAuth.
- `README.md` — instalación paso a paso.
- `MANUAL-SISTEMA.md` — manual completo.
- `ESTADO-PROYECTO.md` — checklist de estado.
- `HANDOFF.md` — este documento.

## 8. Reutilizar para otra empresa
Clonar el mismo `Code.gs`, cambiar CONFIG (EMAIL_DESTINO, MARCA, TONO, clave),
y repetir pasos 3-8 en la cuenta Google que gestione las fichas de esa empresa.
Cada empresa necesita su propio proyecto Cloud y su propia solicitud de acceso.

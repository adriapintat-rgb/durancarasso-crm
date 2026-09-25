# 🤝 HANDOFF · Agente Google (fichas + SEO) Durán Carasso
*(Pásale este documento a otro Claude o a otra persona para que continúe el proyecto)*

## 0. Contexto en 3 líneas
- Es un robot gratuito que cada lunes revisa las 4 fichas de Google de Durán Carasso: Barcelona, Sitges, Cerdanya y Andorra.
- Revisa la ficha, la web y la competencia de cada zona. Con esa información, Gemini propone mejoras.
- Envía un email con botones: ✅ Hecho · 🔄 Dame otra · ❌ No me sirve. Aprende de lo hecho y de lo descartado.
- Vive en Google Apps Script, igual que el Reputation Agent. Coste: 0 €.

## 1. Dónde vive cada cosa
| Pieza | Ubicación |
|---|---|
| Código fuente (respaldo) | Repo `adriapintat-rgb/durancarasso-crm`, carpeta `agente-gbp/`, rama `claude/gifted-ramanujan-yk6dan` |
| Robot en producción | Google Apps Script (un solo archivo `Code.gs`) |
| Registro | Google Sheet `DuranCarasso_AgenteGoogle_Log` en Drive. Se crea sola, con las pestañas Propuestas, Historico y Trabajo |
| Emails | `adriap@durancarasso.com` (`CONFIG.EMAIL_DESTINO`) |
| IA | Gemini `gemini-3.7-flash`. De reserva: `gemini-3.5-flash` y `gemini-flash-lite-latest`. Clave de AI Studio (`AQ.…`) |
| Datos de Google | Places API (New) + PageSpeed, con una clave de Google Cloud (`AIza…`) |

Las claves están **solo en Apps Script**, partidas en trozos (`'…' + '…'`) porque el chat las enmascara. El repositorio lleva placeholders.

## 2. Cómo funciona
1. El trigger de los lunes a las 8:00 (Europe/Madrid) ejecuta `informeSemanal()`.
2. Por cada sede se ejecuta `analizarSede_()`, que hace lo siguiente:
   - `ficha_()`: nota, reseñas, fotos, horario, teléfono, web y nombre.
   - `checklist_()`: calcula el % de ficha completa.
   - `competencia_()`: las 5 inmobiliarias de la zona en Google Maps.
   - `auditarWeb_()` y `pageSpeed_()`: SEO y velocidad de la web.
   - `auditarDominio_()`: robots.txt para las IA, sitemap, llms.txt y versión en francés.
3. `planIA_()` pide a Gemini un JSON con: titular, estado, comparación con la competencia, hasta 4 acciones, un post y la descripción.
   - Recibe lo que el equipo ya hizo o descartó (`memoria_()`), para no repetirlo.
   - Si Gemini falla, `planFallback_()` genera el plan solo con reglas y el email llega igual.
4. Si el proceso se acerca al límite de 6 minutos de Apps Script, guarda el progreso en la pestaña Trabajo y `continuarInforme` sigue al minuto.
5. `enviarInforme_()` manda el email con KPIs, la tabla de competencia y las tarjetas con botones.
6. Los botones llaman a `doGet()`, que valida un token por propuesta:
   - `hecho` / `no` marcan la propuesta en la hoja.
   - `otra` pide a Gemini una versión nueva y la reenvía por email.

## 3. Estado actual (25/09/2026)
- ✅ `testFichas` funciona con las claves reales: 4 fichas + "Gemini responde: OK".
  - BCN: 4,7★ (62 reseñas)
  - STG: 4,8★ (193)
  - CRD: 5★ (15)
  - AND: 4,6★ (5)
- ✅ La prueba local `node agente-gbp/test/probar.js` pasa entera.
- ⏳ Falta que el usuario haga en Apps Script:
  1. `enviarInformeAhora` → llega el primer email.
  2. `instalarTrigger` → el informe se envía solo cada lunes.
  3. **Implementar → Nueva implementación → Aplicación web**, con Ejecutar como **Yo** y Acceso **Cualquier usuario**. Después, vuelve a ejecutar `enviarInformeAhora` para tener los botones activos.

## 4. Gotchas
- **Si cambias el código,** ve a **Implementar → Administrar implementaciones → ✏️ → Nueva versión**. Si no, los botones siguen usando el código viejo.
- **Claves:**
  - Si se pegan desde el chat salen como `•••`. Pégalas partidas en trozos.
  - Se compartieron en el chat, así que hay que **rotarlas** cuando todo esté estable.
- **Gemini:**
  - La clave de Google Cloud da 403 `API_KEY_SERVICE_BLOCKED` con Gemini. Usa la de AI Studio.
  - `gemini-2.5-flash` y `1.5-flash` ya no están disponibles.
  - Si un modelo está saturado (503), el código pasa al siguiente de la reserva.
- **Búsqueda de marca con Google Search (grounding):** en el plan gratis da 429, así que se omite sin romper nada.
- **Si una ficha detectada no es la vuestra:** cambia `buscar` en `SEDES` y borra la propiedad `PLACE_XXX` en Configuración → Propiedades del script.
- **Límite de Places:** devuelve como máximo 10 fotos y 5 reseñas. Por eso "10 fotos" significa "10 o más".
- **Reseñas:** no se tocan aquí. Las gestiona el Reputation Agent.

## 5. Decisiones abiertas (negocio, no código)
- Quitar "| Inmobiliaria en …" del nombre de las fichas: hay riesgo de suspensión. Lo decide dirección. Ver `KIT-FICHAS.md` §1.
- Andorra: unificar la dirección. Ahora conviven Carrer de la Unió 9 y Av. 8 d'Agost 9.
- Fase 2: publicar posts y cambios directamente con la API de Business Profile. Necesita el mismo acceso que espera el Reputation Agent (caso `7-6359000041501`).

## 6. Archivos (`agente-gbp/`)
- `Code.gs`: el robot completo y la fuente de verdad. Las claves van con placeholder.
- `INSTALAR.md`: instalación en 5 minutos.
- `KIT-FICHAS.md`: textos listos para pegar en las fichas.
- `README.md`: qué hace.
- `test/probar.js`: prueba de extremo a extremo con simulaciones.
- `HANDOFF.md`: este documento.

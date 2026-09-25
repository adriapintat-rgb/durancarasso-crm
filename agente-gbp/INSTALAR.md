# Instalar el Agente Google (5 min, mismo sistema que el Reputation Agent)

1. **Pegar el código:** abre el proyecto de Apps Script, borra todo (Ctrl+A) y pega `Code.gs`.
   - Las claves se guardan solas la primera vez: al pegar versiones nuevas ya no hace falta volver a ponerlas.
2. **Poner las claves:** arriba, en `CONFIG`, sustituye:
   - `PEGA_AQUI_TU_API_KEY` por la clave de **Gemini** (la misma del Reputation Agent, o una nueva en aistudio.google.com/apikey).
   - `PEGA_AQUI_TU_CLAVE_GOOGLE` por la clave de **Google Cloud** (Places API New + PageSpeed).

   Guarda con Ctrl+S.
3. **Comprobar:** en el desplegable de arriba elige `testFichas` → ▷ **Ejecutar** → acepta los permisos (Configuración avanzada → Ir a… → Permitir).
   - En el registro deben salir ✅ las 4 fichas y "Gemini responde: OK".
4. **Primer informe:** elige `enviarInformeAhora` → ▷ **Ejecutar**. En 2-5 minutos llega el email.
5. **Automático:** elige `instalarTrigger` → ▷ **Ejecutar**. A partir de ahora, **cada lunes a las 8:00**.
6. **Botones del email:** **Implementar → Nueva implementación → Aplicación web**, con "Ejecutar como: Yo" y "Acceso: Cualquier usuario" → **Implementar**.
   - Si cambias el código, crea una **nueva versión** de la implementación.

⚠️ **Las claves van solo en Apps Script.** No las subas al repositorio.

## Problemas frecuentes
| Síntoma | Solución |
|---|---|
| ❌ "Activa Places API (New)" | console.cloud.google.com/apis/library/places.googleapis.com → **Habilitar** |
| ❌ Gemini 404 / modelo no encontrado | Cambia `GEMINI_MODEL` por un modelo vigente de aistudio.google.com |
| Los botones dicen "se activan al implementar" | Haz el paso 6 |
| Una ficha no es la vuestra | Cambia el texto `buscar` de esa sede en `SEDES`, y en Configuración del proyecto → Propiedades del script borra `PLACE_XXX` |

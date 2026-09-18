# 🏛️ Durán Carasso · Robot de Reseñas de Google — Manual del sistema

Documento maestro. Guarda todo lo necesario para entender, mantener y
reactivar el sistema. Coste del sistema: **0 €**.

---

## 1. Qué es y qué hace

Un agente automático (Google Apps Script) que, **cada hora y sin intervención**:

1. Lee las reseñas nuevas de las 4 fichas de Google del grupo.
2. Con IA (Gemini) clasifica cada reseña: sentimiento (🟢/🟡/🔴), tema y urgencia.
3. Redacta un **borrador de respuesta** en el idioma del cliente.
4. Envía un **email de aviso** con la reseña + el borrador + (si es negativa)
   una acción interna recomendada.
5. Registra todo en una Google Sheet para no duplicar avisos.

El equipo solo revisa el email y publica la respuesta en Google. El robot
**no publica solo** (siempre revisión humana).

Ubicaciones: **Barcelona · Andorra · Sitges · La Cerdanya** (se detectan
automáticamente todas las fichas de la cuenta).

---

## 2. Datos clave del montaje

| Dato | Valor |
|---|---|
| Cuenta Google que gestiona todo (y las fichas) | `grupodurancarasso@gmail.com` |
| Proyecto Google Cloud (ID) | `duran-carasso-resenas` |
| Nº de proyecto Cloud | `360704400683` |
| Emails de aviso | `adriap@durancarasso.com`, `aselles@durancarasso.com` |
| Motor IA | Gemini (`gemini-1.5-flash`) — API key en `Code.gs` |
| Caso de acceso a la API de reseñas | `7-6359000041501` (aprobación 7-10 días hábiles) |
| Dónde vive el robot | Google Apps Script → proyecto "Durán Carasso · Reseñas" |
| Frecuencia de revisión | Cada 1 hora (trigger `instalarTrigger`) |
| Hoja de registro | Google Drive → `DuranCarasso_Reseñas_Log` |

---

## 3. Arquitectura

```
Google Business Profile (reseñas de las 4 fichas)
        │  (API v4, lectura cada hora)
        ▼
Google Apps Script  ──►  Gemini (clasifica + redacta borrador)
        │
        ├──►  Gmail  →  email de aviso a adriap@ y aselles@
        └──►  Google Sheet  →  registro + anti-duplicados
```

APIs de Google usadas (todas activadas en el proyecto Cloud):
- My Business Account Management API — cuentas
- My Business Business Information API — fichas
- Google My Business API (v4) — **reseñas** (requiere aprobación, caso 7-6359000041501)
- Drive API, Sheets API, Gmail API — registro y envío

---

## 4. Estado actual

**✅ Completado:**
- Código instalado en Apps Script y funcionando de principio a fin.
- Proyecto Cloud creado, vinculado y con las APIs internas activadas.
- Pantalla de consentimiento OAuth configurada + usuario de prueba.
- Emails de aviso configurados (adriap@ y aselles@).
- Solicitud de acceso a la API de reseñas enviada.

**⏳ Pendiente (depende de Google):**
- Aprobación del acceso a la API de reseñas (caso `7-6359000041501`).
  Hasta entonces las APIs de Business Profile tienen cuota 0 y el robot
  registra "Sin ubicaciones". **Se desbloquea solo** al aprobar; no hay
  que tocar nada.

**Opcional hoy:**
- Ejecutar la función `instalarTrigger` (si no se hizo) para dejar la
  revisión horaria activa.

---

## 5. Cuando Google apruebe (reactivación)

1. Llega email de aprobación de Google al caso 7-6359000041501.
2. Abrir Apps Script → función `testUbicaciones` → ▶ Ejecutar.
   → Deben aparecer las 4 fichas en el registro.
3. Si el trigger ya está instalado, los emails empiezan a llegar solos.
   Si no: función `instalarTrigger` → ▶ Ejecutar.

---

## 6. Mantenimiento

| Quiero… | Dónde (en `Code.gs`, sección CONFIG) |
|---|---|
| Cambiar emails de aviso | `EMAIL_DESTINO` (separar varios por coma) |
| Ajustar tono de las respuestas | `TONO` |
| Cambiar frecuencia | función `instalarTrigger` → `everyHours(1)` |
| Ver histórico | Google Sheet `DuranCarasso_Reseñas_Log` |
| Rotar la clave de IA | `GEMINI_API_KEY` (nueva en aistudio.google.com/apikey) |

⚠️ **Seguridad pendiente:** rotar la API key de Gemini (se compartió en chat
durante el montaje). Crear una nueva en https://aistudio.google.com/apikey,
borrar la antigua y pegar la nueva en `GEMINI_API_KEY`.

---

## 7. Problemas frecuentes

| Síntoma | Causa / solución |
|---|---|
| "Sin ubicaciones" | Aprobación de reseñas aún pendiente (normal antes de aprobar). |
| "Acceso bloqueado / app no verificada" | Añadir la cuenta como usuario de prueba en Google Auth Platform → Público. |
| "Permission denied while enabling APIs" | Activar a mano Drive/Sheets/Gmail API en el proyecto Cloud. |
| No llegan emails tras aprobación | Revisar que el trigger esté instalado y la API key sea válida. |

---

## 8. Evoluciones futuras (opcionales)

- Resumen semanal de reputación por oficina.
- Auto-publicar respuestas a reseñas de 5★ (bajo riesgo).
- Avisos también a Slack / WhatsApp.
- Panel con evolución de la puntuación media por ubicación.

---

## 9. Archivos de este sistema (en el repositorio)

- `reputation-agent/Code.gs` — el código del robot (fuente de verdad).
- `reputation-agent/appsscript.json` — permisos (OAuth scopes).
- `reputation-agent/README.md` — guía de instalación paso a paso.
- `reputation-agent/ESTADO-PROYECTO.md` — checklist de estado.
- `reputation-agent/MANUAL-SISTEMA.md` — este documento.

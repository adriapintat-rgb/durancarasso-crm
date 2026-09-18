# 🏛️ Durán Carasso · Reputation Agent

Motor **gratuito** que vigila las reseñas de Google de tus 4 fichas
(Barcelona · Andorra · Sitges · La Cerdanya), las clasifica con IA
(buena/mala + tema + urgencia) y te envía un **email con un borrador de
respuesta listo** para revisar y publicar.

- **Coste:** 0 € (corre en Google Apps Script + Gemini free tier)
- **Sin servidores, sin suscripción, sin Zapier/Make**
- **Tuyo:** vive en tu cuenta de Google

---

## ⚙️ Cómo funciona

```
Reseña nueva en Google  →  Apps Script (cada hora)
        →  Gemini: sentimiento + tema + borrador de respuesta
        →  Email a tu Gmail (🟢/🟡/🔴 + borrador + acción)
        →  Registro en Google Sheet (evita duplicados)
```

---

## 🚀 Puesta en marcha (15 min, una sola vez)

### 1. Consigue tu API key de Gemini (gratis)
- Entra en https://aistudio.google.com/apikey
- "Create API key" → cópiala.

### 2. Crea el proyecto Apps Script
- Ve a https://script.google.com → **Nuevo proyecto**.
- Pega el contenido de `Code.gs` en el editor.
- Menú **Configuración del proyecto** (⚙️) → activa
  *"Mostrar el archivo de manifiesto appsscript.json"* → pega el
  contenido de `appsscript.json`.

### 3. Rellena la config
En `Code.gs`, arriba del todo:
- `EMAIL_DESTINO` → ya está tu email.
- `GEMINI_API_KEY` → pega la key del paso 1.

### 4. Habilita el acceso a las reseñas (Business Profile API)
> Es gratis, pero Google exige activarlo una vez.

- En el proyecto Apps Script → **Configuración del proyecto** → anota el
  nº de proyecto de Google Cloud (o crea uno en https://console.cloud.google.com).
- En Google Cloud Console, **APIs y servicios → Biblioteca**, busca y activa:
  - **Google My Business API** (reseñas)
  - **My Business Account Management API**
  - **My Business Business Information API**
- Si "Google My Business API" no aparece, solicítala aquí (aprobación gratuita):
  https://developers.google.com/my-business/content/prereqs
  *(Suele tardar de unas horas a un par de días.)*

### 5. Prueba
- En el editor, selecciona la función `testUbicaciones` → **Ejecutar**.
- La primera vez Google pedirá **autorizar permisos** → acepta.
- En **Registros de ejecución** deberías ver tus 4 fichas listadas.

### 6. Activa el piloto automático
- Ejecuta la función `instalarTrigger` una vez.
- Listo: cada hora revisará las 4 ubicaciones y te avisará de reseñas nuevas.

---

## 🎛️ Ajustes rápidos

| Quiero… | Dónde |
|---|---|
| Cambiar el tono de marca | `CONFIG.TONO` |
| Revisar más/menos a menudo | `instalarTrigger` → `everyHours(1)` |
| Cambiar email de avisos | `CONFIG.EMAIL_DESTINO` |
| Ver histórico de reseñas | Google Sheet `DuranCarasso_Reseñas_Log` |

---

## 🔒 Notas

- Los borradores **no se publican solos**: tú revisas y publicas en 1 clic.
- Si Gemini falla, hay un *fallback* que genera un borrador básico por estrellas.
- El script solo procesa la **página más reciente** de reseñas por ficha en
  cada pasada, y usa el `ReviewID` para no duplicar avisos.

---

## 🔜 Siguientes evoluciones (opcionales)
- Auto-publicar respuestas de reseñas 5★ (bajo riesgo).
- Resumen semanal de reputación por ubicación.
- Alertas a Slack/WhatsApp además de email.

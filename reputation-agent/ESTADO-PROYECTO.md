# 📋 PROYECTO · Robot de Reseñas Durán Carasso

## 🎯 Qué hace
Vigila las reseñas de Google de las 4 oficinas (Barcelona · Andorra · Sitges ·
La Cerdanya), detecta si son buenas/malas y envía un email con la respuesta
ya redactada para revisar y publicar. Coste: 0 €.

## 🔑 Datos clave
| Dato | Valor |
|---|---|
| Proyecto Google Cloud (ID) | `duran-carasso-resenas` |
| Nº de proyecto | `360704400683` |
| Email de avisos | `adriap@durancarasso.com`, `aselles@durancarasso.com` |
| Cuenta que gestiona todo | `grupodurancarasso@gmail.com` |
| Caso solicitud API reseñas | `7-6359000041501` (aprobación 7-10 días hábiles) |
| Dónde vive el robot | Apps Script → proyecto "Durán Carasso · Reseñas" |
| Llave IA (Gemini) | Dentro del código Code.gs (rotar por seguridad al final) |

## ✅ Hecho
- [x] Código del robot pegado en Apps Script
- [x] Llave de IA (Gemini) puesta
- [x] Proyecto Google Cloud creado (`duran-carasso-resenas`)
- [x] APIs activadas: Account Management, Business Information, Drive, Sheets, Gmail
- [x] Solicitud de acceso a la API de reseñas enviada (caso 7-6359000041501)
- [x] Pantalla de consentimiento OAuth configurada + usuario de prueba añadido
- [x] Proyecto Cloud vinculado en Apps Script (Paso 7)
- [x] Código ejecutado OK de principio a fin (crea hoja de registro)
- [x] Email de avisos configurado: adriap@durancarasso.com + aselles@durancarasso.com

## 🔲 Pendiente

### Hoy (~1 min)
- [ ] **Paso 9 — Encender piloto automático**
  Función `instalarTrigger` → ▶ Ejecutar. Revisa las reseñas cada hora.

> Nota: al ejecutar hoy sale "Sin ubicaciones" porque las APIs de Business
> Profile tienen la cuota a 0 hasta que Google apruebe el caso
> 7-6359000041501. Es lo esperado; se desbloquea solo con la aprobación.

### Esperando a Google (7-10 días hábiles)
- [ ] Aprobación del acceso a la API de reseñas (caso 7-6359000041501).
  Cuando llegue el email de aprobación, los avisos empiezan a llegar solos.
  No hay que tocar nada más.

## 🔒 Al terminar (seguridad)
- Rotar la llave de Gemini en https://aistudio.google.com/apikey
  (borrar la actual, crear otra, pegarla en `Code.gs` → `GEMINI_API_KEY`).

## 🔜 Evoluciones futuras (opcionales)
- Resumen semanal de reputación por ubicación.
- Auto-publicar respuestas a reseñas de 5★ (bajo riesgo).
- Avisos también a Slack/WhatsApp.

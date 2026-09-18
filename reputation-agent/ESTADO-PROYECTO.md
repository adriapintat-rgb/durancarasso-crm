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
| Email de avisos | `adriapintat@gmail.com` |
| Caso solicitud API reseñas | `7-6359000041501` (aprobación 7-10 días hábiles) |
| Dónde vive el robot | Apps Script → proyecto "Durán Carasso · Reseñas" |
| Llave IA (Gemini) | Dentro del código Code.gs (rotar por seguridad al final) |

## ✅ Hecho
- [x] Código del robot pegado en Apps Script
- [x] Llave de IA (Gemini) puesta
- [x] Proyecto Google Cloud creado (`duran-carasso-resenas`)
- [x] API My Business Account Management activada
- [x] API My Business Business Information activada
- [x] Solicitud de acceso a la API de reseñas enviada (caso 7-6359000041501)

## 🔲 Pendiente

### Hoy (~5 min)
- [ ] **Paso 7 — Vincular proyecto en Apps Script**
  ⚙️ Configuración del proyecto → "Cambiar de proyecto" → pegar `360704400683` → Establecer.
- [ ] **Paso 8 — Probar detección de fichas**
  En Apps Script, función `testUbicaciones` → ▶ Ejecutar → autorizar permisos →
  deben aparecer las 4 fichas en el registro de ejecución.
- [ ] **Paso 9 — Encender piloto automático**
  Función `instalarTrigger` → ▶ Ejecutar. Revisa las reseñas cada hora.

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

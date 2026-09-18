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

- [x] **Piloto automático activado** (`instalarTrigger` → revisión cada hora)

## 🟢 Sistema montado y armado al 100% por nuestra parte

Todo lo que dependía de nosotros está hecho. El robot ya se ejecuta solo
cada hora.

## 🔲 Único pendiente (depende de Google)
- [ ] Aprobación del acceso a la API de reseñas (caso `7-6359000041501`,
  7-10 días hábiles).

> Hasta la aprobación, las revisiones horarias registran "Sin ubicaciones"
> porque las APIs de Business Profile tienen la cuota a 0. Es lo esperado.
> Al aprobar, empieza a leer fichas y reseñas y a enviar emails **solo**,
> sin tocar nada. Ver "Reactivación" en MANUAL-SISTEMA.md (punto 5).

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

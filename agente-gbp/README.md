# Agente Google · Durán Carasso

Mismo sistema que el **Reputation Agent**: un solo `Code.gs` en Apps Script, IA con **Gemini** (0 €), email con botones de 1 clic.

**Cada lunes a las 8:00**, para las 4 sedes (Barcelona, Sitges, Cerdanya y Andorra):
1. **Revisa la ficha de Google:** nota, reseñas, fotos, horario, teléfono, web y nombre. Calcula el **% de ficha completa**.
2. **Se compara** con las 5 inmobiliarias de la zona en Google Maps.
3. **Revisa la web:** SEO, velocidad, schema, teléfono coherente, robots.txt para IA, llms.txt y francés.
4. **Busca la marca** en Google con Gemini: qué ve un cliente y qué datos no cuadran.
5. **Gemini propone** hasta 4 acciones por sede (con la mejor opción y cuándo), un post y, si hace falta, una nueva descripción.
6. **Email con botones:** ✅ Hecho · 🔄 Dame otra propuesta · ❌ No me sirve. Lo hecho o descartado no se vuelve a proponer.

**Las reseñas** las gestiona el Reputation Agent (aquí no se duplican).

- **Robustez:** si Gemini falla, el informe llega igual con lo que detectan las reglas. Si se acerca el límite de 6 min de Apps Script, sigue solo al minuto.
- **Registro:** hoja `DuranCarasso_AgenteGoogle_Log` (propuestas e histórico), en Drive.
- **Instalación:** [INSTALAR.md](INSTALAR.md).
- **Kit de fichas para pegar a mano:** [KIT-FICHAS.md](KIT-FICHAS.md).
- **Prueba local:** `node agente-gbp/test/probar.js`.

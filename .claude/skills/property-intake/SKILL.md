---
name: property-intake
description: Convierte una propiedad en un pack completo de contenido a partir de una URL de ficha, una captura de pantalla o cuatro datos sueltos. ÚSALA cuando el usuario pegue un enlace de una propiedad, suba una captura o foto de una casa, diga "hazme el contenido de este piso", "mira esta ficha", "de esta URL sácame contenido", "te paso este piso", "genera todo de esta propiedad".
---

# Property Intake · de una propiedad a un pack completo

## Entradas aceptadas

| Entrada | Cómo se procesa |
|---|---|
| **URL de ficha** (tu web u otra) | WebFetch → extrae zona, precio, m², dormitorios, extras |
| **Captura de pantalla** | Lectura directa de la imagen: precio, superficie, referencias |
| **Foto de la propiedad** | Lectura de la imagen: tipología, estado, luz, orientación aparente, elementos vendibles |
| **Cuatro datos sueltos** | Basta con zona + precio + m². El resto se pregunta |

## Proceso

1. **Extrae la ficha.** Rellena esta estructura. Lo que no esté, marca `{{DATO}}` — no lo inventes:
   `zona / parroquia · tipo · precio · m² · dormitorios · baños · exterior ·
   parking · planta · orientación · estado · año · gastos comunidad · referencia`

2. **Carga el contexto de zona.** Si es Andorra, aplica la skill `andorra-expert`:
   precio/m² de la parroquia, carácter del sitio, estacionalidad, comprador tipo.
   Compara el precio de la propiedad con la media de su parroquia — ese contraste
   es contenido por sí solo.

3. **Encuentra el ángulo.** Una propiedad tiene UN gancho, no cinco. Búscalo en este orden:
   - Una cifra anómala (precio por debajo de zona, m² de terraza, altura de techos)
   - Algo que la foto enseña y el texto no
   - Tiempo en mercado (muy poco = urgencia; mucho = historia de reforma)
   - Un detalle irrepetible (año, vistas concretas, orientación)
   Si no hay ángulo, dilo. No fuerces un post mediocre.

4. **Genera el pack.** Ocho piezas de la misma propiedad:

   | # | Pieza | Salida |
   |---|---|---|
   | 1 | Reel property tour | Guion con timings + shot list |
   | 2 | Carrusel 5 slides | Texto slide a slide |
   | 3 | Post precio revelado | Copy + momento de revelación |
   | 4 | 3 Stories | Secuencia con sticker/CTA cada una |
   | 5 | Copy corto para portales | 300 caracteres |
   | 6 | Email a leads del CRM | Asunto + cuerpo, criterio de segmentación |
   | 7 | Texto de ficha web SEO | H1 + 2 párrafos + keywords de zona |
   | 8 | Guion de nota de voz para DM | 20 segundos, tono cercano |

   Cada pieza con las reglas de copy de `content-engine`: hook en 5 palabras,
   cifras sobre adjetivos, 1 CTA, 4-6 hashtags.

5. **Brief de producción visual.** Para cada vídeo: plano a plano, con segundos,
   qué encuadre, qué movimiento de cámara, dónde entra el rótulo y qué dice.
   Escrito para que alguien lo grabe con un móvil sin preguntar nada más.

6. **Guarda** en `content-engine/output/packs/<referencia>.json` y añade las piezas
   seleccionadas a `content-engine/output/cola.json`.

## Qué NO hago, para que no haya sorpresas

- **No grabo vídeo ni genero fotos de la propiedad.** Escribo el guion, la shot list
  y el plan de montaje; las imágenes reales las pone la propiedad.
- **No invento vistas, orientaciones ni distancias** que no estén en la ficha o la foto.
- Si necesitas render de espacios (antes/después), usa la skill `doc-antesdespues`.

## Al terminar

Di siempre qué campos quedaron como `{{DATO}}` y qué falta por confirmar antes de publicar.

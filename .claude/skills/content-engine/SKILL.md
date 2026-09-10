---
name: content-engine
description: Motor de contenido Instagram para Duran Carasso. Genera el plan semanal de 7 días, escribe el copy final de cada pieza, define el brief visual y lo deja en la cola de aprobación. ÚSALA cuando el usuario diga "plan de la semana", "genera el contenido", "qué publico esta semana", "llena la cola", "contenido de Instagram", "calendario editorial", "plan semanal IG".
---

# Content Engine · Instagram Duran Carasso

Genera un plan semanal completo y lo escribe en `content-engine/output/cola.json`.

## 1. Los 7 formatos que funcionan hoy en inmobiliario de lujo

Uno por día. No inventes formatos nuevos: rota estos.

| # | Formato | Por qué funciona | Entrega |
|---|---------|------------------|---------|
| F1 | **Antes / Después** | Máxima retención. El cerebro compara solo. | Reel 8-12s, corte seco al segundo 2 |
| F2 | **Dato de mercado propio** | Autoridad. Nadie más tiene tus números. | Carrusel 4 slides, slide 1 = el número solo |
| F3 | **Property Tour vertical** | Intención de compra alta, guardado alto. | Reel 15-25s, sin música épica, sonido ambiente |
| F4 | **Precio revelado** | Curiosidad. "¿Cuánto cuesta esto?" | Reel 10s: 3 planos + precio al final |
| F5 | **Zona / lifestyle** | Alcance frío. Vende el sitio, no el piso. | Carrusel 5 slides o Reel B-roll |
| F6 | **Error que comete el comprador** | Salvable → compartido. | Carrusel 5 slides, texto grande |
| F7 | **Detrás de la operación** | Confianza. Rostro humano del equipo. | Story serie o Reel a cámara |

## 2. Reglas de copy (no negociables)

- **Primeras 5 palabras = todo.** El hook va en la primera línea, sin emoji, sin saludo.
- Nunca "¡Descubre esta espectacular villa!". Sí: "Esta casa llevaba 11 meses sin venderse."
- Cifras concretas > adjetivos. "340 m²" gana a "amplia".
- **1 CTA por pieza.** Rota: guardar / comentar palabra clave / DM / link en bio.
- Longitud: 40-90 palabras. Salto de línea cada 1-2 frases.
- 4-6 hashtags al final, nunca 30. Mezcla: 2 zona + 2 nicho + 1 marca.
- Idioma: castellano. Añade versión EN solo si la propiedad es >2M€.

## 3. Hooks que funcionan (rellena las variables)

- "Esta casa en {zona} cuesta {precio}. Y se vendió en {dias} días."
- "{numero} de cada 10 compradores en {zona} cometen este error."
- "Nadie quería este {espacio}. Mira cómo quedó."
- "El m² en {zona} ha subido un {pct}% este año. Los números reales:"
- "Precio: {precio}. Antes de juzgar, mira la terraza."
- "Lo que no te enseñan de comprar en {zona}."

## 4. Cadencia semanal

```
Lun  F2  Dato de mercado      (autoridad, arranca la semana)
Mar  F3  Property tour        (producto)
Mié  F1  Antes/Después        (pico de alcance a mitad de semana)
Jue  F6  Error del comprador  (guardable)
Vie  F4  Precio revelado      (viernes = curiosidad, alto engagement)
Sáb  F5  Zona / lifestyle     (alcance frío, fin de semana)
Dom  F7  Detrás de la operación (cercanía)
```

Hora de publicación: 13:30 o 20:30 CET. No publiques antes de las 9:00.

## 5. Proceso

1. Lee `content-engine/data/propiedades.json` (cartera disponible) y `content-engine/data/mercado.json` (datos para F2/F4).
2. Si falta el archivo, pregunta al usuario los datos mínimos de 3 propiedades: zona, precio, m², dormitorios, 1 detalle diferencial.
3. Genera 7 piezas siguiendo la cadencia. Para cada una:
   - `dia`, `formato`, `propiedad_id` (o null)
   - `hook` (primera línea)
   - `copy` (texto completo, listo para pegar)
   - `hashtags` (array de 4-6)
   - `cta`
   - `brief_visual` (qué grabar/montar, plano a plano, en 2-4 líneas)
   - `estado`: "pendiente"
4. Escribe todo en `content-engine/output/cola.json`.
5. Regenera el panel: `content-engine/cola.html` lee ese JSON.
6. Nunca repitas la misma propiedad dos veces en la misma semana.
7. Nunca inventes un dato de mercado ni un precio. Si no está en los datos, marca `"requiere_dato": true` y deja el hueco visible como `{{DATO}}`.

## 6. Publicación

La cola es de aprobación humana. El usuario aprueba en `cola.html` y copia el copy.
Para automatizar la publicación: webhook de Make apuntando a Instagram Graph API,
consumiendo las piezas con `estado: "aprobado"`.

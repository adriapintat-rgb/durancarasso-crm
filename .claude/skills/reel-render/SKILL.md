---
name: reel-render
description: Renderiza un Reel vertical MP4 real (1080x1920, H.264) desde una plantilla animada, listo para subir a Instagram. ÚSALA cuando el usuario pida "genera el vídeo", "hazme el reel", "quiero el vídeo de esto", "renderiza el reel", "un vídeo con estos datos", "vídeo comparativa", "vídeo de precios".
---

# Reel Render · del dato al MP4

Genera Reels de **motion graphics** sin necesidad de cámara ni imágenes de propiedad.

## Qué se puede renderizar así (y qué no)

**Sí, entero y en automático:**
- Comparativas de precio por zona / parroquia
- Precio revelado (cifra que aparece al final)
- Evolución de mercado, ranking, "antes de vender mira esto"
- Listas de errores del comprador, checklists
- Ficha de propiedad en texto sobre fondo de marca

**No:** metraje real de una casa. Para eso el output es la shot list de `property-intake`.
Nunca generes imágenes sintéticas de una propiedad real.

## Pipeline

1. **Plantilla.** Parte de `assets/plantilla-ranking.html`. Es un HTML de 1080×1920
   con una función global `window.seek(t)` que coloca **toda** la animación en el
   segundo `t`. Nada de CSS `animation` ni `transition`: el render es por fotograma,
   así que todo tiene que ser determinista y depender solo de `t`.

2. **Contenido.** Cambia el array `D` (datos), `MAX`, `AVG`, los textos y los tiempos
   de entrada en `seek()`. Datos reales siempre; si falta uno, no se hace el vídeo.

3. **Frames.** `node assets/render.js` → 300 PNG a 25 fps (12 s) con Chromium headless.
   Ajusta `FPS` y `DUR` arriba del script.

4. **Encode.**
   ```
   FF=$(python3 -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())")
   $FF -y -framerate 25 -i frames/f%04d.png -c:v libx264 -preset slow -crf 19 \
       -pix_fmt yuv420p -profile:v high -level 4.1 -movflags +faststart salida.mp4
   ```
   El ffmpeg que trae Playwright **no sirve**: viene sin H.264. Instala
   `pip install imageio-ffmpeg` si no está.

5. **Revisa un fotograma** antes de encodear (uno del segundo 8, con todo en pantalla).
   Sale más barato que renderizar dos veces.

6. Guarda el MP4 en `content-engine/reels/` y enlázalo desde la pieza en `cola.json`.

## Especificaciones Instagram

| | |
|---|---|
| Resolución | 1080 × 1920 (9:16) |
| Duración | 7–15 s para dato/precio; hasta 30 s para tour |
| FPS | 25 o 30 |
| Códec | H.264, yuv420p, CRF 19–21 |
| Zona segura | 250 px arriba, 320 px abajo: la UI de IG tapa ahí |
| Audio | Se añade en la app. Sube el MP4 mudo y pon audio de tendencia en Instagram |

## Reglas de diseño del reel

- El **primer fotograma decide todo**. Tiene que leerse entero sin play.
- Una idea por vídeo. Un número protagonista.
- Los números suben contando: la animación de conteo retiene.
- Tipografía grande. Si dudas del tamaño, súbelo.
- Sin transiciones de vídeo. Corte seco o nada.
- Cierra siempre con marca + una acción concreta.

# Parche carrusel-factory — Durán Carasso

Añade a [carrusel-factory](https://github.com/david-ai-pro/carrusel-factory) la
posibilidad de usar **fotos reales de propiedad** como fondo, más la marca ya
configurada y dos carruseles listos para lanzar.

## Qué incluye

| Archivo | Qué hace |
|---|---|
| `estilos/foto-real/` | Estilo nuevo: tu foto a sangre + degradado + serif elegante |
| `scripts/generar.py` | Versión parcheada: soporta `"foto"` y `"etiqueta"` por slide |
| `config.json` | Marca Durán Carasso (@durancarasso, `#133F49`) |
| `trabajo/carrusel-foto-real.json` | Plantilla de 7 slides para una propiedad |
| `trabajo/carrusel-ia.json` | Carrusel de 6 slides con fondos IA gratis (pollinations-flux) |
| `INSTALAR.bat` | Copia todo dentro de tu carpeta carrusel-factory |

## Instalación (Windows)

```bat
git clone https://github.com/david-ai-pro/carrusel-factory
cd carrusel-factory
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m playwright install chromium
```

Luego, desde esta carpeta del parche:

```bat
INSTALAR.bat C:\ruta\a\carrusel-factory
```

Hace copia de seguridad de `scripts/generar.py` en `generar.py.bak`.

## Uso A — fondos IA, gratis y sin clave

```bat
copy trabajo\carrusel-ia.json trabajo\carrusel.json
run.bat generar
```

Usa `pollinations-flux`: no necesita clave ni registro. Para más calidad,
pon tu clave de [fal.ai](https://fal.ai/dashboard/keys) en
`config.json` → `claves.fal_api_key` y cambia `modelo_imagen` a
`nano-banana-pro` o `gpt-image-2`.

## Uso B — fotos reales de la propiedad (recomendado)

1. Copia 7 fotos a `fotos\` con los nombres `01.jpg` … `07.jpg`.
2. Edita `trabajo/carrusel-foto-real.json`: sustituye los `CAMBIAR:` y los
   `000 m²` por los datos reales de la propiedad.
3. Genera:

```bat
copy trabajo\carrusel-foto-real.json trabajo\carrusel.json
run.bat generar
```

Los PNG salen en `output\<tema>\slide-01.png` …

## Campos nuevos en `trabajo/carrusel.json`

- `"foto"`: ruta relativa a la imagen de fondo, p. ej. `"fotos/03.jpg"`.
  Solo la usan los estilos con `"usa_foto_propia": true`.
- `"etiqueta"`: rótulo pequeño sobre el título (`El salón`, `La terraza`…).
  Se oculta en la slide de portada.

## Nota

Los fondos IA no se pudieron probar en el entorno donde se creó este parche
(la red bloquea `pollinations.ai` y `fal.ai`). El estilo `foto-real` y el
render sí están probados.

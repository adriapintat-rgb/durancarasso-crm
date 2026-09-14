"""Orquestador: lee trabajo/carrusel.json, genera los fondos IA (si el estilo los usa)
y renderiza los PNG finales en output/<slug-del-tema>/.

Uso: run.bat generar   (o: python scripts/generar.py)
"""
import json
import os
import sys

import modelos_imagen
import render
from estilos import cargar_estilo
from utils import cargar_config, marca_configurada, ruta, slug, texto_html


def main():
    plan_p = ruta("trabajo", "carrusel.json")
    if not os.path.isfile(plan_p):
        print("ERROR: no existe trabajo/carrusel.json.")
        print("Pídele a Claude en el chat que prepare el carrusel (escriba el plan) primero.")
        sys.exit(1)

    with open(plan_p, encoding="utf-8") as f:
        plan = json.load(f)

    cfg = cargar_config()
    if not marca_configurada(cfg):
        print("Aún no has configurado tu marca.")
        print("Dile a Claude en el chat: 'configura mi marca' (te preguntará los datos).")
        sys.exit(1)

    defaults = cfg.get("defaults", {})
    nombre_estilo = plan.get("estilo") or defaults.get("estilo", "dark-bold")
    try:
        estilo = cargar_estilo(nombre_estilo)
    except ValueError as e:
        print(f"ERROR: {e}")
        sys.exit(1)

    formato = plan.get("formato") or defaults.get("formato", "4:5")
    modelo = plan.get("modelo_imagen") or defaults.get("modelo_imagen", "nano-banana-pro")
    usa_ia = bool(estilo["preset"].get("usa_fondo_ia"))
    usa_foto = bool(estilo["preset"].get("usa_foto_propia"))
    prompt_base = estilo["preset"].get("prompt_base", "")

    marca = cfg.get("marca", {})
    marca_txt = marca.get("handle") or marca.get("nombre", "")
    marca_color = marca.get("color_principal", "#111111")

    carpeta = ruta("output", slug(plan.get("tema", "carrusel")))
    fondos = os.path.join(carpeta, "_fondos")
    os.makedirs(carpeta, exist_ok=True)

    slides = plan.get("slides", [])
    total = len(slides)
    if total == 0:
        print("El carrusel no tiene slides.")
        sys.exit(1)

    items = []
    coste = 0.0
    for s in slides:
        n = s.get("n")
        fondo_path = None
        if usa_foto and s.get("foto"):
            cand = s["foto"] if os.path.isabs(s["foto"]) else ruta(s["foto"])
            if not os.path.isfile(cand):
                print(f"ERROR: slide {n}: no encuentro la foto '{s['foto']}'.")
                sys.exit(1)
            fondo_path = cand
        elif usa_ia and s.get("fondo_ia_prompt"):
            fondo_path = os.path.join(fondos, f"fondo-{n:02d}.png")
            if not os.path.isfile(fondo_path):
                prompt = (prompt_base + " " + s["fondo_ia_prompt"]).strip()
                print(f"  Slide {n}: generando fondo IA con {modelo}...")
                modelos_imagen.generar_fondo(prompt, formato, modelo, cfg, fondo_path)
                coste += modelos_imagen.coste_de(modelo)
        contexto = {
            "titulo": texto_html(s.get("titulo", "")),
            "cuerpo": texto_html(s.get("cuerpo", "")),
            "marca": marca_txt,
            "n": n,
            "total": total,
            "rol": s.get("rol", ""),
            "etiqueta": texto_html(s.get("etiqueta", "")),
        }
        salida = os.path.join(carpeta, f"slide-{n:02d}.png")
        items.append((contexto, fondo_path, salida))

    print(f"Renderizando {total} slides · estilo '{nombre_estilo}' · formato {formato}...")
    render.render_todas(estilo, items, formato, marca_color)

    print("\n✔ Carrusel listo.")
    print(f"  Slides:  {total}")
    if coste:
        print(f"  Coste aprox. imágenes IA: ${coste:.2f}")
    print(f"  Carpeta: {carpeta}")


if __name__ == "__main__":
    main()

"""Identificacion de propiedades a partir de las URLs que aparecen en la newsletter.

El catalogo se autoalimenta: cualquier URL de ficha que aparezca en una campana
enviada se da de alta sola. No hay mantenimiento manual.
"""
import re
import unicodedata
import urllib.parse

WEB_HOSTS = {"durancarasso.es", "www.durancarasso.es",
             "durancarasso.com", "www.durancarasso.com"}

# Rutas que son del sitio pero no son fichas de propiedad.
NON_PROPERTY = {"", "contacto", "contact", "blog", "nosotros", "about",
                "oficinas", "servicios", "aviso-legal", "privacidad",
                "politica-de-cookies", "vender", "valoracion"}

ZONAS = {
    "barcelona": "Barcelona", "sitges": "Sitges", "garraf": "Sitges",
    "puigcerda": "Cerdanya", "cerdanya": "Cerdanya", "andorra": "Andorra",
    "escaldes-engordany": "Andorra", "sant-julia-de-loria": "Andorra",
}

_M2 = re.compile(r"(\d+)\s*-?m2")
_HAB = re.compile(r"(\d+)\s*-?(?:hab|habitacion)")


def canonical(url):
    """URL sin protocolo, sin www, sin query (UTMs), sin barra final, en minusculas.

    Es la clave primaria de una propiedad: dos links con UTMs distintas
    apuntando a la misma ficha deben sumar clics juntos.
    """
    if not url:
        return ""
    parsed = urllib.parse.urlsplit(url.strip())
    host = (parsed.netloc or "").lower().removeprefix("www.")
    path = urllib.parse.unquote(parsed.path or "").rstrip("/").lower()
    return f"{host}{path}" if host else path


def is_property_url(url):
    """True si la URL es una ficha de propiedad de la web de Duran Carasso."""
    parsed = urllib.parse.urlsplit(url.strip())
    host = (parsed.netloc or "").lower()
    if host not in WEB_HOSTS:
        return False
    segments = [s for s in urllib.parse.unquote(parsed.path or "").strip("/").lower().split("/") if s]
    if not segments or segments[0] in NON_PROPERTY:
        return False
    # Una ficha siempre tiene al menos ciudad/barrio/slug.
    return len(segments) >= 3


def _deaccent(text):
    return "".join(c for c in unicodedata.normalize("NFD", text)
                   if unicodedata.category(c) != "Mn")


def describe(url):
    """Deriva zona, barrio y datos basicos desde la propia URL de la ficha."""
    parsed = urllib.parse.urlsplit(url.strip())
    segments = [s for s in urllib.parse.unquote(parsed.path or "").strip("/").lower().split("/") if s]
    ciudad = _deaccent(segments[0]) if segments else ""
    barrio = segments[1] if len(segments) > 1 else ""
    slug = segments[-1] if segments else ""

    m2 = _M2.search(slug)
    hab = _HAB.search(slug)
    tipo = "Propiedad"
    for candidate, label in (("piso", "Piso"), ("casa", "Casa"), ("villa", "Villa"),
                             ("atico", "Atico"), ("duplex", "Duplex"),
                             ("chalet", "Chalet"), ("terreno", "Terreno"),
                             ("local", "Local"), ("apartamento", "Apartamento")):
        if slug.startswith(candidate) or f"-{candidate}-" in slug:
            tipo = label
            break

    return {
        "zona": ZONAS.get(ciudad, ciudad.replace("-", " ").title() or "Sin zona"),
        "barrio": barrio.replace("-", " ").title(),
        "tipo": tipo,
        "m2": int(m2.group(1)) if m2 else None,
        "habitaciones": int(hab.group(1)) if hab else None,
        "slug": slug,
    }


def label(prop):
    """Etiqueta legible para el informe."""
    bits = [prop.get("tipo") or "Propiedad"]
    if prop.get("m2"):
        bits.append(f"{prop['m2']} m2")
    zona = " · ".join(x for x in (prop.get("barrio"), prop.get("zona")) if x)
    return f"{' '.join(bits)} — {zona}" if zona else " ".join(bits)

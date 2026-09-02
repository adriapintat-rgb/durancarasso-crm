"""Cliente minimo de la API de Mailchimp (solo stdlib).

La API key se lee de la variable de entorno MAILCHIMP_API_KEY.
Formato de la key: <hash>-<server_prefix>  (ej. abc123...-us8)
El server prefix determina el host: https://<prefix>.api.mailchimp.com/3.0
"""
import base64
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

TIMEOUT = 40
RETRIES = 4


class MailchimpError(RuntimeError):
    pass


def _key():
    key = os.environ.get("MAILCHIMP_API_KEY", "").strip()
    if not key:
        raise MailchimpError(
            "Falta MAILCHIMP_API_KEY. Exportala antes de ejecutar:\n"
            "  export MAILCHIMP_API_KEY='xxxxxxxx-us8'"
        )
    if "-" not in key:
        raise MailchimpError("MAILCHIMP_API_KEY sin sufijo de servidor (falta '-usX').")
    return key


def base_url():
    prefix = _key().rsplit("-", 1)[1]
    return f"https://{prefix}.api.mailchimp.com/3.0"


def get(path, **params):
    """GET a la API. Devuelve dict. Reintenta con backoff exponencial."""
    url = f"{base_url()}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    auth = base64.b64encode(f"anystring:{_key()}".encode()).decode()
    req = urllib.request.Request(url, headers={
        "Authorization": f"Basic {auth}",
        "User-Agent": "durancarasso-newsletter-loop/1.0",
        "Accept": "application/json",
    })
    last = None
    for attempt in range(RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:
            body = exc.read().decode(errors="replace")[:400]
            # 4xx salvo 429 no se reintentan: son errores de configuracion.
            if exc.code != 429 and 400 <= exc.code < 500:
                raise MailchimpError(f"HTTP {exc.code} en {path}: {body}") from exc
            last = MailchimpError(f"HTTP {exc.code} en {path}: {body}")
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last = MailchimpError(f"Red caida en {path}: {exc}")
        if attempt < RETRIES - 1:
            time.sleep(2 ** (attempt + 1))
    raise last


def paginate(path, key, page=500, **params):
    """Recorre un endpoint paginado y devuelve la lista completa."""
    out, offset = [], 0
    while True:
        data = get(path, count=page, offset=offset, **params)
        chunk = data.get(key, [])
        out.extend(chunk)
        offset += len(chunk)
        if len(chunk) < page or offset >= data.get("total_items", 0):
            return out


def ping():
    return get("/ping")

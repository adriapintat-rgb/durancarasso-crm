#!/usr/bin/env python3
"""Descarga de Mailchimp las campanas enviadas y sus clics por URL.

Guarda un JSON por campana en newsletter/data/raw/. Las campanas ya
descargadas no se vuelven a pedir (los informes de una campana enviada
hace mas de 30 dias ya no cambian), asi que la ejecucion semanal es barata.

Uso:  python3 newsletter/scripts/fetch.py [--limit 40] [--refresh]
"""
import argparse
import datetime as dt
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import mc_client
import properties as props

RAW = pathlib.Path(__file__).resolve().parents[1] / "data" / "raw"
FRESH_DAYS = 30  # una campana mas reciente que esto aun acumula clics: refrescar

_HREF = re.compile(r'href=["\']([^"\']+)["\']', re.I)


def slot_order(html):
    """Orden de aparicion de cada ficha en el HTML = slot que ocupo.

    El slot importa: la propiedad destacada siempre gana clics por posicion,
    no por merito. Sin esto el ranking solo mide el orden de la maqueta.
    """
    order, seen = {}, 0
    for href in _HREF.findall(html or ""):
        if not props.is_property_url(href):
            continue
        key = props.canonical(href)
        if key not in order:
            seen += 1
            order[key] = seen
    return order


def _is_fresh(send_time):
    try:
        sent = dt.datetime.fromisoformat(send_time.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return True
    age = dt.datetime.now(dt.timezone.utc) - sent
    return age.days < FRESH_DAYS


def fetch_campaign(cid, meta):
    report = mc_client.get(f"/reports/{cid}")
    clicks = mc_client.paginate(f"/reports/{cid}/click-details", "urls_clicked", page=200)
    try:
        content = mc_client.get(f"/campaigns/{cid}/content", fields="html")
    except mc_client.MailchimpError:
        content = {}
    slots = slot_order(content.get("html", ""))

    links = []
    for row in clicks:
        url = row.get("url", "")
        if not props.is_property_url(url):
            continue
        key = props.canonical(url)
        links.append({
            "url": url,
            "key": key,
            "slot": slots.get(key),
            "clicks": int(row.get("total_clicks") or 0),
            "unique_clicks": int(row.get("unique_clicks") or 0),
        })

    opens = report.get("opens", {}) or {}
    return {
        "id": cid,
        "title": (meta.get("settings") or {}).get("title", ""),
        "subject": (meta.get("settings") or {}).get("subject_line", ""),
        "send_time": meta.get("send_time", ""),
        "emails_sent": int(report.get("emails_sent") or 0),
        "unique_opens": int(opens.get("unique_opens") or 0),
        "open_rate": float(opens.get("open_rate") or 0.0),
        "clicks_total": int((report.get("clicks", {}) or {}).get("clicks_total") or 0),
        "unique_subscriber_clicks": int((report.get("clicks", {}) or {}).get("unique_subscriber_clicks") or 0),
        "slots_detected": len(slots),
        "links": links,
        "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=40, help="campanas enviadas a revisar")
    parser.add_argument("--refresh", action="store_true", help="reescribir todas, ignorando cache")
    args = parser.parse_args()

    RAW.mkdir(parents=True, exist_ok=True)
    campaigns = mc_client.get(
        "/campaigns", count=args.limit, status="sent",
        sort_field="send_time", sort_dir="DESC",
    ).get("campaigns", [])

    nuevas = cacheadas = 0
    for meta in campaigns:
        cid = meta.get("id")
        if not cid:
            continue
        path = RAW / f"{cid}.json"
        if path.exists() and not args.refresh and not _is_fresh(meta.get("send_time", "")):
            cacheadas += 1
            continue
        data = fetch_campaign(cid, meta)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        nuevas += 1
        print(f"  · {data['send_time'][:10]}  {data['subject'][:52]:<52} "
              f"{len(data['links'])} fichas / {data['unique_opens']} aperturas")

    print(f"\n{nuevas} campanas descargadas, {cacheadas} desde cache -> {RAW}")
    if not campaigns:
        print("Aviso: la cuenta no devuelve campanas enviadas.")


if __name__ == "__main__":
    try:
        main()
    except mc_client.MailchimpError as exc:
        sys.exit(f"ERROR Mailchimp: {exc}")

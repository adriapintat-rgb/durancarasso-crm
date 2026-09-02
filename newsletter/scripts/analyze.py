#!/usr/bin/env python3
"""Analisis de engagement por propiedad, corregido por sesgo de posicion.

El CTR crudo no sirve para comparar propiedades: la ficha destacada siempre
gana porque va primera, no porque guste mas. Aqui se mide cada propiedad
contra lo que rinde HISTORICAMENTE su slot, y el resultado (lift) si es
comparable entre propiedades.

    share = clics unicos de la ficha / clics unicos a fichas de esa campana
    lift  = share / share medio historico de ese slot

    lift 1.00 -> rinde exactamente lo esperado para su posicion
    lift 1.40 -> rinde un 40% por encima: la propiedad tira, no el slot
    lift 0.60 -> por debajo: ocupa un buen slot y no lo aprovecha

Uso:  python3 newsletter/scripts/analyze.py [--top 10]
"""
import argparse
import datetime as dt
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import properties as props

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
METRICS = ROOT / "data" / "metrics.json"
REPORTS = ROOT / "reports"

MIN_CAMPAIGNS_FOR_BASELINE = 3   # por debajo, la curva de posicion es provisional
QUARANTINE = 2                   # apariciones antes de juzgar una propiedad nueva
RECENCY = 0.65                   # peso de cada aparicion anterior respecto a la ultima

# Curva de decaimiento por posicion tipica en newsletters de 4 bloques.
# Solo se usa mientras no haya historico propio suficiente.
FALLBACK_CURVE = [0.36, 0.25, 0.21, 0.18]


def load_campaigns():
    out = []
    for path in sorted(RAW.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if data.get("links"):
            out.append(data)
    out.sort(key=lambda c: c.get("send_time", ""))
    return out


def slot_baselines(campaigns):
    """Share medio historico de cada slot. Es la curva de posicion real de la lista."""
    acc = {}
    for camp in campaigns:
        total = sum(link["unique_clicks"] for link in camp["links"]) or 0
        if total <= 0:
            continue
        for link in camp["links"]:
            slot = link.get("slot")
            if slot:
                acc.setdefault(slot, []).append(link["unique_clicks"] / total)

    usable = len(campaigns) >= MIN_CAMPAIGNS_FOR_BASELINE
    baselines, provisional = {}, not usable
    for slot, shares in acc.items():
        if usable and len(shares) >= MIN_CAMPAIGNS_FOR_BASELINE:
            baselines[slot] = sum(shares) / len(shares)
        else:
            provisional = True
            idx = min(slot - 1, len(FALLBACK_CURVE) - 1)
            baselines[slot] = FALLBACK_CURVE[idx]
    return baselines, provisional


def observations(campaigns, baselines):
    """Una observacion por (campana, propiedad) con su lift ya corregido."""
    rows = []
    for camp in campaigns:
        total = sum(link["unique_clicks"] for link in camp["links"])
        if total <= 0:
            continue
        opens = camp.get("unique_opens") or 0
        for link in camp["links"]:
            share = link["unique_clicks"] / total
            slot = link.get("slot")
            base = baselines.get(slot) if slot else None
            rows.append({
                "key": link["key"],
                "url": link["url"],
                "campaign": camp["id"],
                "subject": camp.get("subject", ""),
                "send_time": camp.get("send_time", ""),
                "slot": slot,
                "unique_clicks": link["unique_clicks"],
                "share": round(share, 4),
                "ctr_sobre_aperturas": round(link["unique_clicks"] / opens, 4) if opens else None,
                "lift": round(share / base, 3) if base else None,
            })
    return rows


def aggregate(rows):
    """Agrega por propiedad y clasifica: estrella, solida, quemada, floja, nueva."""
    grouped = {}
    for row in rows:
        grouped.setdefault(row["key"], []).append(row)

    result = []
    for key, obs in grouped.items():
        obs.sort(key=lambda r: r["send_time"])
        lifts = [o["lift"] for o in obs if o["lift"] is not None]

        # Media ponderada por recencia: lo de hace 4 envios pesa menos que lo de ayer.
        score = None
        if lifts:
            weights = [RECENCY ** i for i in range(len(lifts) - 1, -1, -1)]
            score = sum(l * w for l, w in zip(lifts, weights)) / sum(weights)

        tendencia = round(lifts[-1] - lifts[-2], 3) if len(lifts) >= 2 else None
        quemada = (
            len(lifts) >= 3
            and lifts[-1] < lifts[-2] < lifts[-3]
            and lifts[-1] < 0.9
        )

        apariciones = len(obs)
        if apariciones < QUARANTINE:
            estado = "nueva"
        elif quemada:
            estado = "quemada"
        elif score is None:
            estado = "sin datos"
        elif score >= 1.25:
            estado = "estrella"
        elif score >= 0.90:
            estado = "solida"
        elif score >= 0.70:
            estado = "floja"
        else:
            estado = "descartar"

        info = props.describe(obs[-1]["url"])
        result.append({
            "key": key,
            "url": obs[-1]["url"],
            "nombre": props.label(info),
            **info,
            "apariciones": apariciones,
            "ultima_aparicion": obs[-1]["send_time"][:10],
            "ultimo_slot": obs[-1]["slot"],
            "clics_unicos_total": sum(o["unique_clicks"] for o in obs),
            "score": round(score, 3) if score is not None else None,
            "tendencia": tendencia,
            "estado": estado,
            "historial": [
                {"fecha": o["send_time"][:10], "slot": o["slot"],
                 "clics": o["unique_clicks"], "share": o["share"], "lift": o["lift"]}
                for o in obs
            ],
        })

    result.sort(key=lambda p: (p["score"] is None, -(p["score"] or 0)))
    return result


def recommend(properties, campaigns, slots=4):
    """Seleccion propuesta para el proximo envio.

    Reglas: la destacada es la de mejor score que no salio en el ultimo envio;
    nunca se repite una quemada; se reserva un hueco a una propiedad nueva
    para seguir alimentando el modelo.
    """
    ultima = campaigns[-1]["links"] if campaigns else []
    salio_ultima = {link["key"] for link in ultima}

    elegibles = [p for p in properties if p["estado"] not in ("quemada", "descartar")]
    frescas = [p for p in elegibles if p["key"] not in salio_ultima]
    pool = frescas or elegibles

    seleccion, usadas = [], set()

    def take(candidates, motivo):
        for cand in candidates:
            if cand["key"] not in usadas:
                usadas.add(cand["key"])
                seleccion.append({**cand, "motivo": motivo})
                return True
        return False

    ranked = [p for p in pool if p["score"] is not None]
    ranked.sort(key=lambda p: -p["score"])
    nuevas = [p for p in pool if p["estado"] == "nueva"]

    take(ranked, "Mejor lift historico: rinde por encima de su posicion")
    take([p for p in ranked if p["estado"] == "estrella"], "Estrella confirmada")
    take(nuevas, "Sin historico suficiente: se mide en este envio")
    while len(seleccion) < slots:
        if not take(ranked + nuevas, "Rota para refrescar la seleccion"):
            break
    return seleccion[:slots]


def report_md(data):
    """Informe en markdown para leer el miercoles por la manana."""
    L = []
    add = L.append
    add(f"# Engagement newsletter · {data['generado']}\n")

    if data["provisional"]:
        add("> **Curva de posicion provisional.** Con menos de "
            f"{MIN_CAMPAIGNS_FOR_BASELINE} campanas se usa una curva estandar. "
            "Los lifts son orientativos hasta acumular mas envios.\n")

    add("## Resumen\n")
    add(f"- Campanas analizadas: **{data['campanas']}**")
    add(f"- Propiedades con historico: **{len(data['propiedades'])}**")
    if data["ultima_campana"]:
        u = data["ultima_campana"]
        add(f"- Ultimo envio: *{u['subject']}* ({u['send_time'][:10]}) · "
            f"{u['emails_sent']} envios · {u['open_rate']*100:.1f}% aperturas · "
            f"{u['unique_subscriber_clicks']} clics unicos")
    add("")

    def tabla(rows, titulo, nota):
        add(f"## {titulo}\n")
        add(f"*{nota}*\n")
        if not rows:
            add("_Sin datos todavia._\n")
            return
        add("| Propiedad | Lift | Tend. | Aparic. | Ultimo slot | Clics |")
        add("|---|---|---|---|---|---|")
        for p in rows:
            lift = f"**{p['score']:.2f}**" if p["score"] is not None else "—"
            tend = "—" if p["tendencia"] is None else (
                f"↑ +{p['tendencia']:.2f}" if p["tendencia"] > 0.05 else
                f"↓ {p['tendencia']:.2f}" if p["tendencia"] < -0.05 else "→")
            add(f"| {p['nombre']} | {lift} | {tend} | {p['apariciones']} | "
                f"{p['ultimo_slot'] or '—'} | {p['clics_unicos_total']} |")
        add("")

    props_ = data["propiedades"]
    tabla([p for p in props_ if p["estado"] in ("estrella", "solida")][:8],
          "Lo que funciona",
          "Lift > 1 = genera mas clics de los que le tocarian por posicion.")
    tabla([p for p in props_ if p["estado"] == "quemada"],
          "Quemadas — sacar de la rotacion",
          "Tres envios consecutivos a la baja. La lista ya las ha visto.")
    tabla([p for p in props_ if p["estado"] in ("floja", "descartar")][:6],
          "Bajo rendimiento",
          "Ocupan un slot que rendiria mas con otra ficha. Revisar foto, copy o precio.")
    tabla([p for p in props_ if p["estado"] == "nueva"],
          "En observacion",
          f"Menos de {QUARANTINE} apariciones: aun no hay datos para juzgarlas.")

    add("## Seleccion propuesta para el proximo envio\n")
    if not data["recomendacion"]:
        add("_Sin datos suficientes para recomendar._\n")
    else:
        for i, p in enumerate(data["recomendacion"], 1):
            marca = "★ DESTACADA" if i == 1 else f"Slot {i}"
            lift = f" · lift {p['score']:.2f}" if p["score"] is not None else " · sin historico"
            add(f"**{marca} — {p['nombre']}**  ")
            add(f"{p['motivo']}{lift}  ")
            add(f"`{p['url']}`\n")
    return "\n".join(L)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--slots", type=int, default=4, help="propiedades por newsletter")
    args = parser.parse_args()

    campaigns = load_campaigns()
    if not campaigns:
        sys.exit("No hay campanas en data/raw/. Ejecuta antes: python3 newsletter/scripts/fetch.py")

    baselines, provisional = slot_baselines(campaigns)
    rows = observations(campaigns, baselines)
    properties = aggregate(rows)
    last = campaigns[-1]

    data = {
        "generado": dt.date.today().isoformat(),
        "campanas": len(campaigns),
        "provisional": provisional,
        "curva_posicion": {str(k): round(v, 4) for k, v in sorted(baselines.items())},
        "ultima_campana": {
            "subject": last.get("subject", ""), "send_time": last.get("send_time", ""),
            "emails_sent": last.get("emails_sent", 0), "open_rate": last.get("open_rate", 0.0),
            "unique_subscriber_clicks": last.get("unique_subscriber_clicks", 0),
        },
        "propiedades": properties,
        "recomendacion": recommend(properties, campaigns, args.slots),
    }

    METRICS.parent.mkdir(parents=True, exist_ok=True)
    METRICS.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    REPORTS.mkdir(parents=True, exist_ok=True)
    out = REPORTS / f"{data['generado']}.md"
    out.write_text(report_md(data), encoding="utf-8")

    print(f"{len(properties)} propiedades sobre {len(campaigns)} campanas")
    print(f"metricas -> {METRICS}")
    print(f"informe  -> {out}")


if __name__ == "__main__":
    main()

# Content Engine · Instagram Duran Carasso

Motor de contenido: genera el plan semanal de IG, lo deja en una cola y tú apruebas.

## Uso

1. Rellena `data/propiedades.json` con tu cartera real y `data/mercado.json` con datos del CRM.
2. Pide a Claude: **"genera el plan de la semana"**.
3. Abre `cola.html` en el navegador: 7 piezas con copy final, hashtags y brief visual.
4. Copia y publica, o aprueba y deja que Make lo publique vía Instagram Graph API.

## Estructura

```
data/propiedades.json   cartera disponible
data/mercado.json       datos de mercado propios (F2/F4)
output/cola.json        plan generado
cola.html               panel de aprobación
```

El playbook de formatos, hooks y reglas de copy vive en
`.claude/skills/content-engine/SKILL.md`.

## Regla

El motor **nunca inventa** un precio ni un dato de mercado. Si falta, deja `{{DATO}}`.

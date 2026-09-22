# Publicador de Instagram — Duran Carasso (gratis)

Publica y agenda carruseles en Instagram desde el Carrusel Studio, sin coste de API.
Piezas: **Instagram Graph API** (gratis) + **Cloudflare Worker** (plan gratis) que aloja
las imágenes y publica. El agendado lo dispara un **cron gratis** cada 5 minutos.

## Qué hace falta de ti (una vez)

### 1. Cuenta de Instagram
- Instagram en modo **Business** (o Creator) **vinculado a una Página de Facebook**.
- Anota el **@usuario**.

### 2. App de Meta + token (gratis)
1. Entra en https://developers.facebook.com/ → **My Apps → Create App** → tipo *Business*.
2. Añade el producto **Instagram Graph API**.
3. En **Graph API Explorer** genera un token con permisos:
   `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`.
4. Conviértelo en **token de larga duración** (60 días) — o usa un *System User token* (no caduca).
5. Consigue el **IG_USER_ID** (id de la cuenta de Instagram Business):
   `GET /me/accounts` → coge el Page id → `GET /{page-id}?fields=instagram_business_account`.

### 3. Cloudflare (gratis)
1. Crea cuenta en https://dash.cloudflare.com/ e instala Node.
2. En esta carpeta:
   ```bash
   npm i -g wrangler
   wrangler login
   wrangler kv namespace create MEDIA
   wrangler kv namespace create JOBS
   ```
   Copia los dos `id` que devuelve dentro de `wrangler.toml`.
3. Pon tu `IG_USER_ID` en `wrangler.toml` ([vars]).
4. Guarda los secretos:
   ```bash
   wrangler secret put IG_TOKEN     # pega el token de larga duración
   wrangler secret put APP_SECRET   # inventa una contraseña larga (la usará la app)
   ```
5. Despliega:
   ```bash
   wrangler deploy
   ```
   Te dará una URL tipo `https://dc-publicador.<tu>.workers.dev`.

### 4. Conectar la app
En el Carrusel Studio → sección **Publicar** → **⚙ Conectar publicador**:
pega la **URL del Worker** y el **APP_SECRET**. Listo: botones *Publicar ahora* y *Agendar*.

> Nota: la publicación funciona en la **versión alojada** de la app, no dentro de la
> preview de Claude (su red está bloqueada por seguridad).

## Alojar la app gratis (GitHub Pages)
El repo ya es vuestro, así que lo más fácil y gratis:
1. GitHub → repo `durancarasso-crm` → **Settings → Pages**.
2. *Build and deployment* → **Deploy from a branch** → rama `main` (o la de trabajo) → carpeta `/root` → Save.
3. En 1-2 min tendrás la app en
   `https://adriapintat-rgb.github.io/durancarasso-crm/carrusel-dc.html`
   — ahí el botón **Publicar** sí funciona (sin límites de red).

## Endpoints
- `GET /health` — comprobar que vive.
- `POST /publish` — `{images:[{b64,ct}], caption, when?}` (`when` = fecha ms para agendar).
- `GET /jobs` — historial + agendados (para el calendario).
- `POST /jobs/cancel` — `{id}` cancela un agendado.

## Coste
0 €. Cloudflare Workers free: 100k req/día. Instagram Graph API: gratis.

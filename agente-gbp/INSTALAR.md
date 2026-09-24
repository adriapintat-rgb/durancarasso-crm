# Instalar el Agente Google (unos 25 min, sin programar)

Necesitas 3 archivos de la carpeta `agente-gbp/instalar/`: `Codigo.gs`, `Pagina.html` y `appsscript.json`.

## Paso 1 · Clave de Google (10 min)
1. Entra en **console.cloud.google.com** con la cuenta de Google de la empresa.
2. Arriba, en el selector de proyectos, pulsa **Proyecto nuevo** → nombre `Agente Google DC` → **Crear**, y selecciónalo.
3. Menú ☰ → **APIs y servicios → Biblioteca**. Busca y pulsa **Habilitar** en:
   - **Places API (New)**
   - **PageSpeed Insights API**
4. Menú ☰ → **APIs y servicios → Credenciales → + Crear credenciales → Clave de API**. Copia la clave (empieza por `AIza…`).
5. Si te pide facturación, añade la tarjeta. Con este uso no se pasa del crédito gratuito mensual.

## Paso 2 · Clave de Anthropic (5 min)
1. Entra en **console.anthropic.com** y crea la cuenta.
2. **Settings → Billing**: añade una tarjeta y carga **10 €** (dan para unos 2-3 meses).
3. **API Keys → Create Key** → nombre `Agente Google DC`. Copia la clave (empieza por `sk-ant-…`).

> No envíes las claves por email ni por chat. Van solo en el paso 4.

## Paso 3 · Pegar el agente en la hoja del CRM (5 min)
1. Abre la hoja de Google del CRM → **Extensiones → Apps Script**.
2. Borra lo que haya en `Código.gs` y pega **todo** `instalar/Codigo.gs` → 💾 Guardar.
3. Pulsa **+ → HTML**, nómbralo exactamente `Pagina` y pega `instalar/Pagina.html` → 💾.
4. Pulsa ⚙️ **Configuración del proyecto** y marca **"Mostrar el archivo de manifiesto appsscript.json"**. Vuelve al editor, abre `appsscript.json`, sustituye su contenido por `instalar/appsscript.json` → 💾.
5. Arriba a la derecha: **Implementar → Nueva implementación** → ⚙️ tipo **Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
   - **Implementar** → **Autorizar acceso** → elige tu cuenta → *Configuración avanzada* → *Ir a Agente (no seguro)* → **Permitir**.
   - Copia la **URL que termina en /exec**. La usarás en el paso 4.

## Paso 4 · Configurar con el menú (5 min)
1. Vuelve a la hoja y **recarga la página**. Aparece el menú **🤖 Agente Google**.
2. **1 · Configurar claves** → pega la clave de Anthropic, luego la de Google y deja vacío el email para usar adriap@durancarasso.com.
3. Aparece el diagnóstico. Si en **"Botones del email"** sale ❌:
   - Ve a Apps Script → ⚙️ **Configuración del proyecto → Propiedades del script → Añadir propiedad**.
   - Nombre `WEBAPP_URL`, valor la URL `/exec` del paso 3.5.
   - Vuelve a pulsar **2 · Comprobar que todo funciona**.
4. Comprueba que las 4 fichas (Barcelona, Sitges, Cerdanya, Andorra) son las nuestras. Si alguna no lo es, avísame.
5. **3 · Activar agente**.
6. **4 · Enviar informe ahora**. En 2-4 minutos te llega el primer email real.

## Después (opcional) · Nivel 2: que publique solo en Google
1. El propietario del Perfil de Empresa pide acceso a la Business Profile API. Busca en Google "Business Profile API access request" y usa el proyecto del paso 1.
2. Cuando Google lo apruebe (unos días), avisa y lo activamos en 5 minutos.

## Si algo falla
Pulsa **🤖 Agente Google → 2 · Comprobar que todo funciona**. Te dice qué falta y cómo arreglarlo. Si no se soluciona, hazle una captura y envíamela.

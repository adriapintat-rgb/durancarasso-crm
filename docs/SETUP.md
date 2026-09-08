# DC · Personas — Puesta en marcha

Suite de RRHH propia: fichaje, ausencias, horarios, equipo, estadísticas, tareas y documentos.
Frontend en un solo `personas.html`. Backend en Google Apps Script sobre Google Sheets.
Coste: 0 €.

---

## Probarlo ahora mismo (modo demo)

Abre `personas.html` en el navegador. Arranca en **modo demo** con datos locales:

- Cualquier empleado → PIN **1234**
- Dirección (Adrià Pintat) → PIN **0000**

Todo funciona (fichar, pedir vacaciones, validar, informes) guardando en el navegador.
En cuanto rellenes `SCRIPT_URL` el modo demo se desactiva solo.

---

## Instalación real (20 minutos)

### 1. Crear la hoja de cálculo

1. Crea una hoja nueva en Google Sheets: **DC Personas**.
2. Copia su ID de la URL: `docs.google.com/spreadsheets/d/`**`ESTE_ES_EL_ID`**`/edit`.

### 2. Desplegar el backend

1. En la hoja: **Extensiones → Apps Script**.
2. Borra el contenido y pega `apps-script/Codigo.gs` completo.
3. **Configuración del proyecto → Propiedades del script → Añadir propiedad**:
   - `SHEET_ID` = el ID del paso 1
   - `SECRET` = una cadena larga aleatoria cualquiera (firma los tokens de sesión)
4. Selecciona la función `setupInicial` y pulsa **Ejecutar**. Acepta los permisos.
   Se crean todas las hojas con sus cabeceras.
5. **Implementar → Nueva implementación → Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
   - Copia la URL que termina en `/exec`.

### 3. Conectar el frontend

En `personas.html`, línea ~12:

```js
var SCRIPT_URL = 'https://script.google.com/macros/s/AKfy.../exec';
```

### 4. Cargar la plantilla

En la hoja **Empleados**, una fila por persona:

| nombre | email | pin | rol | departamento | oficina | horario_id | fecha_alta | vacaciones_anuales | activo |
|---|---|---|---|---|---|---|---|---|---|
| Alex Sellés | aselles@durancarasso.com | 4821 | EMPLEADO | Comercial | Sitges | STD | 2021-03-01 | 23 | SI |
| Adrià Pintat | adriapintat@durancarasso.com | 6921 | DIRECCION | Marketing | Barcelona | STD | 2022-01-10 | 23 | SI |

- `rol`: `EMPLEADO` o `DIRECCION` (dirección ve validaciones, incidencias, informes y plantilla).
- `activo`: `SI` / `NO`. Una baja se marca `NO`, nunca se borra la fila.
- Los PIN solo viven en esta hoja. **Nunca** llegan al navegador.

### 5. Horarios y festivos

**Horarios** ya trae `STD` (09:00-18:00 L-J, 09:00-15:00 V) e `INT` (intensiva).
Formato de cada día: `HH:MM-HH:MM`, vacío = descanso. `pausa_min` se descuenta del cómputo.

**Festivos**: una fila por festivo con `fecha` en formato `YYYY-MM-DD`.
Carga los nacionales, los autonómicos y los locales de cada centro.

### 6. Publicar

Sube `personas.html` donde tengas el CRM actual (GitHub Pages, Drive, tu hosting).
Desde el móvil: **Compartir → Añadir a pantalla de inicio**. Funciona como una app.

---

## Estructura de datos

| Hoja | Qué guarda | Escritura |
|---|---|---|
| `Empleados` | Plantilla, PIN, rol, horario, saldo de vacaciones | Manual / alta desde la app |
| `Fichajes` | Registro de jornada con cadena de hashes | **Append-only, nunca editar** |
| `Ausencias` | Solicitudes y su validación | App |
| `Horarios` | Jornadas teóricas | Manual |
| `Festivos` | Calendario laboral | Manual |
| `Tareas` | Imputación de tiempo | App |
| `Documentos` | Documentos compartidos y su firma | App / manual |
| `Auditoria` | Accesos, validaciones y correcciones | Automática |
| `Turnos` | Jornadas asignadas por periodo | App |
| `Centros` | Geovallas de los centros de trabajo | App |
| `Compensaciones` | Movimientos de la bolsa de horas | App |
| `Objetivos` | Metas individuales y su valoración | App |
| `Evaluaciones` | Campañas de desempeño | App |
| `Encuestas` / `Respuestas` | Clima laboral | App |
| `Publicaciones` | Tablón interno | App |
| `Vacantes` / `Candidatos` | Reclutamiento | App |
| `Checklists` | Onboarding y offboarding | App |

### Por qué no se editan los fichajes a mano

Cada fila de `Fichajes` guarda `hash = SHA256(hash_anterior + id + ts + trabajador + tipo)`.
Editar una celda rompe la cadena y **Dirección → Incidencias → Verificar integridad**
señala exactamente qué fila se tocó. Esto es lo que convierte el registro en prueba válida
ante Inspección de Trabajo.

Si hay un error real: **Dirección → Incidencias → Corregir**. Añade un registro nuevo con
motivo y autor, dejando el original intacto.

---

## Operativa diaria

**Empleado**
1. Abre la app, PIN, **Entrar**.
2. **Pausa** / **Reanudar** en la comida.
3. **Salir** al terminar.
4. Vacaciones: *Mis ausencias → + Solicitar ausencia*.

**Dirección**
- *Validaciones*: aprobar o denegar. El empleado recibe email automático.
- *Incidencias*: cada lunes, revisar jornadas sin salida o superiores a 9 h.
- *Informes*: rango + persona → CSV para la gestoría, o Imprimir/PDF.

---

## Ajustes opcionales

En **Configuración del proyecto → Propiedades del script**:

| Propiedad | Para qué |
|---|---|
| `EXIGIR_CENTRO` | `SI` impide fichar fuera de un centro de la hoja `Centros`. Por defecto `NO` |
| `API_KEY` | Clave de la API de lectura. Se genera sola en `setupInicial` |
| `LIMITE_ARRASTRE` | Hasta cuándo se pueden gastar los días del año anterior. Formato `MM-DD`, por defecto `03-31` |
| `CLAVE_ACCESO` | Si la rellenas, la pantalla de acceso pide esta clave antes de mostrar la plantilla |
| `CARPETA_JUSTIFICANTES` | Carpeta de Drive donde se guardan los certificados. Se crea sola |

## Seguridad

- **El PIN nunca se guarda en claro.** Se almacena como SHA-256 con sal. Los PIN que
  escribas a mano en la hoja se convierten en hash la primera vez que la persona entra.
- **Bloqueo por intentos**: 5 fallos seguidos bloquean el acceso 15 minutos. Dirección
  puede levantarlo desde *Plantilla → PIN*.
- **Cifrado y control de acceso**: los datos viven en tu Google Sheet. Google los cifra
  en reposo y en tránsito, y solo entra quien tenga permiso sobre ese archivo. Comparte
  la hoja únicamente con las cuentas de dirección.
- **Registro de auditoría**: cada acceso, validación, corrección y edición de ficha queda
  en la hoja `Auditoria`, visible en *Dirección → Auditoría* y exportable a CSV.

## Tipos de ausencia y cupos

La hoja `TiposAusencia` define cuántos días da cada tipo y cómo se controla. Se edita
desde *Dirección → Tipos de ausencia*:

| Columna | Qué hace |
|---|---|
| `dias_anuales` | Cupo del año. En Vacaciones manda el valor de la ficha de cada persona |
| `cuenta_saldo` | `SI` descuenta de un cupo y bloquea la solicitud si no quedan días |
| `requiere_justificante` | `SI` obliga a adjuntar un archivo al solicitar |
| `arrastrable` | `SI` pasa los días sobrantes al año siguiente, y se gastan antes que los nuevos |

Cupos de partida: Vacaciones 23 · Asuntos propios 4 · Navidad 24 y 31, uno cada uno ·
Tarde de cumpleaños 1.

**Calendario**: cada persona obtiene su enlace en *Mi perfil → Calendario*. Es un feed iCal
de solo lectura con sus ausencias aprobadas; Outlook y Google Calendar lo aceptan como
calendario por suscripción y se actualiza solo. No necesita ninguna integración.

**API de lectura** (para Power BI, Looker Studio o un script propio):
`https://…/exec?api=TU_CLAVE&recurso=fichajes` — recursos válidos: `fichajes`,
`ausencias`, `empleados` (sin PIN) y `tareas`.

**Quiosco**: en *Dirección → Quiosco / QR*, «Activar modo quiosco» convierte una tablet
en punto de fichaje compartido: cada persona toca su nombre, mete su PIN y ficha, sin
dejar sesión abierta. El QR de la misma pantalla se imprime para recepción.

**Coste por proyecto**: rellena la columna `coste_hora` en la hoja `Empleados` para que
Analytics calcule el coste real de cada proyecto.

## Notas técnicas

- **Sesión**: 12 h, token firmado con HMAC-SHA256 en servidor.
- **Offline**: si falla la red al fichar, el registro queda en cola local y se envía al volver
  la conexión o al reabrir la app. Aviso visible en la cabecera.
- **Geolocalización**: se pide al fichar; si el usuario la deniega, el fichaje se registra igual.
  Para desactivarla del todo, elimina el bloque `navigator.geolocation` de `fichar()`.
- **CORS**: se usa `Content-Type: text/plain` a propósito, para evitar el preflight que
  Apps Script no responde.
- **Concurrencia**: `LockService` serializa las escrituras de fichaje.

## Límites conocidos

- Google Sheets rinde bien hasta ~50.000 filas de fichajes (≈ 5 años con 33 personas).
  Al llegar ahí, archivar por año o migrar a Supabase/Postgres.
- La firma de documentos es un **acuse de recepción con sello temporal**, no una firma
  electrónica cualificada eIDAS.
- Apps Script tiene cuota de 20.000 llamadas/día: sobra para 33 personas.

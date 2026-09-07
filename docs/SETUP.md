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

# Durán Carasso · Personas

Suite de recursos humanos propia: registro de jornada, ausencias, turnos, talento
y analítica de plantilla. Sustituye a Sesame HR con coste de licencia cero.

```
personas.html          La aplicación. Un solo archivo, sin build ni dependencias.
apps-script/Codigo.gs  El backend, sobre Google Sheets.
manifest.json · sw.js  Instalación como app en el móvil.
test/e2e.mjs           Pruebas de extremo a extremo sobre Chromium.
docs/                  Instalación, análisis de Sesame y widget para el CRM.
index.html             El CRM comercial que ya existía. Intacto.
```

## Probarlo sin instalar nada

Abre `personas.html` en el navegador. Arranca en **modo demo** con datos locales:
`Admin de pruebas` con PIN `0000`, `Empleado de pruebas` con PIN `1234`.
Nada sale del navegador. Al rellenar `SCRIPT_URL` el modo demo se apaga solo.

## Ponerlo en producción

Todo el procedimiento está en **[docs/SETUP.md](docs/SETUP.md)**: crear la hoja,
desplegar el Apps Script, cargar la plantilla y activar los automatismos.

## Roles

| Rol | Puede |
|---|---|
| **Empleado** | Fichar, pedir ausencias, ver sus horarios y el estado del equipo |
| **Manager** | Además validar ausencias, corregir incidencias, planificar turnos y descargar informes |
| **Administrador** | Además configurar la empresa, gestionar la plantilla y ver la auditoría |

La aplicación se divide en dos espacios: **Mi espacio**, que ve todo el mundo, y
**Gestión**, que aparece a partir de manager. El conmutador está en la cabecera.

## Qué hace

**Mi espacio** — Fichaje con contador en vivo, pausas por tipo de descanso y
modalidad detectada por ubicación · historial semanal contra la jornada teórica ·
vacaciones y permisos con justificante adjunto · horarios y festivos ·
imputación de tiempo a proyectos · tablón · perfil con cambio de PIN.

**Gestión** — Validación de ausencias · incidencias y correcciones trazables ·
planificador de turnos · informes en CSV y PDF · plantilla · analítica · quiosco
y QR · auditoría · configuración completa de la empresa.

## Configuración

Todo lo que define cómo funciona la empresa se edita desde la aplicación, sin
tocar la hoja de cálculo:

- **Empresa** — datos fiscales, logotipo, moneda, industria y convenio, jornada
  por defecto, correo al que llegan las peticiones de corrección
- **Centros** — direcciones geolocalizadas con radio, país y región
- **Roles y accesos** — qué puede hacer cada rol y quién es qué
- **Horarios** — jornadas por día, tipo y pausa; **Descansos** — comida, café…
- **Festivos** — importación automática de los oficiales por país y región, más
  los locales a mano
- **Vacaciones** — días por convenio y reglas de prorrateo y arrastre
- **Ausencias** — tipos, cupos, justificante obligatorio y arrastre

**Solo** — Recordatorio a quien no fichó la salida, cierre automático de la
jornada, copia de seguridad diaria, aviso semanal de pendientes, envío mensual
del registro a la gestoría y archivo trimestral sellado.

## Cómo cumple el registro de jornada

- **Nada se edita ni se borra.** Una corrección es un registro nuevo con su motivo
  y su autor. El original permanece.
- **Cadena de sellos SHA-256.** Cada fichaje encadena el hash del anterior. Tocar
  una celda en la hoja rompe la cadena, y *Verificar integridad* señala la fila.
- **Auditoría** de accesos, validaciones, correcciones y cambios de ficha.
- **Exportación inmediata** a CSV y PDF, por rango y persona.
- **Conservación** indefinida en Google Sheets, por encima de los 4 años exigidos.

Base legal: art. 34.9 del Estatuto de los Trabajadores (RD-ley 8/2019) y el
reglamento de registro digital en tramitación, que exige sistemas inalterables,
trazables y accesibles en remoto.

## Pruebas

```bash
node test/e2e.mjs
```

Levanta la app en Chromium y recorre los flujos reales: acceso, PIN erróneo, las
30 secciones, fichaje, contador en vivo, cupos de ausencia, arrastre entre años,
validación, firma de documentos, auditoría, administración y vista móvil.
Devuelve código 1 si algo falla.

## Decisiones de diseño

**Google Sheets como base de datos.** Para 33 personas rinde de sobra, ya está
pagado dentro de Workspace, lo respalda Google y cualquiera del equipo puede leer
los datos sin pedir permiso a nadie. A partir de ~50.000 filas de fichajes
(unos cinco años) tocará archivar por año o migrar a Postgres.

**Un solo archivo HTML sin build.** No hay npm, ni bundler, ni pipeline que
mantener. Se edita, se sube y está desplegado. La contrapartida es un archivo
grande; se compensa con secciones separadas y comentadas.

**El PIN nunca viaja en claro ni se guarda en claro.** Se valida en servidor
contra un SHA-256 con sal. Cinco fallos bloquean quince minutos.

**Sin integraciones que dependan de terceros.** La sincronización de calendario
se resuelve con un feed iCal estándar y la analítica externa con un endpoint de
lectura. Ni OAuth, ni claves de API ajenas, ni nada que se rompa cuando otro
cambie su producto.

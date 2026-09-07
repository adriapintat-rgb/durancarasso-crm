# Análisis de Sesame HR y plan de réplica

> Documento base para **DC · Personas**, la plataforma propia de Durán Carasso.
> Fecha de análisis: septiembre 2026.

---

## 1. Qué es Sesame

Sesame HR (`app.sesametime.com`) es una suite de RRHH española, no solo un reloj de fichar.
Cubre el ciclo completo del empleado: reclutamiento → onboarding → jornada diaria →
evaluación → salida. Se vende por módulos contratables por separado.

**Estructura del portal del empleado** (confirmada en las capturas aportadas):

| Sección | Contenido |
|---|---|
| Portal | Panel de inicio del empleado |
| Mis fichajes | Entradas/salidas, historial, corrección de fichajes |
| Mis ausencias | Vacaciones, permisos, bajas + calendario anual |
| Mis tareas | Imputación de tiempo a proyectos y tareas |
| Mis horarios | Turno asignado, jornada teórica |
| Mis documentos | Nóminas, contratos, documentación laboral |
| Equipo | «Who's in»: quién trabaja ahora, en remoto o descansando |
| Estadísticas | Horas trabajadas, extras, bolsa de horas |
| Apps externas | Integraciones |
| Perfil | Datos personales |
| Mis objetivos | Objetivos individuales y valoraciones |

**Barra superior permanente**: contador en vivo `0h 25min / 07:34:18` + botones **Pausa** y **Salir**.
Es el elemento más usado de todo el producto: el fichaje nunca queda a más de un clic.

**Pantalla de Ausencias**: 3 KPIs (días disponibles / consumidos / totales) + calendario de
12 meses con los días coloreados por tipo + lista lateral de tipos de ausencia
(Permiso retribuido, Baja IT, Permiso Navidad 24, Permiso Navidad 31) + sincronización
con Google Calendar y Outlook + botón «+ Solicitar».

---

## 2. Inventario completo de funcionalidades

### 2.1 Control horario
- Fichaje desde **app móvil, web, QR, quiosco (tablet compartida) y geolocalización**.
- Geovallas para limitar el fichaje a un centro de trabajo concreto.
- Estados en tiempo real: activo / pausa / remoto / inactivo.
- Gestión de turnos, horarios flexibles, horas extra y pausas.
- **Bolsa de horas**: horas reales, extras, compensadas en días libres, compensadas
  económicamente y saldo total.
- Informes: registro diario, historial de solicitudes, tipo de registro, balance de horas.
- Modificación de fichajes con trazabilidad.

### 2.2 Ausencias y vacaciones
- Solicitud y aprobación digital de vacaciones, permisos y bajas.
- Calendario de ausencias con visibilidad por equipos.
- Saldos automáticos por año natural.
- Validaciones jerárquicas y notificaciones.

### 2.3 Personas y documentos
- Gestor documental: justificantes, documentos laborales, nóminas, tickets.
- Compartición segura con el empleado.
- Firma electrónica (avanzada y centralizada en el plan Enterprise).
- Expediente digital y multiempresa.

### 2.4 Talento
- **ATS / reclutamiento**: publicar vacantes, tablero visual de candidatos
  (5 ofertas en Starter → ilimitadas en Enterprise).
- **Onboarding / offboarding** por checklists y seguimiento de tareas.
- **Evaluación de desempeño**: evaluaciones periódicas personalizables por rol,
  departamento o persona; competencias, niveles, fechas límite, panel consolidado.
- **Encuestas de clima** tipo formulario, preguntas predefinidas o propias.
- **Objetivos**: registro individual y valoración por managers.

### 2.5 Operativa
- Tareas y proyectos con imputación de tiempo y rentabilidad por proyecto.
- Comunicación interna: publicaciones y notificaciones.
- People analytics (plan Professional en adelante).
- SSO, API y OAuth (solo Enterprise).

---

## 3. Precios (2026)

| Plan | Precio | Mínimo mensual |
|---|---|---|
| Starter | ~5,50 €/persona/mes | ~82,50 € (15 personas) |
| Professional | ~6,25 €/persona/mes | ~93,75 € |
| Enterprise | ~8,00 €/persona/mes | ~120 € |

Add-on IA de turnos: desde ~49 €/mes. Prueba gratuita de 14 días.

**Coste estimado para Durán Carasso (33 personas):**

| Escenario | Coste anual |
|---|---|
| Sesame Starter | ~2.180 € |
| Sesame Professional | ~2.475 € |
| Sesame Enterprise | ~3.170 € |
| **DC · Personas (esta plataforma)** | **0 €** (Google Workspace ya contratado) |

---

## 4. Debilidades detectadas (y cómo las evitamos)

| Queja recurrente de usuarios de Sesame | Qué hacemos en DC · Personas |
|---|---|
| Inestabilidad de la app móvil de fichaje | Web app sin instalación + **cola offline**: si falla la red el fichaje se guarda local y se reenvía solo |
| Configuración inicial tediosa (muchos grupos y subgrupos) | Configuración en una hoja de cálculo: `Empleados`, `Horarios`, `Festivos`. Nada más |
| Integraciones limitadas | Los datos viven en **tu** Google Sheet: cualquier herramienta puede leerlos |
| Soporte lento | Código propio, se cambia en minutos |
| Módulos «en desarrollo» | Alcance acotado a lo que la empresa usa de verdad |
| Coste por persona creciente | Coste fijo cero |

---

## 5. Marco legal (España)

**Vigente hoy** — art. 34.9 ET, RD-ley 8/2019:
- Registro diario con **hora exacta de inicio y fin** de cada trabajador.
- **Conservación 4 años**.
- A disposición de la persona trabajadora, la representación sindical y la Inspección.
- El formato no está impuesto: vale papel, hoja de cálculo o sistema digital, si es fiable.

**Reforma en tramitación** (acordada en septiembre de 2026, aún sin publicarse en el BOE;
el Consejo de Estado emitió dictamen crítico y obligó a revisar el texto). Exigirá:
- Registro **exclusivamente digital**.
- Sistemas **inalterables y trazables**: toda modificación deja rastro de quién, cuándo y por qué.
- **Acceso remoto de la Inspección de Trabajo**.

**Cómo lo cubre DC · Personas:**
1. **Append-only**: un fichaje nunca se edita ni se borra. Una corrección es un registro
   nuevo con motivo y autor.
2. **Cadena de sellos SHA-256**: cada fichaje encadena el hash del anterior. Si alguien
   toca una fila directamente en la hoja, `Verificar integridad` lo detecta y señala la fila.
3. **Hoja de auditoría** con todos los accesos, validaciones y correcciones.
4. **Export CSV/PDF** por rango y persona para entregar a Inspección o a la gestoría.
5. Los datos se conservan indefinidamente en Google Sheets (>4 años).

**RGPD y geolocalización**: la captura de coordenadas es *opcional* y solo se activa si el
navegador da permiso. Para plantilla de oficina la recomendación es no usarla; para perfiles
de movilidad real hay que informar previamente y justificar la base legal.

---

## 6. Qué replicamos y qué no

### Incluido en la v1 (`personas.html`)
- Portal del empleado con estado en vivo
- Fichaje entrada / pausa / reanudar / salida con contador en tiempo real
- Historial semanal con línea de tiempo y comparación contra jornada teórica
- Ausencias: solicitud, saldo de vacaciones, calendario anual de 12 meses, cancelación
- Validación de ausencias por dirección con detección de solapamientos y aviso por email
- Horarios y calendario de festivos
- Equipo / «Who's in» en tiempo real + calendario de ausencias del equipo
- Estadísticas: bolsa de horas, evolución de 8 semanas, exceso acumulado
- Tareas: imputación de tiempo por proyecto con reparto visual
- Documentos con acuse de firma
- Dirección: validaciones, incidencias, informes con export CSV, alta de plantilla,
  corrección trazable de fichajes, verificación de integridad
- Cola offline y sesión persistente 12 h

### Fuera de la v1 (evaluar después)
- ATS / reclutamiento
- Evaluación de desempeño y objetivos
- Encuestas de clima
- Firma electrónica cualificada (aquí es acuse de recepción, no firma eIDAS)
- Nóminas (sigue en la gestoría)
- Planificador de turnos rotativos
- Sincronización con Google/Outlook Calendar
- Fichaje por QR / quiosco compartido y geovallas

---

## Fuentes

- [Sesame · Control horario y vacaciones](https://www.sesametime.com/)
- [Panel del empleado — Sesame](https://www.sesametime.com/panel-del-empleado/)
- [Portal de RRHH para empleados — Sesame HR](https://www.sesamehr.es/software-rrhh-empleados/)
- [Ficha con Sesame: modos de fichaje](https://www.sesamehr.es/blog/control-horario/ficha-sesame-hr/)
- [Bolsa de horas con Sesame](https://www.sesamehr.es/blog/horas-extras/como-gestionar-facilmente-la-bolsa-de-horas-de-tus-empleados-con-sesame/)
- [Sesame HR — Funcionalidades y encaje 2026 (Guía Control Horario)](https://www.guiacontrolhorario.es/software/sesame)
- [Sesame HR: análisis y precios (Tramitapp)](https://www.tramitapp.com/blog/sesame-recursos-humanos/)
- [Precios de Sesame HR 2026 (G2)](https://www.g2.com/products/sesame-hr/pricing)
- [Sesame HR: opiniones y alternativas (Skello)](https://www.skello.es/blog/opiniones-sesame-alternativas)
- [Reseña de Sesame HR (Jibble)](https://www.jibble.io/es/resenas/sesame-hr)
- [Control horario en 2026: normativa y obligaciones (TeamSystem)](https://teamsystem.es/magazine/control-horario-2026/)
- [Registro horario digital obligatorio 2026 (Protime)](https://www.protime.eu/es-es/noticias/registro-horario-digital-obligatorio-2026)
- [Nuevo registro horario digital en España (Factorial)](https://factorial.es/blog/nuevo-registro-horario-digital-espana/)

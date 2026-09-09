# Cumplimiento legal · DC · Personas

Estado a septiembre de 2026. Marco: art. 34.9 del Estatuto de los Trabajadores
(RD-ley 8/2019), reglamento de registro digital en tramitación y RGPD.

## Requisitos legales

| Requisito | Cómo se cumple |
|---|---|
| **Los fichajes no se modifican ni se borran de forma oculta** | La hoja `Fichajes` es de solo inserción: el código nunca sobrescribe una fila. Una corrección es un registro nuevo. Además cada fichaje encadena un **hash SHA-256** con el anterior, así que tocar una celda directamente en la hoja rompe la cadena y *Verificar integridad* señala la fila exacta. |
| **Solo con permiso específico** | Corregir un fichaje exige rol manager o administrador, y el manager solo puede hacerlo con quien le reporta. Un empleado que lo intente recibe `SIN_PERMISOS`. Comprobado en las pruebas. |
| **Rastro de quién, cuándo y por qué** | Toda corrección guarda autor, fecha, hora y motivo, y el motivo es obligatorio. La hoja `Auditoria` registra además accesos, validaciones, cambios de ficha, reseteos de PIN y consentimientos. Visible en Gestión → Auditoría y exportable. |
| **Hora exacta e individualizada** | Cada fichaje guarda la marca de tiempo ISO con segundos, la fecha, la hora y el nombre de la persona. El cierre automático de las 23:45 se marca como incidencia para que se corrija con la hora real. |
| **Conservación cuatro años** | Los datos viven en Google Sheets, sin caducidad. Copia diaria a Drive con las últimas 60. Cada 15 de enero, `purgaAnual` elimina lo que supera los 4 años, previa copia. |
| **Consulta inmediata** | Cada empleado ve su historial completo y descarga sus datos. Los informes se exportan a CSV y PDF por rango y persona. Existe el rol **INSPECTOR**: cuenta de solo lectura con acceso a toda la plantilla, sin poder fichar ni modificar nada. |
| **Formato digital** | No hay papel en ninguna parte del circuito. |

## RGPD

| Obligación | Cómo se cumple |
|---|---|
| Información al interesado (art. 13) | Aviso de privacidad a pantalla completa en el primer acceso: responsable, finalidad, base legal, datos, plazo, destinatarios, derechos y ausencia de decisiones automatizadas. Bloquea la app hasta leerlo y la aceptación queda registrada con fecha y versión. |
| Base legal | Obligación legal para el registro de jornada; **consentimiento separado y revocable** para la geolocalización. |
| Consentimiento de geolocalización | Casilla aparte, desmarcada por defecto. Sin ella no se captura ninguna coordenada. Se activa y retira desde *Mi perfil → Tus datos*, y cada cambio queda en la auditoría. |
| Acceso y portabilidad (arts. 15 y 20) | «Descargar todos mis datos» genera un JSON con ficha, fichajes, ausencias, tareas, turnos, horas extra, consentimientos y accesos. Nunca incluye el PIN. |
| Rectificación (art. 16) | Cada persona edita sus datos de contacto y pide corrección de fichajes desde la app. |
| Supresión y limitación del plazo (art. 5.1.e) | Purga automática anual de lo que supera los 4 años. |
| Minimización | Solo se guarda lo que exige el registro. Sin fotos, sin biometría, sin seguimiento continuo: la ubicación se toma únicamente en el instante de fichar. |
| Seguridad (art. 32) | PIN en SHA-256 con sal, bloqueo tras 5 intentos, sesión firmada con HMAC, cifrado en reposo y tránsito de Google, acceso a la hoja limitado a las cuentas de administración. |
| Encargado de tratamiento | Google Workspace, con centro de datos en la UE y su acuerdo de encargado estándar. |

## Lo que depende de vosotros, no del software

1. **Consulta previa con la representación legal** de los trabajadores sobre cómo se
   organiza y documenta el registro (art. 34.9 ET). Es obligatoria.
2. **Registro de actividades de tratamiento** (art. 30 RGPD): añadir esta actividad al
   registro de la empresa.
3. **Proteger la hoja de cálculo**: en Google Sheets, *Datos → Hojas y rangos protegidos*
   sobre `Fichajes` y `Auditoria`, dejando permiso solo a la cuenta que ejecuta el script.
   La cadena de hashes **detecta** cualquier alteración; la protección de rangos la
   **impide**. Hacen falta las dos.
4. **Andorra**: allí no aplica la norma española sino el Codi de relacions laborals.
   Que lo revise la gestoría antes de dar de alta al personal de ese centro.

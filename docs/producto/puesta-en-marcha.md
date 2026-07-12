# Puesta en marcha

Tras la instalación, el **checklist del inicio** guía la configuración. Cada
ítem se deriva del estado real del sistema (no persiste progreso propio, así que
nunca se desincroniza).

## Checklist inicial

| Ítem | Dónde | Qué hace |
| --- | --- | --- |
| Datos de la institución | Configuración del sistema | Nombre visible en membretes, correos y en la app instalable. |
| Dominio de la instalación | Configuración del sistema | Se verifica con un reto y habilita las URLs de OAuth. |
| Correo saliente | Configuración del sistema | Entorno / SMTP propio / Resend (secretos cifrados) + correo de prueba. |
| Respaldos a Google Drive | Configuración de respaldos | Respaldo diario cifrado; ver [respaldos](../operacion/respaldos.md). |
| Verificación de inicio de sesión | Configuración del sistema | Segundo paso por correo (código o enlace); los administradores con cobertura completa quedan exentos. |
| Inicio de sesión con Google | Configuración del sistema | OIDC con credenciales propias (secret cifrado). |

## Política del sistema editable en runtime

Estos ajustes viven en la base de datos (auditados); **vacío = usar el default
del despliegue**:

- **Sesiones**: duración del cliente (días) y del personal (minutos), con
  renovación deslizante.
- **Seguridad de cuentas**: intentos fallidos antes de bloquear y vigencia de
  los tokens enviados por correo.
- **Zona horaria de la instalación** (IANA): define los límites de día de los
  filtros de calendario; el cambio aplica en segundos, sin reiniciar.
- **Copiloto**: vigencia del ticket de conexión y del arriendo de credencial.

## Marca de la app instalable (PWA)

En **Marca** se sube el logo de la instalación (PNG/JPEG/WEBP; se verifica el
contenido y se bloquea SVG). El manifest de la PWA usa el nombre de la
institución y genera los íconos cuadrados al vuelo; sin logo se usan los íconos
genéricos. La plataforma es instalable y recibe notificaciones Web Push (en iOS,
solo instalada a la pantalla de inicio).

## Copiloto

Cada usuario aporta su propia credencial de proveedor de IA en **Mi cuenta →
Proveedores de IA** (se cifra en reposo y no vuelve a mostrarse). El copiloto
deriva sus herramientas automáticamente de los recursos que el rol del usuario
puede ver, y **toda escritura requiere aprobación explícita** antes de
guardarse.

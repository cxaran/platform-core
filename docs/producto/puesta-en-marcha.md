# Puesta en marcha

Tras la instalación, el **checklist del inicio** guía la configuración. Cada ítem se
deriva del estado real del sistema (no persiste progreso propio, así que nunca se
desincroniza).

## Checklist inicial

| Ítem | Dónde | Qué hace |
| --- | --- | --- |
| Datos de la institución | Configuración del sistema | Nombre y descripción visibles en membretes, correos, metadata del sitio y en la app instalable. |
| Dominio de la instalación | Configuración del sistema | Se verifica con un reto HMAC servido a través del dominio candidato; al verificarse fija la URL pública de la instalación (enlaces absolutos y URLs de OAuth). |
| Correo saliente | Configuración del sistema | Entorno / SMTP propio / Resend (secretos cifrados) + correo de prueba. |
| Respaldos a Google Drive | Configuración de respaldos | Respaldo diario cifrado; ver [respaldos](../operacion/respaldos.md). |
| Verificación de inicio de sesión | Configuración del sistema | Segundo paso por correo (código o enlace); los administradores con cobertura completa quedan exentos. |
| Inicio de sesión con Google | Configuración del sistema | OIDC con credenciales propias (secret cifrado). |

## Política del sistema editable en runtime

Estos ajustes viven en la base de datos (auditados, solo nombres de campo); donde
aplica, **vacío = usar el default del despliegue** (variable de entorno):

- **Registro público**: habilitar o no el alta de cuentas desde la pantalla pública.
- **Seguridad de cuentas**: intentos fallidos antes de bloquear y vigencia de los
  tokens enviados por correo (registro, recuperación, desbloqueo).
- **Recuperación de contraseña**: activar o desactivar el flujo.
- **Zona horaria de la instalación** (IANA): define los límites de día de los filtros
  de calendario; el cambio aplica en segundos, sin reiniciar.
- **Correo saliente**: transporte (entorno / SMTP / Resend) y remitente.
- **Inicio de sesión con Google** y **verificación de inicio de sesión**.

La duración de la sesión (con renovación deslizante) y los tiempos del copiloto son
**defaults del despliegue** (variables de entorno), no política editable desde la
interfaz.

## Marca de la app instalable (PWA)

En **Marca** se sube el logo de la instalación (PNG/JPEG/WEBP; se verifica el contenido
y se bloquea SVG). El manifest de la PWA usa el nombre de la institución y genera los
íconos cuadrados al vuelo; sin logo se usan los íconos genéricos. La plataforma es
instalable y recibe notificaciones Web Push (en iOS, solo instalada a la pantalla de
inicio).

## Copiloto

Cada usuario aporta su propia credencial de proveedor de IA en **Mi cuenta →
Proveedores de IA** — una API key o su cuenta ChatGPT por OAuth. Se cifra en reposo y no
vuelve a mostrarse. El copiloto deriva sus herramientas automáticamente de los recursos
que el rol del usuario puede ver, y **toda escritura requiere aprobación explícita**
antes de guardarse (el payload nunca sale del navegador hacia el gateway).

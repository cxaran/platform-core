# Documentación

Bienvenido a la documentación de la plataforma, organizada por audiencia:

- **Operación** — para quien administra el servidor: [instalación](operacion/instalacion.md)
  y [respaldos cifrados a Google Drive](operacion/respaldos.md).
- **Producto** — para quien administra la instalación desde la interfaz:
  [puesta en marcha](producto/puesta-en-marcha.md) (checklist, política del sistema,
  marca y copiloto).
- **Desarrollo** — para quien construye sobre la plataforma:
  [arquitectura](desarrollo/arquitectura.md) y
  [tareas en segundo plano](desarrollo/tareas-en-segundo-plano.md).

!!! tip "Principio de la plataforma"
    Platform Core es una base **self-hosted de instalación única / organización
    única**: la configuración vive en la base de datos (editable y auditada desde
    la interfaz), las variables de entorno son solo defaults del despliegue, y los
    productos derivados añaden únicamente sus recursos de dominio.

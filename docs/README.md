# Documentación

Documentación de la plataforma, organizada por audiencia:

- **Operación** — para quien administra el servidor:
  [instalación](operacion/instalacion.md), [actualización](operacion/actualizacion.md),
  [respaldos cifrados a Google Drive](operacion/respaldos.md),
  [observabilidad](operacion/observabilidad.md) y
  [solución de problemas](operacion/solucion-problemas.md).
- **Producto** — para quien administra la instalación desde la interfaz:
  [puesta en marcha](producto/puesta-en-marcha.md) (checklist, política del sistema,
  marca y copiloto).
- **Desarrollo** — para quien construye sobre la plataforma:
  [arquitectura](desarrollo/arquitectura.md),
  [contrato de recursos](desarrollo/contrato-de-recursos.md) y
  [tareas en segundo plano](desarrollo/tareas-en-segundo-plano.md).

!!! tip "Principio de la plataforma"
    Platform Core es una base **self-hosted de instalación única / organización
    única**: la configuración vive en la base de datos (editable y auditada desde
    la interfaz), las variables de entorno son solo defaults del despliegue, y los
    productos derivados añaden únicamente sus recursos de dominio.

Las decisiones formales de arquitectura viven en `docs/architecture/` (material
interno de desarrollo, fuera de este nav): `decisions.md` (bitácora de decisiones),
`platform-core-roadmap.md` (charter y principios) y `capa-agentica.md` (el copiloto).

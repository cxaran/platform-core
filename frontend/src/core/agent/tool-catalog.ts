import type { ResourceCatalog } from "@/core/api/contracts";

import type { ToolDefinition } from "./tools/registry";

/**
 * Catálogo de tools con PROCEDENCIA y gating por rol (tool-hardening, sobre P1). Antes de
 * declarar las tools al modelo, las de ESCRITURA se filtran por los permisos del usuario:
 * una tool de escritura solo se declara si el usuario puede CREAR en su recurso destino. Las
 * de LECTURA nunca se gatean.
 *
 * Defensa en profundidad, NO sustituto: FastAPI sigue siendo la autoridad y revalida cada
 * ejecución con la cookie del usuario. El gating evita siquiera OFRECER al modelo una acción
 * que el usuario no podría realizar. La señal de permiso viene del catálogo de recursos
 * (``/api/v1/resources``), que ya está proyectado por permiso: ``forms.create`` solo está
 * presente si el usuario tiene el permiso de creación de ese recurso.
 */

// "declared" = se declara al modelo este turno (el catálogo efectivo completo se declara);
// "gated_out" = restringida por rol/permiso (nunca declarable).
export type ToolStatus = "declared" | "gated_out";

export interface ToolCatalogEntry {
  name: string;
  kind: "read" | "write";
  /** Procedencia legible (familia de la tool), para auditoría. */
  source: string;
  /** Recurso destino de una escritura (null para lecturas). */
  targetResource: string | null;
  status: ToolStatus;
  /** Motivo del gating cuando ``status === "gated_out"``. */
  reason: string | null;
}

const SOURCE_BY_PREFIX: ReadonlyArray<readonly [string, string]> = [
  ["resource.", "Recursos"],
  ["ui.", "Interfaz"],
  ["sandbox.", "Utilidad"],
];

/** Procedencia (familia) de una tool a partir de su prefijo de nombre. */
export function toolSource(name: string): string {
  for (const [prefix, label] of SOURCE_BY_PREFIX) {
    if (name.startsWith(prefix)) {
      return label;
    }
  }
  return "Otra";
}

/**
 * Procedencia EFECTIVA de una tool: su ``source`` explícito si lo declara (p. ej. las MCP, que
 * llevan "MCP: <servidor>"), o la inferida por prefijo del nombre en caso contrario.
 */
export function sourceOf(tool: { name: string; source?: string }): string {
  return tool.source ?? toolSource(tool.name);
}

/**
 * Recursos en los que el usuario puede CREAR, según el catálogo permission-projected.
 * ``forms.create`` solo aparece si el backend concede el permiso de creación.
 */
export function creatableResources(catalog: ResourceCatalog): Set<string> {
  const set = new Set<string>();
  for (const resource of catalog) {
    if (resource.forms?.create) {
      set.add(resource.name);
    }
  }
  return set;
}

/**
 * Proyecta el catálogo de tools con su procedencia y estado de gating. Lecturas nunca se gatean
 * por rol; escrituras solo pasan el gate si su recurso destino es creable por el usuario. Toda
 * tool no gateada queda "declared": el catálogo efectivo completo se declara al modelo cada
 * turno (no hay descubrimiento bajo demanda).
 *
 * ``granted`` (permisos de la sesión, /auth/me) habilita el gate ALTERNATIVO
 * ``approval.requiredPermissions`` de las escrituras cuyo recurso NO publica formulario
 * genérico en el catálogo (p. ej. scale_results). Sin ``granted`` (compat), esas tools
 * quedan gateadas salvo que su recurso sí sea creable.
 */
export function buildToolCatalog(
  tools: readonly ToolDefinition[],
  creatable: Set<string>,
  granted?: ReadonlySet<string>,
): ToolCatalogEntry[] {
  return tools.map((tool) => {
    const source = sourceOf(tool);
    if (tool.kind === "read") {
      return {
        name: tool.name,
        kind: "read",
        source,
        targetResource: null,
        status: "declared" as const,
        reason: null,
      };
    }
    const target = tool.approval?.targetResource ?? null;
    // Escritura OWNER-SCOPED (p. ej. memorias del usuario): no se gatea por el catálogo RBAC
    // (no es un recurso global), siempre disponible para el dueño. Igual pasa por aprobación.
    if (tool.approval?.ownerScoped || tool.approval?.preauthorized) {
      return {
        name: tool.name,
        kind: "write",
        source,
        targetResource: target,
        status: "declared" as const,
        reason: null,
      };
    }
    const required = tool.approval?.requiredPermissions;
    const permitted =
      (target !== null && creatable.has(target)) ||
      (required !== undefined &&
        required.length > 0 &&
        granted !== undefined &&
        required.every((permission) => granted.has(permission)));
    if (permitted) {
      return {
        name: tool.name,
        kind: "write",
        source,
        targetResource: target,
        status: "declared" as const,
        reason: null,
      };
    }
    return {
      name: tool.name,
      kind: "write",
      source,
      targetResource: target,
      status: "gated_out",
      reason: required?.length
        ? `El usuario no tiene los permisos requeridos (${required.join(", ")}).`
        : target
          ? `El usuario no tiene permiso para crear en ${target}.`
          : "La herramienta de escritura no declara recurso destino.",
    };
  });
}

/** Lista EFECTIVA de tools a declarar al modelo (excluye las gateadas por rol). */
export function effectiveTools(
  tools: readonly ToolDefinition[],
  creatable: Set<string>,
  granted?: ReadonlySet<string>,
): ToolDefinition[] {
  const declared = new Set(
    buildToolCatalog(tools, creatable, granted)
      .filter((entry) => entry.status === "declared")
      .map((entry) => entry.name),
  );
  return tools.filter((tool) => declared.has(tool.name));
}

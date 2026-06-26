import type {
  BootstrapCatalogRead,
  BootstrapInitializeRequest,
  BootstrapPermissionGroupRead,
  BootstrapStatusRead,
} from "@/core/api/contracts";
import type { ApiRequestError } from "@/core/api/api-error";

export type InitialUserDraft = {
  name: string;
  last_name: string;
  email: string;
  password: string;
  confirm_password: string;
};

export type SystemAdminRoleDraft = {
  label: string;
  description: string;
};

export type AdditionalRoleDraft = {
  key: string;
  name: string;
  description: string;
  permissions: string[];
  assign_to_initial_user: boolean;
};

export type BootstrapWizardDraft = {
  user: InitialUserDraft;
  system_admin_role: SystemAdminRoleDraft;
  additional_roles: AdditionalRoleDraft[];
};

export type WizardFieldErrors = Record<string, string[]>;

// Campos mapeables de forma fiable a un control visible y único del wizard. Los
// de ``additional_roles`` se excluyen a propósito: al normalizar el error se colapsa
// el índice (``additional_roles.0.name`` → ``additional_roles.name``), por lo que no
// se puede asignar el error al rol correcto; se reportan como error general seguro.
const RELIABLE_WIZARD_FIELDS = new Set([
  "user.name",
  "user.last_name",
  "user.email",
  "user.password",
  "user.confirm_password",
  "system_admin_role.label",
  "system_admin_role.description",
]);

// Códigos de error de dominio del Bootstrap cuyo ``message`` es texto seguro y útil
// para mostrar al usuario (definidos en backend/app/bootstrap/service.py).
const SAFE_BOOTSTRAP_MESSAGE_CODES = new Set([
  "invalid_permission",
  "duplicate_role",
  "invalid_role_name",
  "too_many_roles",
  "invalid_field",
]);

const GENERIC_BOOTSTRAP_ERROR = "No se pudo completar Bootstrap. Inténtalo nuevamente.";
const ADDITIONAL_ROLES_ERROR =
  "Revisa los roles adicionales: hay datos inválidos en su configuración.";

export function emptyBootstrapDraft(): BootstrapWizardDraft {
  return {
    user: {
      name: "",
      last_name: "",
      email: "",
      password: "",
      confirm_password: "",
    },
    system_admin_role: {
      label: "Administrador de plataforma",
      description: "Administración inicial de la plataforma",
    },
    additional_roles: [],
  };
}

export function buildBootstrapPayload(draft: BootstrapWizardDraft): BootstrapInitializeRequest {
  return {
    user: {
      name: draft.user.name,
      last_name: draft.user.last_name,
      email: draft.user.email,
      password: draft.user.password,
      confirm_password: draft.user.confirm_password,
    },
    system_admin_role: {
      label: draft.system_admin_role.label,
      description: draft.system_admin_role.description || null,
    },
    additional_roles: draft.additional_roles
      .filter((role) => role.name.trim() || role.description.trim() || role.permissions.length > 0)
      .map((role) => ({
        name: role.name,
        description: role.description || null,
        permissions: [...new Set(role.permissions)],
        assign_to_initial_user: role.assign_to_initial_user,
      })),
  };
}

export function permissionAccesses(catalog: BootstrapCatalogRead): Set<string> {
  return new Set(
    catalog.permission_groups.flatMap((group) => group.permissions.map((permission) => permission.access)),
  );
}

export function checkedPermissions(
  groups: readonly BootstrapPermissionGroupRead[],
  selected: readonly string[],
): string[] {
  const allowed = new Set(groups.flatMap((group) => group.permissions.map((permission) => permission.access)));
  return selected.filter((permission) => allowed.has(permission));
}

export function shouldShowBootstrapTokenField(status: BootstrapStatusRead): boolean {
  return status.token_required;
}

export function canRequestBootstrapCatalog(status: BootstrapStatusRead, token: string): boolean {
  return !status.token_required || token.trim() !== "";
}

export function canAddAdditionalRole(draft: BootstrapWizardDraft, catalog: BootstrapCatalogRead): boolean {
  return draft.additional_roles.length < catalog.limits.max_additional_roles;
}

/**
 * ¿Algún error pertenece a un campo del paso de administrador (``user.*``)? El
 * wizard usa esto para regresar al paso 1 cuando el backend rechaza un dato del
 * administrador al enviar desde el paso 2. Los errores de roles no aplican aquí.
 */
export function adminStepHasFieldError(fields: WizardFieldErrors): boolean {
  return Object.keys(fields).some((field) => field.startsWith("user."));
}

export function parseBootstrapFormError(
  error: ApiRequestError,
): { redirectToLogin: boolean; general: string | null; fields: WizardFieldErrors } {
  if (
    error.status === 409 &&
    (error.body.code === "bootstrap_completed" || error.body.code === "bootstrap_unavailable")
  ) {
    return { redirectToLogin: true, general: null, fields: {} };
  }

  // Error de dominio del servicio: 422 con código y mensaje seguro pero sin lista de
  // errores por campo (p. ej. permisos no declarados, roles duplicados). Se muestra
  // el mensaje del backend en vez del genérico, que ocultaba la causa real.
  if (error.status === 422 && !(error.body.errors && error.body.errors.length > 0)) {
    const general = SAFE_BOOTSTRAP_MESSAGE_CODES.has(error.body.code)
      ? error.body.message
      : GENERIC_BOOTSTRAP_ERROR;
    return { redirectToLogin: false, general, fields: {} };
  }

  if (error.status === 422 && error.body.errors) {
    const fields: WizardFieldErrors = {};
    let rolesIssue = false;
    let hasUndeclaredFieldError = false;
    for (const item of error.body.errors) {
      const field = normalizeErrorField(item.field);
      if (field && RELIABLE_WIZARD_FIELDS.has(field)) {
        fields[field] = [...(fields[field] ?? []), item.message];
      } else if (field && field.startsWith("additional_roles")) {
        rolesIssue = true;
      } else {
        hasUndeclaredFieldError = true;
      }
    }
    let general: string | null = null;
    if (rolesIssue) {
      general = ADDITIONAL_ROLES_ERROR;
    } else if (hasUndeclaredFieldError) {
      general = GENERIC_BOOTSTRAP_ERROR;
    }
    return { redirectToLogin: false, general, fields };
  }

  return {
    redirectToLogin: false,
    general: GENERIC_BOOTSTRAP_ERROR,
    fields: {},
  };
}

export function safeBootstrapGeneralError(error: ApiRequestError): string {
  if (error.status === 401 || error.status === 403 || error.body.code === "bootstrap_token_invalid") {
    return "No se pudo validar Bootstrap. Revisa los datos e inténtalo nuevamente.";
  }
  if (error.status === 409) {
    return "No se pudo completar Bootstrap. Inténtalo nuevamente.";
  }
  return "No se pudo completar Bootstrap. Inténtalo nuevamente.";
}

function normalizeErrorField(field: string | null | undefined): string | null {
  if (!field) return null;
  return field.replace(/^body\./, "").replace(/\.\d+\./g, ".");
}

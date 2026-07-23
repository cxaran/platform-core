"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { ApiRequestError } from "@/core/api/api-error";
import type {
  BootstrapCatalogRead,
  BootstrapPermissionGroupRead,
  BootstrapStatusRead,
} from "@/core/api/contracts";
import { getBootstrapCatalog, initializeBootstrap } from "@/core/bootstrap/bootstrap-client";
import {
  AdditionalRoleDraft,
  adminStepHasFieldError,
  BootstrapWizardDraft,
  buildBootstrapPayload,
  canAddAdditionalRole,
  canRequestBootstrapCatalog,
  checkedPermissions,
  emptyBootstrapDraft,
  parseBootstrapFormError,
  safeBootstrapGeneralError,
  shouldShowBootstrapTokenField,
  WizardFieldErrors,
} from "@/core/bootstrap/bootstrap-form";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FieldError } from "@/components/ui/FieldError";
import { Input } from "@/components/ui/Input";

type Step = "admin" | "roles";

export function BootstrapWizard({ status }: Readonly<{ status: BootstrapStatusRead }>) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("admin");
  const [draft, setDraft] = useState<BootstrapWizardDraft>(() => ({
    ...emptyBootstrapDraft(),
    // Propuesta editable: la URL con la que se está instalando. Sin ella los
    // correos degradan a token en texto y el login con Google queda apagado.
    app_base_url: typeof window !== "undefined" ? window.location.origin : "",
  }));
  const [token, setToken] = useState("");
  const [catalog, setCatalog] = useState<BootstrapCatalogRead | null>(null);
  const [pending, setPending] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<WizardFieldErrors>({});

  async function continueToRoles(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setGeneralError(null);
    setFieldErrors({});
    try {
      const nextCatalog = await getBootstrapCatalog(token);
      setCatalog(nextCatalog);
      setStep("roles");
    } catch (error) {
      handleBootstrapError(error);
    } finally {
      setPending(false);
    }
  }

  async function submitBootstrap(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setGeneralError(null);
    setFieldErrors({});
    try {
      await initializeBootstrap(buildBootstrapPayload(draft), token);
      clearWizardState();
      router.replace("/login");
    } catch (error) {
      handleBootstrapError(error);
    } finally {
      setPending(false);
    }
  }

  function handleBootstrapError(error: unknown) {
    if (error instanceof ApiRequestError) {
      const parsed = parseBootstrapFormError(error);
      if (parsed.redirectToLogin) {
        clearWizardState();
        router.replace("/login");
        return;
      }
      setFieldErrors(parsed.fields);
      // Los campos del administrador viven en el paso 1. Si el backend reporta un
      // error en alguno de ellos al enviar Bootstrap (paso 2), se regresa al paso 1
      // para que el usuario lo vea y lo corrija.
      if (adminStepHasFieldError(parsed.fields)) {
        setStep("admin");
        setGeneralError(parsed.general ?? "Revisa los datos del administrador inicial.");
      } else {
        setGeneralError(parsed.general ?? safeBootstrapGeneralError(error));
      }
      return;
    }
    setGeneralError("No se pudo completar Bootstrap. Inténtalo nuevamente.");
  }

  function clearWizardState() {
    setDraft(emptyBootstrapDraft());
    setToken("");
    setCatalog(null);
    setFieldErrors({});
    setGeneralError(null);
  }

  return (
    <section className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[0.85fr_1.15fr]">
      <aside className="rounded-3xl border border-[var(--border)] bg-[var(--bg2)] p-8 text-[var(--tx)] shadow-[var(--soft)]">
        <p className="text-sm font-medium uppercase tracking-[0.28em] text-[var(--accent-tx)]">
          Platform Core
        </p>
        <h1 className="mt-5 max-w-md text-4xl font-semibold tracking-tight sm:text-5xl">
          Instalación inicial segura
        </h1>
        <p className="mt-5 max-w-md text-sm leading-6 text-[var(--tx2)]">
          Crea el administrador fundacional y, si lo necesitas, roles operativos iniciales.
          El Bootstrap se cerrará permanentemente al completar este flujo.
        </p>
        <div className="mt-8 grid gap-3 text-sm text-[var(--tx2)]">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
            <p className="font-semibold text-[var(--tx)]">Administrador fundacional</p>
            <p className="mt-1">Obligatorio, asignado al usuario inicial y con permisos completos definidos por backend.</p>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
            <p className="font-semibold text-[var(--tx)]">Sin sesión automática</p>
            <p className="mt-1">Al finalizar irás a login para iniciar sesión normalmente.</p>
          </div>
        </div>
      </aside>

      <div className="rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-6 shadow-[var(--soft)] sm:p-8">
        <StepIndicator step={step} />
        {generalError ? (
          <div
            className="mb-5 rounded-[11px] border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] px-4 py-3 text-sm text-[var(--danger)]"
            role="alert"
          >
            {generalError}
          </div>
        ) : null}
        {step === "admin" ? (
          <AdminStep
            draft={draft}
            fieldErrors={fieldErrors}
            pending={pending}
            status={status}
            token={token}
            setDraft={setDraft}
            setToken={setToken}
            onSubmit={continueToRoles}
          />
        ) : (
          <RolesStep
            catalog={catalog}
            draft={draft}
            fieldErrors={fieldErrors}
            pending={pending}
            setDraft={setDraft}
            onBack={() => setStep("admin")}
            onSubmit={submitBootstrap}
          />
        )}
      </div>
    </section>
  );
}

function StepIndicator({ step }: Readonly<{ step: Step }>) {
  return (
    <ol className="mb-6 grid grid-cols-2 gap-2 text-sm">
      <li
        className={`rounded-full px-4 py-2 text-center font-medium ${
          step === "admin"
            ? "bg-[var(--accent)] text-[var(--on-accent)]"
            : "bg-[var(--panel2)] text-[var(--tx2)]"
        }`}
      >
        1. Administrador
      </li>
      <li
        className={`rounded-full px-4 py-2 text-center font-medium ${
          step === "roles"
            ? "bg-[var(--accent)] text-[var(--on-accent)]"
            : "bg-[var(--panel2)] text-[var(--tx2)]"
        }`}
      >
        2. Roles
      </li>
    </ol>
  );
}

function AdminStep({
  draft,
  fieldErrors,
  pending,
  status,
  token,
  setDraft,
  setToken,
  onSubmit,
}: Readonly<{
  draft: BootstrapWizardDraft;
  fieldErrors: WizardFieldErrors;
  pending: boolean;
  status: BootstrapStatusRead;
  token: string;
  setDraft: (draft: BootstrapWizardDraft) => void;
  setToken: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}>) {
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold">Administrador inicial</h2>
        <p className="mt-1 text-sm text-[var(--tx2)]">Estos datos se enviarán al backend para crear el primer usuario activo.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="setup-name" label="Nombre" value={draft.user.name} error={fieldErrors["user.name"]?.join(" ")} autoComplete="given-name" onChange={(value) => setDraft({ ...draft, user: { ...draft.user, name: value } })} />
        <TextField id="setup-last-name" label="Apellido" value={draft.user.last_name} error={fieldErrors["user.last_name"]?.join(" ")} autoComplete="family-name" onChange={(value) => setDraft({ ...draft, user: { ...draft.user, last_name: value } })} />
      </div>
      <TextField id="setup-email" label="Email" type="email" value={draft.user.email} error={fieldErrors["user.email"]?.join(" ")} autoComplete="email" onChange={(value) => setDraft({ ...draft, user: { ...draft.user, email: value } })} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="setup-password" label="Contraseña" type="password" value={draft.user.password} error={fieldErrors["user.password"]?.join(" ")} autoComplete="new-password" onChange={(value) => setDraft({ ...draft, user: { ...draft.user, password: value } })} />
        <TextField id="setup-confirm-password" label="Confirmar contraseña" type="password" value={draft.user.confirm_password} error={fieldErrors["user.confirm_password"]?.join(" ")} autoComplete="new-password" onChange={(value) => setDraft({ ...draft, user: { ...draft.user, confirm_password: value } })} />
      </div>
      {shouldShowBootstrapTokenField(status) ? (
        <TextField id="setup-token" label="Token de Bootstrap" type="password" value={token} autoComplete="off" onChange={setToken} />
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !canRequestBootstrapCatalog(status, token)}>
          {pending ? "Validando..." : "Continuar"}
        </Button>
      </div>
    </form>
  );
}

function RolesStep({
  catalog,
  draft,
  fieldErrors,
  pending,
  setDraft,
  onBack,
  onSubmit,
}: Readonly<{
  catalog: BootstrapCatalogRead | null;
  draft: BootstrapWizardDraft;
  fieldErrors: WizardFieldErrors;
  pending: boolean;
  setDraft: (draft: BootstrapWizardDraft) => void;
  onBack: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}>) {
  if (!catalog) return null;
  const maxRoles = catalog.limits.max_additional_roles;
  const atLimit = !canAddAdditionalRole(draft, catalog);

  function addRole() {
    if (atLimit) return;
    setDraft({
      ...draft,
      additional_roles: [
        ...draft.additional_roles,
        { key: crypto.randomUUID(), name: "", description: "", permissions: [], assign_to_initial_user: false },
      ],
    });
  }

  function updateRole(index: number, role: AdditionalRoleDraft) {
    const roles = [...draft.additional_roles];
    roles[index] = role;
    setDraft({ ...draft, additional_roles: roles });
  }

  function removeRole(index: number) {
    setDraft({
      ...draft,
      additional_roles: draft.additional_roles.filter((_, currentIndex) => currentIndex !== index),
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Roles iniciales</h2>
        <p className="mt-1 text-sm text-[var(--tx2)]">El rol administrador fundacional es obligatorio. Los roles adicionales son opcionales.</p>
      </div>
      <section className="rounded-2xl border border-[var(--border2)] bg-[var(--bg2)] p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-[var(--tx3)]">System Administrator</p>
            <h3 className="text-lg font-semibold">{draft.system_admin_role.label}</h3>
            <p className="mt-1 text-sm text-[var(--tx2)]">Asignado al usuario inicial. Permisos completos administrados por backend.</p>
          </div>
          <Badge tone="ok">Obligatorio</Badge>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_1.3fr]">
          <TextField id="system-admin-label" label="Label visible" value={draft.system_admin_role.label} error={fieldErrors["system_admin_role.label"]?.join(" ")} onChange={(value) => setDraft({ ...draft, system_admin_role: { ...draft.system_admin_role, label: value } })} />
          <TextField id="system-admin-description" label="Descripción" value={draft.system_admin_role.description} error={fieldErrors["system_admin_role.description"]?.join(" ")} required={false} onChange={(value) => setDraft({ ...draft, system_admin_role: { ...draft.system_admin_role, description: value } })} />
        </div>
      </section>
      <section className="rounded-2xl border border-[var(--border2)] bg-[var(--bg2)] p-4">
        <h3 className="text-lg font-semibold">Política inicial de la plataforma</h3>
        <p className="mt-1 text-sm text-[var(--tx2)]">
          Decisiones editables después en Configuración del sistema. Las integraciones
          (correo, respaldos, IA) se configuran tras iniciar sesión, de forma guiada.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-[1.3fr_1fr]">
          <TextField
            id="institution-name"
            label="Nombre de la institución (opcional)"
            value={draft.institution_name}
            required={false}
            onChange={(value) => setDraft({ ...draft, institution_name: value })}
          />
          <TextField
            id="app-base-url"
            label="URL pública de la instalación"
            value={draft.app_base_url}
            required={false}
            error={fieldErrors["app_base_url"]?.join(" ")}
            onChange={(value) => setDraft({ ...draft, app_base_url: value })}
          />
          <div className="flex flex-col gap-2 self-end pb-2">
            <label className="flex items-center gap-3 text-sm text-[var(--tx)]">
              <input
                type="checkbox"
                checked={draft.public_registration_enabled}
                onChange={(event) =>
                  setDraft({ ...draft, public_registration_enabled: event.target.checked })
                }
                className="h-4 w-4 accent-[var(--accent)]"
              />
              Permitir registro público de cuentas
            </label>
            <label className="flex items-center gap-3 text-sm text-[var(--tx)]">
              <input
                type="checkbox"
                checked={draft.password_reset_enabled}
                onChange={(event) =>
                  setDraft({ ...draft, password_reset_enabled: event.target.checked })
                }
                className="h-4 w-4 accent-[var(--accent)]"
              />
              Permitir recuperación de contraseña por correo
            </label>
          </div>
        </div>
        <p className="mt-2 text-xs text-[var(--tx3)]">
          Deshabilitado, las cuentas las crean los administradores. Recomendado dejarlo
          apagado en producción.
        </p>
      </section>
      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold">Roles adicionales</h3>
            <p className="text-sm text-[var(--tx2)]">{draft.additional_roles.length} de {maxRoles} configurados.</p>
          </div>
          <button type="button" onClick={addRole} disabled={atLimit} className="rounded-[10px] border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--tx2)] transition hover:bg-[var(--panel2)] hover:text-[var(--tx)] disabled:cursor-not-allowed disabled:opacity-60">
            Agregar rol
          </button>
        </div>
        {draft.additional_roles.length === 0 ? (
          <p className="rounded-[11px] border border-dashed border-[var(--border2)] p-4 text-sm text-[var(--tx2)]">No hay roles adicionales. Puedes completar Bootstrap solo con el administrador fundacional.</p>
        ) : null}
        {draft.additional_roles.map((role, index) => (
          <AdditionalRoleCard
            key={role.key}
            catalogGroups={catalog.permission_groups}
            index={index}
            role={role}
            onRemove={() => removeRole(index)}
            onUpdate={(nextRole) => updateRole(index, nextRole)}
          />
        ))}
      </section>
      <FieldError message={fieldErrors["additional_roles.permissions"]?.join(" ")} />
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <button type="button" onClick={onBack} disabled={pending} className="rounded-[10px] border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--tx2)] transition hover:bg-[var(--panel2)] hover:text-[var(--tx)] disabled:cursor-not-allowed disabled:opacity-60">
          Volver
        </button>
        <Button type="submit" disabled={pending}>{pending ? "Completando..." : "Completar Bootstrap"}</Button>
      </div>
    </form>
  );
}

function AdditionalRoleCard({
  catalogGroups,
  index,
  role,
  onRemove,
  onUpdate,
}: Readonly<{
  catalogGroups: BootstrapPermissionGroupRead[];
  index: number;
  role: AdditionalRoleDraft;
  onRemove: () => void;
  onUpdate: (role: AdditionalRoleDraft) => void;
}>) {
  function togglePermission(permission: string, checked: boolean) {
    const selected = checked
      ? [...role.permissions, permission]
      : role.permissions.filter((item) => item !== permission);
    onUpdate({ ...role, permissions: checkedPermissions(catalogGroups, selected) });
  }

  return (
    <article className="rounded-2xl border border-[var(--border)] p-4">
      <div className="mb-4 flex items-start justify-between gap-4">
        <h4 className="font-semibold">Rol adicional {index + 1}</h4>
        <button type="button" onClick={onRemove} className="rounded-[8px] px-3 py-1 text-sm font-medium text-[var(--danger)] transition hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]">
          Eliminar
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id={`role-${role.key}-name`} label="Nombre" value={role.name} onChange={(value) => onUpdate({ ...role, name: value })} />
        <TextField id={`role-${role.key}-description`} label="Descripción" value={role.description} required={false} onChange={(value) => onUpdate({ ...role, description: value })} />
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm text-[var(--tx2)]">
        <input type="checkbox" className="h-4 w-4 rounded border-[var(--border2)] accent-[var(--accent)]" checked={role.assign_to_initial_user} onChange={(event) => onUpdate({ ...role, assign_to_initial_user: event.target.checked })} />
        Asignar también al administrador inicial
      </label>
      <div className="mt-4 space-y-4">
        {catalogGroups.map((group) => (
          <fieldset key={group.name} className="rounded-[11px] border border-[var(--border)] p-3">
            <legend className="px-1 text-sm font-semibold text-[var(--tx)]">{group.label}</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {group.permissions.map((permission) => {
                const id = `role-${role.key}-${permission.access}`;
                return (
                  <label key={permission.access} htmlFor={id} className="flex items-start gap-2 rounded-[8px] p-2 text-sm text-[var(--tx2)] hover:bg-[var(--panel2)]">
                    <input id={id} type="checkbox" className="mt-0.5 h-4 w-4 rounded border-[var(--border2)] accent-[var(--accent)]" checked={role.permissions.includes(permission.access)} onChange={(event) => togglePermission(permission.access, event.target.checked)} />
                    <span>
                      <span className="block font-medium text-[var(--tx)]">{permission.label}</span>
                      {permission.description ? <span className="block text-xs text-[var(--tx3)]">{permission.description}</span> : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
    </article>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  error,
  required = true,
  type = "text",
}: Readonly<{
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  error?: string | null;
  required?: boolean;
  type?: "email" | "password" | "text";
}>) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-[var(--tx2)]" htmlFor={id}>{label}</label>
      <Input
        id={id}
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldError message={error} />
    </div>
  );
}

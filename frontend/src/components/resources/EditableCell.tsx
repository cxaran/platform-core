"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { ApiRequestError } from "@/core/api/api-error";
import type { HttpMethod, ResourceFormFieldCapability } from "@/core/api/contracts";
import { updateResource } from "@/core/resources/resource-mutation-client";

/**
 * Celda editable en sitio (estilo hoja de cálculo). Doble clic (o Enter con la
 * celda enfocada) abre el editor; Enter guarda vía el PATCH del contrato con un
 * payload de UN solo campo; Esc cancela. El backend sigue siendo la autoridad:
 * un 4xx se muestra bajo la celda y el valor no cambia.
 *
 * Solo se monta para campos presentes en el formulario de actualización del
 * contrato (ya filtrado por permisos en el backend) — el resto de celdas ni
 * siquiera cargan esta isla.
 */

const INPUT_CLASS =
  "w-full min-w-[8ch] rounded-[7px] border border-[var(--accent-bd)] bg-[var(--bg2)] px-1.5 py-0.5 text-[13px] text-[var(--tx)] outline-none";

function initialDraft(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function coerceDraft(
  draft: string,
  spec: ResourceFormFieldCapability,
): { ok: true; value: unknown } | { ok: false; message: string } {
  const trimmed = draft.trim();
  if (trimmed === "") {
    if (spec.required) {
      return { ok: false, message: "Este campo es obligatorio." };
    }
    return { ok: true, value: null };
  }
  switch (spec.type) {
    case "integer": {
      if (!/^-?\d+$/.test(trimmed)) return { ok: false, message: "Debe ser un entero." };
      return { ok: true, value: Number.parseInt(trimmed, 10) };
    }
    case "decimal": {
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) return { ok: false, message: "Debe ser un número." };
      return { ok: true, value: parsed };
    }
    case "boolean":
      return { ok: true, value: trimmed === "true" };
    default:
      return { ok: true, value: trimmed };
  }
}

function extractApiMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    // Prefiere el error de campo (el payload lleva UN campo) sobre el mensaje global.
    const fieldError = error.body.errors?.find((item) => item.message);
    return fieldError?.message ?? error.body.message;
  }
  return "No se pudo guardar.";
}

export function EditableCell({
  url,
  method,
  spec,
  value,
  children,
}: Readonly<{
  // URL del PATCH del contrato con {id} YA resuelto.
  url: string;
  method: HttpMethod;
  spec: ResourceFormFieldCapability;
  value: unknown;
  children: ReactNode;
}>) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const open = () => {
    setDraft(initialDraft(value));
    setError(null);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setError(null);
  };

  const save = async () => {
    if (saving) return;
    const coerced = coerceDraft(draft, spec);
    if (!coerced.ok) {
      setError(coerced.message);
      return;
    }
    // Sin cambios → cerrar sin request (mismo criterio que una hoja de cálculo).
    if (initialDraft(value) === draft.trim()) {
      cancel();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateResource(url, method, { [spec.name]: coerced.value });
      setEditing(false);
      router.refresh();
    } catch (requestError) {
      setError(extractApiMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <span
        role="button"
        tabIndex={0}
        title="Doble clic para editar"
        onDoubleClick={open}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            open();
          }
        }}
        className="block cursor-cell rounded-[6px] outline-none transition focus-visible:ring-1 focus-visible:ring-[var(--accent-bd)]"
        data-editable-cell
      >
        {children}
      </span>
    );
  }

  const keyHandler = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  };

  const closedOptions =
    spec.type === "boolean"
      ? [
          { value: "true", label: "Sí" },
          { value: "false", label: "No" },
        ]
      : (spec.options ?? undefined);

  return (
    <span className="block" onBlur={(event) => {
      // Guardar al salir de la celda (blur fuera del editor), como en una hoja.
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        void save();
      }
    }}>
      {closedOptions ? (
        <select
          ref={(node) => {
            inputRef.current = node;
          }}
          value={draft}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={keyHandler}
          className={INPUT_CLASS}
          aria-label={`Editar ${spec.label}`}
        >
          {!spec.required ? <option value="">—</option> : null}
          {closedOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          ref={(node) => {
            inputRef.current = node;
          }}
          type={
            spec.type === "integer" || spec.type === "decimal"
              ? "number"
              : spec.type === "date"
                ? "date"
                : "text"
          }
          value={draft}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={keyHandler}
          className={INPUT_CLASS}
          aria-label={`Editar ${spec.label}`}
        />
      )}
      {error ? (
        <span role="alert" className="mt-0.5 block text-[11.5px] leading-tight text-[var(--danger)]">
          {error}
        </span>
      ) : null}
    </span>
  );
}

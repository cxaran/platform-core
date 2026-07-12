"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { ResourceActionCapability } from "@/core/api/contracts";
import {
  isActionEnabled,
  visibleActionsForRow,
} from "@/core/resources/resource-action";
import { executeAction } from "@/core/resources/resource-action-client";

import { ResourceActionConfirmDialog } from "./ResourceActionConfirmDialog";
import { useRowSelection } from "./RowSelection";

/**
 * Barra de acciones en lote: aparece cuando hay filas seleccionadas. Ofrece
 * copiar la selección como TSV (pegable en Excel/Sheets) y ejecutar sobre TODA
 * la selección las acciones de contrato SIN formulario (las de ``input_schema``
 * capturan datos por fila y no tienen semántica de lote).
 *
 * La ejecución es secuencial por fila (el backend revalida permiso y estado en
 * cada una); al terminar se informa cuántas fueron bien/mal y se refresca la
 * lista. Una acción con confirmación declarada abre el MISMO diálogo accesible
 * de las acciones por fila, con el conteo en el mensaje.
 */

type Column = { name: string; label: string };

function tsvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "boolean" ? (value ? "Sí" : "No") : String(value);
  // TSV: tabs/saltos dentro del valor se colapsan a espacio (sin comillas raras).
  return text.replace(/[\t\n\r]+/g, " ");
}

export function BulkActionsBar({
  columns,
  actions,
  placeholder,
}: Readonly<{
  columns: readonly Column[];
  actions: readonly ResourceActionCapability[];
  placeholder: string;
}>) {
  const router = useRouter();
  const { rows, selectedIds, clear } = useRowSelection();
  const [pendingAction, setPendingAction] = useState<ResourceActionCapability | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  if (selectedIds.size === 0) {
    return null;
  }

  const selectedRows = rows.filter((entry) => selectedIds.has(entry.id));
  // Solo acciones sin formulario; la visibilidad/habilitación por estado se
  // reevalúa por fila al ejecutar (aquí basta que aplique a ALGUNA seleccionada).
  const bulkActions = actions.filter(
    (action) =>
      !action.input_schema &&
      selectedRows.some(
        (entry) =>
          visibleActionsForRow([action], entry.row).length > 0 &&
          isActionEnabled(action, entry.row),
      ),
  );

  const copyTsv = async () => {
    const header = columns.map((column) => tsvEscape(column.label)).join("\t");
    const lines = selectedRows.map((entry) =>
      columns.map((column) => tsvEscape(entry.row[column.name])).join("\t"),
    );
    await navigator.clipboard.writeText([header, ...lines].join("\n"));
    setStatus(`${lines.length} fila(s) copiada(s) como TSV.`);
  };

  const run = async (action: ResourceActionCapability) => {
    setRunning(true);
    setStatus(null);
    let ok = 0;
    let failed = 0;
    for (const entry of selectedRows) {
      const applicable =
        visibleActionsForRow([action], entry.row).length > 0 &&
        isActionEnabled(action, entry.row);
      if (!applicable) {
        failed += 1;
        continue;
      }
      try {
        await executeAction(action, placeholder, entry.id);
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    setRunning(false);
    setPendingAction(null);
    setStatus(
      failed === 0
        ? `${action.label}: ${ok} fila(s) procesada(s).`
        : `${action.label}: ${ok} bien, ${failed} con error u omitida(s).`,
    );
    clear();
    router.refresh();
  };

  return (
    <div
      role="toolbar"
      aria-label="Acciones sobre la selección"
      className="flex flex-wrap items-center gap-2 rounded-[12px] border border-[var(--accent-bd)] bg-[var(--accent-dim)] px-3 py-2 text-[12.5px]"
    >
      <span className="font-semibold text-[var(--accent-tx)]">
        {selectedIds.size} seleccionada(s)
      </span>
      <button
        type="button"
        onClick={() => void copyTsv()}
        className="rounded-[9px] border border-[var(--border2)] bg-[var(--panel)] px-2.5 py-1 font-medium text-[var(--tx)] transition hover:border-[var(--accent-bd)]"
      >
        Copiar TSV
      </button>
      {bulkActions.map((action) => (
        <button
          key={action.name}
          type="button"
          disabled={running}
          onClick={() => {
            if (action.confirmation?.required) {
              setPendingAction(action);
            } else {
              void run(action);
            }
          }}
          className={`rounded-[9px] border px-2.5 py-1 font-medium transition disabled:opacity-50 ${
            action.danger
              ? "border-[var(--danger)] bg-[var(--panel)] text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white"
              : "border-[var(--border2)] bg-[var(--panel)] text-[var(--tx)] hover:border-[var(--accent-bd)]"
          }`}
        >
          {action.label}
        </button>
      ))}
      <button
        type="button"
        onClick={clear}
        className="ml-auto font-medium text-[var(--tx3)] transition hover:text-[var(--tx)]"
      >
        Quitar selección
      </button>
      {status ? (
        <span role="status" className="basis-full text-[var(--tx2)]">
          {status}
        </span>
      ) : null}
      {pendingAction?.confirmation ? (
        <ResourceActionConfirmDialog
          confirmation={{
            ...pendingAction.confirmation,
            message: `${pendingAction.confirmation.message} (${selectedIds.size} fila(s) seleccionada(s).)`,
          }}
          pending={running}
          error={null}
          onConfirm={() => void run(pendingAction)}
          onCancel={() => setPendingAction(null)}
        />
      ) : null}
    </div>
  );
}

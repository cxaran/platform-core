"use client";

// Renderer SEGURO de la UI declarativa generada por el modelo (specs de ui-spec.ts). NUNCA se
// inyecta HTML/JS crudo del modelo: solo specs ya validadas por los parsers se mapean a
// componentes React propios. Interacciones: enviar un mensaje de seguimiento (onFollowUp) o
// abrir un enlace de contacto allowlisted (isSafeButtonUrl). Nada muta datos desde aquí.

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  buildFormSubmissionMessage,
  isSafeButtonUrl,
  type ButtonsSpec,
  type ChartDatum,
  type ChartSpec,
  type FormSpec,
  type SuggestedRepliesSpec,
  type UiSpec,
} from "@/core/agent/tools/ui-spec";

export interface GeneratedUiProps {
  spec: UiSpec;
  /** Envía el texto como el SIGUIENTE mensaje del usuario (continúa la conversación). */
  onFollowUp: (message: string) => void;
  /** Deshabilita interacciones (p. ej. mientras corre un turno). */
  disabled?: boolean;
}

function FormView({
  spec,
  onFollowUp,
  disabled,
}: {
  spec: FormSpec;
  onFollowUp: (message: string) => void;
  disabled?: boolean;
}) {
  const initial = useMemo(() => {
    const values: Record<string, string> = {};
    for (const field of spec.fields) {
      values[field.name] = field.value ?? "";
    }
    return values;
  }, [spec]);
  const [values, setValues] = useState(initial);
  const [sent, setSent] = useState(false);

  const setValue = (name: string, value: string) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  const missingRequired = spec.fields.some(
    (field) => field.required && !(values[field.name] ?? "").trim(),
  );

  if (sent) {
    return <p className="text-sm text-[var(--tx3)]">✅ Formulario enviado.</p>;
  }

  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-[var(--border2)] bg-[var(--bg2)] p-4">
      {spec.title ? <h4 className="text-sm font-semibold text-[var(--tx)]">{spec.title}</h4> : null}
      {spec.description ? <p className="text-xs text-[var(--tx3)]">{spec.description}</p> : null}
      {spec.fields.map((field) => (
        <label key={field.name} className="flex flex-col gap-1 text-xs text-[var(--tx2)]">
          <span>
            {field.label}
            {field.required ? " *" : ""}
          </span>
          {field.type === "textarea" ? (
            <textarea
              className="w-full rounded-[11px] border border-[var(--border2)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--tx)] outline-none focus:border-[var(--accent-bd)]"
              rows={3}
              value={values[field.name] ?? ""}
              placeholder={field.placeholder}
              disabled={disabled}
              onChange={(event) => setValue(field.name, event.target.value)}
            />
          ) : field.type === "select" ? (
            <Select
              value={values[field.name] ?? ""}
              disabled={disabled}
              onChange={(event) => setValue(field.name, event.target.value)}
            >
              <option value="">Selecciona…</option>
              {(field.options ?? []).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              type={field.type === "number" ? "number" : "text"}
              value={values[field.name] ?? ""}
              placeholder={field.placeholder}
              disabled={disabled}
              onChange={(event) => setValue(field.name, event.target.value)}
            />
          )}
        </label>
      ))}
      <div>
        <Button
          type="button"
          disabled={disabled || missingRequired}
          onClick={() => {
            setSent(true);
            onFollowUp(buildFormSubmissionMessage(spec, values));
          }}
        >
          {spec.submit_label}
        </Button>
      </div>
    </div>
  );
}

const CHART_COLORS = ["var(--accent)", "#8b8bd9", "#5fb3a1", "#d9a25f"];

function scaleValues(data: readonly ChartDatum[]): { max: number; min: number } {
  const values = data.map((point) => point.value);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  return { max: max === min ? max + 1 : max, min };
}

function BarChart({ data, unit }: { data: ChartDatum[]; unit?: string }) {
  const { max, min } = scaleValues(data);
  const range = max - min;
  return (
    <div className="flex flex-col gap-1.5">
      {data.map((point) => {
        const ratio = Math.max(0.02, (point.value - min) / range);
        return (
          <div key={point.label} className="flex items-center gap-2 text-xs">
            <span className="w-28 shrink-0 truncate text-[var(--tx3)]" title={point.label}>
              {point.label}
            </span>
            <div className="h-4 flex-1 rounded bg-[var(--bg)]">
              <div
                className="h-4 rounded bg-[var(--accent)]"
                style={{ width: `${Math.round(ratio * 100)}%` }}
              />
            </div>
            <span className="w-20 shrink-0 text-right text-[var(--tx2)]">
              {point.value.toLocaleString("es")}
              {unit ? ` ${unit}` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function LineChart({
  series,
  unit,
}: {
  series: { name?: string; data: ChartDatum[] }[];
  unit?: string;
}) {
  const all = series.flatMap((one) => one.data);
  const { max, min } = scaleValues(all);
  const range = max - min;
  const width = 320;
  const height = 120;
  const labels = series[0]?.data.map((point) => point.label) ?? [];

  const toPoints = (data: ChartDatum[]): string =>
    data
      .map((point, index) => {
        const x = data.length === 1 ? width / 2 : (index / (data.length - 1)) * width;
        const y = height - ((point.value - min) / range) * height;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full rounded bg-[var(--bg)]"
        role="img"
        aria-label="Gráfico de líneas"
      >
        {series.map((one, index) => (
          <polyline
            key={one.name ?? index}
            points={toPoints(one.data)}
            fill="none"
            stroke={CHART_COLORS[index % CHART_COLORS.length]}
            strokeWidth="2"
          />
        ))}
      </svg>
      <div className="flex flex-wrap justify-between gap-1 text-[10px] text-[var(--tx3)]">
        {labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      {series.length > 1 || series[0]?.name ? (
        <div className="flex flex-wrap gap-3 text-xs">
          {series.map((one, index) => (
            <span key={one.name ?? index} className="flex items-center gap-1 text-[var(--tx2)]">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
              />
              {one.name ?? `Serie ${index + 1}`}
              {unit ? ` (${unit})` : ""}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProportionsChart({ data }: { data: ChartDatum[] }) {
  const total = data.reduce((sum, point) => sum + Math.max(0, point.value), 0) || 1;
  return (
    <div className="flex flex-col gap-1.5">
      {data.map((point, index) => {
        const pct = Math.max(0, point.value) / total;
        return (
          <div key={point.label} className="flex items-center gap-2 text-xs">
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
            />
            <span className="w-28 shrink-0 truncate text-[var(--tx3)]" title={point.label}>
              {point.label}
            </span>
            <div className="h-3 flex-1 rounded bg-[var(--bg)]">
              <div
                className="h-3 rounded"
                style={{
                  width: `${Math.max(2, Math.round(pct * 100))}%`,
                  background: CHART_COLORS[index % CHART_COLORS.length],
                }}
              />
            </div>
            <span className="w-14 shrink-0 text-right text-[var(--tx2)]">
              {(pct * 100).toFixed(1)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ChartView({ spec }: { spec: ChartSpec }) {
  const series = spec.series ?? (spec.data ? [{ data: spec.data }] : []);
  const single = series[0]?.data ?? [];

  let body: React.ReactNode;
  if (spec.chart_type === "gantt") {
    // Línea de tiempo: render tabular simple (barras proporcionales quedan para una rebanada posterior).
    body = (
      <ul className="flex flex-col gap-1 text-xs text-[var(--tx2)]">
        {(spec.tasks ?? []).map((task) => (
          <li key={`${task.label}-${task.start}`}>
            <span className="font-medium text-[var(--tx)]">{task.label}</span>: {task.start} →{" "}
            {task.end}
            {task.status ? ` (${task.status})` : ""}
          </li>
        ))}
      </ul>
    );
  } else if (spec.chart_type === "pie" || spec.chart_type === "doughnut") {
    body = <ProportionsChart data={single} />;
  } else if (spec.chart_type === "bar") {
    body = <BarChart data={single} unit={spec.unit} />;
  } else {
    body = <LineChart series={series} unit={spec.unit} />;
  }

  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-[var(--border2)] bg-[var(--bg2)] p-4">
      {spec.title ? (
        <h4 className="text-sm font-semibold text-[var(--tx)]">
          {spec.title}
          {spec.unit ? <span className="font-normal text-[var(--tx3)]"> ({spec.unit})</span> : null}
        </h4>
      ) : null}
      {spec.reference_range ? (
        <p className="text-[10px] text-[var(--tx3)]">
          Rango de referencia: {spec.reference_range.label ??
            `${spec.reference_range.low ?? "−∞"} – ${spec.reference_range.high ?? "+∞"}`}
        </p>
      ) : null}
      {body}
    </div>
  );
}

function ButtonsView({
  spec,
  onFollowUp,
  disabled,
}: {
  spec: ButtonsSpec;
  onFollowUp: (message: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-[var(--border2)] bg-[var(--bg2)] p-4">
      {spec.title ? <h4 className="text-sm font-semibold text-[var(--tx)]">{spec.title}</h4> : null}
      <div className="flex flex-wrap gap-2">
        {spec.buttons.map((button) => {
          if (button.action.type === "link") {
            const url = button.action.url;
            if (!isSafeButtonUrl(url)) {
              return null; // URL fuera de la allowlist: no se ofrece.
            }
            return (
              <a
                key={button.label}
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-[11px] border border-[var(--border2)] px-3 py-2 text-xs font-medium text-[var(--tx2)] transition hover:border-[var(--accent-bd)]"
              >
                {button.label} ↗
              </a>
            );
          }
          if (button.action.type === "message") {
            const prompt = button.action.prompt;
            return (
              <Button
                key={button.label}
                type="button"
                className="!px-3 !py-2 !text-xs"
                disabled={disabled}
                onClick={() => onFollowUp(prompt)}
              >
                {button.label}
              </Button>
            );
          }
          // Acciones "tool" requieren el seam de gobernanza (button-actions), aún no portado.
          return null;
        })}
      </div>
    </div>
  );
}

function SuggestedRepliesView({
  spec,
  onFollowUp,
  disabled,
}: {
  spec: SuggestedRepliesSpec;
  onFollowUp: (message: string) => void;
  disabled?: boolean;
}) {
  const [used, setUsed] = useState(false);
  if (used) {
    return null; // Interfaz de un solo uso: los chips se contraen al elegir.
  }
  return (
    <div className="flex flex-col gap-2">
      {spec.title ? <p className="text-xs text-[var(--tx3)]">{spec.title}</p> : null}
      <div className="flex flex-wrap gap-2">
        {spec.replies.map((reply) => (
          <button
            key={reply}
            type="button"
            className="rounded-full border border-[var(--border2)] px-3 py-1.5 text-xs text-[var(--tx2)] transition hover:border-[var(--accent-bd)] hover:text-[var(--tx)] disabled:opacity-50"
            disabled={disabled}
            onClick={() => {
              setUsed(true);
              onFollowUp(reply);
            }}
          >
            {reply}
          </button>
        ))}
      </div>
    </div>
  );
}

export function GeneratedUi({ spec, onFollowUp, disabled }: GeneratedUiProps) {
  switch (spec.kind) {
    case "form":
      return <FormView spec={spec} onFollowUp={onFollowUp} disabled={disabled} />;
    case "chart":
      return <ChartView spec={spec} />;
    case "buttons":
      return <ButtonsView spec={spec} onFollowUp={onFollowUp} disabled={disabled} />;
    case "suggested_replies":
      return <SuggestedRepliesView spec={spec} onFollowUp={onFollowUp} disabled={disabled} />;
    case "resource_form":
      // El formulario de recurso embebido (InlineResourceForm) llega en una rebanada posterior.
      return (
        <p className="text-xs text-[var(--tx3)]">
          Usa el formulario del recurso en la sección{" "}
          <a className="underline" href={`/resources/${encodeURIComponent(spec.resource)}`}>
            {spec.resource}
          </a>
          .
        </p>
      );
    default:
      return null;
  }
}

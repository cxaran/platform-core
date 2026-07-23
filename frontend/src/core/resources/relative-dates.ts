/**
 * Presets de fecha relativa para el filtro ``between`` de calendario.
 *
 * Composición pura sobre los operadores de calendario ya existentes: un preset calcula
 * el rango civil (``from``/``to``, ``YYYY-MM-DD``) en la zona horaria que el contrato
 * publica para el campo (``calendar_timezone``) y lo aplica a los dos parámetros del
 * rango. No es un operador nuevo del backend: el backend recibe fechas civiles como
 * siempre y resuelve los límites de día en esa misma zona.
 */

export type RelativeDatePreset = {
  key: string;
  label: string;
  range: (timezone: string) => { from: string; to: string };
};

type Civil = { year: number; month: number; day: number };

/** Fecha civil de "hoy" en la zona indicada (nunca la del navegador). */
function todayCivil(timezone: string): Civil {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function toIso({ year, month, day }: Civil): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/**
 * Aritmética de calendario puro sobre una fecha civil (sin zona): usa ``Date.UTC`` solo
 * como calculadora de calendario — la zona ya se aplicó al obtener el "hoy" civil.
 */
function addDays(civil: Civil, delta: number): Civil {
  const date = new Date(Date.UTC(civil.year, civil.month - 1, civil.day));
  date.setUTCDate(date.getUTCDate() + delta);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export const RELATIVE_DATE_PRESETS: readonly RelativeDatePreset[] = [
  {
    key: "today",
    label: "Hoy",
    range: (tz) => {
      const today = toIso(todayCivil(tz));
      return { from: today, to: today };
    },
  },
  {
    key: "last_7_days",
    label: "Últimos 7 días",
    range: (tz) => {
      const today = todayCivil(tz);
      return { from: toIso(addDays(today, -6)), to: toIso(today) };
    },
  },
  {
    key: "last_30_days",
    label: "Últimos 30 días",
    range: (tz) => {
      const today = todayCivil(tz);
      return { from: toIso(addDays(today, -29)), to: toIso(today) };
    },
  },
  {
    key: "this_month",
    label: "Este mes",
    range: (tz) => {
      const today = todayCivil(tz);
      return { from: toIso({ ...today, day: 1 }), to: toIso(today) };
    },
  },
  {
    key: "this_year",
    label: "Este año",
    range: (tz) => {
      const today = todayCivil(tz);
      return { from: toIso({ year: today.year, month: 1, day: 1 }), to: toIso(today) };
    },
  },
];

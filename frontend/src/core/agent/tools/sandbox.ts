// Sandbox de JS para el agente (B9, Parte A). El código del modelo se ejecuta en un
// Web Worker creado desde un Blob: un Worker NO tiene acceso a document, cookie,
// localStorage ni window del padre (aislamiento inherente del navegador). Además aquí
// se deshabilita explícitamente la red (fetch/XHR/importScripts) y se aplica un timeout
// para cortar loops infinitos. No hay eval en el hilo principal.

export interface SandboxOutcome {
  ok: boolean;
  value?: unknown;
  error?: string;
  logs: string[];
  timedOut?: boolean;
}

export interface SandboxOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export type SandboxRunner = (code: string, options?: SandboxOptions) => Promise<SandboxOutcome>;

export const SANDBOX_DEFAULT_TIMEOUT_MS = 2500;
export const SANDBOX_DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;

// Fuente del worker. Se ejecuta el código del modelo vía `new Function(...)` (sin acceso
// al scope externo) con un console capturado; antes se anula la red. document/cookie/
// localStorage no existen en un Worker, por eso no se exponen.
export const SANDBOX_WORKER_SOURCE = `
self.onmessage = function (event) {
  var logs = [];
  var record = function () {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      try { parts.push(typeof a === "string" ? a : JSON.stringify(a)); }
      catch (e) { parts.push(String(a)); }
    }
    logs.push(parts.join(" "));
  };
  var sandboxConsole = { log: record, info: record, warn: record, error: record, debug: record };
  try { self.fetch = function () { throw new Error("Red deshabilitada en el sandbox"); }; } catch (e) {}
  try { self.XMLHttpRequest = function () { throw new Error("Red deshabilitada en el sandbox"); }; } catch (e) {}
  try { self.WebSocket = function () { throw new Error("Red deshabilitada en el sandbox"); }; } catch (e) {}
  try { self.importScripts = function () { throw new Error("importScripts deshabilitado"); }; } catch (e) {}
  try {
    var runner = new Function("console", '"use strict";' + String(event.data.code));
    var value = runner(sandboxConsole);
    self.postMessage({ ok: true, value: value, logs: logs });
  } catch (err) {
    self.postMessage({ ok: false, error: (err && err.message) ? String(err.message) : String(err), logs: logs });
  }
};
`;

function clampText(text: string, maxBytes: number): string {
  return text.length > maxBytes ? `${text.slice(0, maxBytes)}… (salida truncada)` : text;
}

export function clampOutcome(outcome: SandboxOutcome, maxBytes: number): SandboxOutcome {
  const logs = (outcome.logs ?? []).map((line) => clampText(String(line), maxBytes)).slice(0, 200);
  let value = outcome.value;
  try {
    const serialized = JSON.stringify(value ?? null);
    if (serialized.length > maxBytes) {
      value = `${serialized.slice(0, maxBytes)}… (valor truncado)`;
    }
  } catch {
    value = "[valor no serializable]";
  }
  return { ...outcome, value, logs };
}

function normalizeOutcome(data: unknown): SandboxOutcome {
  if (!data || typeof data !== "object") {
    return { ok: false, error: "Respuesta inválida del sandbox.", logs: [] };
  }
  const record = data as Record<string, unknown>;
  return {
    ok: record.ok === true,
    value: record.value,
    error: typeof record.error === "string" ? record.error : undefined,
    logs: Array.isArray(record.logs) ? record.logs.map((line) => String(line)) : [],
  };
}

/**
 * Runner real en el navegador: crea el Worker desde un Blob, le pasa el código y resuelve
 * con el resultado. Nunca rechaza: cualquier fallo (incl. timeout o no poder crear el
 * worker) se devuelve como SandboxOutcome con ok:false para que la tool lo traduzca a un
 * tool_result de error sin romper el panel.
 */
export const browserSandboxRunner: SandboxRunner = (code, options) => {
  const timeoutMs = options?.timeoutMs ?? SANDBOX_DEFAULT_TIMEOUT_MS;
  const maxBytes = options?.maxOutputBytes ?? SANDBOX_DEFAULT_MAX_OUTPUT_BYTES;

  return new Promise<SandboxOutcome>((resolve) => {
    let worker: Worker;
    let url = "";
    try {
      const blob = new Blob([SANDBOX_WORKER_SOURCE], { type: "application/javascript" });
      url = URL.createObjectURL(blob);
      worker = new Worker(url);
    } catch {
      resolve({ ok: false, error: "No se pudo crear el sandbox.", logs: [] });
      return;
    }

    let settled = false;
    const cleanup = (): void => {
      try {
        worker.terminate();
      } catch {
        /* noop */
      }
      try {
        if (url) URL.revokeObjectURL(url);
      } catch {
        /* noop */
      }
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ok: false, timedOut: true, error: `Tiempo de ejecución agotado (>${timeoutMs}ms).`, logs: [] });
    }, timeoutMs);

    worker.onmessage = (event: MessageEvent) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(clampOutcome(normalizeOutcome(event.data), maxBytes));
    };

    worker.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve({ ok: false, error: "Error en el sandbox.", logs: [] });
    };

    worker.postMessage({ code });
  });
};

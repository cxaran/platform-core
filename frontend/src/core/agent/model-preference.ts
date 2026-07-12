// Preferencia del MODELO del agente: qué modelo eligió el usuario en el selector del copiloto. Se
// guarda en el navegador (localStorage), NO en la cuenta, porque la disponibilidad de modelos
// depende de las credenciales/proveedores configurados en ESTE dispositivo y se negocia por sesión.
// El selector vive en el composer del chat; al reconectar se restaura la última selección SIEMPRE
// que ese modelo siga disponible en la lista negociada (si no, cae al primero disponible).

const STORAGE_KEY = "platform-core.copilot.agent.model";

/** Lee el id del último modelo seleccionado (null si no hay valor o no hay almacenamiento). */
export function loadPreferredModelId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/** Persiste el id del modelo seleccionado para restaurarlo en la próxima sesión. */
export function savePreferredModelId(modelId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, modelId);
  } catch {
    // Almacenamiento no disponible (modo privado, cuota): la selección queda solo en memoria.
  }
}

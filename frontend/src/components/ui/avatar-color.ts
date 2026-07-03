/*
 * avatarColor — color determinista para los avatares de iniciales.
 * El diseno (el handoff de diseño (Platform Core.dc.html)) asigna a cada usuario un color de la paleta
 * `AV`. Como aqui los pacientes son dinamicos, derivamos el color por hash
 * estable de una clave (id), reproduciendo la sensacion de avatares de colores
 * del diseno sin depender de datos de demo.
 */

// Paleta `AV` del diseno (mas algunos tonos extra para mejor reparto).
const PALETTE = [
  "#db6aa0",
  "#4f8ef7",
  "#9b7bf0",
  "#e08a4b",
  "#3bb98f",
  "#e0607a",
  "#5b8def",
  "#2fa37a",
  "#cf6fa6",
  "#7c6ee6",
] as const;

export function avatarColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

// Degradado de marca del diseno para la identidad del medico en el pie.
export const BRAND_AVATAR_GRADIENT = "linear-gradient(135deg,#2dd4bf,#3b82f6)";

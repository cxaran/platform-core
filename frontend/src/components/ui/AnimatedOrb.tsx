/*
 * AnimatedOrb — el orbe gradiente animado, elemento de marca de Platform Core.
 * Portado de la funcion `orb(size, variant)` de el handoff de diseño (Platform Core.dc.html):
 * un contenedor circular con rotacion de matiz (hue-rotate), cinco circulos
 * de colores en orbita bajo una capa de desenfoque, y un brillo superior.
 *
 * Difiere del handoff SOLO en que NO lleva box-shadow (decision de Jordan,
 * 2026-07-02): Chrome/Windows rasteriza mal la sombra de un elemento que anima
 * `filter` o contiene capas de filtros animados (ignora el border-radius y la
 * pinta como columna rectangular cortada), asi que se elimino. El interior
 * (blur + hue-rotate juntos en una capa, keyframes orb-hue-rotate-blur) se
 * conserva tal cual el handoff: separar blur y hue en capas anidadas rompe el
 * clipping del desenfoque (el glow desborda el circulo del orbe).
 *
 * Es marcado puro (sin estado ni hooks), valido tanto en arboles server como
 * client. Las animaciones viven en globals.css (orb-hue-rotate,
 * orb-hue-rotate-blur, orb-orbit-1..5).
 */
import type { CSSProperties } from "react";

type OrbVariant = "default" | "red";

const PALETTES: Record<OrbVariant, { bg: string; cols: [string, string, string, string, string] }> = {
  default: { bg: "#cff1f4", cols: ["#9e9fef", "#c471ec", "#9bc761", "#ccd4f2", "#f472b6"] },
  red: { bg: "#fef2f2", cols: ["#ef4444", "#f87171", "#dc2626", "#fca5a5", "#fb7185"] },
};

const CIRCLE_SCALE = [0.45, 0.35, 0.5, 0.25, 0.3] as const;
const CIRCLE_OPACITY = [0.9, 0.85, 0.9, 0.8, 0.85] as const;

export type AnimatedOrbProps = {
  /** Diametro del orbe en px (116 hero, 84 login, 40 enviar, 30 marca/chat). */
  size?: number;
  variant?: OrbVariant;
  className?: string;
  style?: CSSProperties;
};

export function AnimatedOrb({ size = 30, variant = "default", className, style }: AnimatedOrbProps) {
  const palette = PALETTES[variant];
  const blur = Math.max(5, size * 0.15);

  return (
    <div
      aria-hidden="true"
      className={className}
      style={{
        position: "relative",
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        flex: "0 0 auto",
        backgroundColor: palette.bg,
        animation: "orb-hue-rotate 8s linear infinite",
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // consumido por orb-hue-rotate-blur
          ["--orb-blur" as string]: `${blur}px`,
          animation: "orb-hue-rotate-blur 6s linear infinite reverse",
        }}
      >
        {palette.cols.map((color, i) => (
          <div
            key={color}
            className={`orb-c${i + 1}`}
            style={{
              position: "absolute",
              borderRadius: "50%",
              width: size * CIRCLE_SCALE[i],
              height: size * CIRCLE_SCALE[i],
              opacity: CIRCLE_OPACITY[i],
              backgroundColor: color,
            }}
          />
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          pointerEvents: "none",
          background: "linear-gradient(to bottom, rgba(255,255,255,.4) 0%, transparent 100%)",
        }}
      />
    </div>
  );
}

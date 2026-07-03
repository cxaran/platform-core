import Link from "next/link";

/**
 * Enlace de "atrás" discreto y reutilizable para las páginas de recurso. Es un destino DETERMINISTA
 * (Link a una ruta), no ``router.back()`` del historial: así "volver" siempre lleva al índice/listado
 * esperado aunque el usuario llegara por una URL directa o desde la barra lateral.
 */
export function BackLink({
  href,
  label,
}: Readonly<{ href: string; label: string }>) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 transition hover:text-slate-900"
    >
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
      {label}
    </Link>
  );
}

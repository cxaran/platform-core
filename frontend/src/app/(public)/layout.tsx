import { AnalyticsLoader } from "@/components/analytics/AnalyticsLoader";

// Layout del grupo PÚBLICO: la analítica (GA4, opcional y con consentimiento)
// vive aquí a propósito — el panel de administración nunca se mide.
export default function PublicLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      {children}
      <AnalyticsLoader />
    </>
  );
}

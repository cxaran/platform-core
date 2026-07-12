import { AccountPasswordForm } from "@/components/account/AccountPasswordForm";
import { AccountProfileForm } from "@/components/account/AccountProfileForm";
import { AiProvidersPanel } from "@/components/account/AiProvidersPanel";
import { requireSession } from "@/core/auth/session";
import { getProfile } from "@/core/auth/account-client";

/**
 * Mi cuenta: flujo dedicado de identidad autenticada (no es el editor genérico de
 * ``users``). El usuario edita solo campos propios seguros y cambia su contraseña;
 * roles, permisos y estado administrativo no se exponen aquí.
 */
export default async function AccountPage() {
  await requireSession();
  const profile = await getProfile();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Mi cuenta</h1>
        <p className="mt-1 text-sm text-slate-500">Administra tus datos personales y tu contraseña.</p>
      </div>
      <AccountProfileForm profile={profile} />
      <AccountPasswordForm />
      <AiProvidersPanel />
    </div>
  );
}

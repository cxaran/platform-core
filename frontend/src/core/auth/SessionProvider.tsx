"use client";

import { createContext, useContext } from "react";

import { SessionUser } from "./types";

type SessionContextValue = {
  session: SessionUser;
  hasPermission: (permission: string) => boolean;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({
  initialSession,
  children,
}: Readonly<{
  initialSession: SessionUser;
  children: React.ReactNode;
}>) {
  const permissions = new Set(initialSession.permissions ?? []);

  return (
    <SessionContext.Provider
      value={{
        session: initialSession,
        hasPermission: (permission) => permissions.has(permission),
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSession debe usarse dentro de SessionProvider");
  }
  return value;
}

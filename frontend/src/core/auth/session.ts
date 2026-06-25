import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ApiRequestError } from "@/core/api/api-error";
import { serverApi } from "@/core/api/server-client";
import { SessionUser } from "./types";

export async function getSession(): Promise<SessionUser | null> {
  const cookieHeader = (await cookies()).toString();

  try {
    return await serverApi<SessionUser>("/api/v1/auth/me", {
      cookie: cookieHeader,
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

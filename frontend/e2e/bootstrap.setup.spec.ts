import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

const adminEmail = "admin.e2e@example.com";
const adminPassword = "E2e-password-123";
const appBaseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:31080";
const repoRoot = resolve(process.cwd(), "..");
const composeFile = resolve(repoRoot, "compose.e2e.yml");

function composeExec(args: string[]): string {
  return execFileSync("docker", ["compose", "-f", composeFile, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

function queryScalar(sql: string): string {
  return composeExec([
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "platform",
    "-d",
    "platform_core_e2e_test",
    "-t",
    "-A",
    "-c",
    sql,
  ]);
}

async function expectNoClientAuthStorage(page: Page) {
  await expect.poll(async () => page.evaluate(() => localStorage.length)).toBe(0);
  await expect.poll(async () => page.evaluate(() => sessionStorage.length)).toBe(0);
}

async function directSecondInitializeAttempt(request: APIRequestContext) {
  return request.post("/api/v1/bootstrap/initialize", {
    data: {
      user: {
        name: "Second",
        last_name: "Attempt",
        email: "second.e2e@example.com",
        password: "Second-password-123",
        confirm_password: "Second-password-123",
      },
    },
  });
}

test.describe.serial("fresh install bootstrap flow", () => {
  test("root redirects to setup, bootstrap completes, login works, setup closes", async ({ page, context, request }) => {
    const apiRequests: string[] = [];
    page.on("request", (requestEvent) => {
      const url = requestEvent.url();
      if (url.includes("/api/")) apiRequests.push(url);
    });

    await page.goto("/");
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByRole("heading", { name: "Instalación inicial segura" })).toBeVisible();
    await expect(page.getByLabel("Token de Bootstrap")).toHaveCount(0);

    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.locator("#setup-name")).toBeFocused();
    await expect(page.locator("#setup-email")).toHaveJSProperty("validity.valid", false);

    await page.getByLabel("Nombre").fill("Admin");
    await page.getByLabel("Apellido").fill("Platform");
    await page.getByLabel("Email").fill(adminEmail);
    await page.getByLabel("Contraseña", { exact: true }).fill(adminPassword);
    await page.getByLabel("Confirmar contraseña").fill(adminPassword);
    await page.getByRole("button", { name: "Continuar" }).click();

    await expect(page.getByRole("heading", { name: "Roles iniciales" })).toBeVisible();
    await expect(page.getByText("Permisos completos administrados por backend")).toBeVisible();
    await expect(page.getByRole("button", { name: "Agregar rol" })).toBeEnabled();
    await page.getByRole("button", { name: "Agregar rol" }).click();
    await page.getByLabel("Nombre").last().fill("Operación");
    await page.getByLabel("Descripción").last().fill("Rol operativo inicial");
    await page.getByLabel("Listar usuarios").check();
    await expect(page.getByLabel("Asignar también al administrador inicial")).not.toBeChecked();

    await page.getByRole("button", { name: "Completar Bootstrap" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(adminPassword);

    const secondAttempt = await directSecondInitializeAttempt(request);
    expect(secondAttempt.status()).toBe(409);

    await page.getByLabel("Email").fill(adminEmail);
    await page.getByLabel("Contraseña").fill(adminPassword);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText("Platform Core")).toBeVisible();
    await expectNoClientAuthStorage(page);

    const cookies = await context.cookies();
    const sessionCookie = cookies.find((cookie) => cookie.name === "session_token");
    expect(sessionCookie?.httpOnly).toBe(true);

    await page.goto("/setup");
    await expect(page).toHaveURL(/\/$/);

    const freshContext = await context.browser()!.newContext({ baseURL: appBaseUrl });
    const freshPage = await freshContext.newPage();
    await freshPage.goto("/resources/users");
    await expect(freshPage).toHaveURL(/\/login$/);
    await freshPage.goto("/login");
    await expect(freshPage).toHaveURL(/\/login$/);
    await freshContext.close();

    expect(apiRequests.some((url) => url.includes("/api/v1/bootstrap/catalog"))).toBe(true);
    expect(apiRequests.some((url) => url.includes("/api/v1/bootstrap/initialize"))).toBe(true);
    expect(apiRequests.every((url) => url.startsWith(appBaseUrl))).toBe(true);

    expect(queryScalar("select status from platform_setup where id = 1;")).toBe("completed");
    expect(queryScalar("select count(*) from \"user\";")).toBe("1");
    expect(queryScalar("select count(*) from role;")).toBe("2");
    expect(queryScalar("select count(*) from user_role;")).toBe("1");
    const systemAdminPermissions = queryScalar(`
      select count(*)
      from role_access ra
      join platform_setup ps on ps.system_admin_role_id = ra.role_id
      where ra.is_active = true;
    `);
    const declaredPermissions = queryScalar("select count(distinct access) from role_access;");
    expect(systemAdminPermissions).toBe(declaredPermissions);
  });
});

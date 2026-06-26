import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { test, expect, type Page, type APIRequestContext, type BrowserContext } from "@playwright/test";

const adminEmail = "admin.e2e@example.com";
const adminPassword = "E2e-password-123";
const standardEmail = "usuario.e2e@example.com";
const standardPassword = "User-password-123";
const supportRoleName = "Soporte E2E";
const systemAdminRoleName = "Administrador de plataforma";
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

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Ingresar" }).click();
}

// Abre el editor relacional de una fila (por email visible) y su relación.
async function openRowRelation(page: Page, rowText: string, relationLabel: string) {
  await page.goto("/resources/users");
  await page
    .getByRole("row", { name: new RegExp(rowText) })
    .getByRole("link", { name: relationLabel })
    .click();
}

test.describe.serial("fresh install bootstrap and admin relations", () => {
  test("bootstrap, generic create, relation editing, session invalidation and admin survival", async ({
    page,
    context,
    request,
  }) => {
    const apiRequests: string[] = [];
    page.on("request", (requestEvent) => {
      const url = requestEvent.url();
      if (url.includes("/api/")) apiRequests.push(`${requestEvent.method()} ${url}`);
    });

    await test.step("Instalación inicial desde cero y cierre de Bootstrap", async () => {
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
    });

    await test.step("Login del administrador inicial", async () => {
      await page.getByLabel("Email").fill(adminEmail);
      await page.getByLabel("Contraseña").fill(adminPassword);
      await page.getByRole("button", { name: "Ingresar" }).click();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByText("Platform Core")).toBeVisible();
      await expectNoClientAuthStorage(page);

      const cookies = await context.cookies();
      const sessionCookie = cookies.find((cookie) => cookie.name === "session_token");
      expect(sessionCookie?.httpOnly).toBe(true);
    });

    await test.step("Crear rol con el formulario genérico", async () => {
      await page.goto("/resources/roles");
      await expect(page.getByRole("heading", { name: "Roles" })).toBeVisible();
      await page.getByRole("link", { name: "Nuevo" }).click();
      await expect(page.getByRole("heading", { name: "Crear Roles" })).toBeVisible();
      await page.getByLabel("Nombre").fill(supportRoleName);
      await page.getByLabel("Descripción").fill("Rol creado desde el formulario genérico");
      await page.getByRole("button", { name: "Crear" }).click();
      await expect(page).toHaveURL(/\/resources\/roles$/);
      await expect(page.getByText(supportRoleName)).toBeVisible();
    });

    await test.step("Crear usuario con el formulario genérico", async () => {
      await page.goto("/resources/users");
      await expect(page.getByRole("heading", { name: "Usuarios" })).toBeVisible();
      await page.getByRole("link", { name: "Nuevo" }).click();
      await expect(page.getByRole("heading", { name: "Crear Usuarios" })).toBeVisible();
      await page.getByLabel("Nombre").fill("Usuario");
      await page.getByLabel("Apellido").fill("Estandar");
      await page.getByLabel("Correo").fill(standardEmail);
      await page.getByLabel("Contraseña", { exact: true }).fill(standardPassword);
      await page.getByLabel("Confirmar contraseña").fill(standardPassword);
      await expect(page.getByLabel("Activo")).not.toBeChecked();
      await page.getByLabel("Activo").check();
      await page.getByRole("button", { name: "Crear" }).click();
      await expect(page).toHaveURL(/\/resources\/users$/);
      await expect(page.getByText(standardEmail)).toBeVisible();
    });

    await test.step("Vista grouped_catalog de permisos", async () => {
      await page.goto("/resources/permissions");
      await expect(
        page.getByRole("heading", { name: "Permisos", exact: true, level: 1 }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Usuarios", level: 2 }),
      ).toBeVisible();
      await expect(page.getByText("Listar usuarios")).toBeVisible();
    });

    await test.step("Asignar rol al usuario con el editor relacional", async () => {
      await openRowRelation(page, standardEmail, "Roles");
      await expect(page).toHaveURL(/\/roles$/);
      await page.getByLabel(supportRoleName).check();
      await page.getByRole("button", { name: "Guardar" }).click();
      await expect(page).toHaveURL(/\/resources\/users$/);

      expect(
        queryScalar(
          `select count(*) from user_role ur
           join "user" u on u.id = ur.user_id
           join role r on r.id = ur.role_id
           where u.email = '${standardEmail}' and r.name = '${supportRoleName}';`,
        ),
      ).toBe("1");
    });

    await test.step("Cambiar roles invalida la sesión previa del usuario", async () => {
      const userContext: BrowserContext = await context.browser()!.newContext({ baseURL: appBaseUrl });
      const userPage = await userContext.newPage();
      await login(userPage, standardEmail, standardPassword);
      await expect(userPage).toHaveURL(/\/$/);
      await expect(userPage.getByText("Platform Core")).toBeVisible();

      const tokenBefore = queryScalar(`select token from "user" where email = '${standardEmail}';`);

      // El administrador retira el rol: rota el token del usuario afectado.
      await openRowRelation(page, standardEmail, "Roles");
      await page.getByLabel(supportRoleName).uncheck();
      await page.getByRole("button", { name: "Guardar" }).click();
      await expect(page).toHaveURL(/\/resources\/users$/);

      const tokenAfter = queryScalar(`select token from "user" where email = '${standardEmail}';`);
      expect(tokenAfter).not.toBe(tokenBefore);

      // La sesión previa del usuario deja de funcionar.
      await userPage.goto("/");
      await expect(userPage).toHaveURL(/\/login$/);
      await userContext.close();
    });

    await test.step("Bloquear la pérdida del último administrador", async () => {
      await openRowRelation(page, adminEmail, "Roles");
      await expect(page).toHaveURL(/\/roles$/);
      await page.getByLabel(systemAdminRoleName).uncheck();
      await page.getByRole("button", { name: "Guardar" }).click();

      // El backend bloquea con un mensaje de negocio seguro y la UI no redirige.
      // Se acota la alerta al formulario del editor para excluir el route announcer
      // de Next.js, que también expone role="alert".
      await expect(
        page.getByRole("form", { name: "Roles" }).getByRole("alert"),
      ).toContainText("cobertura administrativa");
      await expect(page).toHaveURL(/\/roles$/);

      // La cobertura del administrador y su sesión siguen intactas.
      expect(
        queryScalar(
          `select count(*) from user_role ur
           join "user" u on u.id = ur.user_id
           where u.email = '${adminEmail}';`,
        ),
      ).toBe("1");
      await page.goto("/resources/users");
      await expect(page.getByRole("heading", { name: "Usuarios" })).toBeVisible();
    });

    await test.step("Bootstrap cerrado y datos persistidos", async () => {
      await page.goto("/setup");
      await expect(page).toHaveURL(/\/$/);

      expect(apiRequests.some((entry) => entry.includes("/api/v1/bootstrap/catalog"))).toBe(true);
      expect(apiRequests.some((entry) => entry === `POST ${appBaseUrl}/api/v1/bootstrap/initialize`)).toBe(true);
      expect(apiRequests.some((entry) => entry === `POST ${appBaseUrl}/api/v1/roles`)).toBe(true);
      expect(apiRequests.some((entry) => entry === `POST ${appBaseUrl}/api/v1/users`)).toBe(true);
      expect(apiRequests.every((entry) => entry.split(" ")[1]?.startsWith(appBaseUrl))).toBe(true);

      expect(queryScalar("select status from platform_setup where id = 1;")).toBe("completed");
      expect(queryScalar('select count(*) from "user";')).toBe("2");
      expect(queryScalar("select count(*) from role;")).toBe("3");
      expect(queryScalar(`select count(*) from role where name = '${supportRoleName}';`)).toBe("1");
      expect(queryScalar(`select count(*) from "user" where email = '${standardEmail}';`)).toBe("1");
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
});

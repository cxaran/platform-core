import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { test, expect, type Page, type APIRequestContext, type BrowserContext } from "@playwright/test";

const adminEmail = "admin.e2e@example.com";
const adminPassword = "E2e-password-123";
const standardEmail = "usuario.e2e@example.com";
const updatedEmail = "usuario.actualizado@example.com";
const standardPassword = "User-password-123";
const supportRoleName = "Soporte E2E";
const updatedRoleName = "Soporte Actualizado";
const systemAdminRoleName = "Administrador de plataforma";
const actionUserEmail = "acciones.e2e@example.com";
const actionUserPassword = "Action-password-123";
const actionRoleName = "Rol Acciones";
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

// Abre una acción de fila (editar o editor relacional) navegando primero al listado.
async function openRowAction(
  page: Page,
  listPath: string,
  rowText: string,
  actionLabel: string,
) {
  await page.goto(listPath);
  await page
    .getByRole("row", { name: new RegExp(rowText) })
    .getByRole("link", { name: actionLabel })
    .click();
}

// Clic en un botón de acción declarativa dentro de una fila (no un enlace).
// ``exact`` evita que "Activar" coincida con "Desactivar" (substring por defecto).
async function clickRowButton(
  page: Page,
  listPath: string,
  rowText: string,
  buttonLabel: string,
) {
  await page.goto(listPath);
  await page
    .getByRole("row", { name: new RegExp(rowText) })
    .getByRole("button", { name: buttonLabel, exact: true })
    .click();
}

// Confirma (o cancela) dentro del diálogo accesible con matching exacto.
async function clickDialogButton(page: Page, buttonLabel: string) {
  await page.getByRole("dialog").getByRole("button", { name: buttonLabel, exact: true }).click();
}

async function createUserViaForm(
  page: Page,
  user: { name: string; last: string; email: string; password: string },
) {
  await page.goto("/resources/users");
  await page.getByRole("link", { name: "Nuevo" }).click();
  await expect(page.getByRole("heading", { name: "Crear Usuarios" })).toBeVisible();
  await page.getByLabel("Nombre").fill(user.name);
  await page.getByLabel("Apellido").fill(user.last);
  await page.getByLabel("Correo").fill(user.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(user.password);
  await page.getByLabel("Confirmar contraseña").fill(user.password);
  await page.getByLabel("Activo").check();
  await page.getByRole("button", { name: "Crear" }).click();
  await expect(page).toHaveURL(/\/resources\/users$/);
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
      await openRowAction(page, "/resources/users", standardEmail, "Roles");
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
      await openRowAction(page, "/resources/users", standardEmail, "Roles");
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
      await openRowAction(page, "/resources/users", adminEmail, "Roles");
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

    await test.step("Editar rol con generic update", async () => {
      await openRowAction(page, "/resources/roles", supportRoleName, "Editar");
      await expect(page).toHaveURL(/\/edit$/);
      await expect(page.getByRole("heading", { name: "Editar Roles" })).toBeVisible();
      await page.getByLabel("Nombre").fill(updatedRoleName);
      await page.getByLabel("Descripción").fill("Rol actualizado desde generic update");
      await page.getByRole("button", { name: "Guardar" }).click();
      await expect(page).toHaveURL(/\/resources\/roles$/);
      await expect(page.getByText(updatedRoleName)).toBeVisible();

      expect(queryScalar(`select count(*) from role where name = '${updatedRoleName}';`)).toBe("1");
      expect(queryScalar(`select count(*) from role where name = '${supportRoleName}';`)).toBe("0");
    });

    await test.step("Editar usuario con generic update", async () => {
      await openRowAction(page, "/resources/users", standardEmail, "Editar");
      await expect(page).toHaveURL(/\/edit$/);
      await expect(page.getByRole("heading", { name: "Editar Usuarios" })).toBeVisible();
      await page.getByLabel("Nombre").fill("Usuario");
      await page.getByLabel("Apellido").fill("Actualizado");
      await page.getByRole("button", { name: "Guardar" }).click();
      await expect(page).toHaveURL(/\/resources\/users$/);
      await expect(page.getByText("Actualizado")).toBeVisible();

      expect(
        queryScalar(
          `select count(*) from "user" where email = '${standardEmail}' and last_name = 'Actualizado';`,
        ),
      ).toBe("1");
    });

    await test.step("Cambiar email invalida la sesión previa del usuario", async () => {
      const userContext: BrowserContext = await context.browser()!.newContext({ baseURL: appBaseUrl });
      const userPage = await userContext.newPage();
      await login(userPage, standardEmail, standardPassword);
      await expect(userPage).toHaveURL(/\/$/);

      const tokenBefore = queryScalar(`select token from "user" where email = '${standardEmail}';`);

      await openRowAction(page, "/resources/users", standardEmail, "Editar");
      await expect(page).toHaveURL(/\/edit$/);
      // Se acota al formulario: el enlace de orden de la tabla expone aria-label
      // "Ordenar por Correo...", que de otro modo colisiona con getByLabel("Correo").
      await page
        .getByRole("form", { name: "Editar Usuarios" })
        .getByLabel("Correo")
        .fill(updatedEmail);
      await page.getByRole("button", { name: "Guardar" }).click();
      await expect(page).toHaveURL(/\/resources\/users$/);

      const tokenAfter = queryScalar(`select token from "user" where email = '${updatedEmail}';`);
      expect(tokenAfter).not.toBe(tokenBefore);

      await userPage.goto("/");
      await expect(userPage).toHaveURL(/\/login$/);
      await userContext.close();
    });

    await test.step("Bloquear desactivar al último administrador vía update", async () => {
      await openRowAction(page, "/resources/users", adminEmail, "Editar");
      await expect(page).toHaveURL(/\/edit$/);
      await expect(page.getByLabel("Activo")).toBeChecked();
      await page.getByLabel("Activo").uncheck();
      await page.getByRole("button", { name: "Guardar" }).click();

      await expect(
        page.getByRole("form", { name: "Editar Usuarios" }).getByRole("alert"),
      ).toContainText("cobertura administrativa");

      expect(queryScalar(`select is_active from "user" where email = '${adminEmail}';`)).toBe("t");
      await page.goto("/resources/users");
      await expect(page.getByRole("heading", { name: "Usuarios" })).toBeVisible();
    });

    await test.step("Revocar sesiones: cancelar no muta, confirmar invalida", async () => {
      await createUserViaForm(page, {
        name: "Acciones",
        last: "Usuario",
        email: actionUserEmail,
        password: actionUserPassword,
      });

      const userContext: BrowserContext = await context.browser()!.newContext({ baseURL: appBaseUrl });
      const userPage = await userContext.newPage();
      await login(userPage, actionUserEmail, actionUserPassword);
      await expect(userPage).toHaveURL(/\/$/);

      const tokenBefore = queryScalar(`select token from "user" where email = '${actionUserEmail}';`);

      // Cancelar la confirmación no debe ejecutar ninguna mutación.
      await clickRowButton(page, "/resources/users", actionUserEmail, "Revocar sesiones");
      await clickDialogButton(page, "Cancelar");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(queryScalar(`select token from "user" where email = '${actionUserEmail}';`)).toBe(tokenBefore);

      // Confirmar revoca: rota el token e invalida la sesión previa.
      await clickRowButton(page, "/resources/users", actionUserEmail, "Revocar sesiones");
      await clickDialogButton(page, "Revocar");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect
        .poll(() => queryScalar(`select token from "user" where email = '${actionUserEmail}';`))
        .not.toBe(tokenBefore);

      await userPage.goto("/");
      await expect(userPage).toHaveURL(/\/login$/);
      await userContext.close();
    });

    await test.step("Desactivar y reactivar usuario sin revivir la sesión vieja", async () => {
      // Sesión previa del usuario, capturada mientras está activo.
      const oldContext: BrowserContext = await context.browser()!.newContext({ baseURL: appBaseUrl });
      const oldPage = await oldContext.newPage();
      await login(oldPage, actionUserEmail, actionUserPassword);
      await expect(oldPage).toHaveURL(/\/$/);

      // Desactivar rota el token: la sesión previa deja de funcionar.
      await clickRowButton(page, "/resources/users", actionUserEmail, "Desactivar");
      await clickDialogButton(page, "Desactivar");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect
        .poll(() => queryScalar(`select is_active from "user" where email = '${actionUserEmail}';`))
        .toBe("f");
      await oldPage.goto("/");
      await expect(oldPage).toHaveURL(/\/login$/);

      // Activar (confirmación opcional: sin diálogo) reactiva la cuenta.
      await clickRowButton(page, "/resources/users", actionUserEmail, "Activar");
      await expect
        .poll(() => queryScalar(`select is_active from "user" where email = '${actionUserEmail}';`))
        .toBe("t");

      // La sesión vieja sigue inválida tras reactivar (no se revive el token previo).
      await oldPage.goto("/");
      await expect(oldPage).toHaveURL(/\/login$/);
      await oldContext.close();

      // Pero el usuario reactivado puede iniciar sesión de nuevo.
      const freshContext: BrowserContext = await context.browser()!.newContext({ baseURL: appBaseUrl });
      const freshPage = await freshContext.newPage();
      await login(freshPage, actionUserEmail, actionUserPassword);
      await expect(freshPage).toHaveURL(/\/$/);
      await freshContext.close();
    });

    await test.step("Bloquear desactivar al último administrador vía acción", async () => {
      await clickRowButton(page, "/resources/users", adminEmail, "Desactivar");
      await clickDialogButton(page, "Desactivar");

      await expect(page.getByRole("dialog").getByRole("alert")).toContainText("administrador");
      expect(queryScalar(`select is_active from "user" where email = '${adminEmail}';`)).toBe("t");

      await clickDialogButton(page, "Cancelar");
      await page.goto("/resources/users");
      await expect(page.getByRole("heading", { name: "Usuarios" })).toBeVisible();
    });

    await test.step("Eliminar rol normal con confirmación", async () => {
      await page.goto("/resources/roles");
      await page.getByRole("link", { name: "Nuevo" }).click();
      await expect(page.getByRole("heading", { name: "Crear Roles" })).toBeVisible();
      await page.getByLabel("Nombre").fill(actionRoleName);
      await page.getByLabel("Descripción").fill("Rol para escenario de eliminación");
      await page.getByRole("button", { name: "Crear" }).click();
      await expect(page).toHaveURL(/\/resources\/roles$/);

      await clickRowButton(page, "/resources/roles", actionRoleName, "Eliminar");
      await clickDialogButton(page, "Eliminar");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      // Baja lógica: el rol queda inactivo (is_active=false).
      await expect
        .poll(() => queryScalar(`select is_active from role where name = '${actionRoleName}';`))
        .toBe("f");
    });

    await test.step("Rechazar eliminar el rol administrador fundacional", async () => {
      await clickRowButton(page, "/resources/roles", systemAdminRoleName, "Eliminar");
      await clickDialogButton(page, "Eliminar");

      await expect(page.getByRole("dialog").getByRole("alert")).toContainText("administrador");
      // Sin datos parciales: el rol fundacional sigue activo.
      expect(queryScalar(`select is_active from role where name = '${systemAdminRoleName}';`)).toBe("t");
      await clickDialogButton(page, "Cancelar");
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
      // admin + usuario estándar + usuario de acciones.
      expect(queryScalar('select count(*) from "user";')).toBe("3");
      // fundacional + Operación + Soporte Actualizado + Rol Acciones (baja lógica).
      expect(queryScalar("select count(*) from role;")).toBe("4");
      expect(queryScalar(`select count(*) from role where name = '${updatedRoleName}';`)).toBe("1");
      expect(queryScalar(`select count(*) from "user" where email = '${updatedEmail}';`)).toBe("1");
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

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(frontendRoot, "..");
const composeFile = resolve(repoRoot, "compose.e2e.yml");
const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:31080";

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = process.platform === "win32" ? spawnWindows(command, args, options) : spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: options.stdio ?? "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      }
    });
  });
}

function spawnWindows(command, args, options) {
  return spawn([command, ...args].map(quoteWindowsArg).join(" "), {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    shell: true,
    stdio: options.stdio ?? "inherit",
  });
}

function quoteWindowsArg(value) {
  if (!/[\s"]/u.test(value)) return value;
  return `"${value.replaceAll('"', '\\"')}"`;
}

async function waitForApp() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // Services are still starting.
    }
    await delay(1_000);
  }
  throw new Error(`E2E app did not become ready at ${baseUrl}`);
}

async function main() {
  await run("npx", ["playwright", "install", "chromium"], { cwd: frontendRoot });
  await run("docker", ["compose", "-f", composeFile, "down", "-v", "--remove-orphans"]);
  try {
    await run("docker", ["compose", "-f", composeFile, "up", "-d", "--build"]);
    await waitForApp();
    await run("npx", ["playwright", "test", "--project=chromium", "e2e/bootstrap.setup.spec.ts"], {
      cwd: frontendRoot,
      env: { E2E_BASE_URL: baseUrl },
    });
  } finally {
    await run("docker", ["compose", "-f", composeFile, "down", "-v", "--remove-orphans"]).catch(
      () => {},
    );
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
